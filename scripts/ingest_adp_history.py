#!/usr/bin/env python3
"""Backfill ``adp_history`` from Fantasy Football Calculator.

A one-time job, run by hand, that gives the database the thing it has never
had: draft prices from seasons whose results are already known. See
``supabase/migrations/0007_adp_history.sql`` for why this is a separate table
and ``ff/sources/ffc.py`` for what the source actually covers.

Names are resolved to gsis_ids through the same crosswalk the daily refresh
uses (``ff.pipeline.attach_player_ids``), against the *published*
``player_index`` rather than a freshly downloaded one — that is both faster and
the honest test, since it resolves against the identities the app will actually
join on. An unmatched row is written with a null ``player_id`` rather than
dropped, and the run prints a per-season match rate so a bad crosswalk is
visible rather than quietly halving the dataset.

Match rates measured 2026-08-16 against a 2016-2026 index (10,145 players):

    all rows, all seasons       91.2%
    excluding team defences     96.4%
    excluding DEF, 2016+        99.2%   (2,075 of 2,091)

The three numbers are the same data read at three widths, and the widest is
the least useful. Team defences are ~9% of every FFC season and have no
gsis_id by definition — they are not players. Below 2016 the misses are
players who retired before ``player_index``'s window opens (Calvin Johnson,
Peyton Manning, Ray Rice), who also have no scored weeks to compare a price
against, so an unmatched row there costs nothing the feature wanted.

What is left at 99.2% is 16 rows over eleven seasons, every one a first-name
variant FFC spells differently from nflverse: Hollywood/Marquise Brown,
Joshua/Josh Palmer, Steven/Steve Hauschka, Michael/Mike Badgley,
Chris/Christopher Herndon, Kenny Gainwell. ``attach_player_ids`` matches
exact normalised names only; ``ff.identity``'s fuzzy resolver would catch
these and is deliberately not reached for here, because 16 auditable nulls
are a better trade than a threshold that might quietly attach the wrong man.

Idempotent: rows are upserted on ``(season, source, norm_name)``, so re-running
after a crosswalk fix updates in place instead of duplicating.

Usage::

    uv run python scripts/ingest_adp_history.py                 # 2012..current
    uv run python scripts/ingest_adp_history.py --from 2016     # narrower
    uv run python scripts/ingest_adp_history.py --dry-run       # fetch, no write

Requires a database URL in the environment (SUPABASE_DB_URL or
POSTGRES_URL_NON_POOLING) unless --dry-run.
"""

from __future__ import annotations

import argparse
import sys
from typing import Any

import polars as pl

from ff.config import DSN_ENV_VARS, resolve_dsn
from ff.identity import normalize_name
from ff.pipeline import attach_player_ids
from ff.sources import ffc, sleeper

SOURCE = "ffc_ppr_12"
"""Recorded in `adp_history.source`.

Names the aggregator *and* the league shape, because FFC publishes a different
number for 10-team standard and it would sit in this table indistinguishably.
"""


def fetch_season(season: int) -> tuple[pl.DataFrame, dict[str, Any]]:
    """One season of FFC ADP, shaped for `attach_player_ids`."""
    players, meta = ffc.fetch_adp(season)
    if not players:
        return pl.DataFrame(), meta

    rows = [
        {
            "season": season,
            "source": SOURCE,
            "norm_name": normalize_name(player.get("name") or ""),
            "name": player.get("name"),
            "position": player.get("position"),
            "team": player.get("team"),
            "adp": player.get("adp"),
            "times_drafted": player.get("times_drafted"),
            "high": player.get("high"),
            "low": player.get("low"),
            "stdev": player.get("stdev"),
        }
        for player in players
        if player.get("name") and player.get("adp") is not None
    ]

    # Declared rather than inferred, for the reason build_adp() spells out:
    # stdev and high/low are null often enough near the top of a draft that
    # inference can read the wrong type off the first rows and then fail on a
    # real value further down.
    schema = {
        "season": pl.Int32,
        "source": pl.Utf8,
        "norm_name": pl.Utf8,
        "name": pl.Utf8,
        "position": pl.Utf8,
        "team": pl.Utf8,
        "adp": pl.Float64,
        "times_drafted": pl.Int32,
        "high": pl.Int32,
        "low": pl.Int32,
        "stdev": pl.Float64,
    }
    frame = pl.DataFrame(rows, schema=schema, strict=False)

    # Two FFC rows can normalise to one name (a father and son, a re-used
    # spelling). The primary key is (season, source, norm_name), so collapse
    # here rather than letting the upsert silently keep whichever arrived last.
    # Earliest ADP wins: that is the row a drafter would have been looking at.
    return frame.sort("adp").unique(subset=["norm_name"], keep="first", maintain_order=True), meta


