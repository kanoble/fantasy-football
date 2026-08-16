import { AXIS_MAX, CEILING, FLOOR } from "@/lib/board";

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

/** A score as a percentage across the fixed axis, clamped so nothing escapes
 *  the track. 56 clears the largest score in the published set. */
export const pct = (value: number) => Math.max(0, Math.min(100, (value / AXIS_MAX) * 100));

export function Plot({
  points,
  weeks,
  median,
  q1,
  q3,
  empty,
}: {
  points: number[] | null;
  weeks?: number[] | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  /** Shown instead of the distribution when there is none. The three reasons a
   *  row can be empty read identically otherwise — see `rowState`. */
  empty?: string;
}) {
  const drawable = points != null && q1 != null && q3 != null && median != null;

  return (
    <span className="plot">
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
              style={{ left: `${pct(value)}%` }}
              title={
                weeks?.[index] != null
                  ? `week ${weeks[index]} · ${value.toFixed(1)}`
                  : value.toFixed(1)
              }
            />
          ))}
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
