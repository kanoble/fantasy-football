"""nflverse data access — the historical/statistical backbone. Free, no auth.

Uses **nflreadpy**, the successor to ``nfl_data_py`` (deprecated and archived in
Sep 2025). The important practical difference: nflreadpy returns **Polars**
DataFrames, not pandas. Do not reach for ``.iloc`` / ``.loc`` here.

Refresh cadence worth knowing before you cache:

* rosters + depth charts — daily, ~07:00 UTC
* pbp + weekly stats — nightly after game days, with a **Thursday-night refresh
  for stat corrections** (so a Wednesday pull of last week's stats can still
  change)
* schedules — every 5 minutes in-season

Data is CC-BY-4.0; attribution is required. See README.md.
"""

from __future__ import annotations

import nflreadpy as nfl
import polars as pl

# Weekly box scores are the input to the scoring engine: one row per
# player-week, ~150 columns of raw stats. This is the table that
# ff.scoring applies the league's scoring function to.
WEEKLY_STATS_KEY_COLUMNS = ("player_id", "season", "week", "team", "position")


def load_weekly_stats(seasons: int | list[int] | None = None) -> pl.DataFrame:
    """Weekly player box scores — one row per player-week.

    This is the core table of the project. ``player_id`` here is the
    **gsis_id**, the join key everything else crosswalks to.

    Parameters
    ----------
    seasons:
        A season, a list of seasons, or ``None`` for the current season.
    """
    return nfl.load_player_stats(seasons=seasons, summary_level="week")


def load_rosters(seasons: int | list[int] | None = None) -> pl.DataFrame:
    """Season-level rosters.

    The best join target for active players: ``gsis_id`` coverage is complete,
    and espn/sleeper/sportradar/pfr IDs are ~82% populated.
    """
    return nfl.load_rosters(seasons=seasons)


def load_weekly_rosters(seasons: int | list[int] | None = None) -> pl.DataFrame:
    """Week-by-week rosters — needed to know who was actually on a team when."""
    return nfl.load_rosters_weekly(seasons=seasons)


def load_schedules(seasons: int | list[int] | None = None) -> pl.DataFrame:
    """Game schedules and results. Refreshed every 5 minutes in-season."""
    return nfl.load_schedules(seasons=seasons)


def load_injuries(seasons: int | list[int] | None = None) -> pl.DataFrame:
    """Official injury report data (distinct from RotoWire's news feed)."""
    return nfl.load_injuries(seasons=seasons)


def load_player_ids() -> pl.DataFrame:
    """The DynastyProcess player ID crosswalk (mfl/gsis/sleeper/espn/yahoo/...).

    Note on missing values: the raw CSV encodes them as the literal string
    ``"NA"``, which makes naive emptiness checks report 100% coverage. Loaded
    through nflreadpy they arrive as real nulls — but do not assume that if you
    ever fetch the CSV directly.

    Yahoo ID coverage is the known gap: verified on 2026-08-15, this file has
    **zero** ``yahoo_id`` values for the 2025 (0/376) and 2026 (0/285) draft
    classes. See :mod:`ff.identity` for the fuzzy-match fallback that exists
    because of this.
    """
    return nfl.load_ff_playerids()


def load_depth_charts(seasons: int | list[int] | None = None) -> pl.DataFrame:
    """Depth charts. Refreshed daily at ~07:00 UTC."""
    return nfl.load_depth_charts(seasons=seasons)
