"""The refresh pipeline: fetch, score, and publish to Postgres.

Runs on a schedule (Vercel Cron), never in response to a page view. That
separation is what keeps Yahoo request volume flat regardless of how many
league members use the app.

Shape of this module
--------------------
``build_*`` functions fetch and score, returning Polars DataFrames that match
the SQL schema. They touch the network but never the database, so they can be
inspected and tested without a Supabase project.

``write_*`` / :func:`run_refresh` handle Postgres. Kept deliberately thin.

Incremental by default, full when it matters
--------------------------------------------
A completed season never changes. 2016's box scores have been final for a
decade, so re-scoring them on every run is work done for no reason, and the
routine refresh skips them: only the current season is rebuilt.

The risk that creates is staleness. If the scoring rules change and only the
current season is re-scored, history silently keeps its old numbers — two
different rulesets mixed in one table, with nothing to reveal it. So the rules
are fingerprinted (:meth:`ScoringRules.fingerprint`) and the fingerprint is
stored beside the data. When it stops matching, the next run rebuilds
everything on its own. No remembering to pass a flag.

A full rebuild is therefore automatic when it is needed and skipped when it is
not. ``--full`` forces one anyway; measured cost is ~4s for a decade of history
(174k player-weeks, 311 MB peak), so forcing one is cheap when warranted.

:func:`append_injury_news` is append-only regardless: RotoWire's feed is a
~5-item sliding window, so that history exists only because we accumulate it
and cannot be rebuilt from upstream.
"""

from __future__ import annotations

import io
import logging
from typing import Any

import polars as pl

from ff.analysis.compare import adp_lookup
from ff.scoring.engine import FANTASY_POINTS_COLUMN, score_weekly_stats
from ff.scoring.rules import LEAGUE_SCORING, ScoringRules
from ff.sources import nflverse, rotowire, sleeper

log = logging.getLogger(__name__)

#: Metadata columns carried alongside the scored value.
_META_COLUMNS = (
    "player_id",
    "season",
    "week",
    "season_type",
    "player_name",
    "position",
    "team",
)

#: How many seasons of history to publish.
DEFAULT_HISTORY_SEASONS = 10

#: Positions to pull ADP for.
ADP_POSITIONS = ("QB", "RB", "WR", "TE", "K")


def history_seasons(current_season: int, count: int = DEFAULT_HISTORY_SEASONS) -> list[int]:
    """The seasons to publish, ending with the one before ``current_season``."""
    return list(range(current_season - count, current_season))


# ---------------------------------------------------------------------------
# build_* — network in, DataFrame out. No database.
# ---------------------------------------------------------------------------


def build_scored_weekly(
    seasons: list[int],
    rules: ScoringRules = LEAGUE_SCORING,
    season_type: str | None = "REG",
) -> pl.DataFrame:
    """Scored weekly stats, shaped to the ``scored_weekly_stats`` table.

    Seasons with no published data yet are skipped rather than raising — during
    preseason the current year's file does not exist.
    """
    frames: list[pl.DataFrame] = []
    for season in seasons:
        try:
            frames.append(nflverse.load_weekly_stats(seasons=season))
        except Exception as exc:  # noqa: BLE001 — not published yet is normal
            log.warning("skipping season %s: %s", season, exc)
    if not frames:
        return pl.DataFrame()

    weekly = pl.concat(frames, how="vertical_relaxed")
    if season_type and "season_type" in weekly.columns:
        weekly = weekly.filter(pl.col("season_type") == season_type)

    # Fantasy scores the regular season; postseason rows at weeks 19-22 would
    # otherwise inflate totals for exactly the players worth comparing.
    scored = score_weekly_stats(weekly, rules)

    if "player_display_name" in scored.columns:
        scored = scored.with_columns(pl.col("player_display_name").alias("player_name"))

    wanted = list(_META_COLUMNS) + [FANTASY_POINTS_COLUMN] + list(rules.required_columns())
    present = [c for c in wanted if c in scored.columns]
    return scored.select(present)


