/**
 * The theme preference, and the script that applies it before first paint.
 *
 * Deliberately *not* in `app/theme.tsx`. That file is a `"use client"` module,
 * and every export of a client module becomes a client reference when a server
 * component imports it — so `THEME_SCRIPT` arrived in the layout as an opaque
 * proxy rather than a string, and `dangerouslySetInnerHTML` rendered nothing at
 * all. The failure is silent: the app looks fine until you notice every
 * navigation flashes white for a dark-mode reader.
 *
 * Same class of mistake as the `server-only` split between `lib/board.ts` and
 * `lib/queries.ts` — a module boundary that has to hold, made explicit.
 */

export const THEME_KEY = "theme";

/** `system` is the absence of the attribute, so `prefers-color-scheme` decides. */
export type Theme = "system" | "light" | "dark";

/**
 * Runs in <head>, before anything renders.
 *
 * A preference read in `useEffect` arrives after the first paint, so a
 * dark-mode reader gets a white flash on every navigation. This has to block,
 * which in the App Router means an inline script in the layout.
 *
 * `try`/`catch` because `localStorage` throws outright in a browser with
 * cookies blocked, and a theme preference is not worth a blank page.
 */
export const THEME_SCRIPT = `
try {
  var t = localStorage.getItem(${JSON.stringify(THEME_KEY)});
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch (e) {}
`.trim();
