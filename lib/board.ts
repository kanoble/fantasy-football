/**
 * The seasons the board reads.
 *
 * ADP is for the season being drafted; the distribution is last completed
 * season, because nflverse has no rows for the current one during preseason.
 * Both are constants rather than "now", so the board cannot silently start
 * rendering an empty season the day the calendar rolls over.
 */
export const ADP_SEASON = 2026;
export const STAT_SEASON = 2025;

/**
 * Fixed axis, 0–56. Every row is on one scale, or a tight end looks like a
 * running back. 56 clears the largest score in the published set — Gibbs's
 * 55.4-point week 12 of 2025 — so nothing clips.
 */
export const AXIS_MAX = 56;

/**
 * Inherited from the CLI (`CEILING_THRESHOLD` / `FLOOR_THRESHOLD` in
 * `analysis/compare.py`). Reasonable for a skill player and wrong for a
 * quarterback; they want to vary by position once quarterbacks are on the
 * board. Kept identical to the CLI for now so the two agree.
 */
export const CEILING = 20;
export const FLOOR = 10;

/**
 * How many players `/compare` will put side by side.
 *
 * Three, because the plots share one axis and a fourth column pushes the shared
 * scale narrow enough that the shapes stop being comparable — which is the only
 * thing the screen is for. Extra ids in the URL are dropped rather than
 * rendered small.
 */
export const MAX_COMPARE = 3;

/** One row of `draft_board()`. */
export type BoardRow = {
  player_id: string | null;
  name: string;
  position: string | null;
  team: string | null;
  /**
   * The key a drafted mark is stored under — `adp_projections`' own primary key
   * alongside `season`, and never shown to anyone.
   *
   * It comes from the server rather than being derived here because it cannot
   * be: `normalize_name()` in `ff/identity/crosswalk.py` strips generational
   * suffixes ("Marvin Harrison Jr." → "marvin harrison") and `normaliseName`
   * below does not. They are different functions for different jobs — one is a
   * join key, the other serves a hurried search box — and the drafted table has
   * to be keyed on the one the pipeline actually stored.
   */
  norm_name: string;
  adp: number;
  projected_points: number | null;
  injury_status: string | null;
  games: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
  ceiling_weeks: number;
  floor_weeks: number;
  best: number | null;
  weeks: number[] | null;
  points: number[] | null;
  career_games: number;
};

/**
 * One row of `player_cards()`, which returns `draft_board()`'s shape for a
 * named set of players rather than for the whole ADP list.
 *
 * `BoardRow` on purpose — the player page and the compare page draw the same
 * plot from the same numbers, and a parallel-but-different type is how the two
 * would drift — with one honest narrowing. A board row's `player_id` is
 * nullable because an ADP name can resolve to nobody; a card is built outward
 * from `player_index`, where the id is the primary key, so it always has one.
 * That is why the card routes never render an `unmatched` state.
 */
export type PlayerCard = Omit<BoardRow, "player_id"> & { player_id: string };

/** One row of `player_seasons()` — a single season of one player's career. */
export type SeasonRow = {
  player_id: string;
  season: number;
  games: number;
  total: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
  ceiling_weeks: number;
  floor_weeks: number;
  best: number | null;
  weeks: number[] | null;
  points: number[] | null;
};

/** One row of `scored_weekly_stats`, as returned by `player_week_log()`. */
export type WeekRow = {
  player_id: string;
  season: number;
  week: number;
  season_type: string;
  player_name: string | null;
  position: string | null;
  team: string | null;
  fantasy_points: number;
  passing_yards: number | null;
  passing_tds: number | null;
  passing_interceptions: number | null;
  passing_2pt_conversions: number | null;
  rushing_yards: number | null;
  rushing_tds: number | null;
  rushing_2pt_conversions: number | null;
  rushing_fumbles_lost: number | null;
  receptions: number | null;
  receiving_yards: number | null;
  receiving_tds: number | null;
  receiving_2pt_conversions: number | null;
  receiving_fumbles_lost: number | null;
  sack_fumbles_lost: number | null;
  special_teams_tds: number | null;
  fg_made_0_19: number | null;
  fg_made_20_29: number | null;
  fg_made_30_39: number | null;
  fg_made_40_49: number | null;
  fg_made_50_59: number | null;
  fg_made_60_: number | null;
  pat_made: number | null;
};

/**
 * The slim row the pickers on `/player` and `/compare` search over.
 *
 * Deliberately without the weeks and points arrays: the board ships those
 * because it draws them, and a list you are scanning for a name would carry
 * ~15,000 floats it never renders. Derived from the same `draft_board()` read
 * rather than a query of its own.
 */
export type PlayerOption = {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  adp: number;
  games: number;
  median: number | null;
};

/**
 * Fold a name to something a hurried search box can match. Strips accents and
 * punctuation, so "amonra" finds Amon-Ra St. Brown and "jamarr" finds Ja'Marr
 * Chase — the apostrophes and hyphens nobody types under time pressure during
 * a draft.
 *
 * Shared by the board's find box and both pickers. Three copies of this is
 * three subtly different ideas of what matches.
 */
export const normaliseName = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "");

export type Freshness = {
  last_success: string | null;
  last_full_refresh: string | null;
  rules_fingerprint: string | null;
};

/**
 * The dateline: which season this is, and how old the numbers are.
 *
 * Identical on every screen, which is the point — it is a dateline rather than
 * a caption, so there is one place to look for "how current is this" whether
 * you are on the board or in a career.
 *
 * Reads `last_success` from `pipeline_runs`, never `pipeline_meta`'s
 * `last_full_refresh`. The latter only moves on a *full* rebuild, and an
 * incremental run republishes ADP and the current season without touching it —
 * so a line reading that column would report data days older than it is.
 *
 * Returns the relative age only. The absolute stamp goes in a `title`, because
 * pages revalidate hourly and a rendered "6h ago" can itself be an hour stale;
 * `datelineStamp` below is what does not drift.
 */
export function dateline(freshness: Freshness | null): string {
  const stamp = freshness?.last_success;
  if (!stamp) return `${ADP_SEASON} season · data as of —`;

  const hours = Math.floor((Date.now() - new Date(stamp).getTime()) / 3_600_000);
  const age =
    hours < 1 ? "just now" : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;

  return `${ADP_SEASON} season · data ${age}`;
}

/** The unambiguous version of the above, for the `title` attribute. */
export function datelineStamp(freshness: Freshness | null): string | undefined {
  const stamp = freshness?.last_success;
  if (!stamp) return undefined;
  return `Last successful refresh ${new Date(stamp).toISOString().slice(0, 16).replace("T", " ")}Z`;
}

/**
 * Three states a row can be in that are not "a player with a season", and which
 * look identical on screen unless deliberately told apart.
 *
 * - `unmatched` — the ADP name resolved to nobody in `player_index`. An empty
 *   row that is a lie, and the one state worth flagging in red: it means the
 *   board is silent about a player it should have something to say about.
 * - `rookie` — resolved, but no NFL regular-season week in any season.
 * - `absent` — resolved, has a career, played none of the stat season.
 */
export type RowState = "ok" | "unmatched" | "rookie" | "absent";

export function rowState(row: BoardRow): RowState {
  if (!row.player_id) return "unmatched";
  if (row.games > 0) return "ok";
  return row.career_games > 0 ? "absent" : "rookie";
}
