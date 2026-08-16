"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ADP_SEASON,
  CEILING,
  FLOOR,
  MAX_COMPARE,
  normaliseName,
  STAT_SEASON,
  rowState,
  type BoardRow,
} from "@/lib/board";
import { clearDrafted, fetchDrafted, markDrafted, unmarkDrafted } from "@/lib/drafted";
import { teamClass } from "@/lib/teams";
import { GameLog } from "./game-log";
import { Axis, Plot } from "./plot";

/** Rows added per "show more". ~923 players have an ADP; 923 plots at once is
 *  ~15,000 absolutely-positioned dots, which is a real cost for rows nobody has
 *  scrolled to. A page comfortably clears the 192 picks of a 12-team draft. */
const PAGE = 100;

/** How often the drafted marks are re-read while the tab is visible.
 *
 *  A draft pick lands about once a minute, so 15s is comfortably inside the
 *  gap and cheap against a table with at most a few hundred rows. This is
 *  deliberately a poll rather than Realtime: Realtime needs the table added to
 *  the `supabase_realtime` publication, which is one line away if it is ever
 *  needed, and cannot be verified from here. */
const POLL_MS = 15_000;

/** How long the "marked drafted · Undo" line stays up. */
const UNDO_MS = 6_000;

const f1 = (value: number | null | undefined) =>
  value == null || Number.isNaN(value) ? "—" : value.toFixed(1);

type SortKey = "adp" | "med" | "iqr" | "ceil" | "floor";

type Sort = {
  label: string;
  /** The direction that puts "best" first, so a first click means what the
   *  reader expects: earliest pick, highest median, narrowest spread. */
  dir: "asc" | "desc";
  get: (row: BoardRow) => number | null;
  title: string;
};

const SORTS: Record<SortKey, Sort> = {
  adp: { label: "ADP", dir: "asc", get: (r) => r.adp, title: "Sort by ADP" },
  med: { label: "Median", dir: "desc", get: (r) => r.median, title: "Sort by median" },
  iqr: {
    label: "IQR",
    dir: "asc",
    get: (r) => (r.q1 == null || r.q3 == null ? null : r.q3 - r.q1),
    title: "Sort by width of the middle 50%",
  },
  ceil: {
    label: `${CEILING}+`,
    dir: "desc",
    get: (r) => (r.games > 0 ? r.ceiling_weeks : null),
    title: `Sort by weeks of ${CEILING} points or more`,
  },
  // Not a column of its own: it is the left edge of the IQR, which is already
  // visible in that column. Sorting on spread alone rewards being consistently
  // bad — Jefferson's 7.1-point spread around a 12.5 median beats McCaffrey's
  // 10.5 around 24.1 — so "safest" ranks on the 25th percentile, which encodes
  // level and reliability at once.
  floor: { label: "Floor", dir: "desc", get: (r) => r.q1, title: "Sort by 25th percentile" },
};

const PRESETS: { id: SortKey; label: string }[] = [
  { id: "adp", label: "Draft order" },
  { id: "floor", label: "Safest floor" },
  { id: "ceil", label: "Highest ceiling" },
  { id: "med", label: "Best median" },
];

const POSITIONS = ["QB", "RB", "WR", "TE", "K"];

