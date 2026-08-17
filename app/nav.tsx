import Link from "next/link";

/**
 * The sections, in the app bar.
 *
 * /player and /compare were reachable only from inside an expanded board row,
 * which is a place you have to already know to look. A route nobody can find is
 * not built.
 *
 * Written out rather than mapped over an array: `typedRoutes` validates literal
 * hrefs, and an array of them widens to a union that `Link`'s generic cannot
 * resolve — so a loop would have to be cast back to `Route`, throwing away the
 * exact check this app turned on.
 *
 * These four are one family: they are all about *players*. When the Yahoo
 * layer lands, League and Trends are about *teams*, and they go after a
 * `<span className="tab-div" />` rather than becoming further peers — the rule
 * says which family you are in before anyone reads a word. Draft day is not a
 * tab at all; it is a state the board is in, and it belongs beside the avatar.
 * See `app/chrome.tsx`.
 *
 * Market sits on this side of the divider rather than waiting to become Trends.
 * It is about which *players* are priced below what they return; Trends is the
 * cross-player historical screen `adp_history` can answer — "what has a pick at
 * RB4 actually returned over ten seasons" — which is a bigger and different
 * thing, and is about the market rather than about anyone in it.
 */
export type Section = "board" | "players" | "compare" | "market";

export function Nav({ current }: { current: Section }) {
  return (
    <nav className="tabs" aria-label="Sections">
      <Link
        className="tab"
        href="/"
        aria-current={current === "board" ? "page" : undefined}
      >
        Board
      </Link>
      <Link
        className="tab"
        href="/player"
        aria-current={current === "players" ? "page" : undefined}
      >
        Players
      </Link>
      <Link
        className="tab"
        href="/compare"
        aria-current={current === "compare" ? "page" : undefined}
      >
        Compare
      </Link>
      <Link
        className="tab"
        href="/market"
        aria-current={current === "market" ? "page" : undefined}
      >
        Market
      </Link>
    </nav>
  );
}
