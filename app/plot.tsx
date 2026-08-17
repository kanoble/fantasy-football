import { AXIS_MAX, CEILING, FLOOR, pct } from "@/lib/board";
import { PlotHover } from "./plot-hover";

/**
 * The distribution plot, and the ruler underneath it.
 *
 * Extracted from the board when /player/[id] and /compare arrived: three
 * screens drawing the same axis from three copies of the arithmetic is how the
 * fixed 0-56 scale quietly stops being fixed. Everything about the scale lives
 * here now.
 *
 * No "use client" on purpose — it holds no state, so it renders inside the
 * board's client tree and inside the server-rendered compare page alike.
 */

export const GRIDLINES = [10, 20, 30, 40, 50];
export const AXIS_MARKS = [0, ...GRIDLINES, AXIS_MAX];

export function Plot({
  points,
  weeks,
  median,
  q1,
  q3,
  empty,
  field,
}: {
  points: number[] | null;
  weeks?: number[] | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  /** Shown instead of the distribution when there is none. The three reasons a
   *  row can be empty read identically otherwise — see `rowState`. */
  empty?: string;
  /**
   * The startable field at this player's position, in the same units.
   *
   * Optional, and the board deliberately does not pass it: 923 rows each
   * carrying their position's quartiles is a second aggregate per row to draw
   * a comparison nobody makes while scanning a list. On a career, where every
   * row is the same man in a different year, it is the whole question — it
   * turns "his median slid from 15.4 to 14.3" into whether the field slid with
   * him.
   */
  field?: { p25: number | null; p50: number | null; p75: number | null } | null;
}) {
  const drawable = points != null && q1 != null && q3 != null && median != null;
  const hasField = field?.p25 != null && field?.p75 != null;

  return (
    <span className="plot">
      {/* Behind everything, including the gridlines: this is the ground the
          season is standing on, not a mark on the same layer as his own. */}
      {hasField ? (
        <span
          className="field"
          style={{
            left: `${pct(field!.p25!)}%`,
            width: `${pct(field!.p75!) - pct(field!.p25!)}%`,
          }}
          title={`the field's middle 50%: ${field!.p25!.toFixed(1)}–${field!.p75!.toFixed(1)}`}
        />
      ) : null}
      {field?.p50 != null ? (
        <span
          className="fieldmed"
          style={{ left: `${pct(field.p50)}%` }}
          title={`field median ${field.p50.toFixed(1)}`}
        />
      ) : null}

      {GRIDLINES.map((line) => (
        <span
          key={line}
          className={`gl${line === CEILING || line === FLOOR ? " th" : ""}`}
          style={{ left: `${pct(line)}%` }}
        />
      ))}
      {drawable ? (
        <>
          <span
            className="band"
            style={{ left: `${pct(q1)}%`, width: `${pct(q3) - pct(q1)}%` }}
          />
          <span className="med" style={{ left: `${pct(median)}%` }} />
          {points.map((value, index) => (
            <span
              key={`${index}-${value}`}
              className={`dot${value >= CEILING ? " hi" : value <= FLOOR ? " lo" : ""}`}
              style={{
                left: `${pct(value)}%`,
                // Staggered by position on the axis, so a season assembles left
                // to right rather than appearing all at once. The delay is a
                // fraction of the dot's own x, which costs nothing to compute
                // and reads as the distribution settling into the track.
                animationDelay: `${((pct(value) / 100) * 0.28).toFixed(3)}s`,
              }}
            />
          ))}
          {/* Last, so it sits over the dots it is reading. A dot carries no
              `title` of its own any more: a 5px target and a one-second browser
              delay meant the score was often unreachable, which is the whole
              reason this layer exists. */}
          <PlotHover points={points} weeks={weeks} />
        </>
      ) : (
        <span className="none">{empty ?? "no games"}</span>
      )}
    </span>
  );
}

/** The 0-56 ruler. Rendered once per table, under the header row. */
export function Axis() {
  return (
    <div className="axis" aria-hidden="true">
      {AXIS_MARKS.map((mark, index) => (
        <span
          key={mark}
          className={[
            mark === CEILING || mark === FLOOR ? "th" : "",
            index === 0 ? "first" : "",
            index === AXIS_MARKS.length - 1 ? "last" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{ left: `${pct(mark)}%` }}
        >
          {mark}
        </span>
      ))}
    </div>
  );
}
