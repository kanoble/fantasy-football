"""Compare players for draft prep, in this league's scoring terms.

Answers "would I rather draft A or B" by putting three things side by side:

* **What they actually did** — nflverse weekly box scores, scored with
  :data:`~ff.scoring.rules.LEAGUE_SCORING`. Not generic fantasy points: *this
  league's* points, full PPR included.
* **How reliably they did it** — mean, standard deviation, floor and ceiling
  week counts. A 17-point average built from 8-and-26 is a different asset from
  one built from 16-and-18.
* **What it costs** — Sleeper ADP, so past production can be read against
  current market price.

Every source here is free and unauthenticated. Nothing in this module needs
Yahoo.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import polars as pl

from ff.analysis.players import PlayerRef, find_player, player_index
from ff.scoring.engine import FANTASY_POINTS_COLUMN, score_weekly_stats
from ff.scoring.rules import LEAGUE_SCORING, ScoringRules
from ff.sources import nflverse, rotowire, sleeper

#: A "startable" week for a skill player, roughly. Used for floor/ceiling counts.
CEILING_THRESHOLD = 20.0
FLOOR_THRESHOLD = 10.0


@dataclass
class SeasonLine:
    """One player's scored production for one season."""

    season: int
    games: int
    total_points: float
    points_per_game: float
    std_dev: float
    best_week: float
    worst_week: float
    ceiling_weeks: int  # weeks >= CEILING_THRESHOLD
    floor_weeks: int  # weeks <= FLOOR_THRESHOLD


@dataclass
class PlayerReport:
    """Everything gathered about one player."""

    ref: PlayerRef
    seasons: list[SeasonLine] = field(default_factory=list)
    adp: float | None = None
    projected_points: float | None = None
    injury_status: str | None = None
    news: list[str] = field(default_factory=list)

    @property
    def career_ppg(self) -> float | None:
        games = sum(s.games for s in self.seasons)
        if not games:
            return None
        return sum(s.total_points for s in self.seasons) / games


@dataclass
class ComparisonResult:
    """The full comparison, plus what was analysed."""

    players: list[PlayerReport]
    seasons: list[int]
    rules: ScoringRules
    #: Seasons that were requested but have no nflverse data yet.
    unavailable_seasons: list[int] = field(default_factory=list)

    def to_frame(self) -> pl.DataFrame:
        """Comparison as a tidy table: one row per metric, one column per player."""
        rows: list[dict[str, object]] = []

        def add(metric: str, values: list[object]) -> None:
            row: dict[str, object] = {"metric": metric}
            for report, value in zip(self.players, values, strict=True):
                row[report.ref.name] = value
            rows.append(row)

        add("position", [p.ref.position for p in self.players])
        add("team", [p.ref.team for p in self.players])

        for season in sorted(self.seasons, reverse=True):
            lines = [next((s for s in p.seasons if s.season == season), None) for p in self.players]
            if all(line is None for line in lines):
                continue
            add(f"{season} games", [line.games if line else None for line in lines])
            add(
                f"{season} total pts",
                [round(line.total_points, 1) if line else None for line in lines],
            )
            add(
                f"{season} pts/game",
                [round(line.points_per_game, 1) if line else None for line in lines],
            )
            add(
                f"{season} std dev",
                [round(line.std_dev, 1) if line else None for line in lines],
            )
            add(
                f"{season} best wk",
                [round(line.best_week, 1) if line else None for line in lines],
            )
            add(
                f"{season} wks >= {CEILING_THRESHOLD:g}",
                [line.ceiling_weeks if line else None for line in lines],
            )
            add(
                f"{season} wks <= {FLOOR_THRESHOLD:g}",
                [line.floor_weeks if line else None for line in lines],
            )

        add(
            "career pts/game",
            [round(p.career_ppg, 1) if p.career_ppg is not None else None for p in self.players],
        )
        add("ADP (full PPR)", [p.adp for p in self.players])
        add("Sleeper proj pts", [p.projected_points for p in self.players])
        add("injury status", [p.injury_status or "-" for p in self.players])
        return pl.DataFrame(rows, strict=False)


def _season_lines(scored: pl.DataFrame, gsis_id: str) -> list[SeasonLine]:
    """Per-season metrics for one player from a scored weekly frame."""
    player = scored.filter(pl.col("player_id") == gsis_id)
    if player.is_empty():
        return []

    agg = (
        player.group_by("season")
        .agg(
            pl.len().alias("games"),
            pl.col(FANTASY_POINTS_COLUMN).sum().alias("total"),
            pl.col(FANTASY_POINTS_COLUMN).mean().alias("mean"),
            pl.col(FANTASY_POINTS_COLUMN).std().alias("std"),
            pl.col(FANTASY_POINTS_COLUMN).max().alias("best"),
            pl.col(FANTASY_POINTS_COLUMN).min().alias("worst"),
            (pl.col(FANTASY_POINTS_COLUMN) >= CEILING_THRESHOLD).sum().alias("ceiling"),
            (pl.col(FANTASY_POINTS_COLUMN) <= FLOOR_THRESHOLD).sum().alias("floor"),
        )
        .sort("season")
    )

    return [
        SeasonLine(
            season=r["season"],
            games=r["games"],
            total_points=r["total"],
            points_per_game=r["mean"],
            # std is null for a single-game season; 0.0 is the honest value.
            std_dev=r["std"] if r["std"] is not None else 0.0,
            best_week=r["best"],
            worst_week=r["worst"],
            ceiling_weeks=r["ceiling"],
            floor_weeks=r["floor"],
        )
        for r in agg.iter_rows(named=True)
    ]


