import "server-only";

import { cache } from "react";

import {
  ADP_SEASON,
  CEILING,
  FLOOR,
  STAT_SEASON,
  type BoardRow,
  type DraftValue,
  type Freshness,
  type PlayerCard,
  type PlayerOption,
  type PositionContext,
  type SeasonRow,
} from "./board";
import type { AdpSpread, FormSeason, MarketValue, ValuePlayer } from "./value";

/**
 * One raw row of `adp_spread()`, in the column names SQL returns.
 *
 * Kept here rather than in `lib/value.ts` beside `AdpSpread` because they are
 * different shapes on purpose: this is the wire format, and `AdpSpread` is what
 * the model reads — where `adp` needs no `spread_` prefix to say whose it is,
 * because the type it hangs off says so.
 */
type SpreadRow = {
  norm_name: string;
  spread_adp: number;
  stdev: number;
  times_drafted: number | null;
};
import { check } from "./query-error";
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

  check("is_league_member()", membership);
  check("draft_board()", board);

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

export type MarketData = {
  /** Every board row, with the two `0010` reads folded in. */
  players: ValuePlayer[];
  freshness: Freshness | null;
  isMember: boolean;
};

/**
 * The read for `/market`.
 *
 * Three reads in one `Promise.all` rather than one wider function. Widening
 * `draft_board()` would mean `DROP` and recreate — and dropping a function drops
 * its grants — for columns the board itself does not show; joined in SQL it also
 * takes the board's own read from 183ms to 409ms, where run alongside it the
 * wall clock is the slower of the two, about 230ms. The full reasoning is in
 * migration `0010`.
 *
 * `draft_board()` is reused as-is even though this screen draws none of the
 * weekly arrays it carries. The alternative is a fourth function returning the
 * same rows minus two columns, which is a second definition of "who is on the
 * board" that has to agree with the first one forever. The arrays cost the
 * server-to-Postgres hop and go no further: `ValuePlayer` does not carry them,
 * so nothing crosses to the browser.
 */
