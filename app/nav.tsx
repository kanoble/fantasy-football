import Link from "next/link";

/**
 * The three screens, on every screen.
 *
 * /player and /compare were reachable only from inside an expanded board row,
 * which is a place you have to already know to look. A route nobody can find is
 * not built.
 *
 * Written out rather than mapped over an array: `typedRoutes` validates literal
 * hrefs, and an array of them widens to a union that `Link`'s generic cannot
 * resolve — so a loop would have to be cast back to `Route`, throwing away the
 * exact check this app turned on.
 */
export type Section = "board" | "players" | "compare";

export function Nav({ current }: { current: Section }) {
  return (
    <nav className="nav" aria-label="Sections">
      <Link
        className="nav-link"
        href="/"
        aria-current={current === "board" ? "page" : undefined}
      >
        Board
      </Link>
      <Link
        className="nav-link"
        href="/player"
        aria-current={current === "players" ? "page" : undefined}
      >
        Players
      </Link>
      <Link
        className="nav-link"
        href="/compare"
        aria-current={current === "compare" ? "page" : undefined}
      >
        Compare
      </Link>
    </nav>
  );
}
