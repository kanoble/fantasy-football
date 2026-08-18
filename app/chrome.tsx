import Link from "next/link";

import { LEAGUE_FOUNDED, dateline, datelineStamp, type Freshness } from "@/lib/board";
import type { Viewer } from "@/lib/viewer";
import { Account } from "./account";
import { Nav, type Section } from "./nav";

/**
 * The app's chrome: a crest, a name, the sections, and who is reading.
 *
 * Two levels of identity used to be one. The old masthead put "Draft board" —
 * a *page* — in the largest type on screen, so the app had no name at all, and
 * wedged the section nav above it as what read like a subtitle. Everything the
 * league is called now lives here and never changes; `<h1>` went back to naming
 * the page, in `PageHead` below.
 *
 * It also emptied a junk drawer. `.who-am-i` held four unrelated things in one
 * row — how old the data is, which is a fact about the *data*; an email address
 * and a sign-out, which are the account; and a theme control, which is a
 * preference set once. Freshness rejoined the data as the dateline; the other
 * three collapsed behind the avatar.
 */

/**
 * The mark.
 *
 * Deliberately not a wordmark-only identity: this is twelve relatives, and the
 * thing a family league gets something out of is a crest — it goes on a trophy,
 * a group chat and a shirt, where a typographic lockup does not.
 *
 * Drawn rather than fetched so it inherits the theme: the shield is `--ink`,
 * the initial knocks out to `--panel`, and the bar beneath it is the one amber
 * the palette already spends. No new hue — see the note in globals.css.
 */
export function Crest({ size = 26 }: { size?: number }) {
  return (
    <svg
      className="crest"
      width={size}
      height={(size * 30) / 26}
      viewBox="0 0 26 30"
      role="img"
      aria-label="Noble Family Football"
    >
      <path
        className="crest-field"
        d="M1 1h24v16.5c0 5.8-5.1 9.6-12 11.5C6.1 27.1 1 23.3 1 17.5z"
      />
      <text
        className="crest-letter"
        x="13"
        y="15.6"
        textAnchor="middle"
        fontSize="13"
        fontWeight="800"
      >
        N
      </text>
      <rect className="crest-bar" x="7.5" y="19" width="11" height="1.9" rx="0.95" />
    </svg>
  );
}

/** Crest plus the name, stacked. Links home, as a masthead is expected to. */
export function Lockup({ size }: { size?: number }) {
  return (
    <Link className="lockup" href="/">
      <Crest size={size} />
      <span className="wordmark">
        <span className="wm-1">Noble</span>
        {/* The founding year rides the descender line rather than taking a
            third one: a stacked lockup beside a 26px crest has room for two
            lines, and the bar's height is the one thing every screen shares. */}
        <span className="wm-2">Family Football · Est. {LEAGUE_FOUNDED}</span>
      </span>
    </Link>
  );
}

/**
 * The bar itself. Fixed height on every screen, so the content below always
 * starts in the same place.
 */
export function AppBar({
  current,
  viewer,
}: {
  current: Section;
  viewer: Viewer;
}) {
  return (
    <header className="appbar">
      <Lockup />
      <Nav current={current} />
      {/* Draft day belongs here when it lands — a live pill beside the avatar,
          present for the two hours a year it means anything and absent the rest
          of the time. It is a mode the board is in, not a fourth section. */}
      <div className="appbar-right">
        <Account viewer={viewer} />
      </div>
    </header>
  );
}

/**
 * The page's own head: what this screen is, what it is showing, and — in the
 * dateline — which season and how old the numbers are.
 *
 * The dateline is deliberately identical on every screen. That is what makes it
 * a dateline rather than a caption: a reader learns one place to look for "how
 * current is this", and it is the same place on the board as on a career.
 */
export function PageHead({
  title,
  context,
  freshness,
  tone,
  action,
  portrait,
}: {
  title: React.ReactNode;
  context?: React.ReactNode;
  /**
   * Taken as the raw row rather than a formatted string so the four screens
   * cannot word it four ways — the whole reason it is a dateline.
   */
  freshness?: Freshness | null;
  /** A team class from `lib/teams.ts`, when the page is about one player. */
  tone?: string;
  action?: React.ReactNode;
  /**
   * A face, on the one screen that is about a person.
   *
   * A slot rather than a `headshotUrl` prop: the board and the compare page
   * pass nothing, and keeping the image out of this file means the chrome does
   * not grow a dependency on `next/image` or on what a player is.
   */
  portrait?: React.ReactNode;
}) {
  return (
    <div className={`page-head${tone ? ` ${tone}` : ""}`}>
      <div className="page-id">
        {tone ? <span className="page-bar" /> : null}
        {portrait}
        <div>
          <h1>{title}</h1>
          {context ? <p className="ctx">{context}</p> : null}
        </div>
      </div>
      <div className="page-aside">
        {action}
        {freshness !== undefined ? (
          <span className="dateline" title={datelineStamp(freshness)}>
            {dateline(freshness)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
