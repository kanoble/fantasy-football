/**
 * A figure's position on an absolute scale.
 *
 * `/compare`'s job is "A or B", and until now it answered that with fourteen
 * rows of digits and left the reader to do the subtracting. This is the mark
 * that makes a gap visible instead — but it only earns its place because of two
 * constraints, and both are load-bearing.
 *
 * **The domain is absolute, never fitted to the players on screen.** A scale
 * drawn from the minimum and maximum of the current comparison makes the best
 * of three a full bar and the worst an empty one, whoever the three are — so
 * the mark says "best here" rather than "good", and every bar moves the moment
 * a player is added or dropped. Fixed domains mean a reader learns something
 * that survives the next comparison. They live in `lib/board.ts` beside the
 * axis they extend.
 *
 * **Position identifies the player, not colour.** Each gauge is inside that
 * player's own card, under his own name, so `--tm` is decoration here exactly
 * as it is on the board — it never has to be decoded, and two players from the
 * same team do not become indistinguishable. That was the defect that killed
 * the first version of this idea.
 *
 * A row that is a *rank* gets no gauge at all. Cost, position rank and both
 * deltas are ranks in differently sized pools, and drawing them to a common
 * length would be the verdict this screen has refused since `0009`.
 */
export function Gauge({
  lo,
  hi,
  from,
  to,
  title,
}: {
  /** The domain's floor and ceiling. Absolute — see the note above. */
  lo: number;
  hi: number;
  /**
   * The span to fill. A single figure runs `from` the domain floor `to` its
   * value; the middle 50% runs from its 25th to its 75th percentile, which is
   * why this takes a span rather than a number. A range is a fact about a
   * season rather than a score, so it is drawn as the width it is.
   */
  from: number;
  to: number;
  /** The figure and its domain in words, for the pointer. */
  title: string;
}) {
  const place = (value: number) =>
    Math.max(0, Math.min(100, ((value - lo) / (hi - lo)) * 100));

  const left = place(Math.min(from, to));
  const width = Math.abs(place(to) - place(from));

  return (
    <span className="gauge" title={title}>
      {/* A span of zero width still has to be visible, or a floor of 0.0 and a
          missing figure look identical. */}
      <span
        className="gauge-fill"
        style={{ left: `${left}%`, width: `max(2px, ${width}%)` }}
      />
    </span>
  );
}
