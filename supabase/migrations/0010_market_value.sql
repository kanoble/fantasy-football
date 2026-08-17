-- What a price usually buys, so a chart can say who beat it.
--
-- 0009 gave a player page a Cost column and 0008 gave it a Rank, and the
-- legibility pass put the subtraction between them in a Delta column. All three
-- answer the question one player at a time. The value chart asks it of the whole
-- board at once: plot every player's cost against what he returned *above or
-- below what that price usually buys*, and the bargains are the dots at the top
-- rather than a diagonal the reader has to eyeball.
--
-- ---------------------------------------------------------------------------
-- WHY TWO FUNCTIONS AND NOT ONE.
--
-- They are different grains and neither one nests inside the other.
--
--   market_value()  one row per player      — a career figure
--   season_form()   one row per player-season — the recent window
--
-- Folding them together would mean repeating a career median on three season
-- rows, or returning parallel arrays whose alignment is a convention nobody can
-- check. Two round trips in the same Promise.all cost the slower of the two.
--
-- WHY NOT WIDEN draft_board(). Postgres cannot change a function's return type
-- with CREATE OR REPLACE, so widening it means DROP and recreate — and dropping
-- a function drops its grants, which is the 0005 lesson and the reason its
-- revoke/grant pair is repeated. Doing that to the function the entire board
-- depends on, for columns the board does not show, is risk with no return.
-- Measured before deciding: the delta joined into draft_board() takes it from
-- 183ms to 409ms, where a separate RPC inside the existing Promise.all makes the
-- wall clock the slower of the two, about 230ms.
--
-- Both are SECURITY INVOKER like every other read here, so 0002's allowlist
-- applies unchanged. Both are additive: nothing is dropped or narrowed.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- market_value — the career median of cost-minus-finish, per player.
--
-- One number for a whole career: typically, how many positional ranks a player
-- beats his own draft price by. Positive means he beat it. Amon-Ra St. Brown is
-- +5 across five priced seasons; Ja'Marr Chase is -3 across five; Christian
-- McCaffrey is 0 across nine, which is the right answer for a player who has
-- been either the best back in the league or injured.
--
-- This reproduces app/player/[id]/career.tsx's Delta column exactly, one season
-- at a time, and then takes the median of them. If it ever stops agreeing with
-- that column, one of the two is wrong and this file is the copy that has no
-- reader to notice.
--
-- ---------------------------------------------------------------------------
-- THE JOIN IS ON (player_id, season) AND DELIBERATELY NOT ON POSITION.
--
-- The two ranks come from two different position labels, and that is by design.
-- The cost rank takes FFC's label because it describes what the market *bought*;
-- the finish rank takes mode() over the played weeks because it describes what
-- the player *did*. They disagree on 8 of 1,818 pairs, 0.4% — 2025's only case
-- is Travis Hunter, drafted WR33 and playing corner. Joining on position as well
-- would silently drop exactly those seasons, and a dropped season is invisible
-- in a median. Joining on the player and the year keeps them, and "priced as a
-- receiver, finished as a corner" is a real thing to have happened.
--
-- THE TWO POOLS ARE DIFFERENT SIZES AND THIS NUMBER CANNOT HIDE IT. Cost is out
-- of the players drafted at that position (64 backs in 2025); finish is out of
-- everyone who played there (151). So McCaffrey's 2024 reads -67, and part of
-- that 67 is the second pool being larger rather than the season being that much
-- worse. It is an honest direction and a soft distance — which is exactly why the
-- chart puts it through a per-position moving median before drawing anything,
-- rather than plotting it raw.
--
-- MEDIAN, NOT MEAN, for the reason the whole app uses medians: McCaffrey's two
-- injury seasons (-53 and -67) drag a mean to -15.8 and describe a career he has
-- not had. percentile_cont interpolates, so an even number of seasons lands on
-- the midpoint of the two middle values — the same definition as median() in
-- lib/board.ts, which is what keeps the two agreeing.
--
-- The window is 2016+ without saying so: adp_history reaches back to 2012 but
-- scored_weekly_stats starts in 2016, so the inner join drops the four seasons
-- that have a price and nothing to compare it against.
-- ---------------------------------------------------------------------------
create or replace function public.market_value(
    p_adp_season integer default 2026,
    -- Named rather than assumed, for the reason draft_value() names it:
    -- adp_history's primary key includes `source` precisely because one player in
    -- one season can carry a price from more than one aggregator, and ranking
    -- across a mixture produces an ordinal that is partly a change in the players
    -- and partly a change in who was asked.
    p_source     text default 'ffc_ppr_12'
)
returns table (
    player_id      text,
    median_delta   double precision,
    -- How many seasons the median is drawn from. One priced season is a fact
    -- about one year wearing the clothes of a career, and the chart dims it.
    priced_seasons integer
)
language sql
stable
set search_path = public
as $$
    -- No scoping CTE on either ranking, unlike position_context(). Both sides
    -- rank set-wise — every player at that position in that season — so scoping
    -- to the requested players would change the ranks rather than just the rows.
    -- That is also what makes this cheap for a thousand players: the work is the
    -- same as for three.
    with cost as (
        select
            h.player_id,
            h.season,
            row_number() over (
                partition by h.season,
                    -- FFC spells kickers PK where nflverse spells them K. Folded
                    -- here the same way 0009 folds it: unfolded, all 184 kickers
                    -- rank in a pool of one.
                    case upper(h."position") when 'PK' then 'K' else upper(h."position") end
                -- adp, then player_id: ties are real (two players at 110.8) and a
                -- rerun on unchanged input must not reorder them.
                order by h.adp, h.player_id
            ) as cost_rank
        from adp_history h
        where h.source = p_source
          and h.player_id is not null
    ),
    totals as (
        select
            s.player_id,
            s.season,
            mode() within group (order by s.position) as pos,
            sum(s.fantasy_points)                     as total
        from scored_weekly_stats s
        where s.season_type = 'REG'
          and s.position is not null
        group by s.player_id, s.season
    ),
    finish as (
        select
            t.player_id,
            t.season,
            row_number() over (partition by t.season, t.pos order by t.total desc, t.player_id)
                as finish_rank
        from totals t
    ),
    deltas as (
        select
            c.player_id,
            c.season,
            (c.cost_rank - f.finish_rank) as delta
        from cost c
        join finish f
          on f.player_id = c.player_id
         and f.season    = c.season
    )
    select
        d.player_id,
        percentile_cont(0.5) within group (order by d.delta),
        count(*)::integer
    from deltas d
    -- Scoped to this year's board at the very end, so the ranks above are
    -- computed against the whole league and only the output is narrowed.
    where exists (
        select 1
        from adp_projections a
        where a.player_id = d.player_id
          and a.season    = p_adp_season
          and a.adp_ppr is not null
    )
    group by d.player_id;
