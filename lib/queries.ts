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
  type PlayerOption,
  type PositionContext,
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

export type OptionsData = {
  options: PlayerOption[];
  freshness: Freshness | null;
  isMember: boolean;
};

/**
 * The searchable list behind both pickers.
 *
 * Reuses the board's read rather than adding a query: the same 923 rows, minus
 * the arrays the pickers do not draw, minus the rows whose ADP name resolved to
 * nobody — those have no player page to open, so offering them would be
 * offering a dead end.
 *
 * That makes the searchable universe "players with a 2026 price", which is the
 * draft-prep scope. A veteran with no ADP still has a working /player/[id] URL;
 * he is just not in this list. Widening it means searching player_index by
 * name, and `norm_name` is an exact-match index — a substring search over
 * 10,146 rows needs pg_trgm added first.
 */
export async function fetchPlayerOptions(): Promise<OptionsData> {
  const { rows, freshness, isMember } = await fetchBoard();

  return {
    isMember,
    // Carried through rather than re-read: every screen shows the same dateline,
    // and this call already paid for it.
    freshness,
    options: rows
      .filter((row): row is BoardRow & { player_id: string } => row.player_id != null)
      .map((row) => ({
        player_id: row.player_id,
        name: row.name,
        position: row.position,
        team: row.team,
        adp: row.adp,
        games: row.games,
        median: row.median,
      })),
  };
}

export type PlayerData = {
  /** In the order the ids were asked for, and only for ids that resolved. */
  cards: PlayerCard[];
  /** Every season of every requested player, newest first. */
  seasons: SeasonRow[];
  /**
   * One row per (player, season) saying where that season sat among startable
   * players at his position. Same grain as `seasons`, fetched alongside rather
   * than folded into it: `player_seasons()` is about one player and this is
   * about the field he was in, and merging them server-side would put a
   * cohort-wide aggregate inside a function named for a single career.
   */
  context: PositionContext[];
  freshness: Freshness | null;
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
    const [membership, freshness] = await Promise.all([
      supabase.rpc("is_league_member"),
      supabase.rpc("data_freshness"),
    ]);
    if (membership.error) throw membership.error;
    return {
      cards: [],
      seasons: [],
      context: [],
      freshness: ((freshness.data ?? [])[0] as Freshness | undefined) ?? null,
      isMember: membership.data === true,
    };
  }

  const supabase = await createClient();

  const [membership, cards, seasons, context, freshness] = await Promise.all([
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
    // Left at the function's default league size. The number belongs in SQL
    // beside the derivation that uses it, not spread across a constant here
    // and a default there that could drift apart.
    supabase.rpc("position_context", { p_player_ids: playerIds }),
    supabase.rpc("data_freshness"),
  ]);

  if (membership.error) throw membership.error;
  if (cards.error) throw cards.error;
  if (seasons.error) throw seasons.error;
  if (context.error) throw context.error;

  const isMember = membership.data === true;

  return {
    cards: isMember ? ((cards.data ?? []) as PlayerCard[]) : [],
    seasons: isMember ? ((seasons.data ?? []) as SeasonRow[]) : [],
    context: isMember ? ((context.data ?? []) as PositionContext[]) : [],
    freshness: ((freshness.data ?? [])[0] as Freshness | undefined) ?? null,
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