def _adp_lookup(positions: set[str], season: int) -> dict[str, dict[str, float]]:
    """Fetch Sleeper ADP + projections, keyed by normalised player name.

    Uses ``adp_ppr`` because this league is full PPR. Note the research doc's
    ``adp_dd_ppr`` is not a real field — passing it returns unordered
    placeholder rows.
    """
    from ff.identity import normalize_name

    out: dict[str, dict[str, float]] = {}
    for position in sorted(positions):
        try:
            rows = sleeper.season_projections(season, position, order_by="adp_ppr")
        except Exception:  # noqa: BLE001 — undocumented endpoint, degrade quietly
            continue
        for row in rows:
            meta = row.get("player") or {}
            name = f"{meta.get('first_name', '')} {meta.get('last_name', '')}".strip()
            if not name:
                continue
            stats = row.get("stats") or {}
            adp = stats.get("adp_ppr")
            out[normalize_name(name)] = {
                # 999 is Sleeper's "undrafted / no data" placeholder, not an ADP.
                "adp": adp if adp is not None and adp < 999 else None,
                "proj": stats.get("pts_ppr"),
                "injury_status": meta.get("injury_status"),
            }
    return out


def compare_players(
    queries: list[str],
    seasons: list[int] | None = None,
    rules: ScoringRules = LEAGUE_SCORING,
    adp_season: int | None = None,
    include_news: bool = True,
    season_type: str = "REG",
) -> ComparisonResult:
    """Compare players by name.

    Parameters
    ----------
    queries:
        Player names as typed, e.g. ``["Bijan Robinson", "Jahmyr Gibbs"]``.
    seasons:
        Seasons of history to score. Defaults to the three most recent seasons
        that actually have data.
    rules:
        Scoring rules. Defaults to this league's.
    adp_season:
        Season to pull ADP for. Defaults to the season after the last analysed
        one — i.e. the draft you are preparing for.
    season_type:
        ``"REG"`` (default), ``"POST"``, or ``"ALL"``. Regular season only is
        the right default and not a detail: nflverse weekly stats carry
        postseason rows at weeks 19-22, and counting them inflates season
        totals and games played for exactly the good players you are most
        likely to be comparing. Fantasy leagues score the regular season.
    """
    from ff.identity import normalize_name

    state = sleeper.nfl_state()
    current_season = int(state.get("season", 2026))
    if seasons is None:
        # The current season has no completed games during preseason, so look
        # back from the previous one.
        seasons = [current_season - 3, current_season - 2, current_season - 1]
    if adp_season is None:
        adp_season = current_season

    index = player_index(seasons + [current_season])
    refs = [find_player(q, index) for q in queries]

    # Score every requested season once, then slice per player.
    frames: list[pl.DataFrame] = []
    unavailable: list[int] = []
    for season in seasons:
        try:
            frames.append(nflverse.load_weekly_stats(seasons=season))
        except Exception:  # noqa: BLE001 — season not published yet
            unavailable.append(season)

    reports: list[PlayerReport] = []
    if frames:
        weekly = pl.concat(frames, how="vertical_relaxed")
        if season_type.upper() != "ALL" and "season_type" in weekly.columns:
            weekly = weekly.filter(pl.col("season_type") == season_type.upper())
        scored = score_weekly_stats(weekly, rules)
        for ref in refs:
            reports.append(PlayerReport(ref=ref, seasons=_season_lines(scored, ref.gsis_id)))
    else:
        reports = [PlayerReport(ref=ref) for ref in refs]

    # Market price and projections.
    positions = {r.ref.position for r in reports if r.ref.position}
    adp_map = _adp_lookup(positions, adp_season)
    for report in reports:
        entry = adp_map.get(normalize_name(report.ref.name))
        if entry:
            report.adp = entry.get("adp")
            report.projected_points = entry.get("proj")
            report.injury_status = entry.get("injury_status")

    # Injury news. The RotoWire window is ~5 items, so a hit is a bonus, not a
    # health check — absence here does not mean a player is healthy.
    if include_news:
        try:
            items = rotowire.fetch_injuries()
        except Exception:  # noqa: BLE001 — news is a nice-to-have
            items = []
        for report in reports:
            norm = normalize_name(report.ref.name)
            report.news = [i.title for i in items if norm in normalize_name(i.title)]

    return ComparisonResult(
        players=reports,
        seasons=[s for s in seasons if s not in unavailable],
        rules=rules,
        unavailable_seasons=unavailable,
    )
