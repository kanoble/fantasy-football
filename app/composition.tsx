import type { WeekRow } from "@/lib/board";
import { decomposeSeason, shares } from "@/lib/scoring";

/**
 * Where a season's points came from.
 *
 * The board argues that a median and a spread describe a player better than an
 * average. This is the argument one level down: two backs with the same median
 * are not the same bet when one takes 60% of it from touchdowns and the other
 * from volume, because touchdowns regress and targets do not. The page had the
 * data to say so — `scored_weekly_stats` stores the 22 columns the rules read
 * for exactly this reason — and was saying it about one week a season.
 *
 * COLOUR. Every segment is the player's own team hue at a different opacity,
 * never a different hue. Colour on this app means *team*, and a categorical
 * palette here would be a second colour language competing with the one the
 * board already taught. Value separates the categories; the hue keeps meaning
 * what it means. Amber is deliberately not used — it marks the median and
 * nothing else earns it.
 *
 * Deductions are not slices. A lost fumble does not sit beside receiving yards
 * occupying space, it takes some away, so it is drawn as a deficit past the
 * end of the bar rather than as a segment of it.
 */

/** Opacity steps, largest share first. Beyond this the tail shares the last. */
const STEPS = [1, 0.72, 0.52, 0.38, 0.28, 0.2];

const f1 = (value: number) => value.toFixed(1);

/**
 * A share as a percentage, never as "0%".
 *
 * The "other" bucket collects everything below the sliver threshold so the bar
 * still sums to the whole, and for a receiver whose only stray points are a
 * two-point conversion that lands at 0.4%. Rounding that to "0%" states that a
 * visible segment is worth nothing, which is both wrong and the kind of detail
 * that makes a reader stop trusting the rest of the number.
 */
const pc = (value: number) => (value < 0.005 ? "<1%" : `${Math.round(value * 100)}%`);

export function Composition({
  weeks,
  season,
  tone = "",
}: {
  weeks: WeekRow[];
  season: number;
  /** The player's `tm-*` class, so the bar is his colour like everything else. */
  tone?: string;
}) {
  const decomposition = decomposeSeason(weeks);
  const { positive, negative, gross } = shares(decomposition);

  // A season that scored nothing positive has no composition to draw, and an
  // empty bar would read as a loading state.
  if (positive.length === 0) return null;

  const net = decomposition.stored;

  return (
    <div className={`comp ${tone}`}>
      <div className="panel-top">
        <span className="panel-title">
          {season} season · where {f1(net)} points came from
        </span>
        {decomposition.agrees ? (
          <span className="checks">✓ matches the stored scores</span>
        ) : null}
      </div>

      <div className="comp-bar" role="img" aria-label={
        `${season} scoring: ${positive
          .map((share) => `${share.label} ${pc(share.share)}`)
          .join(", ")}`
      }>
        {positive.map((share, index) => {
          const step = STEPS[index] ?? STEPS[STEPS.length - 1]!;
          return (
          <span
            key={share.label}
            // `solid` marks the one segment drawn at full team strength. Its
            // label knocks out; every faded step's label does not. See the
            // note on `.comp-lab` in globals.css.
            className={`comp-seg${step === 1 ? " solid" : ""}`}
            style={{
              width: `${share.share * 100}%`,
              // Drives the fill only, through a pseudo-element. Setting
              // `opacity` on this element would fade the label with it, which
              // is what made every step past the first unreadable.
              "--step": step,
            } as React.CSSProperties}
            title={`${share.label} · ${f1(share.points)} points · ${pc(share.share)}`}
          >
            {/* Labelled inside only when the segment can hold the words. At
                the width this bar gets, 6% is around 110px — room for "8% REC
                TD" and then some. The first threshold was 13%, which left a
                perfectly wide segment blank and reading as a stub. */}
            {share.share >= 0.06 ? (
              <span className="comp-lab">
                <b>{pc(share.share)}</b>
                {share.label}
              </span>
            ) : null}
          </span>
          );
        })}
      </div>

      {negative.length > 0 ? (
        <div className="comp-deficit">
          {negative.map((share) => (
            <span key={share.label} title={`${f1(share.points)} points`}>
              {f1(share.points)} {share.label}
            </span>
          ))}
          <span className="comp-gross">
            {f1(gross)} gross &minus; {f1(gross - net)} = {f1(net)}
          </span>
        </div>
      ) : null}

      {/* Same guarantee the week-level arithmetic gives: these rules are a
          second copy of the Python ones, so a disagreement is shown rather
          than hidden behind a confident wrong total. */}
      {!decomposition.agrees ? (
        <div className="checks bad">
          ⚠ these rules reconstruct {f1(decomposition.computed)} across the season but
          the pipeline stored {f1(decomposition.stored)} — lib/scoring.ts has drifted
          from ff.scoring.rules
        </div>
      ) : null}
    </div>
  );
}