$$;

revoke execute on function public.market_value(integer, text) from public, anon;
grant execute on function public.market_value(integer, text) to authenticated;


-- ---------------------------------------------------------------------------
-- season_form — median week and season total, for the last few seasons.
--
-- draft_board() already returns a median, for one season, alongside the weekly
-- arrays that make it 183ms and hundreds of kilobytes. This returns the two
-- figures the chart plots, for a window of seasons, and nothing else.
--
-- WHY A WINDOW AND NOT JUST LAST SEASON. The chart's vertical can be read over
-- 2025 alone or over three seasons weighted toward the recent one, and that is a
-- control the reader operates. Returning the raw per-season figures rather than a
-- pre-weighted number is what lets the toggle be instant: the weighting happens
-- in lib/value.ts, where it is a pure function over plain numbers and is covered
-- by tests. A function that returned the weighted answer would need a round trip
-- per flip, and would bury the weights in SQL where nothing can assert on them.
--
-- It also keeps the weights out of the database, which matters because they are a
-- judgment and not a fact. 3/2/1 is defensible and so is 5/3/1; the one that
-- ships should be visible in a file someone reads, not in a function body.
--
-- Regular season only, like every other aggregate here. A season with no rows
-- simply has no row: absence is the fact, and coalescing it to zero games and
-- zero points would assert that a player scored nothing in a year he did not
-- play — which is precisely the lie the chart's rail exists to avoid telling.
-- ---------------------------------------------------------------------------
create or replace function public.season_form(
    p_adp_season  integer default 2026,
    p_stat_season integer default 2025,
    -- How many seasons back the window reaches, inclusive of p_stat_season.
    -- A parameter rather than a literal 3 because nobody has tuned it, and the
    -- plan for this screen says to build it so it can be re-pointed.
    p_seasons     integer default 3
)
returns table (
    player_id text,
    season    integer,
    games     integer,
    median    double precision,
    total     double precision
)
language sql
stable
set search_path = public
as $$
    select
        s.player_id,
        s.season,
        count(*)::integer,
        -- percentile_cont, matching draft_board() exactly. percentile_disc would
        -- round to an observed week and quietly disagree with the board's own
        -- median for the same player and season.
        percentile_cont(0.5) within group (order by s.fantasy_points),
        sum(s.fantasy_points)
    from scored_weekly_stats s
    where s.season_type = 'REG'
      and s.season between p_stat_season - greatest(p_seasons, 1) + 1 and p_stat_season
      and exists (
          select 1
          from adp_projections a
          where a.player_id = s.player_id
            and a.season    = p_adp_season
            and a.adp_ppr is not null
      )
    group by s.player_id, s.season;
$$;

revoke execute on function public.season_form(integer, integer, integer) from public, anon;
grant execute on function public.season_form(integer, integer, integer) to authenticated;
