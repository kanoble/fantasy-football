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

/** One row of `draft_board()`. */
export type BoardRow = {
  player_id: string | null;
  name: string;
  position: string | null;
  team: string | null;
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

export type Freshness = {
  last_success: string | null;
  last_full_refresh: string | null;
  rules_fingerprint: string | null;
};

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
