"""Tests for the refresh pipeline's decision logic.

The interesting part is not the SQL — it is whether the pipeline can tell that
previously-published data is stale. Incremental refresh is only safe because a
scoring-rule change is *detected*; if the fingerprint were unreliable, history
would quietly keep numbers computed under rules that no longer exist.

No database and no network: `full_rebuild_reason` is exercised against a fake
connection.
"""

from __future__ import annotations

from dataclasses import replace

import polars as pl

from ff.pipeline import attach_player_ids, full_rebuild_reason, history_seasons
from ff.scoring.rules import LEAGUE_SCORING, ScoringRules, StatRule

# -- fingerprint ----------------------------------------------------------


def test_fingerprint_is_stable_across_calls():
    assert LEAGUE_SCORING.fingerprint() == LEAGUE_SCORING.fingerprint()


def test_fingerprint_is_insensitive_to_rule_order():
    """Reordering rules is not a scoring change and must not force a rebuild."""
    reordered = ScoringRules(
        league_key=LEAGUE_SCORING.league_key,
        rules=tuple(reversed(LEAGUE_SCORING.rules)),
        unmapped=LEAGUE_SCORING.unmapped,
    )
    assert reordered.fingerprint() == LEAGUE_SCORING.fingerprint()


def test_fingerprint_changes_when_a_points_value_changes():
    """Half PPR vs full PPR must be detectable — this is the whole point."""
    changed = ScoringRules(
        league_key=LEAGUE_SCORING.league_key,
        rules=tuple(
            replace(r, points_per_unit=0.5) if r.name == "Receptions" else r
            for r in LEAGUE_SCORING.rules
        ),
        unmapped=LEAGUE_SCORING.unmapped,
    )
    assert changed.fingerprint() != LEAGUE_SCORING.fingerprint()


def test_fingerprint_changes_when_a_rule_gains_a_column():
    """Dropping a fumble column changes scores; it must change the fingerprint."""
    changed = ScoringRules(
        league_key=LEAGUE_SCORING.league_key,
        rules=tuple(
            replace(r, columns=("rushing_fumbles_lost",)) if r.name == "Fumbles Lost" else r
            for r in LEAGUE_SCORING.rules
        ),
        unmapped=LEAGUE_SCORING.unmapped,
    )
    assert changed.fingerprint() != LEAGUE_SCORING.fingerprint()


def test_fingerprint_changes_when_an_unmapped_rule_becomes_mapped():
    """Mapped rules alone would look identical here — unmapped must count too."""
    changed = ScoringRules(
        league_key=LEAGUE_SCORING.league_key,
        rules=LEAGUE_SCORING.rules + (StatRule("Offensive Fumble Return TD", 6.0, ("x",)),),
        unmapped=(),
    )
    assert changed.fingerprint() != LEAGUE_SCORING.fingerprint()


# -- rebuild decision -----------------------------------------------------


class FakeCursor:
    def __init__(self, results: list):
        self._results = list(results)
        self.executed: list[str] = []

    def execute(self, sql, params=None):
        self.executed.append(sql)

    def fetchone(self):
        return self._results.pop(0) if self._results else None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeConnection:
    def __init__(self, results: list):
        self._cursor = FakeCursor(results)

    def cursor(self):
        return self._cursor


def test_first_run_rebuilds_everything():
    reason = full_rebuild_reason(FakeConnection([None]), "abc123")
    assert reason is not None
    assert "first run" in reason


def test_matching_fingerprint_and_populated_table_goes_incremental():
    connection = FakeConnection([("abc123",), (1,)])
    assert full_rebuild_reason(connection, "abc123") is None


def test_changed_fingerprint_forces_a_full_rebuild():
    """The safety property incremental refresh depends on."""
    connection = FakeConnection([("oldhash",), (1,)])
    reason = full_rebuild_reason(connection, "newhash")
    assert reason is not None
    assert "scoring rules changed" in reason
    assert "oldhash" in reason and "newhash" in reason


def test_empty_table_forces_a_full_rebuild():
    """Fingerprint matches but there is no data — e.g. someone truncated it."""
    connection = FakeConnection([("abc123",), None])
    reason = full_rebuild_reason(connection, "abc123")
    assert reason is not None
    assert "empty" in reason


def test_forced_rebuild_short_circuits_without_querying():
    connection = FakeConnection([])
    assert full_rebuild_reason(connection, "abc123", forced=True) == "forced by caller"


# -- season selection -----------------------------------------------------


def test_history_seasons_excludes_the_current_season():
    seasons = history_seasons(2026, count=3)
    assert seasons == [2023, 2024, 2025]
    assert 2026 not in seasons


# -- identity: resolving an ADP row to a player ---------------------------
#
# These guard a bug that shipped: the ADP join matched on normalised name only
# and deduplicated the index arbitrarily, so Justin Jefferson the Vikings
# receiver was resolved to a Browns linebacker of the same name and shown with
# no history. An empty row reads as "no data"; nobody looks twice at it.


