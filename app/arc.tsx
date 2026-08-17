import { AXIS_MAX, CEILING, FLOOR } from "@/lib/board";

/**
 * A season in the order it happened.
 *
 * The distribution plot beside every season row throws away week order on
 * purpose — that is what makes a median and an IQR describe a player better
 * than an average. But it is genuinely lossy about one thing, and it is a
 * thing a drafter asks constantly: a slow start that became a breakout and a
 * hot start that collapsed produce the *same* distribution. So does a player
 * who was fine, got hurt in week 6, and came back diminished.
 *
 * This draws the same numbers against time instead of against frequency. It is
 * the second view of one season, not a second season — same fixed 0-56 scale
 * as `plot.tsx`, same team hue, same ceiling and floor lines, and the same
 * meaning for a filled dot and a hollow one.
 *
 * No new query. `player_seasons()` already returns `weeks` and `points`; the
 * career table has been holding both and drawing only their distribution.
 *
 * No "use client": it holds no state, like `Plot`.
 */

/**
 * The x domain, fixed at 1-18 for every season.
 *
 * Same argument as the fixed 0-56 y axis: a 2019 season drawn 1-17 and a 2025
 * season drawn 1-18 would put week 10 in two different places, and comparing
 * two seasons of one career is the entire reason this sits inside the career
 * table. A shorter season ending early is a fact worth seeing, not a scale to
 * correct for.
 */
const WEEK_MAX = 18;

/**
 * Coordinate space. The SVG scales uniformly, so these are not pixels — and
 * the ratio between them decides two things at once: how tall the chart
 * renders, and how big its labels come out.
 *
 * Sized against the width this actually gets. `.shell` is max-width 90rem, so
 * the career panel's plot area is about 1330px on a desktop. At 1080 units
 * wide that is a scale of ~1.23, which puts the chart near 200px tall with
 * 10-unit labels at ~12px — the size of the mono labels everywhere else.
 *
 * The first version was 720x150. At the same width that scaled by 1.85 and
 * produced a ~290px chart with 20px axis labels, larger than anything else on
 * the page and taller than the eight stat tiles above it put together. The
 * chart is supporting evidence for the row it sits under; a wide, short
 * viewBox is what keeps it that.
 */
const W = 1080;
const H = 160;
const PAD = { top: 10, right: 12, bottom: 24, left: 34 };

const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const x = (week: number) => PAD.left + ((week - 1) / (WEEK_MAX - 1)) * PLOT_W;
const y = (points: number) =>
  PAD.top + PLOT_H - (Math.max(0, Math.min(AXIS_MAX, points)) / AXIS_MAX) * PLOT_H;

/** Week labels. Every week is too many at this width; these are the quarters. */
const WEEK_TICKS = [1, 5, 9, 13, 18];

/**
 * Horizontal rules, all of them labelled.
 *
 * 10 and 20 are the floor and ceiling thresholds and are drawn firmer, but the
 * rest need their numbers too: on a fixed 0-56 axis a 55-point week is most of
 * the chart's height, and with only 10 and 20 marked there was nothing to read
 * that spike against.
 */
const GRID = [10, 20, 30, 40, 50];

type Point = { week: number; points: number };

/**
 * Split into runs of consecutive weeks.
 *
 * A bye or an injury leaves a hole in `weeks`, and joining week 4 straight to
 * week 9 with a solid line would draw four weeks of football that never
 * happened. Runs are drawn solid and the jumps between them dashed, so an
 * absence reads as an absence.
 */
function runs(series: Point[]): Point[][] {
  const out: Point[][] = [];
  let current: Point[] = [];

  for (const point of series) {
    const previous = current[current.length - 1];
    if (previous && point.week !== previous.week + 1) {
      out.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) out.push(current);
  return out;
}

const line = (series: Point[]) =>
  series.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.week)} ${y(p.points)}`).join(" ");

export function Arc({
  weeks,
  points,
  median,
  season,
  name,
}: {
  weeks: number[] | null;
  points: number[] | null;
  median: number | null;
  season: number;
  name: string;
}) {
  if (!weeks || !points || weeks.length === 0) return null;

  const series: Point[] = weeks
    .map((week, index) => ({ week, points: points[index] ?? 0 }))
    .sort((a, b) => a.week - b.week);

  const segments = runs(series);

  /**
   * Weeks between his first and last appearance with no game.
   *
   * Listed rather than counted, and never called "missed". Every player has a
   * bye, so a single gap is almost always that — and `scored_weekly_stats`
   * holds no schedule, so the app cannot tell a bye from four weeks on IR.
   * Naming the weeks is a fact; naming them "missed" would be a diagnosis the
   * data does not support. A reader who sees three of them knows what they are
   * looking at without being told.
   */
  const quiet: number[] = [];
  for (let week = series[0]!.week; week <= series[series.length - 1]!.week; week++) {
    if (!series.some((point) => point.week === week)) quiet.push(week);
  }

  return (
    <div className="arc-wrap">
      <div className="panel-title">
        {season} week by week
        {quiet.length > 0 ? (
          <span className="arc-quiet">
            {" "}
            · no game in week{quiet.length === 1 ? "" : "s"} {quiet.join(", ")}
          </span>
        ) : null}
      </div>

      <svg
        className="arc"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${name}'s ${season} season week by week: ${series
          .map((p) => `week ${p.week}, ${p.points.toFixed(1)} points`)
          .join("; ")}`}
      >
        {GRID.map((value) => (
          <line
            key={value}
            className={`arc-gl${value === CEILING || value === FLOOR ? " th" : ""}`}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(value)}
            y2={y(value)}
          />
        ))}

        {GRID.map((value) => (
          <text
            key={value}
            className={`arc-ylab${value === CEILING || value === FLOOR ? " th" : ""}`}
            x={PAD.left - 7}
            y={y(value)}
          >
            {value}
          </text>
        ))}

        {WEEK_TICKS.map((week) => (
          <text key={week} className="arc-xlab" x={x(week)} y={H - 5}>
            {week}
          </text>
        ))}

        {median != null ? (
          <line
            className="arc-med"
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(median)}
            y2={y(median)}
          >
            <title>season median {median.toFixed(1)}</title>
          </line>
        ) : null}

        {/* Dashed across the gaps first, so the solid runs draw over them. */}
        {segments.slice(0, -1).map((segment, index) => {
          const from = segment[segment.length - 1]!;
          const to = segments[index + 1]![0]!;
          return (
            <path
              key={`gap-${from.week}`}
              className="arc-gap"
              d={`M${x(from.week)} ${y(from.points)} L${x(to.week)} ${y(to.points)}`}
            />
          );
        })}

        {segments.map((segment) =>
          segment.length > 1 ? (
            <path key={`run-${segment[0]!.week}`} className="arc-line" d={line(segment)} />
          ) : null,
        )}

        {series.map((point) => (
          <circle
            key={point.week}
            className={`arc-dot${
              point.points >= CEILING ? " hi" : point.points <= FLOOR ? " lo" : ""
            }`}
            cx={x(point.week)}
            cy={y(point.points)}
            r={point.points >= CEILING ? 4.2 : 3.4}
          >
            <title>
              week {point.week} · {point.points.toFixed(1)}
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