def load_player_index(connection: Any) -> pl.DataFrame:
    """The published index, in the shape `attach_player_ids` expects."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT player_id, norm_name, position, latest_season FROM player_index")
        rows = cursor.fetchall()

    return pl.DataFrame(
        rows,
        schema={
            "player_id": pl.Utf8,
            "norm_name": pl.Utf8,
            "position": pl.Utf8,
            "latest_season": pl.Int32,
        },
        orient="row",
    )


def upsert(connection: Any, frame: pl.DataFrame) -> int:
    """Insert or update rows keyed on (season, source, norm_name)."""
    if frame.is_empty():
        return 0

    # Identifiers quoted throughout: `position` is a SQL keyword, and an
    # unquoted one in a column list is a parse error waiting for the first run
    # against a real database rather than a dry one.
    columns = list(frame.columns)
    keys = {"season", "source", "norm_name"}
    updates = ", ".join(f'"{c}" = excluded."{c}"' for c in columns if c not in keys)
    placeholders = ", ".join(["%s"] * len(columns))
    names = ", ".join(f'"{c}"' for c in columns)
    statement = (
        f"INSERT INTO adp_history ({names}) VALUES ({placeholders}) "
        f"ON CONFLICT (season, source, norm_name) DO UPDATE SET {updates}"
    )

    with connection.cursor() as cursor:
        cursor.executemany(statement, frame.rows())
    return frame.height


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="start", type=int, default=ffc.EARLIEST_SEASON)
    parser.add_argument("--to", dest="end", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true", help="fetch and report, write nothing")
    args = parser.parse_args()

    end = args.end
    if end is None:
        # The season being drafted is worth having from FFC too, so the whole
        # series is one instrument end to end rather than nine years of FFC
        # with a Sleeper number bolted on the front.
        end = int(sleeper.nfl_state().get("season", 2026))

    seasons = list(range(args.start, end + 1))
    print(f"Backfilling {SOURCE} for {seasons[0]}..{seasons[-1]} ({len(seasons)} seasons)\n")

    if args.dry_run:
        total = 0
        for season in seasons:
            frame, meta = fetch_season(season)
            total += frame.height
            print(
                f"  {season}  {frame.height:>4} players  "
                f"{meta.get('total_drafts') or '?':>6} drafts"
            )
        print(f"\nDry run: {total} rows, nothing written.")
        return 0

    dsn = resolve_dsn()
    if not dsn:
        print(f"No database URL. Set {' or '.join(DSN_ENV_VARS)}.", file=sys.stderr)
        return 1

    import psycopg

    written = 0
    unmatched_total = 0
    with psycopg.connect(dsn) as connection:
        index = load_player_index(connection)
        if index.is_empty():
            print(
                "player_index is empty — run the refresh first, or every row "
                "here would be written unmatched.",
                file=sys.stderr,
            )
            return 1
        print(f"Resolving against {index.height} published players.\n")

        for season in seasons:
            frame, meta = fetch_season(season)
            if frame.is_empty():
                print(f"  {season}  no data for this format, skipped")
                continue

            resolved = attach_player_ids(frame, index)
            matched = resolved.filter(pl.col("player_id").is_not_null()).height
            unmatched_total += resolved.height - matched

            written += upsert(connection, resolved)
            print(
                f"  {season}  {resolved.height:>4} players  "
                f"{matched:>4} matched ({matched / resolved.height:>5.1%})  "
                f"{meta.get('total_drafts') or '?':>6} drafts"
            )
        connection.commit()

    print(f"\nWrote {written} rows. {unmatched_total} unmatched (stored with a null player_id).")
    # Unmatched rows are expected and not an error: FFC lists kickers and
    # defences the index has no gsis_id for, plus a decade of players who never
    # appeared in the ten seasons player_index covers.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
