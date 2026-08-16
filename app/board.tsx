"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  CEILING,
  FLOOR,
  MAX_COMPARE,
  STAT_SEASON,
  rowState,
  type BoardRow,
} from "@/lib/board";
import { GameLog } from "./game-log";
import { Axis, Plot } from "./plot";

/** Rows added per "show more". ~923 players have an ADP; 923 plots at once is
 *  ~15,000 absolutely-positioned dots, which is a real cost for rows nobody has
 *  scrolled to. A page comfortably clears the 192 picks of a 12-team draft. */
const PAGE = 100;

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

/** Fold a name to something a hurried search box can match. Strips accents and
 *  punctuation, so "amonra" finds Amon-Ra St. Brown and "jamarr" finds
 *  Ja'Marr Chase — the apostrophes and hyphens nobody types under time
 *  pressure during a draft. */
const normalise = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "");

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

  const filtered = useMemo(() => {
    const needle = normalise(query.trim());
    return rows.filter((row) => {
      if (position && (row.position ?? "").toUpperCase() !== position) return false;
      if (needle && !normalise(row.name).includes(needle)) return false;
      return true;
    });
  }, [rows, position, query]);

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

  const staged = compare
    .map((id) => rows.find((row) => row.player_id === id))
    .filter((row): row is BoardRow => row != null);

  return (
    <div className="board">
      <div className="board-head">
        <span className="board-title">
          Draft board · every {STAT_SEASON} week scored in league terms
        </span>
        <span className="board-sub">
          full PPR · regular season · click a row to open the game log
        </span>
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
      </div>

      <div className="grid">
        <div className="r r-head">
          <div />
          <div>Player</div>
          <div>Pos</div>
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
          />
        ))}

        {visible.length === 0 ? (
          <p className="empty">No player matches that filter.</p>
        ) : null}
      </div>

      <div className="board-foot">
        <span className="showing">
          showing {visible.length} of {ordered.length}
          {ordered.length !== rows.length ? ` (${rows.length} with an ADP)` : ""}
        </span>
        {visible.length < ordered.length ? (
          <button className="more" type="button" onClick={() => setLimit(limit + PAGE)}>
            Show {Math.min(PAGE, ordered.length - visible.length)} more
          </button>
        ) : null}
      </div>

      <div className="legend">
        <span>
          <i style={{ background: "#DCE2E8", opacity: 0.55 }} />
          one game
        </span>
        <span>
          <i style={{ background: "#4E9E86" }} />
          ceiling week ≥ {CEILING}
        </span>
        <span>
          <i style={{ background: "#C15F52" }} />
          floor week ≤ {FLOOR}
        </span>
        <span>
          <i style={{ background: "#D6A03C", borderRadius: 0, width: "2px", height: "0.7rem" }} />
          median
        </span>
        <span>
          <i
            style={{
              background: "rgba(214,160,60,0.3)",
              borderRadius: 0,
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
}: {
  row: BoardRow;
  ordinal: number;
  expanded: boolean;
  onToggle: () => void;
  staged: boolean;
  canStage: boolean;
  onStage: (playerId: string) => void;
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
      <button
        className="r row"
        type="button"
        aria-expanded={expanded}
        disabled={!hasSeason}
        onClick={onToggle}
      >
        <span className="rank">{ordinal}</span>
        <span className="who">
          <span className="n">
            {row.name}
            {flag}
          </span>
          <span className="t">
            {row.position ?? "—"} · {row.team ?? "—"}
            {hasSeason ? ` · ${row.games}g` : ""}
          </span>
        </span>
        <span className="num dim">{row.position ?? "—"}</span>
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

      {expanded && row.player_id ? (
        <>
          <GameLog playerId={row.player_id} name={row.name} />
          {/* Outside the row button rather than inside it: a link and a toggle
              nested in a button is invalid markup, and the browser's own
              behaviour for it is not something to design around. */}
          <div className="panel-actions">
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