def build_player_index(seasons: list[int]) -> pl.DataFrame:
    """The searchable player universe, shaped to the ``player_index`` table."""
    from ff.analysis.players import player_index

    index = player_index(seasons)
    return index.select(
        pl.col("gsis_id").alias("player_id"),
        pl.col("name"),
        pl.col("norm_name"),
        pl.col("position"),
        pl.col("team"),
        pl.col("season").alias("latest_season"),
    )


def build_adp(season: int, positions: tuple[str, ...] = ADP_POSITIONS) -> pl.DataFrame:
    """ADP and projections, shaped to the ``adp_projections`` table.

    Joined to ``player_id`` where a name match is available; left null
    otherwise, so an unmatched Sleeper row is visible rather than dropped.
    """
    lookup = adp_lookup(set(positions), season)
    if not lookup:
        return pl.DataFrame()

    rows = [
        {
            "season": season,
            "norm_name": norm,
            "sleeper_name": entry.get("name") or norm,
            "position": entry.get("position"),
            "team": entry.get("team"),
            "adp_ppr": entry.get("adp"),
            "projected_points": entry.get("proj"),
            "injury_status": entry.get("injury_status"),
        }
        for norm, entry in lookup.items()
    ]
    return pl.DataFrame(rows, strict=False)


def attach_player_ids(adp: pl.DataFrame, index: pl.DataFrame) -> pl.DataFrame:
    """Left-join ADP rows to ``player_id`` on normalised name."""
    if adp.is_empty() or index.is_empty():
        return adp.with_columns(pl.lit(None, dtype=pl.Utf8).alias("player_id"))
    return adp.join(
        index.select("player_id", "norm_name").unique(subset="norm_name"),
        on="norm_name",
        how="left",
    )


def build_injury_news() -> pl.DataFrame:
    """Current RotoWire feed window, shaped to the ``injury_news`` table."""
    items = rotowire.fetch_injuries()
    if not items:
        return pl.DataFrame()
    return pl.DataFrame(
        [
            {
                "guid": i.guid,
                "title": i.title,
                "summary": i.summary,
                "link": i.link,
                "published": i.published,
            }
            for i in items
        ]
    )


# ---------------------------------------------------------------------------
# write_* — Postgres. Thin on purpose.
# ---------------------------------------------------------------------------


def _copy_frame(cursor: Any, table: str, frame: pl.DataFrame) -> int:
    """Bulk-load ``frame`` into ``table`` with COPY.

    COPY rather than row-by-row inserts or PostgREST: 174k rows through a REST
    API would be thousands of round trips.
    """
    buffer = io.BytesIO()
    frame.write_csv(buffer, include_header=False)
    buffer.seek(0)
    columns = ", ".join(f'"{c}"' for c in frame.columns)
    with cursor.copy(f"COPY {table} ({columns}) FROM STDIN WITH (FORMAT CSV)") as copy:
        copy.write(buffer.read())
    return frame.height


def replace_table(connection: Any, table: str, frame: pl.DataFrame) -> int:
    """Atomically replace ``table`` with ``frame``.

    TRUNCATE and COPY inside the caller's transaction, so readers never observe
    a half-rebuilt table.
    """
    if frame.is_empty():
        log.warning("refusing to truncate %s: nothing to write", table)
        return 0
    with connection.cursor() as cursor:
        cursor.execute(f"TRUNCATE {table}")
        return _copy_frame(cursor, table, frame)


def append_injury_news(connection: Any, frame: pl.DataFrame) -> int:
    """Append feed items, ignoring GUIDs already stored.

    Appended rather than replaced: this is the one table whose history cannot
    be rebuilt from an upstream source.
    """
    if frame.is_empty():
        return 0
    columns = ("guid", "title", "summary", "link", "published")
    rows = frame.select(columns).rows()
    with connection.cursor() as cursor:
        cursor.executemany(
            "INSERT INTO injury_news (guid, title, summary, link, published) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (guid) DO NOTHING",
            rows,
        )
    return len(rows)


def replace_season(connection: Any, season: int, frame: pl.DataFrame) -> int:
    """Replace one season's rows in ``scored_weekly_stats``.

    The incremental path. Deletes and re-inserts a single season rather than
    truncating the table, so a decade of settled history is left alone.
    """
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM scored_weekly_stats WHERE season = %s", (season,))
        if frame.is_empty():
            return 0
        return _copy_frame(cursor, "scored_weekly_stats", frame)


