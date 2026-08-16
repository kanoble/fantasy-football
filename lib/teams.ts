/**
 * Team colour, as a class name.
 *
 * The board draws each player's weeks in his team's hue. That is the one place
 * colour on this app means something rather than decorating something: it is
 * already in every row, and it makes a Lions stack or a Bengals run visible
 * without reading a word.
 *
 * The hues themselves live in `globals.css` under `.tm-*`, one declaration per
 * team, because they have to differ between light and dark grounds and a CSS
 * custom property is the only place that difference can be expressed once.
 *
 * A player with no team — a free agent, or an ADP row that resolved to nobody —
 * gets no class, and `--tm` falls back to the neutral in the stylesheet.
 */

/** nflverse abbreviations, which are what `player_index.team` holds. */
const KNOWN = new Set([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LA", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO",
  "NYG", "NYJ", "OAK", "PHI", "PIT", "SD", "SEA", "SF",
  "STL", "TB", "TEN", "WAS",
]);

/**
 * `tm-XXX` for a known team, empty otherwise.
 *
 * Unknown abbreviations return nothing rather than a class that resolves to no
 * hue: an undefined `--tm` falls back to the neutral, which is the same result
 * with fewer dead class names in the DOM. Relocated franchises (OAK, SD, STL)
 * are included because the career table renders seasons a decade back, where
 * those are the abbreviations nflverse actually stored.
 */
export function teamClass(team: string | null | undefined): string {
  if (!team) return "";
  const key = team.toUpperCase();
  return KNOWN.has(key) ? `tm-${key}` : "";
}
