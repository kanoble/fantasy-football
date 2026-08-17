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

/** The league itself, for the chrome that names it. */
export const LEAGUE_NAME = "Noble Family Football";
export const LEAGUE_FOUNDED = 2021;

/**
 * Draft day, as an ISO date with no time.
 *
 * No time because nobody has fixed one, and an invented hour would render as
 * fact — the same reason the dateline shows a day count rather than a clock.
 * Update it each season alongside `ADP_SEASON`. A stale value fails quiet: the
 * dateline drops the segment entirely once the date has passed, rather than
 * counting down to a day in the past.
 */
export const DRAFT_DATE = "2026-08-30";

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
 * The domains `/compare`'s gauges are drawn on.
 *
 * Every gauge there runs an **absolute** scale rather than one fitted to
 * whoever happens to be in the comparison. That is the whole difference between
 * a mark that means something and a mark that only ranks the three players on
 * screen: fitting the scale to the selection makes every bar move when a player
 * is added or removed, so a reader learns nothing that survives the next
 * comparison.
 *
 * `AXIS_MAX` covers the points rows and is already the app's fixed axis.
 * These two cover the other domains:
 *
 * - `SEASON_GAMES` is a regular season. Nobody can exceed it, so a count of
 *   weeks has a true ceiling rather than a chosen one.
 * - `TOTAL_MAX` is **the one arbitrary number in the set**, and it is arbitrary
 *   because season points have no natural ceiling. 450 clears the largest
 *   season in the published set (McCaffrey's 416.6 in 2025) with room to spare.
 *   The honest alternative is the position cohort's best that year, which moves
 *   every season and would make two players' bars incomparable across
 *   positions — worse, for this screen, than a round number that never moves.
 */
export const SEASON_GAMES = 17;
export const TOTAL_MAX = 450;

/**
 * A score as a percentage across the fixed axis, clamped so nothing escapes
 * the track.
 *
 * Here rather than in `app/plot.tsx` because two things now need it: the plot
 * that draws the dots, and the hover layer that has to work out which dot a
 * pointer is nearest. A second copy of this arithmetic is exactly how a fixed
 * scale quietly stops being fixed — the same reason the plot was extracted
 * from the board in the first place.
 */
export const pct = (value: number) => Math.max(0, Math.min(100, (value / AXIS_MAX) * 100));

/**
 * The middle value, or the mean of the two middle ones.
 *
 * The app's own argument, applied to itself: a career's cost-versus-finish
 * deltas are a distribution with outliers — two injury seasons drag a mean
 * somewhere the career never was — and the same reasoning that puts a median
 * on every row of the board puts one on the summary above it.
 *
 * Copies before sorting: the caller's array is usually `points` or a mapped
 * projection of a query result, and sorting it in place would silently reorder
 * a season's weeks.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 === 1
    ? sorted[Math.floor(mid)]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * A delta with its sign always shown: `+5`, `-67`, `0`.
 *
 * The sign is the whole signal — it is what makes the column scannable — so it
 * is never implicit, and a plus is not a decoration that can be dropped when
 * the number is positive. Set in the mono face with tabular figures, so the
 * signs line up down the column and the eye can run past them.
 *
 * Whole numbers stay whole: a per-season delta is a difference of two ranks and
 * always is one. Only the median of an even number of seasons lands on a half,
 * and that is the one case worth a decimal.
 */
export function signedDelta(value: number): string {
  const shown = Number.isInteger(value) ? String(Math.abs(value)) : Math.abs(value).toFixed(1);
  if (value > 0) return `+${shown}`;
  if (value < 0) return `-${shown}`;
  return "0";
}

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
 * Who a player is, as opposed to how he scores.
 *
 * Carried by `player_cards()` and deliberately not by `draft_board()`: the
 * board renders 923 rows and would ship eight more columns per row to draw
 * none of them. Every field is nullable because every one of them is genuinely
 * missing for somebody — and `draft_number` is null for every undrafted free
 * agent, where the null *is* the fact rather than a gap in the data.
 */
export type PlayerBio = {
  headshot_url: string | null;
  /** ISO date. Rendered as an age, which is the form a drafter thinks in. */
  birth_date: string | null;
  college: string | null;
  jersey_number: number | null;
  years_exp: number | null;
  draft_number: number | null;
  draft_club: string | null;
  rookie_year: number | null;
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
 *
 * Bio is added here rather than to `BoardRow` for the reason above: extending
 * the shared type would have put a headshot URL on every board row, which is
 * both wasted payload and the first step toward putting faces on the board.
 */
export type PlayerCard = Omit<BoardRow, "player_id"> & { player_id: string } & PlayerBio;

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

/**
 * One row of `position_context()` — where a player sat among startable players
 * at his position, for one season of his career.
 *
 * The denominator the fixed axis never had. A 14.2 median is either an
 * excellent running back or a replaceable one, and until this the app had no
 * way to say which. `rank` may exceed `cohort` — "RB41 of 24" is a real answer
 * about a season outside the startable pool, and suppressing it would blank
 * exactly the seasons carrying the worst news.
 */
export type PositionContext = {
  player_id: string;
  season: number;
  position: string;
  rank: number;
  /** How many players at this position a league of this size starts. */
  cohort: number;
  /** Weekly quartiles across the cohort — the field, in the same units. */
  p25: number | null;
  p50: number | null;
  p75: number | null;
};

/**
 * One row of `draft_value()` — what the market asked for a player, for one
 * season of his career.
 *
 * The price is carried as a *positional* rank rather than as the ADP, so it
 * compares directly with `PositionContext.rank` beside it: "drafted WR8,
 * finished WR3" needs no conversion between an overall pick number and a
 * positional finish. `adp` comes along for the title, because it is the number
 * every other source prints.
 *
 * `pool` is deliberately not `PositionContext.cohort`. This one counts the
 * players at that position who carried a price; that one counts the players a
 * league of this size starts. They are different denominators for different
 * questions and forcing them to agree would flatten a bust — see the note in
 * migration 0009.
 *
 * `position` may differ from the one in `PositionContext` for the same season.
 * That is the market's label against what he actually played, and it is a fact
 * about the season rather than a mismatch to reconcile.
 */
export type DraftValue = {
  player_id: string;
  season: number;
  position: string;
  adp: number;
  rank: number;
  pool: number;
  /** How many drafts the number is drawn from. 303 in 2012, 8,470 in 2025. */
  times_drafted: number | null;
  stdev: number | null;
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
 * How long until the draft, in whole days, or null once it has gone.
 *
 * Days rather than a date because "draft in 11 days" is the thing a drafter is
 * actually asking, and days rather than hours because `DRAFT_DATE` carries no
 * time — a countdown finer than its input is precision the app does not have.
 *
 * Both sides are compared in UTC. Local midnight would make the number tick
 * over at a different moment for a reader in a different zone, and this is a
 * family spread across several.
 */
export function draftCountdown(now: number = Date.now()): string | null {
  const draft = Date.parse(`${DRAFT_DATE}T00:00:00Z`);
  if (Number.isNaN(draft)) return null;

  const today = new Date(now);
  const midnight = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  const days = Math.round((draft - midnight) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return "draft today";
  if (days === 1) return "draft tomorrow";
  return `draft in ${days} days`;
}

/**
 * Age in whole years, or null if the birth date is missing or unreadable.
 *
 * Whole years because that is the only precision a drafter uses — "27" is a
 * fact about a running back's remaining career and "27.4" is noise. Computed
 * from today rather than from the draft date: the two differ by at most a
 * fortnight and the first is what every other source prints, so matching them
 * avoids an off-by-one argument nobody wants to have mid-draft.
 *
 * All arithmetic in UTC, matching `draftCountdown` — the family is spread
 * across several zones and a birthday should not land on different days for
 * different readers.
 */
export function ageFrom(birthDate: string | null, now: number = Date.now()): number | null {
  if (!birthDate) return null;

  const born = new Date(`${birthDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;

  const today = new Date(now);
  let age = today.getUTCFullYear() - born.getUTCFullYear();

  // Not yet had this year's birthday.
  const month = today.getUTCMonth() - born.getUTCMonth();
  if (month < 0 || (month === 0 && today.getUTCDate() < born.getUTCDate())) age -= 1;

  // A negative or implausible age means the date is wrong, not that the player
  // is unborn. Better to show nothing than a number that is visibly nonsense.
  return age >= 0 && age < 70 ? age : null;
}

/**
 * The dateline: which season this is, how close the draft is, and how old the
 * numbers are.
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

  const hours = stamp
    ? Math.floor((Date.now() - new Date(stamp).getTime()) / 3_600_000)
    : null;
  const age =
    hours == null
      ? "data as of —"
      : hours < 1
        ? "data just now"
        : hours < 24
          ? `data ${hours}h ago`
          : `data ${Math.floor(hours / 24)}d ago`;

  return [`${ADP_SEASON} season`, draftCountdown(), age].filter(Boolean).join(" · ");
}

/** The unambiguous version of the above, for the `title` attribute. */
export function datelineStamp(freshness: Freshness | null): string | undefined {
  const draftDay = new Date(`${DRAFT_DATE}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const stamp = freshness?.last_success;
  const refreshed = stamp
    ? `Last successful refresh ${new Date(stamp).toISOString().slice(0, 16).replace("T", " ")}Z`
    : "No successful refresh recorded";

  return `Draft ${draftDay} · ${refreshed}`;
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