export async function fetchMarket(): Promise<MarketData> {
  const supabase = await createClient();

  const [membership, board, value, form, spread, freshness] = await Promise.all([
    supabase.rpc("is_league_member"),
    supabase.rpc("draft_board", {
      p_adp_season: ADP_SEASON,
      p_stat_season: STAT_SEASON,
      p_ceiling: CEILING,
      p_floor: FLOOR,
    }),
    // Both left at their function defaults, for the reason `draft_value()` is:
    // which aggregator's prices these are, and how far the window reaches,
    // belong in SQL beside the ranking that uses them rather than in constants
    // here that could drift from it.
    supabase.rpc("market_value", { p_adp_season: ADP_SEASON }),
    supabase.rpc("season_form", { p_adp_season: ADP_SEASON, p_stat_season: STAT_SEASON }),
    // `0011`, and the same reasoning: the source stays in SQL beside the spread
    // it describes. A fifth read rather than a wider fourth one, because this is
    // a fact about one season's price where `market_value()` is a career figure —
    // see the head of the migration.
    supabase.rpc("adp_spread", { p_adp_season: ADP_SEASON }),
    supabase.rpc("data_freshness"),
  ]);

  check("is_league_member()", membership);
  check("draft_board()", board);
  check("market_value()", value);
  check("season_form()", form);
  // This one was worth a second look, because unlike the four above it the
  // screen genuinely works without it: `figureFor` in `lib/value.ts` already
  // degrades a missing spread to a step function, so `spread: null` is a state
  // the model handles rather than a hole. Degrading here would mean a missing
  // migration cost the odds column instead of the page.
  //
  // It still throws, and the reason is specific rather than the house rule about
  // failures that shout. Roughly three quarters of board rows have no published
  // spread *legitimately* — so a silently degraded read would not look empty, it
  // would look exactly like the normal case, on a screen whose whole job is to
  // draw a verdict. This app has been bitten by that shape once already: the
  // catch-all proxy matcher that answered the cron with a 307, whose only
  // symptom was data quietly ceasing to move.
  check("adp_spread()", spread);

  const isMember = membership.data === true;
  const rows = isMember ? ((board.data ?? []) as BoardRow[]) : [];

  const byId = new Map<string, MarketValue>();
  for (const row of (isMember ? ((value.data ?? []) as MarketValue[]) : [])) {
    byId.set(row.player_id, row);
  }

  // Newest first, matching what `ValuePlayer.form` promises and what the
  // weighting in `figureFor` reads. Sorted here rather than trusted from SQL:
  // `season_form()` groups without an ORDER BY, and a weighting that silently
  // depended on row order would be the kind of defect this screen cannot show.
  const formById = new Map<string, FormSeason[]>();
  for (const row of (isMember ? ((form.data ?? []) as Required<FormSeason>[]) : [])) {
    const seasons = formById.get(row.player_id);
    if (seasons) seasons.push(row);
    else formById.set(row.player_id, [row]);
  }
  for (const seasons of formById.values()) seasons.sort((a, b) => b.season - a.season);

  // Keyed on `norm_name` and not `player_id`, which is `0011`'s own measurement
  // rather than a preference: across the 179 board rows inside the draft,
  // `norm_name` matches 178 and `player_id` matches 177, because `adp_history`
  // leaves the id null wherever the name resolved to nobody. It is also the key
  // `drafted` chose in `0005`, for the same reason.
  const spreadByName = new Map<string, AdpSpread>();
  for (const row of (isMember ? ((spread.data ?? []) as SpreadRow[]) : [])) {
    spreadByName.set(row.norm_name, {
      adp: row.spread_adp,
      stdev: row.stdev,
      drafts: row.times_drafted,
    });
  }

  return {
    isMember,
    freshness: ((freshness.data ?? [])[0] as Freshness | undefined) ?? null,
    players: rows.map((row) => {
      const value = row.player_id ? byId.get(row.player_id) : undefined;
      return {
        player_id: row.player_id,
        name: row.name,
        position: row.position,
        team: row.team,
        norm_name: row.norm_name,
        adp: row.adp,
        injury_status: row.injury_status,
        games: row.games,
        career_games: row.career_games,
        median_delta: value?.median_delta ?? null,
        priced_seasons: value?.priced_seasons ?? 0,
        form: (row.player_id ? formById.get(row.player_id) : undefined) ?? [],
        spread: spreadByName.get(row.norm_name) ?? null,
      };
    }),
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
  /**
   * One row per (player, season) the market put a price on — the other half of
   * `context`. Same grain, fetched alongside for the same reason: a rank with
   * no price beside it is half of the question a drafter is asking.
   *
   * Sparser than `seasons` on purpose. `adp_history` starts in 2012 and only
   * lists the players worth drafting, so an undrafted season simply has no row
   * and the column renders empty — which is the fact, not a gap.
   */
  value: DraftValue[];
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
    check("is_league_member()", membership);
    return {
      cards: [],
      seasons: [],
      context: [],
      value: [],
      freshness: ((freshness.data ?? [])[0] as Freshness | undefined) ?? null,
      isMember: membership.data === true,
    };
  }

  const supabase = await createClient();

  const [membership, cards, seasons, context, value, freshness] = await Promise.all([
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
    // Left at the function's default source for the same reason: which
    // aggregator's prices these are belongs in SQL beside the ranking that
    // uses them, not in a constant here that could drift from it.
    supabase.rpc("draft_value", { p_player_ids: playerIds }),
    supabase.rpc("data_freshness"),
  ]);

  check("is_league_member()", membership);
  check("player_cards()", cards);
  check("player_seasons()", seasons);
  check("position_context()", context);
  check("draft_value()", value);

  const isMember = membership.data === true;

  return {
    cards: isMember ? ((cards.data ?? []) as PlayerCard[]) : [],
    seasons: isMember ? ((seasons.data ?? []) as SeasonRow[]) : [],
    context: isMember ? ((context.data ?? []) as PositionContext[]) : [],
    value: isMember ? ((value.data ?? []) as DraftValue[]) : [],
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
