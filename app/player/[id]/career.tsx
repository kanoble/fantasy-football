"use client";

import { useState } from "react";

import {
  CEILING,
  type DraftValue,
  type PositionContext,
  type SeasonRow,
  signedDelta,
} from "@/lib/board";
import { Arc } from "../../arc";
import { GameLog } from "../../game-log";
import { Axis, Plot } from "../../plot";
import { Tip } from "../../tip";

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
            named here rather than left to be worked out from a tooltip. The
            middle clause is doing the other half of the job: a hover definition
            nobody knows is there is a definition nobody reads, so the affordance
            gets announced once rather than discovered by accident. */}
        <span className="board-sub">
          shaded band = the startable field · hover a column head for what it means
          · click a season to open its game log
        </span>
      </div>

      <div className="grid">
        {/* Every column but the season says what it means on hover. The
            subtitle above could carry one definition and not nine, and a header
            a reader cannot decode is a column they do not read — see app/tip.tsx. */}
        <div className="r r-season r-head">
          <div>
            <Tip hint="Regular seasons he played, newest first. A season he was on a roster for but never took a snap in does not appear.">
              Season
            </Tip>
          </div>
          {/* Cost then rank then the gap between them, in that order, because
              that is the order the season happened in: the price was set in
              August, the finish was the answer to it, and the delta is the
              subtraction a reader would otherwise do in their head. */}
          <div>
            <Tip hint="Where the market drafted him at his position that August — WR8 is the eighth receiver off the board. Out of everyone drafted at that position, so a smaller pool than Rank's.">
              Cost
            </Tip>
          </div>
          <div>
            <Tip hint="Where the season actually finished among the startable players at his position — the pool a 12-team league starts each week.">
              Rank
            </Tip>
          </div>
          <div>
            <Tip hint="Cost minus Rank. Positive means he finished better than his price. The two pools are different sizes, so read it as a direction rather than a distance.">
              Delta
            </Tip>
          </div>
          <div>
            <Tip hint="Games played, regular season only. A bye or a spell on IR is simply absent rather than counted as a zero, which would drag the median down.">
              G
            </Tip>
          </div>
          <div>
            <Tip hint="Every week added up, in this league's scoring. A big total can still come from a season you could never have started with confidence.">
              Total
            </Tip>
          </div>
          <div>
            <Tip hint="His middle week — half his games scored above it, half below. Used instead of an average because one enormous week describes a season he mostly did not have.">
              Median
            </Tip>
          </div>
          <div>
            <Tip
              align="right"
              hint="The middle 50% of his weeks, 25th to 75th percentile. A narrow spread is a predictable player, not automatically a better one."
            >
              IQR
            </Tip>
          </div>
          <div>
            <Tip
              align="right"
              hint={`Weeks he scored ${CEILING} or more — the games that win a matchup on their own.`}
            >
              {CEILING}+
            </Tip>
          </div>
          <div>
            <Tip align="right" hint="His single highest-scoring week of the season.">
              Best
            </Tip>
          </div>
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
                <Delta
                  value={price.get(season.season)}
                  context={field.get(season.season)}
                />
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
 * STILL NO VERDICT. The subtraction now has a column of its own — Kevin asked
 * for something scannable and doing it in your head down ten seasons is not —
 * but it stays a signed number in one colour. Colouring a season green where
 * the finish beat the price is the mistake the IQR column and the compare
 * page's rank row both refuse to make: a back who returned RB6 on an RB2 price
 * had a fine season, and an arrow pointing down would call it a failure.
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

/**
 * The gap between the two, as one signed number.
 *
 * Cost and Rank have sat side by side since `0009` on the argument that the
 * subtraction is one glance away. Over a five-season career that is five
 * subtractions, and over St. Brown's it is the difference between reading a
 * table and scanning one — which is what this column is for.
 *
 * `Cost - Rank`, so **positive means he beat his price**: drafted WR8 and
 * finished WR3 is `+5`. That direction is the one worth having, because it makes
 * the good news positive and needs no explaining to anyone who has read a
 * scoreboard.
 *
 * THE TWO POOLS ARE DIFFERENT SIZES, AND THIS NUMBER CANNOT HIDE IT. Cost is
 * out of the players *drafted* at that position — 64 backs in 2025 — and Rank is
 * out of everyone who *played* there, 151. So McCaffrey's 2024 reads `-67`, and
 * part of that 67 is the second pool being larger rather than the season being
 * that much worse. It is an honest direction and a soft distance, which is why
 * both denominators travel in the title and why the header says so in words.
 *
 * One colour, no arrow. See the note on `Cost` above.
 */
function Delta({
  value,
  context,
}: {
  value: DraftValue | undefined;
  context: PositionContext | undefined;
}) {
  // Needs both halves. A season with a price and no finish, or a finish and no
  // price, has no gap to report — and an em dash is the same answer the two
  // columns beside it already give.
  if (!value || !context) return <span className="num dim">&mdash;</span>;

  const delta = value.rank - context.rank;

  return (
    <span
      className="num delta"
      title={`Drafted ${value.position}${value.rank} of ${value.pool} priced · finished ${context.position}${context.rank} of ${context.cohort} startable`}
    >
      {signedDelta(delta)}
    </span>
  );
}
