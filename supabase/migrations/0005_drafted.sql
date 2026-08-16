-- Mark players drafted, live, during the draft.
--
-- The board is a draft-*prep* screen: it ranks 923 players against a static ADP
-- list. During the draft itself that list is wrong within minutes, because a
-- third of it is already gone. This migration adds the one fact that turns prep
-- into a draft-day screen — a player is taken, or he is not.
--
-- This is the app's FIRST WRITE PATH. Every policy before this one is read-only,
-- so the insert and delete policies below are the first that need the
-- non-member case exercised rather than assumed.
--
-- No conflict with the read-only guarantee in README.md: that is a promise about
-- *Yahoo*, and this writes only to a table of our own.

-- ---------------------------------------------------------------------------
-- The table.
--
-- Keyed on (season, norm_name), which is adp_projections' own primary key, and
-- deliberately NOT on player_id. 92 of the 923 ADP rows have a null player_id,
-- and exactly one of them is inside the 192 picks of a 12-team draft: Kenny
-- Gainwell, RB TB, ADP 110.8. The rest sit at ADP 246+. Keying on player_id
-- would leave one real, draftable player permanently unmarkable, and the symptom
-- would be a button that silently does nothing.
--
-- NO FOREIGN KEY to adp_projections, and this is load-bearing rather than an
-- omission. ff.pipeline.replace_table() runs `TRUNCATE adp_projections` on every
-- daily refresh; a referencing FK makes that TRUNCATE fail outright, and
-- TRUNCATE ... CASCADE would silently delete the draft. The table stands alone
-- and a mark for a name that later leaves the ADP list is simply inert.
--
-- `season` scopes a mark to one draft rather than forever, so next year starts
-- empty without anybody remembering to clear this.
-- ---------------------------------------------------------------------------
create table if not exists drafted (
    season     integer     not null,
    norm_name  text        not null,
    drafted_at timestamptz not null default now(),
    -- Who pressed the button, not which fantasy team took the player. The app
    -- deliberately knows nothing about the league having teams (see "Scope:
    -- draft prep first"); this is an audit column on a shared mutable table.
    -- Nullable on purpose: auth.jwt() is null for the service role, and an
    -- operational insert should not fail on a bookkeeping column.
    marked_by  text        default lower(auth.jwt() ->> 'email'),

    primary key (season, norm_name)
);

-- ---------------------------------------------------------------------------
-- Policies.
--
-- Same shape as the read policies in 0002, extended to writes. The `(select ...)`
-- wrapper around the membership call is load-bearing for performance, not style
-- — called bare it is re-evaluated per candidate row; wrapped, it is an InitPlan
-- evaluated once per query.
--
-- There is deliberately NO UPDATE policy. A mark is inserted or deleted, never
-- edited, which is exactly what a toggle does — so the absent policy is the
-- schema agreeing with the UI rather than a gap.
-- ---------------------------------------------------------------------------
alter table drafted enable row level security;

drop policy if exists "allowlisted read" on drafted;
create policy "allowlisted read" on drafted
    for select to authenticated using ((select public.is_league_member()));

drop policy if exists "allowlisted insert" on drafted;
create policy "allowlisted insert" on drafted
    for insert to authenticated with check ((select public.is_league_member()));

drop policy if exists "allowlisted delete" on drafted;
create policy "allowlisted delete" on drafted
    for delete to authenticated using ((select public.is_league_member()));

-- The revoke has to name `authenticated` explicitly, and this is the one line
-- here most likely to be "tidied" away by someone who checks that the grants
-- below already hold. Supabase ships default privileges that grant ALL on every
-- new table in `public` to `authenticated`, so a bare `grant select, insert,
-- delete` is a no-op and the table arrives carrying UPDATE, TRUNCATE, TRIGGER
-- and REFERENCES as well.
--
-- UPDATE is held closed by the absent UPDATE policy above. TRUNCATE is not:
-- **RLS is not consulted for TRUNCATE at all**, so the table privilege is the
-- only thing standing in front of it. On the published tables that is harmless
-- — they are a cache the cron rebuilds every morning. This table is the one
-- whose contents cannot be rebuilt from upstream: truncating it mid-draft loses
-- the draft, and no policy in this file would have been asked about it.
--
-- Every other table in the schema still carries the default grants. That is
-- pre-existing and out of scope here, but it is the same shape of hole.
revoke all on public.drafted from public, anon, authenticated;
grant select, insert, delete on public.drafted to authenticated;

-- ---------------------------------------------------------------------------
-- draft_board and player_cards gain norm_name.
--
-- The browser cannot compute this key itself. ff.identity.crosswalk.normalize_name
-- strips generational suffixes ("Marvin Harrison Jr." -> "marvin harrison");
-- normaliseName in lib/board.ts does not, because it serves a hurried search box
-- rather than a join. They are different functions for different jobs, and the
-- key has to be the one the pipeline actually stored.
--
-- Both functions are recreated in full rather than altered: Postgres cannot
-- change a function's return type with CREATE OR REPLACE. Dropping a function
-- also drops its grants, so the revoke/grant pair is re-applied below each one.
-- Bodies are otherwise character-for-character what 0003 and 0004 published.
-- ---------------------------------------------------------------------------
drop function if exists public.draft_board(integer, integer, double precision, double precision);

create function public.draft_board(
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
    -- The key a drafted mark is stored under. Not shown to anyone; it exists so
    -- the board can join its rows to the drafted table without guessing.
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
    career_games     integer
)
language sql
stable
set search_path = public
as $$
    with season_stats as (
        select
            s.player_id                                                        as pid,
            count(*)::integer                                                  as games,
            percentile_cont(0.5)  within group (order by s.fantasy_points)     as median,
            percentile_cont(0.25) within group (order by s.fantasy_points)     as q1,
            percentile_cont(0.75) within group (order by s.fantasy_points)     as q3,
            count(*) filter (where s.fantasy_points >= p_ceiling)::integer     as ceiling_weeks,
            count(*) filter (where s.fantasy_points <= p_floor)::integer       as floor_weeks,
            max(s.fantasy_points)                                              as best,
            array_agg(s.week order by s.week)                                  as weeks,
            array_agg(s.fantasy_points order by s.week)                        as points
        from scored_weekly_stats s
        where s.season = p_stat_season
          and s.season_type = 'REG'
        group by s.player_id
    ),
    career as (
        select s.player_id as pid, count(*)::integer as career_games
        from scored_weekly_stats s
        where s.season_type = 'REG'
        group by s.player_id
    )
    select
        a.player_id,
        a.sleeper_name,
        a.position,
        a.team,
        a.norm_name,
        a.adp_ppr,
        a.projected_points,
        a.injury_status,
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
    from adp_projections a
    left join season_stats ss on ss.pid = a.player_id
    left join career      c  on c.pid  = a.player_id
    where a.season = p_adp_season
      and a.adp_ppr is not null
    order by a.adp_ppr;
$$;

revoke execute on function public.draft_board(integer, integer, double precision, double precision)
    from public, anon;
grant execute on function public.draft_board(integer, integer, double precision, double precision)
    to authenticated;

-- ---------------------------------------------------------------------------
-- player_cards, same addition.
--
-- Sourced from player_index rather than the price CTE, and that is safe rather
-- than approximate: ff.pipeline.attach_player_ids joins ADP rows to player_index
-- *on norm_name*, so any ADP row with a player_id has by construction the same
-- norm_name as its player_index row. The two are one key space.
--
-- It is added here only so PlayerCard stays `BoardRow` with one honest narrowing
-- rather than becoming a parallel type that has to be kept in step by hand.
-- Neither /player nor /compare renders drafted state today.
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
