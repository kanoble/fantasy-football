import "server-only";

import { cache } from "react";

import {
  ADP_SEASON,
  CEILING,
  FLOOR,
  STAT_SEASON,
  type BoardRow,
  type Freshness,
  type PlayerCard,
  type SeasonRow,
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

export type PlayerData = {
  /** In the order the ids were asked for, and only for ids that resolved. */
  cards: PlayerCard[];
  /** Every season of every requested player, newest first. */
  seasons: SeasonRow[];
  isMember: boolean;
};

/**
 * The read for `/player/[id]` and `/compare`, which differ only in how many
 * ids they pass. One round trip each way rather than a query per player.
 */
export async function fetchPlayers(playerIds: string[]): Promise<PlayerData> {
  if (playerIds.length === 0) {
    // Still ask about membership: an empty id list and an outsider are
    // different screens, and the caller cannot tell them apart otherwise.
    const supabase = await createClient();
    const membership = await supabase.rpc("is_league_member");
    if (membership.error) throw membership.error;
    return { cards: [], seasons: [], isMember: membership.data === true };
  }

  const supabase = await createClient();

  const [membership, cards, seasons] = await Promise.all([
    supabase.rpc("is_league_member"),
    supabase.rpc("player_cards", {
      p_player_ids: playerIds,
      p_adp_season: ADP_SEASON,
      p_stat_season: STAT_SEASON,
      p_ceiling: CEILING,
      p_floor: FLOOR,
    }),
    supabase.rpc("player_seasons", {
      p_player_ids: playerIds,
      p_ceiling: CEILING,
      p_floor: FLOOR,
    }),
  ]);

  if (membership.error) throw membership.error;
  if (cards.error) throw cards.error;
  if (seasons.error) throw seasons.error;

  const isMember = membership.data === true;

  return {
    cards: isMember ? ((cards.data ?? []) as PlayerCard[]) : [],
    seasons: isMember ? ((seasons.data ?? []) as SeasonRow[]) : [],
    isMember,
  };
}

/**
 * One player, deduplicated across a render.
 *
 * `generateMetadata` needs the name and the page needs everything, and without
 * this that is two identical round trips per player page. Keyed on the id
 * string rather than wrapping `fetchPlayers` directly: `cache()` compares
 * arguments by identity, and `[id]` is a fresh array on every call, so caching
 * the array form would never hit.
 */
export const fetchPlayer = cache(async (playerId: string): Promise<PlayerData> => {
  return fetchPlayers([playerId]);
});
