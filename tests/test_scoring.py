"""Tests for the scoring engine — the pure heart of the project.

No network, no database, no Yahoo. ScoringRules is built by hand, which is
exactly the point: the scoring function is decoupled from how the rules were
obtained, so it is testable long before Yahoo API access is approved.
"""

from __future__ import annotations

import polars as pl
import pytest

from ff.scoring.engine import score_weekly_stats, season_totals
from ff.scoring.rules import ScoringRules, StatRule


def half_ppr() -> ScoringRules:
    """A conventional half-PPR ruleset."""
    return ScoringRules(
        league_key="461.l.000000",
        rules=(
            StatRule(4, "Passing Yards", 0.04, "passing_yards"),
            StatRule(5, "Passing TD", 4.0, "passing_tds"),
            StatRule(6, "Interception", -1.0, "passing_interceptions"),
            StatRule(8, "Rushing Yards", 0.1, "rushing_yards"),
            StatRule(9, "Rushing TD", 6.0, "rushing_tds"),
            StatRule(11, "Receiving Yards", 0.1, "receiving_yards"),
            StatRule(12, "Receiving TD", 6.0, "receiving_tds"),
            StatRule(13, "Reception", 0.5, "receptions"),
        ),
    )


def sample_stats() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "player_id": ["00-0000001", "00-0000002", "00-0000001"],
            "season": [2025, 2025, 2025],
            "week": [1, 1, 2],
            "passing_yards": [300.0, 0.0, 250.0],
            "passing_tds": [3.0, 0.0, 1.0],
            "passing_interceptions": [1.0, 0.0, 2.0],
            "rushing_yards": [20.0, 100.0, 10.0],
            "rushing_tds": [0.0, 1.0, 0.0],
            "receiving_yards": [0.0, 40.0, 0.0],
            "receiving_tds": [0.0, 0.0, 0.0],
            "receptions": [0.0, 4.0, 0.0],
        }
    )


def test_scores_a_known_line_exactly():
    scored = score_weekly_stats(sample_stats(), half_ppr())
    # QB week 1: 300*0.04 + 3*4 - 1*1 + 20*0.1 = 12 + 12 - 1 + 2 = 25.0
    assert scored["fantasy_points"][0] == pytest.approx(25.0)
    # RB week 1: 100*0.1 + 1*6 + 40*0.1 + 4*0.5 = 10 + 6 + 4 + 2 = 22.0
    assert scored["fantasy_points"][1] == pytest.approx(22.0)


def test_scoring_is_a_function_of_the_rules_not_the_data():
    """The same stats under full PPR must differ by exactly the reception delta."""
    stats = sample_stats()
    half = score_weekly_stats(stats, half_ppr())

    rules = half_ppr()
    full_ppr = ScoringRules(
        league_key=rules.league_key,
        rules=tuple(
            StatRule(r.stat_id, r.name, 1.0 if r.stat_id == 13 else r.points_per_unit, r.column)
            for r in rules.rules
        ),
    )
    full = score_weekly_stats(stats, full_ppr)

    delta = full["fantasy_points"] - half["fantasy_points"]
    expected = stats["receptions"] * 0.5
    assert delta.to_list() == pytest.approx(expected.to_list())


def test_negative_scoring_applies():
    """Interceptions must subtract. A sign error here corrupts everything."""
    stats = pl.DataFrame(
        {
            "passing_yards": [0.0],
            "passing_tds": [0.0],
            "passing_interceptions": [3.0],
            "rushing_yards": [0.0],
            "rushing_tds": [0.0],
            "receiving_yards": [0.0],
            "receiving_tds": [0.0],
            "receptions": [0.0],
        }
    )
    scored = score_weekly_stats(stats, half_ppr())
    assert scored["fantasy_points"][0] == pytest.approx(-3.0)


def test_nulls_count_as_zero_not_null():
    """A WR has null passing stats; that is 0 points, not an unknown score."""
    stats = pl.DataFrame(
        {
            "passing_yards": [None],
            "passing_tds": [None],
            "passing_interceptions": [None],
            "rushing_yards": [None],
            "rushing_tds": [None],
            "receiving_yards": [80.0],
            "receiving_tds": [1.0],
            "receptions": [6.0],
        }
    )
    scored = score_weekly_stats(stats, half_ppr())
    # 80*0.1 + 6 + 6*0.5 = 8 + 6 + 3 = 17.0
    assert scored["fantasy_points"][0] == pytest.approx(17.0)


def test_missing_column_is_lenient_by_default_and_strict_on_request():
    stats = sample_stats().drop("receptions")
    lenient = score_weekly_stats(stats, half_ppr())
    assert "fantasy_points" in lenient.columns

    with pytest.raises(ValueError, match="missing columns"):
        score_weekly_stats(stats, half_ppr(), strict=True)


def test_rules_with_no_mappable_stats_is_an_error_not_a_zero_column():
    """Scoring every player 0.0 is a silent, catastrophic wrong answer."""
    unmappable = ScoringRules(
        league_key="x",
        rules=(StatRule(999, "Mystery Stat", 1.0, None),),
    )
    with pytest.raises(ValueError, match="no mappable stat rules"):
        score_weekly_stats(sample_stats(), unmappable)


def test_season_totals_aggregates_and_reports_volatility():
    scored = score_weekly_stats(sample_stats(), half_ppr())
    totals = season_totals(scored)
    qb = totals.filter(pl.col("player_id") == "00-0000001")
    assert qb["weeks"][0] == 2
    # week1 25.0 + week2 (250*.04 + 4 - 2 + 1) = 10 + 4 - 2 + 1 = 13.0 -> 38.0
    assert qb["total_points"][0] == pytest.approx(38.0)
    assert qb["std_points"][0] > 0  # spiky weeks are visible, not averaged away


def test_unmapped_rules_are_reported_not_silently_dropped():
    rules = ScoringRules(
        league_key="x",
        rules=(StatRule(13, "Reception", 0.5, "receptions"),),
        unmapped=(StatRule(19, "FG 0-19", 3.0, None),),
    )
    assert "UNMAPPED" in rules.describe()
    assert "FG 0-19" in rules.describe()
    assert len(rules.mappable) == 1
