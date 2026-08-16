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
  const terms: Term[] = [];

  for (const rule of LEAGUE_RULES) {
    const units = rule.columns.reduce(
      (total, column) => total + asNumber(week[column] as number | null),
      0,
    );
    // A rule contributing nothing is noise in the arithmetic, not information.
    if (units === 0) continue;
    terms.push({ rule, units, points: units * rule.pointsPerUnit });
  }

  const computed = terms.reduce((total, term) => total + term.points, 0);
  const stored = asNumber(week.fantasy_points);

  return {
    terms,
    computed,
    stored,
    // Both sides are sums of floats, so exact equality is the wrong test. A
    // tenth of a point is finer than anything the board displays and far
    // coarser than float noise.
    agrees: Math.abs(computed - stored) < 0.05,
  };
}
