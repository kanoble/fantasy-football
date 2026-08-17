"use client";

import { useState } from "react";

import { CEILING, type SeasonRow } from "@/lib/board";
import { Arc } from "../../arc";
import { GameLog } from "../../game-log";
import { Axis, Plot } from "../../plot";

const f1 = (value: number | null | undefined) =>
  value == null || Number.isNaN(value) ? "—" : value.toFixed(1);

/**
 * A career as the board's argument repeated down the years.
 *
 * The board says a median and a spread describe a player better than a
 * per-game average. That claim is worth more, not less, across seasons: every
 * row here is one season drawn on the same fixed 0-56 axis, so a decline shows
 * up as a distribution sliding left rather than as two numbers a reader has to
 * hold in their head and subtract.
 *
 * Opening a season fetches that season's weeks, the same way the board fetches
 * one on expansion — a decade of game logs is a payload almost none of which
 * gets read.
 */
export function Career({
  playerId,
  name,
  seasons,
  tone = "",
}: {
  playerId: string;
  name: string;
  seasons: SeasonRow[];
  /** The player's `tm-*` class. One player, one hue, on every season row. */
  tone?: string;
}) {
  // The newest season starts open: it is the one a drafter is asking about, and
  // an all-closed table makes the reader click to see anything at all.
  const [open, setOpen] = useState<number | null>(seasons[0]?.season ?? null);

  if (seasons.length === 0) {
    return (
      <div className={`career ${tone}`}>
        <div className="board-head">
          <span className="board-title">Career</span>
        </div>
        <p className="empty">
          No regular-season week in any season. {name} is either a rookie or has
          never taken an NFL snap.
        </p>
      </div>
    );
  }

  return (
    <div className={`career ${tone}`}>
      <div className="board-head">
        <span className="board-title">
          Career · {seasons.length} season{seasons.length === 1 ? "" : "s"}, every week
          scored in league terms
        </span>
        <span className="board-sub">click a season to open its game log</span>
      </div>

      <div className="grid">
        <div className="r r-season r-head">
          <div>Season</div>
          <div>G</div>
          <div>Total</div>
          <div>Median</div>
          <div>IQR</div>
          <div>{CEILING}+</div>
          <div>Best</div>
          <Axis />
          <div />
        </div>

        {seasons.map((season) => {
          const expanded = open === season.season;
          return (
            <div key={season.season}>
              <button
                className="r r-season row"
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : season.season)}
              >
                <span className="who">
                  <span className="n">{season.season}</span>
                </span>
                <span className="num dim">{season.games}</span>
                <span className="num dim">{f1(season.total)}</span>
                <span className="num key">{f1(season.median)}</span>
                <span className="iqr">
                  {f1(season.q1)}&ndash;{f1(season.q3)}
                </span>
                <span className="num dim">{season.ceiling_weeks}</span>
                <span className="num dim">{f1(season.best)}</span>
                <Plot
                  points={season.points}
                  weeks={season.weeks}
                  median={season.median}
                  q1={season.q1}
                  q3={season.q3}
                />
                <span className="chev">&rsaquo;</span>
              </button>

              {expanded ? (
                <>
                  {/* Order matters: shape, then arc, then arithmetic. The row
                      above says how good the season was, this says when, and
                      the game log under it says how each week was built. */}
                  <div className={`panel arc-panel ${tone}`}>
                    <Arc
                      weeks={season.weeks}
                      points={season.points}
                      median={season.median}
                      season={season.season}
                      name={name}
                    />
                  </div>
                  <GameLog
                    playerId={playerId}
                    name={name}
                    season={season.season}
                    tone={tone}
                  />
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