def _index(rows: list[dict]) -> pl.DataFrame:
    return pl.DataFrame(
        rows,
        schema={
            "player_id": pl.Utf8,
            "name": pl.Utf8,
            "norm_name": pl.Utf8,
            "position": pl.Utf8,
            "team": pl.Utf8,
            "latest_season": pl.Int32,
        },
    )


def _adp(rows: list[dict]) -> pl.DataFrame:
    return pl.DataFrame(
        rows,
        schema={
            "season": pl.Int32,
            "norm_name": pl.Utf8,
            "sleeper_name": pl.Utf8,
            "position": pl.Utf8,
            "team": pl.Utf8,
            "adp_ppr": pl.Float64,
        },
    )


NAMESAKES = _index(
    [
        {
            "player_id": "00-0036322",
            "name": "Justin Jefferson",
            "norm_name": "justin jefferson",
            "position": "WR",
            "team": "MIN",
            "latest_season": 2026,
        },
        {
            "player_id": "00-0041075",
            "name": "Justin Jefferson",
            "norm_name": "justin jefferson",
            "position": "LB",
            "team": "CLE",
            "latest_season": 2026,
        },
    ]
)


def test_ambiguous_name_resolves_on_position():
    """The real bug: two players, one name, and only one of them is a receiver."""
    adp = _adp(
        [
            {
                "season": 2026,
                "norm_name": "justin jefferson",
                "sleeper_name": "Justin Jefferson",
                "position": "WR",
                "team": "MIN",
                "adp_ppr": 11.0,
            }
        ]
    )
    resolved = attach_player_ids(adp, NAMESAKES)
    assert resolved.height == 1
    assert resolved["player_id"][0] == "00-0036322"


def test_ambiguous_name_resolves_the_other_way_too():
    """Same index, defensive query: the gate must actually read the position."""
    adp = _adp(
        [
            {
                "season": 2026,
                "norm_name": "justin jefferson",
                "sleeper_name": "Justin Jefferson",
                "position": "LB",
                "team": "CLE",
                "adp_ppr": 300.0,
            }
        ]
    )
    assert attach_player_ids(adp, NAMESAKES)["player_id"][0] == "00-0041075"


def test_position_label_differences_still_match():
    """Sleeper says FB, nflverse says RB. Same player; not a mismatch."""
    index = _index(
        [
            {
                "player_id": "00-0035125",
                "name": "Alec Ingold",
                "norm_name": "alec ingold",
                "position": "RB",
                "team": "MIA",
                "latest_season": 2026,
            }
        ]
    )
    adp = _adp(
        [
            {
                "season": 2026,
                "norm_name": "alec ingold",
                "sleeper_name": "Alec Ingold",
                "position": "FB",
                "team": "MIA",
                "adp_ppr": 566.0,
            }
        ]
    )
    assert attach_player_ids(adp, index)["player_id"][0] == "00-0035125"


def test_unmatched_name_keeps_a_null_id_rather_than_vanishing():
    adp = _adp(
        [
            {
                "season": 2026,
                "norm_name": "nobody atall",
                "sleeper_name": "Nobody Atall",
                "position": "WR",
                "team": None,
                "adp_ppr": 400.0,
            }
        ]
    )
    resolved = attach_player_ids(adp, NAMESAKES)
    assert resolved.height == 1
    assert resolved["player_id"][0] is None


def test_no_position_match_prefers_the_most_recent_player():
    """Neither candidate plays the queried position, so recency breaks the tie."""
    index = _index(
        [
            {
                "player_id": "00-0011111",
                "name": "Sam Same",
                "norm_name": "sam same",
                "position": "OL",
                "team": "BUF",
                "latest_season": 2019,
            },
            {
                "player_id": "00-0022222",
                "name": "Sam Same",
                "norm_name": "sam same",
                "position": "DB",
                "team": "KC",
                "latest_season": 2026,
            },
        ]
    )
    adp = _adp(
        [
            {
                "season": 2026,
                "norm_name": "sam same",
                "sleeper_name": "Sam Same",
                "position": "TE",
                "team": "KC",
                "adp_ppr": 500.0,
            }
        ]
    )
    assert attach_player_ids(adp, index)["player_id"][0] == "00-0022222"


def test_one_row_per_adp_entry_even_with_namesakes():
    """A fan-out here would duplicate the primary key and abort the COPY."""
    adp = _adp(
        [
            {
                "season": 2026,
                "norm_name": "justin jefferson",
                "sleeper_name": "Justin Jefferson",
                "position": "WR",
                "team": "MIN",
                "adp_ppr": 11.0,
            }
        ]
    )
    resolved = attach_player_ids(adp, NAMESAKES)
    assert resolved.height == 1
    assert resolved.columns == [*adp.columns, "player_id"]
