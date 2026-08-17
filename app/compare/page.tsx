import type { Metadata } from "next";
import Link from "next/link";

import {
  ADP_SEASON,
  CEILING,
  FLOOR,
  MAX_COMPARE,
  STAT_SEASON,
  rowState,
  type PlayerCard,
} from "@/lib/board";
import { fetchPlayerOptions, fetchPlayers } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { AppBar, PageHead } from "../chrome";
import { NotOnList } from "../not-on-list";
import { teamClass } from "@/lib/teams";
import { Picker } from "../picker";
import { Axis, Plot } from "../plot";

export const metadata: Metadata = { title: "Compare" };

const f1 = (value: number | null | undefined) =>
  value == null || Number.isNaN(value) ? "—" : value.toFixed(1);

/**
 * One line of the comparison table.
 *
 * `better` is the direction that wins, or null where there is no honest winner.
 * The spread is the case that matters: a narrow IQR is not better than a wide
 * one, it is a different asset, and highlighting the narrower one would be the
 * board's "safest floor" mistake — the sort that ranked Jefferson third for
 * being consistently mediocre.
 */
type Metric = {
  label: string;
  get: (card: PlayerCard) => number | null;
  format: (card: PlayerCard) => string;
  better: "high" | "low" | null;
};

const METRICS: Metric[] = [
  {
    label: `${ADP_SEASON} ADP`,
    get: (c) => c.adp,
    format: (c) => (c.adp == null ? "undrafted" : f1(c.adp)),
    better: "low",
  },
  {
    label: "Projected points",
    get: (c) => c.projected_points,
    format: (c) => f1(c.projected_points),
    better: "high",
  },
  {
    label: `${STAT_SEASON} games`,
    get: (c) => (c.games > 0 ? c.games : null),
    format: (c) => String(c.games),
    better: "high",
  },
  {
    label: "Median week",
    get: (c) => c.median,
    format: (c) => f1(c.median),
    better: "high",
  },
  {
    label: "Middle 50%",
    get: () => null,
    format: (c) =>
      c.q1 == null || c.q3 == null ? "—" : `${f1(c.q1)}–${f1(c.q3)}`,
    better: null,
  },
  {
    label: "Floor · 25th pct",
    get: (c) => c.q1,
    format: (c) => f1(c.q1),
    better: "high",
  },
  {
    label: `Weeks ≥ ${CEILING}`,
    get: (c) => (c.games > 0 ? c.ceiling_weeks : null),
    format: (c) => (c.games > 0 ? String(c.ceiling_weeks) : "—"),
    better: "high",
  },
  {
    label: `Weeks ≤ ${FLOOR}`,
    get: (c) => (c.games > 0 ? c.floor_weeks : null),
    format: (c) => (c.games > 0 ? String(c.floor_weeks) : "—"),
    better: "low",
  },
  {
    label: "Best week",
    get: (c) => c.best,
    format: (c) => f1(c.best),
    better: "high",
  },
];

/** Indices holding the winning value, or none when it is tied, undecidable, or
 *  the metric has no direction. A tie highlights nothing rather than
 *  arbitrarily crowning the first column. */
