"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { ADP_SEASON, signedDelta } from "@/lib/board";
import { fetchDrafted } from "@/lib/drafted";
import {
  COST_TICKS,
  DRAFT_PICKS,
  REASONS,
  VERTICALS,
  buildModel,
  costX,
  scopeModel,
  type Dot,
  type Lookback,
  type Reason,
  type ValueModel,
  type ValuePlayer,
  type Vertical,
} from "@/lib/value";
import { Tip } from "../tip";

/**
 * The value chart: cost against what a price usually buys.
 *
 * Pure presentation over plain data, which is what lets a throwaway probe render
 * it with real rows and no session — the split PR #9 established, and the only
 * reason that pass's measurements were possible at all. Everything it needs
 * arrives as props; the one thing it fetches for itself is who has already been
 * taken, because that changes during a draft and a server render does not.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THIS FILE MUST NOT BREAK. `buildModel` runs over **every** player
 * handed to it, and `scopeModel` narrows afterward. The controls below feed the
 * second call and never the first. Wiring a filter into `buildModel` instead
 * would make the baseline sink with every pick — a player's residual would
 * improve while he sat there doing nothing — and the chart would look entirely
 * reasonable the whole time. `lib/value.test.ts` asserts the property; this
 * comment is what stops someone helpfully "simplifying" the two calls into one.
 */

/** Matching the board. A backgrounded tab is a tab nobody is reading. */
const POLL_MS = 15_000;

const POSITIONS = ["QB", "RB", "WR", "TE", "K"];

/** How many bargains get named on the plot itself. */
const LABELS = 6;

/**
 * How far apart two labels must sit, in percent of the plot box, before both are
 * drawn. Labels are the one thing here allowed to change as the room picks: a
 * dot must not move, but which dots are worth naming is exactly what a drafter
 * wants updated when the six above them come off the board.
 */
const LABEL_GAP_X = 9;
const LABEL_GAP_Y = 7;

const f1 = (value: number) => value.toFixed(1);

/**
 * A coordinate, as a CSS percentage, rounded before it reaches the DOM.
 *
 * NOT cosmetic, and not safe to remove. React's server renderer and the browser
 * serialize a full-precision float differently — the server wrote
 * `left: 58.268%` where the client computed `left: 58.26796401447532%` — and
 * every dot on the plot therefore failed hydration. The whole tree gets thrown
 * away and re-rendered on the client, and the only visible symptom is an error
 * in a console nobody opened. Three decimals is 0.013px on a 1300px plot, which
 * is well under a device pixel, and both sides now emit the same string.
 *
 * This is the second hydration failure in this app found only by reading the
 * browser console — see the legibility pass. Read the console, do not assume it.
 */
const at = (value: number) => `${value.toFixed(3)}%`;

/** Past this point on the cost axis, a label would be clipped by the frame. */
const LABEL_FLIP_X = 78;

