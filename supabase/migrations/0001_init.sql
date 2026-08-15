-- Initial schema for the hosted league app.
--
-- Design notes worth knowing before changing anything here:
--
-- 1. Every table below is a CACHE, not a system of record. nflverse parquet and
--    the Sleeper API are the sources of truth, and both are public and
--    permanent. The refresh job rebuilds these tables wholesale on every run
--    (~4s for a decade of history), so a scoring-rule change propagates by
--    itself on the next tick. Nothing here needs backfilling or versioning.
--
-- 2. Because refresh is a full replace, there are no upserts and no
--    "last_updated per row" bookkeeping. The job truncates and COPYs inside one
--    transaction, so readers never see a partially-rebuilt table.
--
-- 3. RLS is on everywhere and there is no anonymous policy. Unauthenticated
--    visitors can read nothing. The refresh job connects as the service role
--    and bypasses RLS; the web app reads as an authenticated user.

-- ---------------------------------------------------------------------------
-- Scored weekly stats — the core table.
--
-- One row per player-week, already scored under the league's rules. Carries the
-- 22 stat columns the scoring rules actually read (not all 150 nflverse
-- columns) so the UI can explain a score, not just assert it.
-- ---------------------------------------------------------------------------
create table if not exists scored_weekly_stats (
    player_id                 text    not null,   -- nflverse gsis_id
    season                    integer not null,
    week                      integer not null,
    season_type               text    not null,   -- REG / POST
    player_name               text,
    position                  text,
    team                      text,

    fantasy_points            double precision not null,

    -- Passing
    passing_yards             double precision,
    passing_tds               double precision,
    passing_interceptions     double precision,
    passing_2pt_conversions   double precision,
    -- Rushing
    rushing_yards             double precision,
    rushing_tds               double precision,
    rushing_2pt_conversions   double precision,
    rushing_fumbles_lost      double precision,
    -- Receiving
    receptions                double precision,
    receiving_yards           double precision,
    receiving_tds             double precision,
    receiving_2pt_conversions double precision,
    receiving_fumbles_lost    double precision,
    -- Other offense
    sack_fumbles_lost         double precision,
    special_teams_tds         double precision,
    -- Kicking
    fg_made_0_19              double precision,
    fg_made_20_29             double precision,
    fg_made_30_39             double precision,
    fg_made_40_49             double precision,
    fg_made_50_59             double precision,
    fg_made_60_               double precision,
    pat_made                  double precision,

    primary key (player_id, season, week, season_type)
);

-- The two access patterns: one player's history, and one week's leaderboard.
create index if not exists idx_scored_player_season
    on scored_weekly_stats (player_id, season);
create index if not exists idx_scored_season_week
    on scored_weekly_stats (season, week, season_type);
-- Ranking within a week/position, e.g. "top RBs in week 4".
create index if not exists idx_scored_position_points
    on scored_weekly_stats (season, week, position, fantasy_points desc);

-- ---------------------------------------------------------------------------
-- Player index — the searchable universe, including rookies with no stat rows.
-- ---------------------------------------------------------------------------
create table if not exists player_index (
    player_id     text primary key,               -- gsis_id
    name          text not null,
    norm_name     text not null,                  -- normalised for matching
    position      text,
    team          text,
    latest_season integer
);

create index if not exists idx_player_index_norm_name on player_index (norm_name);
create index if not exists idx_player_index_position on player_index (position);

-- ---------------------------------------------------------------------------
-- ADP and projections from Sleeper.
--
-- adp is null where Sleeper has no data (their API encodes that as 999, which
-- is normalised away on ingest so nobody mistakes it for a draft position).
-- ---------------------------------------------------------------------------
create table if not exists adp_projections (
    season           integer not null,
    player_id        text,                        -- gsis_id, null if unmatched
    sleeper_name     text    not null,
    norm_name        text    not null,
    position         text,
    team             text,
    adp_ppr          double precision,
    projected_points double precision,
    injury_status    text,
    primary key (season, norm_name)
);

create index if not exists idx_adp_player on adp_projections (player_id, season);
create index if not exists idx_adp_season_adp on adp_projections (season, adp_ppr);

-- ---------------------------------------------------------------------------
-- Injury news.
--
-- The RotoWire feed is a ~5-item sliding window, so history exists only if we
-- accumulate it. This is the ONE table that is not a full replace — rows are
-- appended and deduped on guid, because dropping it would lose data that
-- cannot be re-fetched.
-- ---------------------------------------------------------------------------
create table if not exists injury_news (
    guid        text primary key,
    title       text not null,
    summary     text,
    link        text,
    published   text,
    ingested_at timestamptz not null default now()
);

create index if not exists idx_injury_news_ingested on injury_news (ingested_at desc);

-- ---------------------------------------------------------------------------
-- Pipeline metadata — a single row.
--
-- Holds the fingerprint of the scoring rules that produced the currently
-- published data. The refresh job compares it against the live rules and
-- forces a full rebuild when they differ. This is what makes an incremental
-- refresh safe: completed seasons can be skipped, because a scoring change is
-- detected rather than assumed not to happen.
-- ---------------------------------------------------------------------------
create table if not exists pipeline_meta (
    id                  integer primary key default 1,
    rules_fingerprint   text,
    last_full_refresh   timestamptz,
    constraint single_row check (id = 1)
);

-- ---------------------------------------------------------------------------
-- Pipeline run log. Cron failures are invisible without one.
-- ---------------------------------------------------------------------------
create table if not exists pipeline_runs (
    id          bigserial primary key,
    started_at  timestamptz not null default now(),
    finished_at timestamptz,
    status      text not null default 'running',  -- running / ok / error
    mode        text,                             -- full / incremental
    reason      text,                             -- why a full rebuild happened
    rows_written jsonb,
    error       text
);

create index if not exists idx_pipeline_runs_started on pipeline_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- Row level security.
--
-- Enabled on every table with read-only policies for authenticated users and
-- NO anonymous policy at all. The email allowlist is enforced at the auth
-- layer; this is the second line of defence, so a missing check in the app
-- cannot expose league data to an unauthenticated visitor.
--
-- The refresh job uses the service role key, which bypasses RLS by design.
-- That key must never reach the browser.
-- ---------------------------------------------------------------------------
alter table scored_weekly_stats enable row level security;
alter table player_index        enable row level security;
alter table adp_projections     enable row level security;
alter table injury_news         enable row level security;
alter table pipeline_runs       enable row level security;
alter table pipeline_meta       enable row level security;

drop policy if exists "authenticated read" on scored_weekly_stats;
create policy "authenticated read" on scored_weekly_stats
    for select to authenticated using (true);

drop policy if exists "authenticated read" on player_index;
create policy "authenticated read" on player_index
    for select to authenticated using (true);

drop policy if exists "authenticated read" on adp_projections;
create policy "authenticated read" on adp_projections
    for select to authenticated using (true);

drop policy if exists "authenticated read" on injury_news;
create policy "authenticated read" on injury_news
    for select to authenticated using (true);

-- pipeline_runs deliberately has NO read policy: operational data, service
-- role only. Add one if the app ever needs to show "last updated".