function winners(cards: PlayerCard[], metric: Metric): Set<number> {
  if (metric.better == null || cards.length < 2) return new Set();

  const values = cards.map(metric.get);
  const present = values.filter((value): value is number => value != null);
  if (present.length < 2) return new Set();

  const target =
    metric.better === "high" ? Math.max(...present) : Math.min(...present);
  const winning = values.flatMap((value, index) => (value === target ? [index] : []));

  return winning.length === cards.length ? new Set() : new Set(winning);
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;

  // The URL is hand-editable and arrives from a link, so treat it as input:
  // split, drop blanks, collapse duplicates, and cap the width the layout can
  // actually hold. Extra ids are dropped rather than rendered too narrow.
  const requested = [...new Set((ids ?? "").split(",").map((id) => id.trim()).filter(Boolean))];
  const dropped = Math.max(0, requested.length - MAX_COMPARE);
  const wanted = requested.slice(0, MAX_COMPARE);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ cards, seasons, context, isMember }, { options, freshness }] = await Promise.all([
    fetchPlayers(wanted),
    fetchPlayerOptions(),
  ]);

  // The stat season's field, per player. This is the screen where it matters
  // most: comparing a back with a receiver on raw points compares two
  // different jobs, and the only honest head-to-head is how far each one sits
  // above the field he is actually drafted out of.
  const field = new Map(
    context.filter((row) => row.season === STAT_SEASON).map((row) => [row.player_id, row]),
  );

  if (!isMember) {
    return (
      <main className="shell">
        <NotOnList email={user?.email} />
      </main>
    );
  }

  return (
    <main className="shell">
      <AppBar current="compare" email={user?.email} />
      <PageHead
        title="Compare"
        context={`${STAT_SEASON} regular season · full PPR · one axis, so the shapes are the comparison`}
        freshness={freshness}
      />

      {/* The picker sits above the result and is seeded with whatever the URL
          asked for, so changing the comparison is the same act as building one
          — rather than going back to the board to stage a different set. */}
      {/* Keyed on the ids so a navigation remounts it. Without that, `initial`
          is read once at mount and the picker keeps showing the selection from
          whichever comparison was loaded first. */}
      <Picker
        key={wanted.join(",")}
        options={options}
        mode="select"
        initial={cards.map((card) => card.player_id)}
        startOpen={cards.length === 0}
      />

      {cards.length === 0 ? null : (
        <>
          {dropped > 0 ? (
            <p className="note">
              {dropped} more {dropped === 1 ? "id was" : "ids were"} in the link
              and {dropped === 1 ? "was" : "were"} dropped — {MAX_COMPARE} columns
              is as many as one shared axis holds legibly.
            </p>
          ) : null}

          <div className="board">
            <div className="board-head">
              <span className="board-title">
                Every {STAT_SEASON} week, one row per player
              </span>
              <span className="board-sub">
                amber band is the middle 50% · dot is one game
              </span>
            </div>

            <div className="grid">
              <div className="r r-compare r-head">
                <div>Player</div>
                <div>Median</div>
                <div>IQR</div>
                <Axis />
              </div>

              {cards.map((card) => {
                const state = rowState(card);
                return (
                  <div
                    className={`r r-compare crow ${teamClass(card.team)}`}
                    key={card.player_id}
                  >
                    <span className="who">
                      <span className="n">{card.name}</span>
                      <span className="t">
                        {card.position ?? "—"} · {card.team ?? "—"} ·{" "}
                        {card.adp == null ? "no ADP" : `adp ${f1(card.adp)}`}
                      </span>
                    </span>
                    <span className="num key">{f1(card.median)}</span>
                    <span className="iqr">
                      {card.q1 == null || card.q3 == null
                        ? "—"
                        : `${f1(card.q1)}–${f1(card.q3)}`}
                    </span>
                    <Plot
                      points={card.games > 0 ? card.points : null}
                      weeks={card.weeks}
                      median={card.median}
                      q1={card.q1}
                      q3={card.q3}
                      field={field.get(card.player_id) ?? null}
                      empty={
                        state === "rookie"
                          ? "no NFL games played"
                          : `no ${STAT_SEASON} games`
                      }
                    />
                  </div>
                );
              })}
            </div>

            <table className="vs">
              <thead>
                <tr>
                  <th scope="col">&nbsp;</th>
                  {cards.map((card) => (
                    <th key={card.player_id} scope="col">
                      <Link className="vs-name" href={`/player/${card.player_id}`}>
                        {card.name}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map((metric) => {
                  const best = winners(cards, metric);
                  return (
                    <tr key={metric.label}>
                      <th scope="row">{metric.label}</th>
                      {cards.map((card, index) => (
                        <td
                          key={card.player_id}
                          className={best.has(index) ? "win" : undefined}
                        >
                          {metric.format(card)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                <tr>
                  <th scope="row">{STAT_SEASON} position rank</th>
                  {cards.map((card) => {
                    const row = field.get(card.player_id);
                    return (
                      // Deliberately never marked as a win. RB3 of 24 and QB1
                      // of 12 are ranks in differently sized pools, and
                      // crowning one would be comparing two numbers that are
                      // not on the same scale — the mistake the IQR row above
                      // exists to avoid.
                      <td key={card.player_id}>
                        {row ? `${row.position}${row.rank} of ${row.cohort}` : "—"}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <th scope="row">Seasons played</th>
                  {cards.map((card) => (
                    <td key={card.player_id}>
                      {seasons.filter((season) => season.player_id === card.player_id).length}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>

            <p className="vs-note">
              The middle 50% has no winner on purpose. A narrow spread is not a
              better asset than a wide one — it is a different one, and ranking on
              width alone rewards being reliably mediocre.
            </p>

            {/* No "drop" links here: removing a player is the picker's job,
                and two places to do it is two places to keep in step. */}
            <div className="board-foot">
              <span className="showing">
                {cards.length} of {MAX_COMPARE} columns
              </span>
            </div>
          </div>

          {cards.length === 1 ? (
            <p className="note">
              One player is a profile, not a comparison. Add another from the{" "}
              <Link className="linkish" href="/">
                board
              </Link>
              .
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
