import Link from "next/link";

import {
  ADP_SEASON,
  AXIS_MAX,
  CEILING,
  FLOOR,
  MAX_COMPARE,
  SEASON_GAMES,
  STAT_SEASON,
  TOTAL_MAX,
  median,
  rowState,
  signedDelta,
  type DraftValue,
  type PlayerCard,
  type PositionContext,
  type SeasonRow,
} from "@/lib/board";
import { teamClass } from "@/lib/teams";
import { Axis, Plot } from "../plot";
import { Portrait } from "../player/[id]/portrait";
import { Tip } from "../tip";
import { Gauge } from "./gauge";

/**
 * The comparison itself, separated from the page that authenticates and fetches
 * it.
 *
 * The split is the same one `lib/board.ts` and `lib/queries.ts` already make,
 * and it exists for the same practical reason: everything below is pure
 * presentation over plain data, so it can be rendered from a throwaway public
 * route with real rows pulled straight out of Postgres and looked at in a
 * browser. `page.tsx` cannot be, because `getUser()` revalidates against the
 * auth server and no session can be minted from here. Two of this app's uglier
 * defects — a hydration failure on every player page, and a pair of CSS rules
 * that had never applied — were found exactly that way and by nothing else.
 */

const f1 = (value: number | null | undefined) =>
  value == null || Number.isNaN(value) ? "—" : value.toFixed(1);

/**
 * Everything one column of the comparison needs, gathered once.
 *
 * The career-wide figures are the reason this exists rather than the page
 * reading straight off `PlayerCard`: `fetchPlayers` already returns every
 * season of `position_context()` and `draft_value()` for each id, and the
 * previous version of this screen filtered both down to the stat season and
 * threw the rest away. The median delta costs no new query, only the arithmetic
 * that was already being done on `/player/[id]`.
 */
export type Column = {
  card: PlayerCard;
  /** The stat season's rows, or undefined where he has none. */
  context: PositionContext | undefined;
  value: DraftValue | undefined;
  /**
   * The stat season's points total.
   *
   * From `player_seasons()`, which `fetchPlayers` already returns and this page
   * already paid for — `player_cards()` has no total column. Summing the weekly
   * `points` array would reproduce it exactly (checked: McCaffrey's seventeen
   * 2025 weeks sum to 416.6, the stored figure) but there is no reason to
   * reconstruct a number the query hands over.
   */
  total: number | null;
  /** The middle of his cost-minus-rank gaps, across his whole career. */
  medianDelta: number | null;
  /** How many seasons that median is drawn from. Travels in the cell's title. */
  deltaSeasons: number;
};

/**
 * Fold four query results into one column per player, in the order asked for.
 *
 * Here rather than in the page so that the probe and the page build their
 * columns the same way — a fixture that is assembled differently from the real
 * thing tests the fixture.
 */
export function toColumns(
  cards: PlayerCard[],
  seasons: SeasonRow[],
  context: PositionContext[],
  value: DraftValue[],
): Column[] {
  // The stat season's field, per player. This is the screen where it matters
  // most: comparing a back with a receiver on raw points compares two different
  // jobs, and the only honest head-to-head is how far each one sits above the
  // field he is actually drafted out of.
  const field = new Map(
    context.filter((row) => row.season === STAT_SEASON).map((row) => [row.player_id, row]),
  );

  // What each was drafted at for the same season, so the two rows read as a
  // pair: what he cost, then what he returned. Same season as the field above
  // and not the one being drafted now — the point of the pair is that both
  // halves describe one completed season.
  const cost = new Map(
    value.filter((row) => row.season === STAT_SEASON).map((row) => [row.player_id, row]),
  );

  const total = new Map(
    seasons
      .filter((season) => season.season === STAT_SEASON)
      .map((season) => [season.player_id, season.total]),
  );

  // Every season's finish, for the career median delta.
  const ranked = new Map(context.map((row) => [`${row.player_id}:${row.season}`, row.rank]));

  return cards.map((card) => {
    // A season contributes a delta only when the market priced him *and* he
    // played it, so this is drawn from the seasons that have both rather than
    // from the length of either list.
    const deltas = value
      .filter((price) => price.player_id === card.player_id)
      .map((price) => {
        const finish = ranked.get(`${price.player_id}:${price.season}`);
        return finish == null ? null : price.rank - finish;
      })
      .filter((delta): delta is number => delta != null);

    return {
      card,
      context: field.get(card.player_id),
      value: cost.get(card.player_id),
      total: total.get(card.player_id) ?? null,
      medianDelta: median(deltas),
      deltaSeasons: deltas.length,
    };
  });
}

