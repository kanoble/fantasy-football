"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  ADP_SEASON,
  MAX_COMPARE,
  STAT_SEASON,
  normaliseName,
  type PlayerOption,
} from "@/lib/board";
import { teamClass } from "@/lib/teams";

/** Enough to browse without paging, few enough to render instantly. The search
 *  box is the way past it, which is the point: this is a find, not a list. */
const SHOWN = 60;

const POSITIONS = ["QB", "RB", "WR", "TE", "K"];

const f1 = (value: number | null | undefined) =>
  value == null || Number.isNaN(value) ? "—" : value.toFixed(1);

/**
 * Search-and-pick over the players with a price.
 *
 * Two modes over one list, because "find a player to read about" and "find
 * players to compare" are the same act of searching with a different thing at
 * the end of it, and building them separately is how the two searches end up
 * behaving differently.
 *
 * The filtering is client-side over ~830 rows: instant, and it needs no index.
 * A server-side substring search would need pg_trgm on `player_index.norm_name`,
 * which is currently an exact-match index.
 */
export function Picker({
  options,
  mode,
  initial = [],
  startOpen = true,
}: {
  options: PlayerOption[];
  /** `link` navigates straight to a player page; `select` stages ids for a
   *  comparison and hands off through the URL. */
  mode: "link" | "select";
  initial?: string[];
  /**
   * Whether the list starts expanded. False on a comparison that already has
   * players in it: landing on a result and having to scroll past sixty rows to
   * reach it makes the control the page and the answer a footnote.
   */
  startOpen?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>(initial);
  const [listOpen, setListOpen] = useState(startOpen);

  const matches = useMemo(() => {
    const needle = normaliseName(query.trim());
    return options.filter((option) => {
      if (position && (option.position ?? "").toUpperCase() !== position)
        return false;
      if (needle && !normaliseName(option.name).includes(needle)) return false;
      return true;
    });
  }, [options, position, query]);

  const visible = matches.slice(0, SHOWN);
  const byId = useMemo(
    () => new Map(options.map((option) => [option.player_id, option])),
    [options],
  );

  const changed =
    chosen.length !== initial.length ||
    chosen.some((id, index) => id !== initial[index]);

  function toggle(playerId: string) {
    setChosen((current) =>
      current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : current.length >= MAX_COMPARE
          ? current
          : [...current, playerId],
    );
  }

  return (
    <div className="picker">
      {mode === "select" ? (
        <div className="picked">
          <span className="lbl">Comparing</span>
          {chosen.length === 0 ? (
            <span className="tray-hint">nobody yet</span>
          ) : (
            chosen.map((id) => (
              <button
                key={id}
                className="tray-chip"
                type="button"
                onClick={() => toggle(id)}
                title={`Remove ${byId.get(id)?.name ?? id}`}
              >
                {byId.get(id)?.name ?? id} <span className="x">×</span>
              </button>
            ))
          )}
          <button
            className="act"
            type="button"
            aria-expanded={listOpen}
            onClick={() => setListOpen(!listOpen)}
          >
            {listOpen
              ? "Hide list"
              : chosen.length === 0
                ? "Pick players"
                : "Change players"}
          </button>
          {/* Hidden when the selection already matches what is rendered below:
              a button that navigates to the page you are on reads as broken. */}
          {chosen.length >= 2 && changed ? (
            <Link className="tray-go" href={`/compare?ids=${chosen.join(",")}`}>
              Compare {chosen.length} &rsaquo;
            </Link>
          ) : chosen.length === 1 ? (
            <span className="tray-hint">pick one more</span>
          ) : null}
        </div>
      ) : null}

      {!listOpen ? null : (
        <>
          <div className="controls">
            <div className="control-group">
              <label className="lbl" htmlFor="pick-search">
                Find
              </label>
              <input
                id="pick-search"
                className="search"
                type="search"
                placeholder="player name"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <div className="control-group">
              <span className="lbl">Position</span>
              <button
                className="chip"
                type="button"
                aria-pressed={position === null}
                onClick={() => setPosition(null)}
              >
                All
              </button>
              {POSITIONS.map((pos) => (
                <button
                  key={pos}
                  className="chip"
                  type="button"
                  aria-pressed={position === pos}
                  onClick={() => setPosition(position === pos ? null : pos)}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>

          <div className="pick-list">
            <div className="pick pick-head">
              <div />
              <div>Player</div>
              <div>Pos</div>
              <div>ADP</div>
              <div>{STAT_SEASON} median</div>
              <div />
            </div>

            {visible.map((option) => {
              const on = chosen.includes(option.player_id);
              const body = (
                <>
                  <span className="stripe" aria-hidden="true" />
                  <span className="pn">{option.name}</span>
                  <span className="num dim">{option.position ?? "—"}</span>
                  <span className="num dim">{f1(option.adp)}</span>
                  <span className="num key">
                    {option.games > 0 ? f1(option.median) : "—"}
                  </span>
                  <span className="pick-end">
                    {mode === "link" ? "›" : on ? "✓" : "+"}
                  </span>
                </>
              );

              return mode === "link" ? (
                <Link
                  key={option.player_id}
                  className={`pick prow ${teamClass(option.team)}`}
                  href={`/player/${option.player_id}`}
                >
                  {body}
                </Link>
              ) : (
                <button
                  key={option.player_id}
                  className={`pick prow ${teamClass(option.team)}`}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && chosen.length >= MAX_COMPARE}
                  onClick={() => toggle(option.player_id)}
                >
                  {body}
                </button>
              );
            })}

            {matches.length === 0 ? (
              <p className="empty">
                Nobody with a {ADP_SEASON} price matches that. The list covers
                drafted players only — a veteran with no ADP still has a page,
                but you need his link.
              </p>
            ) : null}
          </div>

          <div className="board-foot">
            <span className="showing">
              showing {visible.length} of {matches.length}
              {matches.length !== options.length
                ? ` (${options.length} with a price)`
                : ""}
              {matches.length > SHOWN ? " · keep typing to narrow" : ""}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
