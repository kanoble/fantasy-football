-- Give a player page a player.
--
-- Until now `player_index` carried five columns — a name, a position, a team,
-- and the season it last saw him. That is enough to *rank* somebody and not
-- enough to *recognise* him, which is why /player/[id] reads as a spreadsheet
-- row with a chart under it rather than as a page about a person.
--
-- Every column below already exists in the nflverse roster file that
-- ff.analysis.players.player_index() has been reading since day one. They were
-- being selected away. This migration is the storage half of un-selecting them.
--
-- No backfill script. ff.pipeline.replace_table() TRUNCATEs and rewrites
-- player_index whole on every refresh, so the next cron run populates all ten
-- thousand rows. Until it does, these columns are null and every reader below
-- treats null as "unknown" rather than as an error.
-- ---------------------------------------------------------------------------

alter table player_index
    add column if not exists headshot_url  text,
    add column if not exists birth_date    date,
    add column if not exists college       text,
    add column if not exists jersey_number integer,
    add column if not exists years_exp     integer,
    add column if not exists draft_number  integer,
    add column if not exists draft_club    text,
    add column if not exists rookie_year   integer;

-- All nullable, and none of them defaulted. The gaps are real and differ by
-- column: measured against the 2025 roster file, 92 of 3,137 players have no
-- headshot, 163 have no birth date or college, and 1,281 have no draft number —
-- the last of those being every undrafted free agent, where null is not missing
-- data but the fact itself. A default would turn all three into a lie.

-- ---------------------------------------------------------------------------
-- player_cards gains the bio columns.
--
-- Only player_cards. draft_board() is deliberately left alone: the board draws
-- 923 rows and would carry eight more columns per row to render none of them,
-- and headshots are staying off the board on purpose — see the note in
-- next.config.ts about what a portrait per row costs.
--
-- Recreated in full rather than altered, for the reason 0005 already found:
-- Postgres cannot change a function's return type with CREATE OR REPLACE, and
-- dropping a function drops its grants, so the revoke/grant pair is re-applied
-- below. The body is character-for-character what 0005 published apart from the
-- eight columns in the returns clause and the eight in the final select.
-- ---------------------------------------------------------------------------
drop function if exists public.player_cards(text[], integer, integer, double precision, double precision);

create function public.player_cards(
    p_player_ids  text[],
    p_adp_season  integer,
    p_stat_season integer,
    p_ceiling     double precision default 20,
    p_floor       double precision default 10
)
returns table (
    player_id        text,
    name             text,
    -- Quoted: POSITION is a reserved word in a column definition list. Still
    -- plain `position` over the wire.
    "position"       text,
    team             text,
    norm_name        text,
    adp              double precision,
    projected_points double precision,
    injury_status    text,
    games            integer,
    median           double precision,
    q1               double precision,
    q3               double precision,
    ceiling_weeks    integer,
    floor_weeks      integer,
    best             double precision,
    weeks            integer[],
    points           double precision[],
    career_games     integer,
    headshot_url     text,
    birth_date       date,
    college          text,
    jersey_number    integer,
    years_exp        integer,
    draft_number     integer,
    draft_club       text,
    rookie_year      integer
)
language sql
stable
set search_path = public
as $$
    with ids as (
        select pid, min(ord) as ord
        from unnest(p_player_ids) with ordinality as t(pid, ord)
        group by pid
    ),
    season_stats as (
        select
            s.player_id                                                    as pid,
            count(*)::integer                                              as games,
            percentile_cont(0.5)  within group (order by s.fantasy_points) as median,
            percentile_cont(0.25) within group (order by s.fantasy_points) as q1,
            percentile_cont(0.75) within group (order by s.fantasy_points) as q3,
            count(*) filter (where s.fantasy_points >= p_ceiling)::integer as ceiling_weeks,
            count(*) filter (where s.fantasy_points <= p_floor)::integer   as floor_weeks,
            max(s.fantasy_points)                                          as best,
            array_agg(s.week order by s.week)                              as weeks,
            array_agg(s.fantasy_points order by s.week)                    as points
        from scored_weekly_stats s
        join ids on ids.pid = s.player_id
        where s.season = p_stat_season
          and s.season_type = 'REG'
        group by s.player_id
    ),
    career as (
        select s.player_id as pid, count(*)::integer as career_games
        from scored_weekly_stats s
        join ids on ids.pid = s.player_id
        where s.season_type = 'REG'
        group by s.player_id
    ),
    -- One ADP row per player, not one per name. Two Sleeper names can resolve
    -- to the same gsis_id, and without this the join would duplicate the
    -- player. Cheapest price wins, which is the one a drafter cares about.
    price as (
        select distinct on (a.player_id)
            a.player_id as pid,
            a.adp_ppr,
            a.projected_points,
            a.injury_status
        from adp_projections a
        join ids on ids.pid = a.player_id
        where a.season = p_adp_season
          and a.adp_ppr is not null
        order by a.player_id, a.adp_ppr
    )
    select
        p.player_id,
        p.name,
        p.position,
        p.team,
        p.norm_name,
        price.adp_ppr,
        price.projected_points,
        price.injury_status,
        coalesce(ss.games, 0),
        ss.median,
        ss.q1,
        ss.q3,
        coalesce(ss.ceiling_weeks, 0),
        coalesce(ss.floor_weeks, 0),
        ss.best,
        ss.weeks,
        ss.points,
        coalesce(c.career_games, 0),
        p.headshot_url,
        p.birth_date,
        p.college,
        p.jersey_number,
        p.years_exp,
        p.draft_number,
        p.draft_club,
        p.rookie_year
    from player_index p
    join ids                on ids.pid   = p.player_id
    left join season_stats ss on ss.pid  = p.player_id
    left join career       c  on c.pid   = p.player_id
    left join price          on price.pid = p.player_id
    order by ids.ord;
$$;

revoke execute on function public.player_cards(text[], integer, integer, double precision, double precision)
    from public, anon;
grant execute on function public.player_cards(text[], integer, integer, double precision, double precision)
    to authenticated;
