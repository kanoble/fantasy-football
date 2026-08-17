-- How firm a price is, so the rail can say who will still be there.
--
-- `/market` ranks by residual, which answers "who is the best value in the
-- draft". A drafter is only ever asking "who is the best value I can still
-- get". The difference is availability, and availability needs the one thing
-- every price on the board is missing: a spread. adp_projections carries a
-- single number per player and nothing about how firm it is, so the board can
-- only treat a price as a promise.
--
-- adp_history has carried the spread since 0007 and nothing has read it —
-- times_drafted, high, low and stdev, per player per season, from FFC. This
-- exposes the current season's for the players on this year's board.
--
-- ---------------------------------------------------------------------------
-- WHY A NEW FUNCTION RATHER THAN A WIDER market_value().
--
-- They are different facts about different things, and it took a measurement to
-- see that widening was wrong rather than merely inelegant.
--
--   market_value()  a career figure, over every season a player was priced
--   adp_spread()    one season's price and how much the room disagreed about it
--
-- Both are one row per player, so folding them together would typecheck and
-- would read as a tidy saving. It would also mean DROP and recreate, because
-- Postgres cannot change a function's return type with CREATE OR REPLACE — and
-- dropping a function drops its grants, which is the 0005 lesson. Doing that to
-- a function the newest screen already depends on, to add a column about a
-- different subject, is the risk 0010 declined to take against draft_board()
-- for the same reason. This is purely additive: nothing is dropped or narrowed.
--
-- ---------------------------------------------------------------------------
-- THE JOIN IS ON norm_name, AND IT BEATS player_id BY ONE ROW.
--
-- Measured across the 179 board rows inside the first 192 picks: norm_name
-- matches 178, player_id matches 177. adp_history.player_id is nullable by
-- design — 28 of the 261 FFC rows for 2026 have none — and an unmatched name is
-- exactly the case a spread is still wanted for. norm_name is also the key the
-- `drafted` table chose in 0005, and for the same reason: it is the one key both
-- ADP tables always have.
--
-- The single miss is Andy Borregales, ADP 153.6 — a kicker FFC's 2026 file does
-- not carry. He gets no spread, and lib/value.ts falls back to a step function
-- on his price alone rather than inventing a dispersion for him.
--
-- ---------------------------------------------------------------------------
-- THIS IS A TOP-OF-THE-DRAFT STATISTIC AND CANNOT BE ANYTHING ELSE.
--
-- FFC's 2026 file is 261 rows and its deepest price is 190.3, because FFC
-- publishes the draftable universe and not the long tail. Against a 1,050-row
-- board that is 221 matches overall and 178 of the 179 inside the draft — so
-- coverage is 99.4% exactly where the screen defaults to looking, and near zero
-- past pick 192. That is the same shape as market_value()'s own coverage and
-- the screen says so rather than implying completeness.
--
-- ---------------------------------------------------------------------------
-- WHY spread_adp IS RETURNED AND NOT JUST stdev.
--
-- Because the two prices are not the same number and the gap between them is
-- not inside the stdev. Measured over the 178 matched in-draft rows:
--
--   pearson correlation of the two prices        0.951
--   median absolute difference                  11.15 picks
--   median difference in units of FFC's stdev    1.20 sigma
--   p90 difference in units of FFC's stdev       2.74 sigma
--   rows differing by more than 2 sigma          42 of 178 (24%)
--
-- So a normal centred on Sleeper's price and given FFC's raw stdev would be
-- badly overconfident for a quarter of the board: Saquon Barkley is 13.9 to
-- Sleeper and 20.1 to FFC with a stdev of 3.5, and a model that believed the
-- first two figures together would say he cannot possibly last, while the drafts
-- FFC actually observed have him going 6 picks later with a low of 33.
--
-- The correlation between the gap and the stdev is only 0.427, which is what
-- says the disagreement is a separate uncertainty rather than one the stdev
-- already contains. lib/value.ts adds the two in quadrature; that arithmetic is
-- a judgment and belongs in TypeScript where a test can assert on it, so this
-- function returns both raw numbers and does no combining of its own.
--
-- SECURITY INVOKER like every other read here, so 0002's allowlist applies
-- unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.adp_spread(
    p_adp_season integer default 2026,
    -- Named rather than assumed, exactly as market_value() and draft_value()
    -- name it: adp_history's primary key includes `source` because one player in
    -- one season legitimately carries a price from more than one aggregator, and
    -- a spread read across a mixture would be partly a disagreement between
    -- rooms and partly a disagreement between aggregators.
    p_source     text default 'ffc_ppr_12'
)
returns table (
    -- The join key, not the player's name. norm_name is what the board row
    -- already has for every player including the unmatched ones.
    norm_name     text,
    -- This source's own price for the same player. Returned because the gap
    -- between it and the board's price is evidence, not noise — see above.
    spread_adp    double precision,
    -- Standard deviation of the pick he actually went at, across the drafts
    -- below. Nullable in the table; a row with none is no more useful than a
    -- missing row, so those are filtered out here rather than returned as holes
    -- the caller has to remember to check.
    stdev         double precision,
    -- How many drafts stand behind it. 1,296 for Gibbs and 96 at the back of
    -- the draft, so a spread is not equally trustworthy down the board, and the
    -- rail dims thin evidence the same way the chart dims a one-season dot.
    times_drafted integer
)
language sql
stable
set search_path = public
as $$
    select
        h.norm_name,
        h.adp,
        h.stdev,
        h.times_drafted
    from adp_history h
    where h.season = p_adp_season
      and h.source = p_source
      and h.stdev is not null
      -- Scoped to this year's board at the end, like market_value(). Nothing
      -- above is ranked or aggregated, so this only narrows the output.
      and exists (
          select 1
          from adp_projections a
          where a.season    = p_adp_season
            and a.norm_name = h.norm_name
            and a.adp_ppr is not null
      );
$$;

revoke execute on function public.adp_spread(integer, text) from public, anon;
grant execute on function public.adp_spread(integer, text) to authenticated;
