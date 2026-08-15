"""Tests for the scoring engine — the pure heart of the project.

No network, no database, no Yahoo. Rules are built by hand, which is the point:
scoring is decoupled from how the rules were obtained.
"""

from __future__ import annotations

import polars as pl
import pytest

from ff.scoring.engine import score_weekly_stats, season_totals
from ff.scoring.rules import LEAGUE_SCORING, ScoringRules, StatRule


def half_ppr() -> ScoringRules:
    return ScoringRules(
        league_key="test",
        rules=(
            StatRule("Passing Yards", 0.04, ("passing_yards",)),
            StatRule("Passing TD", 4.0, ("passing_tds",)),
            StatRule("Interception", -1.0, ("passing_interceptions",)),
            StatRule("Rushing Yards", 0.1, ("rushing_yards",)),
            StatRule("Rushing TD", 6.0, ("rushing_tds",)),
            StatRule("Receiving Yards", 0.1, ("receiving_yards",)),
            StatRule("Receiving TD", 6.0, ("receiving_tds",)),
            StatRule("Reception", 0.5, ("receptions",)),
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
    # QB wk1: 300*.04 + 3*4 - 1 + 20*.1 = 12 + 12 - 1 + 2 = 25.0
    assert scored["fantasy_points"][0] == pytest.approx(25.0)
    # RB wk1: 100*.1 + 6 + 40*.1 + 4*.5 = 10 + 6 + 4 + 2 = 22.0
    assert scored["fantasy_points"][1] == pytest.approx(22.0)


def test_scoring_is_a_function_of_the_rules_not_the_data():
    stats = sample_stats()
    half = score_weekly_stats(stats, half_ppr())
    base = half_ppr()
    full = ScoringRules(
        league_key=base.league_key,
        rules=tuple(
            StatRule(r.name, 1.0 if r.name == "Reception" else r.points_per_unit, r.columns)
            for r in base.rules
        ),
    )
    delta = score_weekly_stats(stats, full)["fantasy_points"] - half["fantasy_points"]
    assert delta.to_list() == pytest.approx((stats["receptions"] * 0.5).to_list())


def test_negative_scoring_applies():
    stats = pl.DataFrame({"passing_interceptions": [3.0]})
    rules = ScoringRules("t", (StatRule("INT", -1.0, ("passing_interceptions",)),))
    assert score_weekly_stats(stats, rules)["fantasy_points"][0] == pytest.approx(-3.0)


def test_nulls_count_as_zero_not_null():
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
    assert scored["fantasy_points"][0] == pytest.approx(17.0)  # 8 + 6 + 3


# -- multi-column rules ---------------------------------------------------
# The regression this whole interface change exists to prevent.


def test_a_rule_sums_its_columns_before_applying_the_multiplier():
    """Fumbles Lost is -2 per fumble across THREE nflverse columns."""
    stats = pl.DataFrame(
        {
            "rushing_fumbles_lost": [1.0],
            "receiving_fumbles_lost": [1.0],
            "sack_fumbles_lost": [1.0],
        }
    )
    rules = ScoringRules(
        "t",
        (
            StatRule(
                "Fumbles Lost",
                -2.0,
                ("rushing_fumbles_lost", "receiving_fumbles_lost", "sack_fumbles_lost"),
            ),
        ),
    )
    # 3 fumbles x -2 = -6. A single-column mapping would give -2 and look fine.
    assert score_weekly_stats(stats, rules)["fantasy_points"][0] == pytest.approx(-6.0)


def test_single_column_rule_is_just_the_one_element_case():
    stats = pl.DataFrame({"receptions": [7.0]})
    rules = ScoringRules("t", (StatRule("Rec", 1.0, ("receptions",)),))
    assert score_weekly_stats(stats, rules)["fantasy_points"][0] == pytest.approx(7.0)


def test_partial_nulls_across_summed_columns():
    """A WR has null sack fumbles; that must not null out the whole rule."""
    stats = pl.DataFrame(
        {
            "rushing_fumbles_lost": [None],
            "receiving_fumbles_lost": [2.0],
            "sack_fumbles_lost": [None],
        }
    )
    rules = ScoringRules(
        "t",
        (
            StatRule(
                "Fumbles Lost",
                -2.0,
                ("rushing_fumbles_lost", "receiving_fumbles_lost", "sack_fumbles_lost"),
            ),
        ),
    )
    assert score_weekly_stats(stats, rules)["fantasy_points"][0] == pytest.approx(-4.0)


def test_fg_50_plus_spans_two_nflverse_buckets():
    """League has one 50+ bucket; nflverse splits at 60."""
    stats = pl.DataFrame({"fg_made_50_59": [2.0], "fg_made_60_": [1.0]})
    rules = ScoringRules("t", (StatRule("FG 50+", 5.0, ("fg_made_50_59", "fg_made_60_")),))
    assert score_weekly_stats(stats, rules)["fantasy_points"][0] == pytest.approx(15.0)


def test_required_columns_is_deduplicated_and_complete():
    cols = LEAGUE_SCORING.required_columns()
    assert len(cols) == len(set(cols))
    for expected in (
        "passing_yards",
        "receptions",
        "rushing_fumbles_lost",
        "sack_fumbles_lost",
        "fg_made_60_",
        "pat_made",
    ):
        assert expected in cols


# -- the league's real ruleset -------------------------------------------


def test_league_scoring_is_full_ppr():
    rec = next(r for r in LEAGUE_SCORING.rules if r.name == "Receptions")
    assert rec.points_per_unit == 1.0


def test_league_scoring_known_stat_line():
    """A hand-computed full-PPR line against the real league rules."""
    stats = pl.DataFrame(
        {
            "receptions": [8.0],
            "receiving_yards": [112.0],
            "receiving_tds": [1.0],
            "rushing_yards": [15.0],
            "rushing_fumbles_lost": [1.0],
        }
    )
    scored = score_weekly_stats(stats, LEAGUE_SCORING)
    # 8*1 + 112*.1 + 6 + 15*.1 - 2 = 8 + 11.2 + 6 + 1.5 - 2 = 24.7
    assert scored["fantasy_points"][0] == pytest.approx(24.7)


def test_missing_column_is_lenient_by_default_and_strict_on_request():
    stats = sample_stats().drop("receptions")
    assert "fantasy_points" in score_weekly_stats(stats, half_ppr()).columns
    with pytest.raises(ValueError, match="missing columns"):
        score_weekly_stats(stats, half_ppr(), strict=True)


def test_rules_with_no_mappable_stats_is_an_error_not_a_zero_column():
    unmappable = ScoringRules("t", (StatRule("Mystery", 1.0, ()),))
    with pytest.raises(ValueError, match="no mappable stat rules"):
        score_weekly_stats(sample_stats(), unmappable)


def test_unmapped_rules_are_reported_not_silently_dropped():
    assert "UNMAPPED" in LEAGUE_SCORING.describe()
    assert "Offensive Fumble Return TD" in LEAGUE_SCORING.describe()


def test_season_totals_aggregates_and_reports_volatility():
    scored = score_weekly_stats(sample_stats(), half_ppr())
    qb = season_totals(scored).filter(pl.col("player_id") == "00-0000001")
    assert qb["weeks"][0] == 2
    assert qb["total_points"][0] == pytest.approx(38.0)
    assert qb["std_points"][0] > 0
