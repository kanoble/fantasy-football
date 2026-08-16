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
    frame = scored.select(present)

    # nflverse emits an all-zero placeholder row per team-week carrying no
    # player_id and no name: measured 2026-08-15, 70 rows of 70,296 (0.1%)
    # across 2016-2025, every one scoring exactly 0.0 on every stat. player_id
    # is part of this table's primary key and NOT NULL, so these can never be
    # stored — and being all-zero, dropping them loses nothing. Logged, because
    # a sudden jump in the count would mean upstream changed shape.
    identified = frame.filter(pl.col("player_id").is_not_null())
    dropped = frame.height - identified.height
    if dropped:
        log.warning("scored_weekly_stats: dropped %d row(s) with no player_id", dropped)

    return identified


def build_player_index(seasons: list[int]) -> pl.DataFrame:
    """The searchable player universe, shaped to the ``player_index`` table."""
    from ff.analysis.players import player_index

    index = player_index(seasons)

    # nflverse rosters carry the occasional entry with no player_name: measured
    # 2026-08-15, exactly 1 row of 10,147 across 2016-2026 (gsis_id 00-0031605,
    # a 2016 Viking). This table exists to be searched by name, so a nameless
    # row is unusable to every caller — and both name columns are NOT NULL in
    # the schema, so keeping it aborts the whole COPY rather than landing one
    # bad row. Dropped, but logged: a jump in this count means upstream changed.
    named = index.filter(pl.col("name").is_not_null() & pl.col("norm_name").is_not_null())
    dropped = index.height - named.height
    if dropped:
        log.warning("player_index: dropped %d row(s) with no player name", dropped)

    return named.select(
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
    # Declare the schema rather than letting Polars infer it. injury_status is
    # null for every healthy player, so inference reads Null from the first
    # infer_schema_length rows and then fails on the first real value
    # ("Questionable"). That makes the failure depend on how many healthy
    # players happen to sort first — fine in August, broken in November. These
    # types mirror the adp_projections table.
    schema = {
        "season": pl.Int32,
        "norm_name": pl.Utf8,
        "sleeper_name": pl.Utf8,
        "position": pl.Utf8,
        "team": pl.Utf8,
        "adp_ppr": pl.Float64,
        "projected_points": pl.Float64,
        "injury_status": pl.Utf8,
    }
    return pl.DataFrame(rows, schema=schema, strict=False)


#: Position labels that name the same player pool on different sides of the
#: join. Sleeper lists fullbacks as FB; nflverse rosters call the same players
#: RB. Folded together so a real match is never rejected over a label.
_POSITION_ALIASES = {"FB": "RB", "HB": "RB", "PK": "K"}


def _canonical_position(column: str) -> pl.Expr:
    """``column`` uppercased and folded onto its canonical position label."""
    return pl.col(column).str.to_uppercase().replace(_POSITION_ALIASES)


def attach_player_ids(adp: pl.DataFrame, index: pl.DataFrame) -> pl.DataFrame:
    """Resolve each ADP row to a ``player_id``, gating an ambiguous name on position.

    Joining on normalised name alone is wrong here, and wrong in a way that
    hides. Measured 2026-08-16, ``player_index`` holds 143 normalised names
    shared by more than one player, so deduplicating the index arbitrarily
    handed a star his namesake's row: Justin Jefferson, drafted 11th overall,
    resolved to a Browns *linebacker* of the same name and rendered with no
    history at all — as did Josh Allen (an offensive lineman) and DeVonta Smith
    (a defensive back). 159 ADP rows resolved across a position boundary and 19
    of those inherited a stranger's stat line, which is the worse half: an
    empty row reads as missing, a wrong row reads as fact.

    Candidates are ranked by position agreement, then by most recent season,
    then by ``player_id`` — the last purely so a rerun on unchanged input
    cannot silently produce a different answer, which is what made the original
    bug so hard to see.

    An unmatched row still keeps a null ``player_id`` rather than being
    dropped, so a Sleeper name with no nflverse counterpart stays visible.
    """
    if adp.is_empty() or index.is_empty():
        return adp.with_columns(pl.lit(None, dtype=pl.Utf8).alias("player_id"))

    columns = adp.columns
    candidates = adp.join(
        index.select(
            "player_id",
            "norm_name",
            pl.col("position").alias("_index_position"),
            pl.col("latest_season").alias("_index_season"),
        ),
        on="norm_name",
        how="left",
    )

    exact = pl.col("position").str.to_uppercase() == pl.col("_index_position").str.to_uppercase()
    equivalent = _canonical_position("position") == _canonical_position("_index_position")
    unknown = pl.col("position").is_null() | pl.col("_index_position").is_null()

    ranked = candidates.with_columns(
        pl.when(exact)
        .then(0)
        .when(equivalent)
        .then(1)
        # A candidate whose position nobody knows beats one that actively
        # contradicts: missing information is not evidence of a mismatch.
        .when(unknown)
        .then(2)
        .otherwise(3)
        .alias("_match_rank")
    )

    best = ranked.sort(
        ["_match_rank", "_index_season", "player_id"],
        descending=[False, True, False],
        nulls_last=True,
    ).unique(subset=["season", "norm_name"], keep="first", maintain_order=True)

    return best.select(*columns, "player_id")


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
