-- A decade of draft prices, so a price can be checked against what it returned.
--
-- The app scores every NFL week in this league's terms going back ten seasons.
-- It has never been able to say whether a player was *worth* his draft slot,
-- because it only ever knew one slot: ff.pipeline.replace_table() TRUNCATEs
-- adp_projections on every refresh, and ff.sources.sleeper serves the season
-- being drafted and nothing else. Every August, last August's prices were
-- overwritten.
--
-- This table is the other half of the comparison, backfilled once from Fantasy
-- Football Calculator (ff.sources.ffc) and thereafter appended to.
--
-- Deliberately NOT a widening of adp_projections, for three reasons:
--
--   1. adp_projections is a cache the cron rebuilds each morning. This is
--      accumulated history that cannot be re-derived if lost — the same
--      distinction 0001 draws for injury_news, and the reason that table is
--      the one exception to full replacement. Keeping them apart means the
--      daily TRUNCATE can never reach this.
--   2. The shapes differ. FFC carries times_drafted/high/low/stdev, which is
--      the evidence for how much a given season's number is worth; Sleeper
--      carries projected_points and injury_status, which are about the season
--      ahead rather than the draft.
--   3. They are different instruments. FFC aggregates FFC's drafters, Sleeper
--      aggregates Sleeper's. Storing both under one column named `adp` would
--      make a ten-year trend line that is partly a change in the players and
--      partly a change in who was asked.
-- ---------------------------------------------------------------------------
create table if not exists adp_history (
    season        integer not null,
    -- Which aggregator produced this number. In the primary key because the
    -- same player in the same season legitimately has one price per source,
    -- and a chart that mixes them should have to say so.
    source        text    not null,
    norm_name     text    not null,   -- ff.identity.normalize_name of `name`
    -- Resolved gsis_id, or null where the name matched nobody. Null rather
    -- than dropped, matching attach_player_ids(): an unmatched row is visible
    -- evidence about the crosswalk, and a missing row is not.
    player_id     text,
    name          text    not null,   -- as the source spelled it
    "position"    text,
    team          text,               -- the source's abbreviation, not nflverse's

    -- Overall pick number as a decimal (1.4 = mid first round), which is what
    -- FFC's `adp` field holds. Named to match adp_projections.adp_ppr's
    -- meaning rather than its name, because that column is PPR-specific and
    -- this one records its format in `source`.
    adp           double precision not null,

    -- How much the number is worth. A 2012 ADP drawn from 303 drafts and a
    -- 2025 one drawn from 8,470 are not equally trustworthy, and a stdev of
    -- 0.6 (Barkley, 2019, universally the 1.01) says something a stdev of 12
    -- does not. Nullable: not every source publishes them.
    times_drafted integer,
    high          integer,
    low           integer,
    stdev         double precision,

    primary key (season, source, norm_name)
);

-- The access pattern this exists for: one player's price history, on his page.
create index if not exists idx_adp_history_player
    on adp_history (player_id, season);

-- ---------------------------------------------------------------------------
-- Policies. Same shape as the read policies in 0002 — this is published data
-- like every other table here, gated on the same allowlist.
--
-- The `(select ...)` wrapper is load-bearing for performance, not style: bare,
-- the membership call is re-evaluated per candidate row.
-- ---------------------------------------------------------------------------
alter table adp_history enable row level security;

drop policy if exists "allowlisted read" on adp_history;
create policy "allowlisted read" on adp_history
    for select to authenticated using ((select public.is_league_member()));

-- Read-only to the app, written only by the backfill script running as the
-- service role. Naming `authenticated` explicitly for the reason 0005 spells
-- out: Supabase's default privileges grant ALL on every new public table to
-- `authenticated`, so a bare `grant select` would leave INSERT, UPDATE, DELETE
-- and TRUNCATE in place. TRUNCATE especially — RLS is not consulted for it at
-- all, and this is the second table in the schema whose contents cannot be
-- rebuilt from upstream on demand.
revoke all on public.adp_history from public, anon, authenticated;
grant select on public.adp_history to authenticated;
