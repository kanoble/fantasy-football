/**
 * The league's scoring rules, mirrored from `ff.scoring.rules.LEAGUE_SCORING`.
 *
 * This is a second copy of something that already exists in Python, which is
 * normally a mistake. It is here because the board's whole argument is that a
 * score can be *shown as arithmetic* rather than asserted, and the read path
 * deliberately runs no Python: `scored_weekly_stats` stores the 22 columns the
 * rules read precisely so the decomposition can be reconstructed client-side.
 *
 * The duplication is made safe rather than trusted. `decompose()` returns the
 * sum it arrives at alongside the value Postgres stored, and the UI shows a
 * mismatch instead of hiding it — so if these rules ever drift from the Python
 * ones, the screen says so rather than quietly displaying wrong arithmetic.
 *
 * A rule is not one column: three categories map to a SUM of nflverse columns
 * and one league bucket (FG 50+) spans two finer ones. Modelling a rule as a
 * single column undercounts fumbles by roughly two-thirds, silently.
 */

import type { WeekRow } from "./board";

export type StatRule = {
  /** Label as it appears in the league's settings. */
  name: string;
  /** Short label for the inline arithmetic, where space is tight. */
  short: string;
  pointsPerUnit: number;
  columns: readonly (keyof WeekRow)[];
};

export const OFFENSE_RULES: readonly StatRule[] = [
  { name: "Passing Yards", short: "pass yds", pointsPerUnit: 0.04, columns: ["passing_yards"] },
  { name: "Passing TD", short: "pass TD", pointsPerUnit: 4.0, columns: ["passing_tds"] },
  { name: "Interceptions", short: "int", pointsPerUnit: -1.0, columns: ["passing_interceptions"] },
  { name: "Rushing Yards", short: "rush yds", pointsPerUnit: 0.1, columns: ["rushing_yards"] },
  { name: "Rushing TD", short: "rush TD", pointsPerUnit: 6.0, columns: ["rushing_tds"] },
  { name: "Receptions", short: "rec", pointsPerUnit: 1.0, columns: ["receptions"] },
  { name: "Receiving Yards", short: "rec yds", pointsPerUnit: 0.1, columns: ["receiving_yards"] },
  { name: "Receiving TD", short: "rec TD", pointsPerUnit: 6.0, columns: ["receiving_tds"] },
  { name: "Return TD", short: "ret TD", pointsPerUnit: 6.0, columns: ["special_teams_tds"] },
  {
    name: "2-Pt Conversions",
    short: "2pt",
    pointsPerUnit: 2.0,
    columns: [
      "passing_2pt_conversions",
      "rushing_2pt_conversions",
      "receiving_2pt_conversions",
    ],
  },
  {
    name: "Fumbles Lost",
    short: "fum lost",
    pointsPerUnit: -2.0,
    columns: [
      "rushing_fumbles_lost",
      "receiving_fumbles_lost",
      "sack_fumbles_lost",
    ],
  },
];

export const KICKING_RULES: readonly StatRule[] = [
  { name: "FG 0-19", short: "FG 0-19", pointsPerUnit: 3.0, columns: ["fg_made_0_19"] },
  { name: "FG 20-29", short: "FG 20-29", pointsPerUnit: 3.0, columns: ["fg_made_20_29"] },
  { name: "FG 30-39", short: "FG 30-39", pointsPerUnit: 3.0, columns: ["fg_made_30_39"] },
  { name: "FG 40-49", short: "FG 40-49", pointsPerUnit: 4.0, columns: ["fg_made_40_49"] },
  // The league has one 50+ bucket; nflverse splits it at 60.
  { name: "FG 50+", short: "FG 50+", pointsPerUnit: 5.0, columns: ["fg_made_50_59", "fg_made_60_"] },
  { name: "PAT Made", short: "PAT", pointsPerUnit: 1.0, columns: ["pat_made"] },
];

export const LEAGUE_RULES: readonly StatRule[] = [...OFFENSE_RULES, ...KICKING_RULES];

export type Term = {
  rule: StatRule;
  /** Summed units across the rule's columns. */
  units: number;
  points: number;
};

