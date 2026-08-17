"use client";

import { useState } from "react";

import { CEILING, type DraftValue, type PositionContext, type SeasonRow } from "@/lib/board";
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
  context,
  value,
  tone = "",
}: {
  playerId: string;
  name: string;
  seasons: SeasonRow[];
  /** One row per season of this career, from `position_context()`. */
  context: PositionContext[];
  /** What the market asked, per season, from `draft_value()`. Sparse. */
  value: DraftValue[];
  /** The player's `tm-*` class. One player, one hue, on every season row. */
  tone?: string;
}) {
  // The newest season starts open: it is the one a drafter is asking about, and
  // an all-closed table makes the reader click to see anything at all.
  const [open, setOpen] = useState<number | null>(seasons[0]?.season ?? null);

  // Keyed by season so each row can find its own field without a scan per row.
  const field = new Map(context.map((row) => [row.season, row]));
  const price = new Map(value.map((row) => [row.season, row]));

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
        {/* The shading is a new mark on a plot readers already know, so it is
            named here rather than left to be worked out from a tooltip. */}
        <span className="board-sub">
          cost = where he was drafted at his position · shaded band = the startable
          field · click a season to open its game log
        </span>
      </div>

      <div className="grid">
        <div className="r r-season r-head">
          <div>Season</div>
          {/* Cost then rank, in that order, because that is the order the
              season happened in: the price was set in August and the finish
              was the answer to it. */}
          <div>Cost</div>
          <div>Rank</div>
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
                <Cost value={price.get(season.season)} />
                <Rank context={field.get(season.season)} />
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
                  field={field.get(season.season) ?? null}
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

/**
 * What the market asked for him that August, as a positional slot.
 *
 * Set beside the finish rank and in the same form — "RB4" against "RB1" — so
 * the pair reads without converting between an overall pick number and a
 * positional result. The ADP itself, and how many drafts it came from, go in
 * the title: 2.4 is the number every other source prints, and 336 drafts
 * against 8,470 is the difference between a price and an anecdote.
 *
 * Dimmed against the rank beside it, deliberately. The two are not equals: one
 * is what happened and one is what was guessed beforehand.
 *
 * NO VERDICT IS DRAWN. It would be easy to colour a season green where the
 * finish beat the price, and it is the same mistake the IQR column and the
 * compare page both refuse to make — the delta is right there for a reader who
 * wants it, and a back who returned RB6 on an RB2 price had a fine season that
 * an arrow pointing down would call a failure.
 *
 * An empty cell is a fact: he was not worth drafting that year, or the season
 * predates 2012. It is not a gap in the data, so it renders as an em dash like
 * every other honest absence on this screen rather than as nothing at all.
 */
function Cost({ value }: { value: DraftValue | undefined }) {
  if (!value) return <span className="num dim">&mdash;</span>;

  const drafts =
    value.times_drafted == null
      ? ""
      : ` · from ${value.times_drafted.toLocaleString("en-GB")} drafts`;

  return (
    <span
      className="num cost"
      title={`Drafted ${value.rank} of ${value.pool} ${value.position}s with a price · ADP ${value.adp.toFixed(1)}${drafts}`}
    >
      {value.position}
      {value.rank}
    </span>
  );
}

/**
 * Where this season sat among startable players at his position.
 *
 * "RB3" alone would be ambiguous about the pool, so the cohort travels with it
 * in the tooltip. A rank past the cohort is shown rather than hidden — a
 * season outside the startable pool is a real answer, and blanking it would
 * empty exactly the rows carrying the worst news.
 */
function Rank({ context }: { context: PositionContext | undefined }) {
  if (!context) return <span className="num dim">&mdash;</span>;

  const inside = context.rank <= context.cohort;
  return (
    <span
      className={`num rank${inside ? "" : " out"}`}
      title={`${context.rank} of ${context.cohort} startable ${context.position}s that season`}
    >
      {context.position}
      {context.rank}
    </span>
  );
}