/**
 * One row of the comparison, as it appears in the rail and in every card.
 *
 * `gauge` is null wherever a mark would assert something the app has decided
 * not to assert — see `app/compare/gauge.tsx`. It is not an omission on those
 * rows, it is the point of them.
 */
type Row = {
  label: string;
  hint: string;
  format: (column: Column) => string;
  /**
   * Supplementary detail for the pointer, per player.
   *
   * The rail's definition explains the row and is necessarily the same for all
   * three columns; this is where a fact about *one* of them goes — the pool a
   * rank came out of, how many seasons a median spans. The same split the
   * career table already uses: `Tip` on the header, `title` on the cell.
   */
  title?: (column: Column) => string | undefined;
  /** Matches the career table's vocabulary, so the two screens agree by class. */
  cls?: string;
  gauge?: (column: Column) => { lo: number; hi: number; from: number; to: number } | null;
};

/** A figure on the points axis, expressed as a span from the axis floor. */
const onAxis = (value: number | null) =>
  value == null ? null : { lo: 0, hi: AXIS_MAX, from: 0, to: value };

/** A count of weeks, against a full regular season. */
const onSeason = (value: number | null) =>
  value == null ? null : { lo: 0, hi: SEASON_GAMES, from: 0, to: value };

const ROWS: Row[] = [
  {
    label: `${ADP_SEASON} ADP`,
    hint: "Average draft position across public 12-team PPR drafts — roughly the pick he goes at this year. No gauge: across the 192 picks of a 12-team draft every top-ten price is an invisible sliver, and the top ten is most of what this screen compares.",
    format: (c) => (c.card.adp == null ? "undrafted" : f1(c.card.adp)),
  },
  {
    label: "Projected points",
    hint: `Projected ${ADP_SEASON} points, from Sleeper. Somebody else's forecast, carried through as-is — every other figure here is scored from what actually happened.`,
    format: (c) => f1(c.card.projected_points),
    gauge: (c) =>
      c.card.projected_points == null
        ? null
        : { lo: 0, hi: TOTAL_MAX, from: 0, to: c.card.projected_points },
  },
  {
    label: `${STAT_SEASON} draft cost`,
    hint: "Where the market drafted him at his position that August — WR7 is the seventh receiver off the board. Out of everyone drafted at that position, so a smaller pool than the rank below. No gauge: it is the number the rank is the answer to, not a score.",
    cls: "cost",
    format: (c) => (c.value ? `${c.value.position}${c.value.rank} of ${c.value.pool}` : "—"),
    title: (c) =>
      c.value
        ? `Drafted ${c.value.rank} of ${c.value.pool} ${c.value.position}s with a price · ADP ${c.value.adp.toFixed(1)}${
            c.value.times_drafted == null
              ? ""
              : ` · from ${c.value.times_drafted.toLocaleString("en-GB")} drafts`
          }`
        : undefined,
  },
  {
    label: `${STAT_SEASON} position rank`,
    hint: "Where the season finished among the startable players at his position — the pool a 12-team league starts each week. No gauge: RB1 of 24 and WR4 of 36 are ranks in differently sized pools, and drawing them to a common length would compare two scales that are not the same.",
    cls: "rank",
    format: (c) =>
      c.context ? `${c.context.position}${c.context.rank} of ${c.context.cohort}` : "—",
    title: (c) =>
      c.context
        ? `${c.context.rank} of ${c.context.cohort} startable ${c.context.position}s that season`
        : undefined,
  },
  {
    label: `${STAT_SEASON} delta`,
    hint: "Cost minus rank. Positive means he finished better than his price. The two pools are different sizes, so read it as a direction rather than a distance — and for that reason it carries no gauge and no colour.",
    cls: "delta",
    format: (c) => (c.value && c.context ? signedDelta(c.value.rank - c.context.rank) : "—"),
    title: (c) =>
      c.value && c.context
        ? `Drafted ${c.value.position}${c.value.rank} of ${c.value.pool} priced · finished ${c.context.position}${c.context.rank} of ${c.context.cohort} startable`
        : undefined,
  },
  {
    label: "Median delta",
    hint: "The middle of his cost-minus-rank gaps across every season with both a price and a finish. Positive means he has usually finished better than the market's guess. A median rather than an average, because two injury seasons would otherwise describe a career that also contains two position-winning ones.",
    cls: "delta",
    format: (c) => (c.medianDelta == null ? "—" : signedDelta(c.medianDelta)),
    title: (c) =>
      c.deltaSeasons === 0
        ? "No season yet with both a price and a finish"
        : `Across ${c.deltaSeasons} season${c.deltaSeasons === 1 ? "" : "s"} with both a price and a finish`,
  },
  {
    label: `${STAT_SEASON} total`,
    hint: `Every week of ${STAT_SEASON} added up, in this league's scoring. A big total can still come from a season you could never have started with confidence, which is what the rows below are for. The gauge runs 0–${TOTAL_MAX}.`,
    cls: "strong",
    format: (c) => (c.total == null ? "—" : f1(c.total)),
    gauge: (c) => (c.total == null ? null : { lo: 0, hi: TOTAL_MAX, from: 0, to: c.total }),
  },
  {
    label: "Median week",
    hint: `His middle week — half his games scored above it, half below. Used instead of an average because one enormous week describes a season he mostly did not have. The gauge runs the same fixed 0–${AXIS_MAX} axis as the plots above.`,
    cls: "key",
    format: (c) => f1(c.card.median),
    gauge: (c) => onAxis(c.card.median),
  },
  {
    label: "Middle 50%",
    hint: `The 25th to 75th percentile of his weeks — what an ordinary Sunday from him looked like. Drawn as a span on the 0–${AXIS_MAX} axis rather than a bar, because a spread is a fact about a season and not a score: a narrow range is a predictable player, not automatically a better one.`,
    format: (c) =>
      c.card.q1 == null || c.card.q3 == null ? "—" : `${f1(c.card.q1)}–${f1(c.card.q3)}`,
    gauge: (c) =>
      c.card.q1 == null || c.card.q3 == null
        ? null
        : { lo: 0, hi: AXIS_MAX, from: c.card.q1, to: c.card.q3 },
  },
  {
    label: "Floor · 25th pct",
    hint: `A quarter of his weeks came in below this — what a bad week from him actually costs you. Same 0–${AXIS_MAX} axis.`,
    format: (c) => f1(c.card.q1),
    gauge: (c) => onAxis(c.card.q1),
  },
  {
    label: `Weeks ≥ ${CEILING}`,
    hint: `Weeks he scored ${CEILING} or more — the games that win a matchup on their own. Out of a ${SEASON_GAMES}-game regular season, which is the gauge's ceiling.`,
    format: (c) => (c.card.games > 0 ? String(c.card.ceiling_weeks) : "—"),
    gauge: (c) => (c.card.games > 0 ? onSeason(c.card.ceiling_weeks) : null),
  },
  {
    label: `Weeks ≤ ${FLOOR}`,
    hint: `Weeks he scored ${FLOOR} or less — the games the rest of your team has to cover for. Out of ${SEASON_GAMES}. Note this is the one row where a longer gauge is a worse season: the mark reports the quantity and draws no verdict, the same as everywhere else here.`,
    format: (c) => (c.card.games > 0 ? String(c.card.floor_weeks) : "—"),
    gauge: (c) => (c.card.games > 0 ? onSeason(c.card.floor_weeks) : null),
  },
  {
    label: "Best week",
    hint: `His single highest-scoring week of ${STAT_SEASON}, on the same 0–${AXIS_MAX} axis.`,
    format: (c) => f1(c.card.best),
    gauge: (c) => onAxis(c.card.best),
  },
  {
    label: `${STAT_SEASON} games`,
    hint: `Regular-season games he played, out of a possible ${SEASON_GAMES}. Postseason is excluded everywhere in this app.`,
    format: (c) => String(c.card.games),
    gauge: (c) => onSeason(c.card.games),
  },
];