export type Decomposition = {
  terms: Term[];
  /** What these rules add up to. */
  computed: number;
  /** What the pipeline stored. */
  stored: number;
  /**
   * Whether the two agree to within a rounding tolerance. False means these
   * rules have drifted from the Python ones and the arithmetic on screen
   * cannot be trusted — which is the point of computing both.
   */
  agrees: boolean;
};

const asNumber = (value: number | null | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** Break one scored week into the rules that produced it. */
export function decompose(week: WeekRow): Decomposition {
  return decomposeAll([week]);
}

/**
 * The same, across a whole season.
 *
 * Two running backs with an identical 14.0 median are not the same bet. One
 * who takes 60% of it from touchdowns and one who takes it from volume differ
 * in exactly the way a drafter is trying to price — touchdowns regress and
 * targets do not — and the page could not tell them apart, because it showed
 * the total and never what the total was made of.
 *
 * `scored_weekly_stats` stores the 22 stat columns the rules read precisely so
 * this can be reconstructed without running Python at request time. The
 * schema comment in 0001 says the columns exist "so the UI can explain a
 * score, not just assert it"; until now only one week per season was explained.
 *
 * No new query: `GameLog` already fetches every `WeekRow` of the open season
 * to draw the table, so this is a second reading of an array that is already
 * in the browser.
 *
 * The drift check matters more here, not less. Summing 17 weeks of float
 * arithmetic accumulates more error than one week does, so the tolerance
 * scales with the number of weeks rather than staying at a flat tenth.
 */
export function decomposeSeason(weeks: WeekRow[]): Decomposition {
  return decomposeAll(weeks);
}

function decomposeAll(weeks: WeekRow[]): Decomposition {
  const terms: Term[] = [];

  for (const rule of LEAGUE_RULES) {
    const units = weeks.reduce(
      (total, week) =>
        total +
        rule.columns.reduce(
          (subtotal, column) => subtotal + asNumber(week[column] as number | null),
          0,
        ),
      0,
    );
    // A rule contributing nothing is noise in the arithmetic, not information.
    if (units === 0) continue;
    terms.push({ rule, units, points: units * rule.pointsPerUnit });
  }

  const computed = terms.reduce((total, term) => total + term.points, 0);
  const stored = weeks.reduce((total, week) => total + asNumber(week.fantasy_points), 0);

  return {
    terms,
    computed,
    stored,
    // Both sides are sums of floats, so exact equality is the wrong test. A
    // tenth of a point per week is finer than anything the board displays and
    // far coarser than float noise; scaling by the number of weeks keeps a
    // 17-week sum from tripping the check on accumulated rounding alone.
    agrees: Math.abs(computed - stored) < 0.05 * Math.max(1, weeks.length),
  };
}

/**
 * A season's positive points as shares of a bar, with the deductions kept out.
 *
 * Negatives cannot be a segment width — a fumble does not occupy space next to
 * receiving yards, it removes some — so they come back separately for the
 * caller to render as a deficit rather than as a slice.
 *
 * Slivers are folded into one "other" segment. Below about 2% a segment is
 * narrower than the gap between segments, so it reads as a rendering artefact
 * rather than as a category.
 */
export type Share = { label: string; points: number; share: number };

export function shares(
  decomposition: Decomposition,
  minimum = 0.02,
): { positive: Share[]; negative: Share[]; gross: number } {
  const positive = decomposition.terms.filter((term) => term.points > 0);
  const negative = decomposition.terms.filter((term) => term.points < 0);

  const gross = positive.reduce((total, term) => total + term.points, 0);
  if (gross <= 0) return { positive: [], negative: [], gross: 0 };

  const big: Share[] = [];
  let rest = 0;

  for (const term of positive.sort((a, b) => b.points - a.points)) {
    const share = term.points / gross;
    if (share < minimum) rest += term.points;
    else big.push({ label: term.rule.short, points: term.points, share });
  }

  if (rest > 0) big.push({ label: "other", points: rest, share: rest / gross });

  return {
    positive: big,
    negative: negative.map((term) => ({
      label: term.rule.short,
      points: term.points,
      share: term.points / gross,
    })),
    gross,
  };
}
