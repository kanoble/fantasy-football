import Image from "next/image";

/**
 * A player's face, or his initials.
 *
 * The reason this component exists rather than an inline `<Image>`: 12% of
 * `player_index` has no `headshot_url` — 1,205 of 10,145 rows, mostly players
 * whose last season predates the NFL's current portrait library — and the
 * fallback has to be as deliberate as the image. A broken-image glyph, or a
 * gap where a face should be, would read as the page failing rather than as
 * the league never having published one.
 *
 * So the fallback is initials on the player's own team hue, which is the same
 * trick the crest in `chrome.tsx` plays with `--ink`. It occupies exactly the
 * space the portrait would, so a page with a face and a page without have the
 * same shape and nothing shifts when one loads.
 */

const SIZE = 96;

/** First and last initial. Middle names and suffixes are noise at 96px. */
function initials(name: string): string {
  const parts = name
    .split(/\s+/)
    .filter((part) => /[a-z]/i.test(part))
    .filter((part) => !/^(jr|sr|i{1,3}|iv|v)\.?$/i.test(part));

  if (parts.length === 0) return "?";
  const first = parts[0]![0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

export function Portrait({ src, name }: { src: string | null; name: string }) {
  if (!src) {
    return (
      <span className="portrait none" aria-hidden="true">
        {initials(name)}
      </span>
    );
  }

  return (
    <span className="portrait">
      <Image
        src={src}
        // The name is already the <h1> immediately beside this, so announcing
        // it again would make a screen reader say it twice. The image carries
        // no information the heading does not.
        alt=""
        width={SIZE}
        height={SIZE}
        // One width and one quality across the app, so each player costs a
        // single Vercel cache key — see the note in next.config.ts.
        //
        // 75 because that is the only quality on the allowlist, and asking for
        // 80 was a no-op that logged a warning on every player page: Next
        // silently serves "the closest allowed value", so these portraits have
        // always been 75. Widening the allowlist to gain five points of JPEG
        // quality on a 96px square would double the cache keys per player for
        // nothing visible.
        quality={75}
        sizes={`${SIZE}px`}
      />
    </span>
  );
}
