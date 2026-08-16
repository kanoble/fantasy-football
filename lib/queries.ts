import "server-only";

import {
  ADP_SEASON,
  CEILING,
  FLOOR,
  STAT_SEASON,
  type BoardRow,
  type Freshness,
} from "./board";
import { createClient } from "./supabase/server";

/**
 * Kept apart from `lib/board.ts` so the shared types and constants can be
 * imported by client components without dragging the server client — and the
 * cookie handling and Supabase keys behind it — into a browser bundle. The
 * `server-only` import above turns that mistake into a build error rather than
 * a shipped one.
 */

export type BoardData = {
  rows: BoardRow[];
  freshness: Freshness | null;
  /**
   * Whether the signed-in address is on the league allowlist. RLS returns zero
   * rows to a non-member rather than an error, so without this check an
   * outsider and a broken query look exactly the same — and so do a member and
   * a genuinely empty table.
   */
  isMember: boolean;
};

export async function fetchBoard(): Promise<BoardData> {
  const supabase = await createClient();

  const [membership, board, freshness] = await Promise.all([
    supabase.rpc("is_league_member"),
    supabase.rpc("draft_board", {
      p_adp_season: ADP_SEASON,
      p_stat_season: STAT_SEASON,
      p_ceiling: CEILING,
      p_floor: FLOOR,
    }),
    supabase.rpc("data_freshness"),
  ]);

  if (membership.error) throw membership.error;
  if (board.error) throw board.error;

  const isMember = membership.data === true;

  return {
    rows: isMember ? ((board.data ?? []) as BoardRow[]) : [],
    // A non-member gets no rows from this either, which is correct and not
    // worth surfacing as an error.
    freshness: ((freshness.data ?? [])[0] as Freshness | undefined) ?? null,
    isMember,
  };
}