def full_rebuild_reason(
    connection: Any,
    fingerprint: str,
    forced: bool = False,
) -> str | None:
    """Why this run must rebuild everything, or ``None`` to go incremental.

    Returning a *reason* rather than a bool means the run log records why a
    full rebuild happened, which is the difference between a debuggable
    pipeline and a mysterious one.
    """
    if forced:
        return "forced by caller"
    with connection.cursor() as cursor:
        cursor.execute("SELECT rules_fingerprint FROM pipeline_meta WHERE id = 1")
        row = cursor.fetchone()
        if row is None or row[0] is None:
            return "first run — no published data yet"
        if row[0] != fingerprint:
            return f"scoring rules changed ({row[0]} -> {fingerprint})"

        cursor.execute("SELECT 1 FROM scored_weekly_stats LIMIT 1")
        if cursor.fetchone() is None:
            return "scored_weekly_stats is empty"
    return None


def run_refresh(
    dsn: str,
    seasons: list[int] | None = None,
    adp_season: int | None = None,
    rules: ScoringRules = LEAGUE_SCORING,
    full: bool = False,
) -> dict[str, Any]:
    """Refresh the published tables. Returns a summary of what was written.

    Incremental unless a full rebuild is warranted — see
    :func:`full_rebuild_reason`. Logs to ``pipeline_runs`` before doing any
    work, because a cron job that fails silently is worse than one that fails
    loudly.
    """
    import psycopg

    state = sleeper.nfl_state()
    current_season = int(state.get("season", 2026))
    all_seasons = seasons or history_seasons(current_season)
    adp_season = adp_season or current_season
    fingerprint = rules.fingerprint()

    written: dict[str, int] = {}
    with psycopg.connect(dsn) as connection:
        reason = full_rebuild_reason(connection, fingerprint, forced=full)
        mode = "full" if reason else "incremental"

        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO pipeline_runs (status, mode, reason) "
                "VALUES ('running', %s, %s) RETURNING id",
                (mode, reason),
            )
            run_id = cursor.fetchone()[0]
        connection.commit()

        try:
            # Small tables are always rebuilt whole: a few thousand rows each,
            # and rosters/ADP/injury status change continuously.
            index = build_player_index(all_seasons + [current_season])
            written["player_index"] = replace_table(connection, "player_index", index)

            adp = attach_player_ids(build_adp(adp_season), index)
            written["adp_projections"] = replace_table(connection, "adp_projections", adp)

            written["injury_news"] = append_injury_news(connection, build_injury_news())

            if mode == "full":
                log.info("full rebuild: %s", reason)
                scored = build_scored_weekly(all_seasons + [current_season], rules=rules)
                written["scored_weekly_stats"] = replace_table(
                    connection, "scored_weekly_stats", scored
                )
            else:
                # Settled seasons are left untouched. Only the current season
                # can still change — nflverse rebuilds it nightly and applies
                # stat corrections on Thursdays.
                scored = build_scored_weekly([current_season], rules=rules)
                written["scored_weekly_stats"] = replace_season(connection, current_season, scored)

            with connection.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO pipeline_meta (id, rules_fingerprint, last_full_refresh) "
                    "VALUES (1, %s, CASE WHEN %s THEN now() ELSE NULL END) "
                    "ON CONFLICT (id) DO UPDATE SET "
                    "rules_fingerprint = excluded.rules_fingerprint, "
                    "last_full_refresh = COALESCE(excluded.last_full_refresh, "
                    "pipeline_meta.last_full_refresh)",
                    (fingerprint, mode == "full"),
                )
                cursor.execute(
                    "UPDATE pipeline_runs SET status='ok', finished_at=now(), "
                    "rows_written=%s::jsonb WHERE id=%s",
                    (_json(written), run_id),
                )
            connection.commit()
        except Exception as exc:
            connection.rollback()
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE pipeline_runs SET status='error', finished_at=now(), "
                    "error=%s WHERE id=%s",
                    (str(exc)[:2000], run_id),
                )
            connection.commit()
            raise

    return {"mode": mode, "reason": reason, "rows_written": written}


def _json(value: Any) -> str:
    import json

    return json.dumps(value)
