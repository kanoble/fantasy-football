import type { ReactNode } from "react";

/**
 * A column label that can say what it means.
 *
 * The career table listed what `Cost` was in its subtitle and said nothing
 * about the eight columns beside it, on the theory that `G`, `IQR` and `20+`
 * explain themselves. They explain themselves to whoever built them. This app
 * is about to be handed to eleven relatives who have never seen a distribution
 * plot, and a header nobody can decode is a column nobody reads.
 *
 * Three deliberate choices in what is otherwise a very small component:
 *
 * **A `<button>`, not a `title`.** The native tooltip takes about a second to
 * appear and the delay is not adjustable, which is the same defect this pass
 * removed from the plot's dots. It also never appears on a phone. A button gets
 * hover, keyboard focus *and* tap for free.
 *
 * **No JavaScript.** Hover and `:focus-visible` are CSS, so this stays a server
 * component and the career table, the compare page and the stat strip can all
 * use it without pulling anything into a client bundle.
 *
 * **The hint sits inside the button rather than behind `aria-describedby`.**
 * That makes it part of the button's accessible name — a screen reader reads
 * "G, games played that season…" as one label — and it needs no generated id,
 * which would have meant `useId` and therefore a client component. It is hidden
 * with `opacity`, not `display: none`, so it stays in the accessibility tree.
 */
export function Tip({
  children,
  hint,
  align = "left",
}: {
  /** The label itself: the word that is already in the header. */
  children: ReactNode;
  /** What it means, and why it is worth looking at. One or two sentences. */
  hint: string;
  /**
   * Which edge of the label the box lines up with.
   *
   * `.career` and `.board` are `overflow-x: auto`, which makes them clip on
   * *both* axes — so a box that hangs past a panel edge is not merely untidy,
   * it is cut off and can add a scrollbar. Right-hand columns take `"right"`.
   */
  align?: "left" | "right";
}) {
  return (
    <button className={`tip tip-${align}`} type="button">
      {children}
      <span className="tipbox">{hint}</span>
    </button>
  );
}
