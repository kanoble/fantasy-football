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

from ff.pipeline import full_rebuild_reason, history_seasons
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