export function Chart({
  players,
  statSeason,
}: {
  players: ValuePlayer[];
  statSeason: number;
}) {
  const [vertical, setVertical] = useState<Vertical>("delta");
  const [lookback, setLookback] = useState<Lookback>("last");
  const [positions, setPositions] = useState<Set<string>>(new Set());
  const [hideDrafted, setHideDrafted] = useState(true);
  // The draft, by default. Showing every priced name made the ten biggest
  // bargains a list of retired players — see `DRAFT_PICKS`.
  const [maxCost, setMaxCost] = useState<number | undefined>(DRAFT_PICKS);
  const [near, setNear] = useState<number | null>(null);

  // `null` while the first read is in flight, so "not loaded yet" and "nobody
  // has been drafted yet" stay distinguishable — the same reason the board keeps
  // them apart rather than showing a confident zero before it knows anything.
  const [drafted, setDrafted] = useState<Set<string> | null>(null);
  const plot = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    // Read-only here, so there is no pending-write ref to merge over the result:
    // the board owns the write path and this screen only watches it. A failure
    // is swallowed rather than surfaced, because the chart is entirely readable
    // without it — the scope chip simply keeps showing everyone.
    fetchDrafted(ADP_SEASON)
      .then(setDrafted)
      .catch(() => setDrafted(new Set()));
  }, []);

  useEffect(() => {
    load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    const timer = setInterval(onVisible, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Over every player, always. See the note at the top of this file.
  const model: ValueModel = useMemo(
    () => buildModel(players, { vertical, lookback, statSeason }),
    [players, vertical, lookback, statSeason],
  );

  const scoped = useMemo(
    () =>
      scopeModel(model, {
        drafted: hideDrafted ? (drafted ?? undefined) : undefined,
        positions,
        maxCost,
      }),
    [model, drafted, hideDrafted, positions, maxCost],
  );

  // Sorted richest-residual first, which is both the labelling order and the
  // order the rail's "best available" reads in.
  const ranked = useMemo(
    () => [...scoped.dots].sort((a, b) => b.residual - a.residual),
    [scoped.dots],
  );

  const labelled = useMemo(() => {
    const placed: Dot[] = [];
    for (const dot of ranked) {
      if (placed.length >= LABELS) break;
      const clashes = placed.some(
        (other) =>
          Math.abs(other.x - dot.x) < LABEL_GAP_X && Math.abs(other.y - dot.y) < LABEL_GAP_Y,
      );
      if (!clashes) placed.push(dot);
    }
    return new Set(placed.map((dot) => dot.player.player_id));
  }, [ranked]);

  const togglePosition = (position: string) =>
    setPositions((current) => {
      const next = new Set(current);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });

  /**
   * The nearest dot to the pointer, anywhere in the plot.
   *
   * The same inversion `app/plot-hover.tsx` made for the distribution, in two
   * dimensions: a dot is 7px across, which is smaller than the pointer's own
   * jitter, so a per-dot target means a reader can be over a cloud of players
   * and still be over nothing. Here it matters more than it did there — a
   * scatter is mostly empty space by construction.
   *
   * Distance is measured in **pixels, not in axis units**. The plot is far wider
   * than it is tall, so a percentage on the cost axis is a fraction of the
   * distance a percentage on the residual axis is, and comparing them directly
   * would make the hover snap to whatever was horizontally closest.
   */
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;

    const x = ((event.clientX - box.left) / box.width) * 100;
    const y = ((event.clientY - box.top) / box.height) * 100;

    let best: number | null = null;
    let gap = Infinity;

    for (let index = 0; index < scoped.dots.length; index += 1) {
      const dot = scoped.dots[index]!;
      const dx = ((dot.x - x) / 100) * box.width;
      const dy = ((dot.y - y) / 100) * box.height;
      const distance = dx * dx + dy * dy;
      if (distance < gap) {
        gap = distance;
        best = index;
      }
    }

    setNear((previous) => (previous === best ? previous : best));
  };

  const hovered = near == null ? null : (scoped.dots[near] ?? null);
  const meta = VERTICALS[vertical];
  const draftedCount = drafted?.size ?? 0;

  return (
    <section className="mkt">
      <div className="controls">
        <div className="control-group">
          <span className="lbl">Vertical</span>
          {(Object.keys(VERTICALS) as Vertical[]).map((key) => (
            <button
              key={key}
              type="button"
              className="chip"
              aria-pressed={vertical === key}
              onClick={() => setVertical(key)}
            >
              {VERTICALS[key].label}
            </button>
          ))}
        </div>

        <div className="control-group">
          <span className="lbl">Reads</span>
          <button
            type="button"
            className="chip"
            aria-pressed={vertical !== "delta" && lookback === "last"}
            disabled={vertical === "delta"}
            onClick={() => setLookback("last")}
          >
            {statSeason} only
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={vertical !== "delta" && lookback === "weighted"}
            disabled={vertical === "delta"}
            onClick={() => setLookback("weighted")}
          >
            3 seasons, weighted
          </button>
        </div>

        <div className="control-group">
          <span className="lbl">Position</span>
          {POSITIONS.map((position) => (
            <button
              key={position}
              type="button"
              className="chip"
              aria-pressed={positions.has(position)}
              onClick={() => togglePosition(position)}
            >
              {position}
            </button>
          ))}
          {positions.size > 0 ? (
            <button type="button" className="chip" onClick={() => setPositions(new Set())}>
              All
            </button>
          ) : null}
        </div>

        <div className="control-group">
          <span className="lbl">Show</span>
          <button
            type="button"
            className="chip"
            aria-pressed={maxCost === DRAFT_PICKS}
            onClick={() => setMaxCost(DRAFT_PICKS)}
          >
            First {DRAFT_PICKS} picks
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={maxCost === undefined}
            onClick={() => setMaxCost(undefined)}
          >
            Every price
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={hideDrafted}
            onClick={() => setHideDrafted((current) => !current)}
          >
            Hide drafted{draftedCount > 0 ? ` (${draftedCount})` : ""}
          </button>
        </div>
      </div>

      {/* Said plainly, because the default hides two thirds of the priced names
          and a reader who does not know that will think players are missing. */}
      {maxCost === undefined ? (
        <p className="mkt-why">
          Showing every price. Career figures earned a decade ago sit beside
          today&rsquo;s prices out here, so the biggest residuals past pick{" "}
          {DRAFT_PICKS} tend to belong to players who have retired.
        </p>
      ) : null}

      {/* The career delta ignores the window control, so the control says so
          rather than sitting there greyed with no explanation. A disabled thing
          that does not say why reads as broken. */}
      {vertical === "delta" ? (
        <p className="mkt-why">
          Career value is measured across every season a player was priced, so the
          season window does not apply to it.
        </p>
      ) : null}

      <div className="mkt-body">
        <div className="mkt-main">
          <div className="mkt-frame">
            <div className="mkt-yaxis" aria-hidden="true">
              <span className="mkt-ytick mkt-ytop">+{scoped.range}</span>
              <span className="mkt-ytick mkt-ymid">0</span>
              <span className="mkt-ytick mkt-ybot">&minus;{scoped.range}</span>
            </div>

            <div
              className="mkt-plot"
              ref={plot}
              onPointerMove={pick}
              onPointerLeave={() => setNear(null)}
            >
              {COST_TICKS.map((tick) => (
                <span key={tick} className="mkt-vgrid" style={{ left: at(costX(tick)) }} />
              ))}

              {/* Where the draft ends.
                  The cost axis is fixed and does not shrink to fit the scope —
                  rescaling it when the cutoff moves would move every dot, which
                  is the one thing this screen must never do. So the region past
                  the cutoff is shaded and named instead of left as dead space:
                  it is not a gap in the data, it is the end of the draft. */}
              {maxCost != null ? (
                <>
                  <span className="mkt-beyond" style={{ left: at(costX(maxCost)) }} />
                  <span className="mkt-beyond-lab" style={{ left: at(costX(maxCost)) }}>
                    undrafted
                  </span>
                </>
              ) : null}

              {/* The market's own expectation. Everything this screen is for is
                  read against this one line, so it is the only rule on the plot
                  drawn in ink rather than in a grid tone. */}
              <span className="mkt-zero" />
              <span className="mkt-zero-lab mkt-zero-up">beats his price</span>
              <span className="mkt-zero-lab mkt-zero-down">misses it</span>

              {scoped.dots.map((dot, index) => (
                <span
                  key={dot.player.player_id ?? dot.player.name}
                  className={`mkt-dot${dot.residual >= 0 ? " up" : " down"}${
                    near === index ? " on" : ""
                  }${dot.seasons < 2 ? " thin" : ""}${dot.clamped ? " off" : ""}`}
                  style={{ left: at(dot.x), top: at(dot.y) }}
                />
              ))}

              {/* Named on the plot rather than left to a hover, because the whole
                  question this screen answers is "who", and a chart that makes
                  you interrogate it one dot at a time has not answered it. */}
              {scoped.dots.map((dot) =>
                labelled.has(dot.player.player_id) && near == null ? (
                  <span
                    key={`lab-${dot.player.player_id}`}
                    // Flipped to the left of its dot near the right edge. The
                    // plot is `overflow: hidden`, so a label that ran past the
                    // frame was simply cut in half — which is how "Marvin Jones"
                    // shipped as "Marvi" in the first render of this screen.
                    className={`mkt-name${dot.x > LABEL_FLIP_X ? " flip" : ""}`}
                    style={{ left: at(dot.x), top: at(dot.y) }}
                  >
                    {dot.player.name}
                  </span>
                ) : null,
              )}

              {hovered ? <Readout dot={hovered} vertical={vertical} /> : null}
            </div>

            <div className="mkt-xaxis" aria-hidden="true">
              {COST_TICKS.filter((tick) => maxCost == null || tick <= maxCost).map((tick) => (
                <span key={tick} className="mkt-xtick" style={{ left: at(costX(tick)) }}>
                  {tick}
                </span>
              ))}
            </div>
          </div>

          <p className="mkt-legend">
            Cost rises to the right, in overall pick number, on a log scale — so the
            first two rounds get real width instead of a sliver. Height is{" "}
            <Tip hint={meta.hint}>{meta.label.toLowerCase()}</Tip> measured against
            what that price usually buys{" "}
            <Tip hint="The middle value among the 13 players nearest him in price at his own position. Per position always: a quarterback outscores a receiver every week of his life, so one curve across the whole market would report what position a man plays rather than whether he is a bargain.">
              at his own position
            </Tip>
            . Bargains are top-left.
          </p>
        </div>

        <Rail model={scoped} ranked={ranked} vertical={vertical} />
      </div>
    </section>
  );
}

/**
 * What the pointer is nearest, in full.
 *
 * The three numbers rather than one: a residual on its own is uncheckable, and
 * this app's whole argument is that a figure should be shown as arithmetic. Seen
 * together, "17.2 against an expected 12.4" is a claim a reader can disagree
 * with, where "+4.8" is one they can only accept.
 */
function Readout({ dot, vertical }: { dot: Dot; vertical: Vertical }) {
  const meta = VERTICALS[vertical];
  const good = dot.residual >= 0;

  // Flipped to the other side near the edges, so the box never leaves the plot
  // and never adds a scrollbar — the same containment rule `.tipbox` follows.
  const side = dot.x > 62 ? " left" : "";
  const vert = dot.y < 22 ? " below" : "";

  return (
    <span className={`mkt-read${side}${vert}`} style={{ left: at(dot.x), top: at(dot.y) }}>
      <span className="mkt-read-name">{dot.player.name}</span>
      <span className="mkt-read-sub">
        {dot.player.position ?? "—"}
        {dot.player.team ? ` · ${dot.player.team}` : ""} · pick {f1(dot.player.adp)}
      </span>
      <span className="mkt-read-fig">
        <span className={good ? "up" : "down"}>{signedDelta(Number(dot.residual.toFixed(1)))}</span>{" "}
        {meta.unit} vs the field
      </span>
      <span className="mkt-read-sum">
        {f1(dot.value)} against an expected {f1(dot.expected)}
      </span>
      <span className="mkt-read-sum">
        {dot.seasons} {dot.seasons === 1 ? "season" : "seasons"} behind it
      </span>
      {dot.clamped ? (
        <span className="mkt-read-sum">Past the end of the axis — drawn at the edge.</span>
      ) : null}
    </span>
  );
}

/**
 * The players who cannot be plotted, and the ones worth taking.
 *
 * `draft_board()` coalesces its counts to zero, which is right in a table cell
 * and a lie on a plot: a rookie drawn at zero is being asserted to have scored
 * none rather than to have had no season. Roughly two thirds of the board is in
 * one of those states, so dropping them silently is the worst option available —
 * and on a draft-day screen a rookie inside your pick window is a live decision
 * that has no dot by definition.
 */
function Rail({
  model,
  ranked,
  vertical,
}: {
  model: ValueModel;
  ranked: Dot[];
  vertical: Vertical;
}) {
  const grouped = useMemo(() => {
    const out = new Map<Reason, ValuePlayer[]>();
    for (const entry of model.unplotted) {
      const list = out.get(entry.reason);
      if (list) list.push(entry.player);
      else out.set(entry.reason, [entry.player]);
    }
    for (const list of out.values()) list.sort((a, b) => a.adp - b.adp);
    return out;
  }, [model.unplotted]);

  const order: Reason[] = ["rookie", "absent", "unpriced", "no-baseline", "unmatched"];

  return (
    <aside className="mkt-rail">
      <div className="mkt-rail-block">
        <h2 className="mkt-rail-head">Best available</h2>
        <ol className="mkt-list">
          {ranked.slice(0, 10).map((dot) => (
            <li key={dot.player.player_id} className="mkt-item">
              <Link className="mkt-item-name" href={`/player/${dot.player.player_id}`}>
                {dot.player.name}
              </Link>
              <span className="mkt-item-meta">
                {dot.player.position ?? "—"} · {f1(dot.player.adp)}
              </span>
              <span className={`mkt-item-num ${dot.residual >= 0 ? "up" : "down"}`}>
                {signedDelta(Number(dot.residual.toFixed(1)))}
              </span>
            </li>
          ))}
        </ol>
        <p className="mkt-rail-note">
          Ranked by {VERTICALS[vertical].label.toLowerCase()} against the field at
          the same price. Follows the scope above.
        </p>
      </div>

      <div className="mkt-rail-block">
        <h2 className="mkt-rail-head">
          <Tip hint="These players are on the draft list and cannot be given a coordinate, because the chart needs both a price and something to compare it against. They are listed rather than dropped: on draft day a rookie inside your pick window is a live decision, and he has no dot by definition.">
            No dot
          </Tip>
        </h2>

        {order.map((reason) => {
          const list = grouped.get(reason);
          if (!list || list.length === 0) return null;
          return (
            <div key={reason} className="mkt-reason">
              <span className="mkt-reason-head">
                <Tip hint={REASONS[reason].hint} align="right">
                  {REASONS[reason].label}
                </Tip>
                <span className="mkt-reason-n">{list.length}</span>
              </span>
              <p className="mkt-reason-list">
                {list.slice(0, 8).map((player, index) => (
                  <span key={`${player.player_id ?? player.name}`}>
                    {index > 0 ? ", " : ""}
                    {player.player_id ? (
                      <Link className="mkt-quiet" href={`/player/${player.player_id}`}>
                        {player.name}
                      </Link>
                    ) : (
                      <span className="mkt-quiet">{player.name}</span>
                    )}
                  </span>
                ))}
                {list.length > 8 ? <span className="mkt-quiet"> +{list.length - 8} more</span> : null}
              </p>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
