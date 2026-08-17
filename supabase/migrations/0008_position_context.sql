-- Give the axis a denominator.
--
-- Every plot in this app is drawn on a fixed 0-56 scale, which makes shapes
-- comparable and says nothing about the field. "Median 14.2" is a fact with no
-- referent: it is either an excellent running back or a replaceable one, and
-- the app has never been able to say which.
--
-- 0001 created idx_scored_position_points (season, week, position,
-- fantasy_points desc) for exactly this and nothing has ever used it.
--
-- ---------------------------------------------------------------------------
-- THE COHORT IS THE FEATURE.
--
-- Measured on 2025, the weekly median of *every* player labelled RB is 5.1
-- points, because 151 players carry that label and most of them are third on a
-- depth chart. A band built from that is flattering to everyone and tells a
-- drafter nothing. Restricted to the players a 12-team league actually starts,
-- the same median is 14.3.
--
-- The number moves enough that it cannot be buried:
--
--     top 12 RBs   p25 11.4   median 17.0   p75 22.8
--     top 24 RBs   p25  8.7   median 14.3   p75 20.1
--     top 36 RBs   p25  7.2   median 12.1   p75 18.7
--     all 151 RBs  p25  1.1   median  5.1   p75 11.4
--
-- So the cohort is derived rather than picked: `p_teams` × the starters a
-- standard lineup fields at that position. One stated assumption instead of
-- five magic numbers, and changing the league size changes every band
-- consistently.
--
-- THE ASSUMPTION, stated because it is one: a 12-team lineup starting 1 QB,
-- 2 RB, 3 WR (the flex assumed to be a receiver), 1 TE, 1 K. That is the
-- common shape, not this league's known shape — the Yahoo integration that
-- would tell us the real roster settings is still stubbed. When it lands, this
-- function is where the real numbers go, and every band moves at once.
-- ---------------------------------------------------------------------------

create or replace function public.position_starters(p_position text)
returns integer
language sql
immutable
as $$
    select case upper(p_position)
        when 'QB' then 1
        when 'RB' then 2
        when 'WR' then 3
        when 'TE' then 1
        when 'K'  then 1
        -- Anything else (defensive players carrying a stat line, an odd
        -- label) gets the flex-ish default rather than dividing by zero.
        else 2
    end;
$$;

-- ---------------------------------------------------------------------------
-- position_context — where a player sat among startable players at his
-- position, once per season of his career.
--
-- Returns one row per (player, season): his rank by season total inside the
-- cohort, how big that cohort is, and the cohort's weekly quartiles. The rank
-- answers "is 14.2 good"; the quartiles let a plot draw the field behind him.
--
-- A player outside the cohort still gets a row, with a rank past `cohort` —
-- "RB41 of 24" is a real and useful answer, and suppressing it would make the
-- season with the worst news the one that renders blank.
--
-- Position comes from the weeks themselves via mode(), not from
-- player_index.position: the index holds what he is *now*, and this function
-- exists to describe seasons up to a decade old. A receiver who finished his
-- career at tight end must be ranked against receivers in the years he was one.
--
-- SECURITY INVOKER like everything else here, so the 0002 allowlist applies.
-- ---------------------------------------------------------------------------
create or replace function public.position_context(
    p_player_ids text[],
    p_teams      integer default 12
)
returns table (
    player_id  text,
    season     integer,
    "position" text,
    rank       integer,
    cohort     integer,
    p25        double precision,
    p50        double precision,
    p75        double precision
)
language sql
stable
set search_path = public
as $$
    with me as (
        select
            s.player_id                                    as pid,
            s.season,
            mode() within group (order by s.position)      as pos
        from scored_weekly_stats s
        where s.player_id = any (p_player_ids)
          and s.season_type = 'REG'
          and s.position is not null
        group by s.player_id, s.season
    ),
    -- Only the (season, position) pairs the requested players actually appear
    -- in. Without this the ranking below is computed for the whole table.
    scope as (
        select distinct season, pos from me
    ),
    totals as (
        select
            s.player_id                               as pid,
            s.season,
            mode() within group (order by s.position) as pos,
            sum(s.fantasy_points)                     as total
        from scored_weekly_stats s
        where s.season_type = 'REG'
          and s.position is not null
          and (s.season, s.position) in (select season, pos from scope)
        group by s.player_id, s.season
    ),
    ranked as (
        select
            t.*,
            row_number() over (partition by t.season, t.pos order by t.total desc, t.pid)
                as rnk,
            (p_teams * position_starters(t.pos))::integer as cohort_size
        from totals t
    ),
    bands as (
        select
            r.season,
            r.pos,
            max(r.cohort_size)                                             as cohort_size,
            percentile_cont(0.25) within group (order by s.fantasy_points) as p25,
            percentile_cont(0.50) within group (order by s.fantasy_points) as p50,
            percentile_cont(0.75) within group (order by s.fantasy_points) as p75
        from ranked r
        join scored_weekly_stats s
          on s.player_id = r.pid
         and s.season    = r.season
         and s.season_type = 'REG'
        where r.rnk <= r.cohort_size
        group by r.season, r.pos
    )
    select
        me.pid,
        me.season,
        me.pos,
        r.rnk::integer,
        b.cohort_size,
        b.p25,
        b.p50,
        b.p75
    from me
    join ranked r on r.pid = me.pid and r.season = me.season
    left join bands b on b.season = me.season and b.pos = me.pos
    order by me.pid, me.season desc;
$$;

revoke execute on function public.position_context(text[], integer) from public, anon;
grant execute on function public.position_context(text[], integer) to authenticated;

revoke execute on function public.position_starters(text) from public, anon;
grant execute on function public.position_starters(text) to authenticated;