export function Board({ rows }: { rows: BoardRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("adp");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(SORTS.adp.dir);
  const [position, setPosition] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  // Player ids staged for /compare. Held here rather than in the URL because a
  // half-built comparison is not a place worth being able to navigate back to.
  const [compare, setCompare] = useState<string[]>([]);

  // Drafted state. `null` while the first read is in flight, so "not loaded
  // yet" and "nobody has been drafted yet" are distinguishable — otherwise the
  // count reads a confident 0 before it knows anything.
  const [drafted, setDrafted] = useState<Set<string> | null>(null);
  const [hideDrafted, setHideDrafted] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ key: string; name: string } | null>(null);

  // Marks whose write has not landed yet, as norm_name -> intended state. The
  // poll below would otherwise overwrite an optimistic toggle with a server
  // read taken before the insert committed, and the row would flicker back
  // under the reader's hand mid-draft.
  const pending = useRef(new Map<string, boolean>());

  const load = useCallback(() => {
    fetchDrafted(ADP_SEASON)
      .then((server) => {
        const merged = new Set(server);
        for (const [key, wanted] of pending.current) {
          if (wanted) merged.add(key);
          else merged.delete(key);
        }
        setDrafted(merged);
        setDraftError(null);
      })
      .catch((error: unknown) => {
        setDraftError(error instanceof Error ? error.message : String(error));
      });
  }, []);

  useEffect(() => {
    load();

    // Visible-tab only. A backgrounded draft board is a tab nobody is reading,
    // and polling it is a round trip per member per 15s for nothing.
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

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const filtered = useMemo(() => {
    const needle = normaliseName(query.trim());
    return rows.filter((row) => {
      if (position && (row.position ?? "").toUpperCase() !== position) return false;
      if (needle && !normaliseName(row.name).includes(needle)) return false;
      if (hideDrafted && drafted?.has(row.norm_name)) return false;
      return true;
    });
  }, [rows, position, query, hideDrafted, drafted]);

  const ordered = useMemo(() => {
    const { get } = SORTS[sortKey];
    const sign = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      // A player with no season sorts last on every measure, rather than
      // winning an ascending sort by being absent.
      if (x == null && y == null) return a.adp - b.adp;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x - y) * sign || a.adp - b.adp;
    });
  }, [filtered, sortKey, sortDir]);

  const visible = ordered.slice(0, limit);

  function sortBy(key: SortKey) {
    // Re-clicking the active column flips it; a new column starts best-first.
    setSortDir(key === sortKey ? (sortDir === "asc" ? "desc" : "asc") : SORTS[key].dir);
    setSortKey(key);
    setLimit(PAGE);
  }

  function applyPreset(key: SortKey) {
    setSortKey(key);
    setSortDir(SORTS[key].dir);
    setLimit(PAGE);
  }

  function toggleCompare(playerId: string) {
    setCompare((current) =>
      current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : // Silently dropping the oldest would lose a deliberate pick; the
          // button that adds a fourth is disabled instead, so this is a guard
          // rather than the mechanism.
          current.length >= MAX_COMPARE
          ? current
          : [...current, playerId],
    );
  }

  const draftedCount = drafted?.size ?? 0;

  /**
   * Mark or unmark a player, optimistically.
   *
   * The local set moves first and the write follows. A draft does not wait for
   * a round trip, and a toggle that spins for 200ms is a toggle that gets
   * pressed twice. On failure the change is reverted and the reason is shown,
   * so a mark that did not stick never looks like one that did.
   *
   * Note what is deliberately absent: no `setLimit(PAGE)`. Every other filter
   * here resets pagination, which is right when the reader changed what they
   * are looking at — but marking a pick is not that, and being thrown back to
   * the top 100 rows on every pick would be unusable.
   */
  async function toggleDrafted(row: BoardRow) {
    const key = row.norm_name;
    const wanted = !(drafted?.has(key) ?? false);

    pending.current.set(key, wanted);
    setDrafted((current) => {
      const next = new Set(current ?? []);
      if (wanted) next.add(key);
      else next.delete(key);
      return next;
    });
    setDraftError(null);
    // Only on the way in. Unmarking is itself the undo, and offering to undo an
    // undo is noise.
    setUndo(wanted ? { key, name: row.name } : null);

    try {
      if (wanted) await markDrafted(ADP_SEASON, key);
      else await unmarkDrafted(ADP_SEASON, key);
    } catch (error: unknown) {
      setDrafted((current) => {
        const next = new Set(current ?? []);
        if (wanted) next.delete(key);
        else next.add(key);
        return next;
      });
      setUndo(null);
      setDraftError(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current.delete(key);
    }
  }

  async function clearAll() {
    const count = draftedCount;
    if (!window.confirm(`Clear all ${count} drafted marks for ${ADP_SEASON}?`)) return;

    const previous = drafted;
    setDrafted(new Set());
    setUndo(null);
    setDraftError(null);

    try {
      await clearDrafted(ADP_SEASON);
      pending.current.clear();
    } catch (error: unknown) {
      setDrafted(previous);
      setDraftError(error instanceof Error ? error.message : String(error));
    }
  }

  const staged = compare
    .map((id) => rows.find((row) => row.player_id === id))
    .filter((row): row is BoardRow => row != null);

  return (
    <div className="board">
      {/* No title here. The masthead already says "Draft board" six lines up,
          and saying it twice was the loudest thing on the screen. What is left
          is the part the masthead does not cover: how to operate this. */}
      <div className="board-head">
        <span className="board-sub">
          every {STAT_SEASON} week, scored in league terms
        </span>
        <span className="board-sub">click a row to open the game log</span>
      </div>

      <div className="controls">
        <div className="control-group">
          <span className="lbl">Views</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              className="chip"
              type="button"
              aria-pressed={sortKey === preset.id && sortDir === SORTS[preset.id].dir}
              onClick={() => applyPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="control-group">
          <span className="lbl">Position</span>
          <button
            className="chip"
            type="button"
            aria-pressed={position === null}
            onClick={() => {
              setPosition(null);
              setLimit(PAGE);
            }}
          >
            All
          </button>
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              className="chip"
              type="button"
              aria-pressed={position === pos}
              onClick={() => {
                setPosition(position === pos ? null : pos);
                setLimit(PAGE);
              }}
            >
              {pos}
            </button>
          ))}
        </div>

        <div className="control-group">
          <label className="lbl" htmlFor="board-search">
            Find
          </label>
          <input
            id="board-search"
            className="search"
            type="search"
            placeholder="player name"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE);
            }}
          />
        </div>

        {/* Deliberately does not reset pagination, unlike every other control
            above it. Hiding drafted players is something you do once at the
            start of a draft and then live with, not a change of subject. */}
        <div className="control-group">
          <span className="lbl">Draft</span>
          <button
            className="chip"
            type="button"
            aria-pressed={hideDrafted}
            onClick={() => setHideDrafted(!hideDrafted)}
          >
            Hide drafted
          </button>
          {draftedCount > 0 ? (
            <button className="chip" type="button" onClick={clearAll} title={`Clear all ${draftedCount} marks`}>
              Clear {draftedCount}
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid">
        <div className="r brow r-head">
          <div />
          <div />
          <div />
          <div>Player</div>
          <SortHeader current={sortKey} dir={sortDir} target="adp" onSort={sortBy} />
          <SortHeader current={sortKey} dir={sortDir} target="med" onSort={sortBy} />
          <SortHeader current={sortKey} dir={sortDir} target="iqr" onSort={sortBy} />
          <SortHeader current={sortKey} dir={sortDir} target="ceil" onSort={sortBy} />
          <Axis />
          <div />
        </div>

        {visible.map((row, index) => (
          <Row
            key={`${row.name}-${row.player_id ?? "unmatched"}`}
            row={row}
            ordinal={index + 1}
            expanded={open === rowKey(row)}
            onToggle={() => setOpen(open === rowKey(row) ? null : rowKey(row))}
            staged={row.player_id != null && compare.includes(row.player_id)}
            canStage={compare.length < MAX_COMPARE}
            onStage={toggleCompare}
            drafted={drafted?.has(row.norm_name) ?? false}
            onDraft={toggleDrafted}
          />
        ))}

        {visible.length === 0 ? (
          <p className="empty">No player matches that filter.</p>
        ) : null}
      </div>

      {/* Marking a player while "Hide drafted" is on makes them vanish, which is
          the one failure mode of hiding rather than dimming. This is the way
          back. It is not a toast: it sits in the flow above the footer so it
          cannot cover a row you are about to click. */}
      {undo ? (
        <div className="undo" role="status">
          <span>{undo.name} marked drafted</span>
          <button
            className="linkish"
            type="button"
            onClick={() => {
              const row = rows.find((candidate) => candidate.norm_name === undo.key);
              if (row) toggleDrafted(row);
              setUndo(null);
            }}
          >
            Undo
          </button>
        </div>
      ) : null}

      {draftError ? (
        <div className="undo bad" role="alert">
          <span>could not save that mark — {draftError}</span>
        </div>
      ) : null}

      <div className="board-foot">
        <span className="showing">
          showing {visible.length} of {ordered.length}
          {ordered.length !== rows.length ? ` (${rows.length} with an ADP)` : ""}
          {draftedCount > 0 ? ` · ${draftedCount} drafted${hideDrafted ? ", hidden" : ""}` : ""}
        </span>
        {visible.length < ordered.length ? (
          <button className="more" type="button" onClick={() => setLimit(limit + PAGE)}>
            Show {Math.min(PAGE, ordered.length - visible.length)} more
          </button>
        ) : null}
      </div>

      {/* Reads the same tokens the plot does, rather than repeating hex values
          that would then only be right in one theme — which is what the old
          hard-coded swatches were. */}
      <div className="legend">
        <span>
          <i style={{ background: "var(--tm-none)", opacity: 0.5 }} />
          one game, in team colour
        </span>
        <span>
          <i style={{ background: "var(--tm-none)", width: "0.7rem", height: "0.7rem" }} />
          ceiling week ≥ {CEILING}
        </span>
        <span>
          <i style={{ background: "transparent", border: "1px solid var(--muted)" }} />
          floor week ≤ {FLOOR}
        </span>
        <span>
          <i
            style={{ background: "var(--amber)", borderRadius: 0, width: "2px", height: "0.7rem" }}
          />
          median
        </span>
        <span>
          <i
            style={{
              background: "var(--band)",
              border: "1px solid var(--band-edge)",
              borderRadius: "1px",
              width: "1.1rem",
              height: "0.55rem",
            }}
          />
          middle 50% of weeks
        </span>
      </div>

      {/* Fixed to the viewport, not sticky inside the board: `.board` scrolls
          horizontally, which makes it a scroll container in both axes, and a
          sticky child of a container that never scrolls vertically just sits at
          the bottom of the list where nobody scrolled to. */}
      {staged.length > 0 ? (
        <div className="tray" role="region" aria-label="Staged for comparison">
          <span className="tray-lbl">Compare</span>
          {staged.map((row) => (
            <button
              key={row.player_id}
              className="tray-chip"
              type="button"
              onClick={() => toggleCompare(row.player_id as string)}
              title={`Remove ${row.name}`}
            >
              {row.name} <span className="x">×</span>
            </button>
          ))}
          {staged.length >= 2 ? (
            <Link
              className="tray-go"
              href={`/compare?ids=${staged.map((row) => row.player_id).join(",")}`}
            >
              Compare {staged.length} &rsaquo;
            </Link>
          ) : (
            <span className="tray-hint">pick one more</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

const rowKey = (row: BoardRow) => `${row.name}-${row.player_id ?? "unmatched"}`;

function SortHeader({
  current,
  dir,
  target,
  onSort,
}: {
  current: SortKey;
  dir: "asc" | "desc";
  target: SortKey;
  onSort: (key: SortKey) => void;
}) {
  const active = current === target;
  return (
    <div>
      <button
        className="sortbtn"
        type="button"
        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
        title={SORTS[target].title}
        onClick={() => onSort(target)}
      >
        {SORTS[target].label}
        <span className="car" />
      </button>
    </div>
  );
}

function Row({
  row,
  ordinal,
  expanded,
  onToggle,
  staged,
  canStage,
  onStage,
  drafted,
  onDraft,
}: {
  row: BoardRow;
  ordinal: number;
  expanded: boolean;
  onToggle: () => void;
  staged: boolean;
  canStage: boolean;
  onStage: (playerId: string) => void;
  drafted: boolean;
  onDraft: (row: BoardRow) => void;
}) {
  const state = rowState(row);
  const hasSeason = state === "ok";

  const flag =
    row.injury_status != null ? (
      <span className="flagpill q" title={row.injury_status}>
        {row.injury_status.slice(0, 1)}
      </span>
    ) : state === "rookie" ? (
      <span className="flagpill r">rookie</span>
    ) : state === "unmatched" ? (
      <span className="flagpill u" title="This ADP name did not resolve to an NFL player">
        no match
      </span>
    ) : null;

  const emptyLabel =
    state === "rookie"
      ? "no NFL games played"
      : state === "unmatched"
        ? "no stats matched"
        : `no ${STAT_SEASON} games`;

  return (
    <>
      {/* The row is a wrapper grid rather than one button, because the drafted
          toggle cannot live inside the row button: nesting a button in a button
          is invalid markup — the same thing that already pushed `panel-actions`
          outside — and the row button is `disabled` for rookies, unmatched and
          absent players. Those are 307, 92 and 191 rows respectively, and they
          include top-30 picks like Jeremiyah Love, so they are exactly the rows
          that most need marking. The toggle is a sibling and always enabled. */}
      <div className={`r brow ${teamClass(row.team)}${drafted ? " is-drafted" : ""}`}>
        <button
          className="mark"
          type="button"
          aria-pressed={drafted}
          aria-label={drafted ? `${row.name} is drafted` : `Mark ${row.name} drafted`}
          title={drafted ? `${row.name} is drafted — click to undo` : `Mark ${row.name} drafted`}
          onClick={() => onDraft(row)}
        />
        <button
          className="row"
          type="button"
          aria-expanded={expanded}
          disabled={!hasSeason}
          onClick={onToggle}
        >
          <span className="stripe" aria-hidden="true" />
          <span className="rank">{ordinal}</span>
          <span className="who">
            <span className="n">
              {row.name}
              {flag}
            </span>
            {/* Position lives here and only here. It used to be repeated as a
                column immediately to the right, so "RB" sat next to "RB · DET". */}
            <span className="t">
              {row.position ?? "—"} · {row.team ?? "—"}
              {hasSeason ? ` · ${row.games}g` : ""}
            </span>
          </span>
          <span className="num dim">{f1(row.adp)}</span>
          <span className="num key">{hasSeason ? f1(row.median) : "—"}</span>
          <span className="iqr">{hasSeason ? `${f1(row.q1)}–${f1(row.q3)}` : "—"}</span>
          <span className="num dim">{hasSeason ? row.ceiling_weeks : "—"}</span>
          <Plot
            points={hasSeason ? row.points : null}
            weeks={row.weeks}
            median={row.median}
            q1={row.q1}
            q3={row.q3}
            empty={emptyLabel}
          />
          <span className="chev">{hasSeason ? "›" : ""}</span>
        </button>
      </div>

      {expanded && row.player_id ? (
        <>
          <GameLog playerId={row.player_id} name={row.name} tone={teamClass(row.team)} />
          {/* Outside the row button rather than inside it: a link and a toggle
              nested in a button is invalid markup, and the browser's own
              behaviour for it is not something to design around. Carries the
              team class so its left edge matches the panel above it. */}
          <div className={`panel-actions ${teamClass(row.team)}`}>
            <Link className="act" href={`/player/${row.player_id}`}>
              Full career &amp; every week &rsaquo;
            </Link>
            <button
              className="act"
              type="button"
              aria-pressed={staged}
              disabled={!staged && !canStage}
              onClick={() => onStage(row.player_id as string)}
              title={
                !staged && !canStage
                  ? `Comparing ${MAX_COMPARE} already — drop one first`
                  : undefined
              }
            >
              {staged ? "✓ in comparison" : "Add to compare"}
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
