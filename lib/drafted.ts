/**
 * The drafted marks — the app's only write path.
 *
 * Everything else here reads. These four functions insert and delete rows in
 * `drafted`, guarded by the allowlist policies in migration `0005`, which are
 * the first non-select policies in the schema.
 *
 * Deliberately NOT `server-only`, unlike `lib/queries.ts`. The board is rendered
 * on the server and revalidated hourly; a mark has to appear the instant it is
 * pressed, in the middle of a draft, so drafted state is client state layered
 * over the server-rendered list. This follows the same browser-client pattern as
 * `app/game-log.tsx`, and touches no key the browser does not already hold.
 *
 * Every function is keyed on `norm_name` rather than `player_id`. See
 * `BoardRow.norm_name` in `lib/board.ts` for why that key and not the obvious
 * one.
 */

import { createClient } from "./supabase/client";

/** One row of `drafted`, as the board reads it. */
type DraftedRow = { norm_name: string };

/**
 * Every player marked drafted for a season.
 *
 * Returns a `Set` because the board asks "is this row drafted?" once per
 * rendered row, on every render, for up to 923 rows.
 */
export async function fetchDrafted(season: number): Promise<Set<string>> {
  const supabase = createClient();
  const { data, error } = await supabase.from("drafted").select("norm_name").eq("season", season);

  if (error) throw error;
  return new Set(((data ?? []) as DraftedRow[]).map((row) => row.norm_name));
}

/**
 * Mark a player drafted.
 *
 * `upsert` rather than `insert` so that two people marking the same pick at the
 * same moment — which is the normal case in a room of twelve, not an edge case —
 * is a no-op for the second one instead of a primary-key error surfaced as a
 * failed toggle. `ignoreDuplicates` keeps the original `drafted_at` and
 * `marked_by` rather than overwriting who got there first.
 */
export async function markDrafted(season: number, normName: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("drafted")
    .upsert({ season, norm_name: normName }, { onConflict: "season,norm_name", ignoreDuplicates: true });

  if (error) throw error;
}

/** Undo a mark. */
export async function unmarkDrafted(season: number, normName: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("drafted")
    .delete()
    .eq("season", season)
    .eq("norm_name", normName);

  if (error) throw error;
}

/**
 * Clear the whole draft for a season.
 *
 * Exists for mock drafts, which is the only way anybody will exercise this
 * feature before the day it matters.
 */
export async function clearDrafted(season: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("drafted").delete().eq("season", season);

  if (error) throw error;
}