export function CompareResult({ columns }: { columns: Column[] }) {
  return (
    <div className="board">
      <div className="board-head">
        <span className="board-title">
          Every {STAT_SEASON} week, one row per player
        </span>
        <span className="board-sub">
          amber band is the middle 50% · dot is one game · hover a row label for
          what it means
        </span>
      </div>

      {/* The shape comparison happens once, here, where the three sit on one
          axis and the rows line up. A plot inside each card would be the same
          data made harder to compare. */}
      <div className="stack">
        {columns.map(({ card, context }) => {
          const state = rowState(card);
          return (
            <div className={`stack-row ${teamClass(card.team)}`} key={card.player_id}>
              <span className="stack-name">{card.name}</span>
              <span className="num key">{f1(card.median)}</span>
              <Plot
                points={card.games > 0 ? card.points : null}
                weeks={card.weeks}
                median={card.median}
                q1={card.q1}
                q3={card.q3}
                field={context ?? null}
                empty={
                  state === "rookie" ? "no NFL games played" : `no ${STAT_SEASON} games`
                }
              />
            </div>
          );
        })}
        <div className="stack-axis">
          <Axis />
        </div>
      </div>

      {/* One rail names every row; a card carries only its figures. The labels
          repeated inside all three cards is what the rail exists to stop, and
          it is what keeps a card narrow enough for three. */}
      <div className="cmp">
        <div className="cmp-rail">
          {ROWS.map((row) => (
            <div className="rail-label" key={row.label}>
              {/* Left-aligned even though the label is right-aligned text. The
                  rail is the leftmost column, so a box anchored to the label's
                  right edge extends further left still and leaves the viewport
                  — measured at -96px. Anchored left it opens rightwards over
                  the cards, which is inside the panel that clips it. */}
              <Tip hint={row.hint}>
                {row.label}
              </Tip>
            </div>
          ))}
        </div>

        {columns.map((column) => (
          <div
            className={`cmp-card ${teamClass(column.card.team)}`}
            key={column.card.player_id}
          >
            <div className="cmp-head">
              {/* Requested at the portrait's own 96px and scaled down in CSS,
                  deliberately. Vercel's image cache is keyed on the width asked
                  for, not the size displayed, so this shares the entry
                  /player/[id] already warmed and costs no transformation — see
                  next.config.ts. */}
              <Portrait src={column.card.headshot_url} name={column.card.name} />
              <span className="cmp-who">
                <Link className="cmp-name" href={`/player/${column.card.player_id}`}>
                  {column.card.name}
                </Link>
                <span className="cmp-meta">
                  {column.card.position ?? "—"} · {column.card.team ?? "—"}
                </span>
              </span>
            </div>

            <dl className="cmp-figs">
              {ROWS.map((row) => {
                const gauge = row.gauge?.(column) ?? null;
                return (
                  <div className="cmp-fig" key={row.label}>
                    {gauge ? (
                      <Gauge
                        {...gauge}
                        title={`${row.label} · ${row.format(column)} on ${gauge.lo}–${gauge.hi}`}
                      />
                    ) : (
                      <span className="gauge-none" />
                    )}
                    <dd
                      className={row.cls ? `num ${row.cls}` : "num"}
                      title={row.title?.(column)}
                    >
                      {row.format(column)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>

      <p className="vs-note">
        The middle 50% is drawn as a span rather than a bar, and neither it nor
        the cost, rank and delta rows carry a gauge at all. A narrow spread is
        not a better asset than a wide one — it is a different one — and a rank
        is out of a pool whose size the next column does not share.
      </p>

      {/* No "drop" links here: removing a player is the picker's job, and two
          places to do it is two places to keep in step. */}
      <div className="board-foot">
        <span className="showing">
          {columns.length} of {MAX_COMPARE} columns
        </span>
      </div>
    </div>
  );
}
