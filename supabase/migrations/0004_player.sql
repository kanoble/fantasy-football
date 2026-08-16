-- The read path for /player/[id] and /compare.
--
-- Both routes need the same two things: who a player is with their price
-- attached, and what their weeks looked like. 0003 answers that for the whole
-- ADP list at once (`draft_board`), which is the wrong shape for one player —
-- 923 rows fetched to render one of them, per player page, per cache miss.
--
-- Two functions rather than three, because /compare is /player with more than
-- one id: every function here takes an array and the single-player case is an
-- array of one. That also keeps the compare page to one round trip instead of
-- fanning out a query per player.
--
-- SECURITY INVOKER (the default), like everything in 0003, so the allowlist
-- policies from 0002 apply unchanged: a JWT whose email is not in
-- league_members reads zero rows through these too.

-- ---------------------------------------------------------------------------
-- player_cards — draft_board()'s row shape, for a named set of players.
--
-- Deliberately built from player_index outward rather than adp_projections,
-- which is the one structural difference from draft_board. The board only ever
-- shows players who have a price; a player page must still render for someone
-- who has none — a veteran nobody is drafting still has a career worth looking
-- at, and a URL that 404s on him would be a worse answer than an empty ADP
-- cell.
--
-- The input array's order is preserved and duplicates collapse, so /compare
-- renders its columns in the order the URL asked for rather than in whatever
-- order the planner returns rows.
-- ---------------------------------------------------------------------------
create or replace function public.player_cards(
    p_player_ids  text[],
    p_adp_season  integer,
    p_stat_season integer,
    p_ceiling     double precision default 20,
    p_floor       double precision default 10
)
returns table (
    player_id        text,
    name             text,
    -- Quoted for the same reason as in 0003: POSITION is a reserved word in a
    -- column definition list. Still plain `position` over the wire.
    "position"       text,
    team             text,
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
    career_games     integer
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
        coalesce(c.career_games, 0)
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

-- ---------------------------------------------------------------------------
-- player_seasons — the same distribution, once per season of a career.
--
-- This is the thing the board cannot show and the reason /player/[id] earns a
-- route rather than staying an expandable row: the board argues that a median
-- and a spread describe a player better than a per-game average, and a career
-- is that argument repeated down the years. Each season carries its own weeks
-- and points arrays so every one of them can be drawn on the same fixed axis.
--
-- A decade of seasons is ~17 floats each, so returning the arrays for all of
-- them costs less than the single draft_board() row that the board already
-- ships 923 of.
--
-- Regular season only, matching every other aggregate in this schema: weeks
-- 19-22 inflated Nacua's 2025 from 16 games/375.0 to 19/452.6.
-- ---------------------------------------------------------------------------
create or replace function public.player_seasons(
    p_player_ids text[],
    p_ceiling    double precision default 20,
    p_floor      double precision default 10
)
returns table (
    player_id     text,
    season        integer,
    games         integer,
    total         double precision,
    median        double precision,
    q1            double precision,
    q3            double precision,
    ceiling_weeks integer,
    floor_weeks   integer,
    best          double precision,
    weeks         integer[],
    points        double precision[]
)
language sql
stable
set search_path = public
as $$
    select
        s.player_id,
        s.season,
        count(*)::integer,
        sum(s.fantasy_points),
        percentile_cont(0.5)  within group (order by s.fantasy_points),
        percentile_cont(0.25) within group (order by s.fantasy_points),
        percentile_cont(0.75) within group (order by s.fantasy_points),
        count(*) filter (where s.fantasy_points >= p_ceiling)::integer,
        count(*) filter (where s.fantasy_points <= p_floor)::integer,
        max(s.fantasy_points),
        array_agg(s.week order by s.week),
        array_agg(s.fantasy_points order by s.week)
    from scored_weekly_stats s
    where s.player_id = any (p_player_ids)
      and s.season_type = 'REG'
    group by s.player_id, s.season
    order by s.player_id, s.season desc;
$$;

revoke execute on function public.player_seasons(text[], double precision, double precision)
    from public, anon;
grant execute on function public.player_seasons(text[], double precision, double precision)
    to authenticated;
