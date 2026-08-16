-- The read path for the web UI.
--
-- Everything the board needs, computed in Postgres and returned in one round
-- trip. No Python at request time: `compare_players()` scores in-process from
-- nflverse, which is right for a CLI and wrong for a web app. These queries run
-- against the already-published tables instead.
--
-- Both functions are SECURITY INVOKER (the default), so the allowlist policies
-- from 0002 still apply. A JWT whose email is not in league_members reads zero
-- rows through them, exactly as it reads zero rows from the tables directly.

-- ---------------------------------------------------------------------------
-- draft_board — one row per player with an ADP, with the season's distribution.
--
-- The board plots every week as a dot, so the per-week points come back as an
-- array rather than being aggregated away. ~923 rows for the 2026 ADP, each
-- carrying ~17 floats: one query, a payload measured in hundreds of kilobytes,
-- and no N+1 over players.
--
-- percentile_cont is linear-interpolated, which is the same definition the
-- mockup used to pick the median and IQR shown in the design. percentile_disc
-- would round to an actual observed week and quietly disagree with it.
--
-- Aggregates are computed only over the requested season; career_games spans
-- every season, and is what separates a genuine rookie from a veteran who
-- missed the year. On screen those two look identical unless told apart.
-- ---------------------------------------------------------------------------
create or replace function public.draft_board(
    p_adp_season  integer,
    p_stat_season integer,
    p_ceiling     double precision default 20,
    p_floor       double precision default 10
)
returns table (
    player_id        text,
    name             text,
    -- Quoted: POSITION is a reserved word in a column definition (POSITION(x IN
    -- y)), so bare `position text` is a syntax error here. The quoted name is
    -- still plain `position` over the wire.
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
-- player_week_log — one player's season, with the stat columns behind a score.
--
-- Returned raw so the UI can show a week as arithmetic rather than asserting a
-- number: the 22 stored rule columns are exactly what makes that possible.
-- Hits idx_scored_player_season.
-- ---------------------------------------------------------------------------
create or replace function public.player_week_log(
    p_player_id text,
    p_season    integer
)
returns setof scored_weekly_stats
language sql
stable
set search_path = public
as $$
    select s.*
    from scored_weekly_stats s
    where s.player_id = p_player_id
      and s.season = p_season
      and s.season_type = 'REG'
    order by s.week;
$$;

revoke execute on function public.player_week_log(text, integer) from public, anon;
grant execute on function public.player_week_log(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Staleness.
--
-- 0001 left pipeline_meta with RLS on and no policy, and its comment documents
-- only pipeline_runs as deliberately closed — so the app could not answer "how
-- old is this?" at all. A read policy fixes that.
--
-- But pipeline_meta alone cannot answer it honestly. last_full_refresh is set
-- only when a FULL rebuild happens; an incremental run republishes ADP and the
-- current season without touching it. Reading it as "data as of" would show a
-- date days stale while the data underneath was hours old.
--
-- The truthful answer lives in pipeline_runs, which stays closed on purpose —
-- error strings and row counts are operational. So the timestamp is exposed
-- through a security-definer function that returns two columns and nothing
-- else, and re-checks the allowlist itself because security definer bypasses
-- the RLS that would otherwise do it.
-- ---------------------------------------------------------------------------
drop policy if exists "allowlisted read" on pipeline_meta;
create policy "allowlisted read" on pipeline_meta
    for select to authenticated using ((select public.is_league_member()));

create or replace function public.data_freshness()
returns table (
    last_success      timestamptz,
    last_full_refresh timestamptz,
    rules_fingerprint text
)
language sql
stable
security definer
set search_path = public
as $$
    select
        (select max(r.finished_at) from pipeline_runs r where r.status = 'ok'),
        m.last_full_refresh,
        m.rules_fingerprint
    from pipeline_meta m
    where m.id = 1
      and public.is_league_member();
$$;

revoke execute on function public.data_freshness() from public, anon;
grant execute on function public.data_freshness() to authenticated;
