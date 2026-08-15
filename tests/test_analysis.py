"""Tests for player-name resolution.

Uses a hand-built index rather than live nflverse data, so these run offline and
fast. The network paths (`player_index`, `compare_players`) are exercised by
`scripts/smoke_test.py` and by actually running the CLI.
"""

from __future__ import annotations

import polars as pl
import pytest

from ff.analysis.players import (
    AmbiguousPlayerError,
    PlayerNotFoundError,
    find_player,
)
from ff.identity import normalize_name


def index() -> pl.DataFrame:
    rows = [
        ("00-0000001", "Josh Allen", "QB", "BUF", 2025),
        ("00-0000002", "Keenan Allen", "WR", "LAC", 2025),
        ("00-0000003", "Josh Allen", "LB", "JAX", 2025),  # real-life collision
        ("00-0000004", "Ja'Marr Chase", "WR", "CIN", 2025),
        ("00-0000005", "Marvin Harrison Jr.", "WR", "AZ", 2025),
        ("00-0000006", "Bijan Robinson", "RB", "ATL", 2025),
    ]
    return pl.DataFrame(
        {
            "gsis_id": [r[0] for r in rows],
            "name": [r[1] for r in rows],
            "position": [r[2] for r in rows],
            "team": [r[3] for r in rows],
            "season": [r[4] for r in rows],
            "norm_name": [normalize_name(r[1]) for r in rows],
        }
    )


def test_exact_match():
    assert find_player("Bijan Robinson", index()).gsis_id == "00-0000006"


def test_match_ignores_suffix_and_punctuation():
    """What you type rarely matches the source's spelling exactly."""
    assert find_player("Marvin Harrison", index()).gsis_id == "00-0000005"
    assert find_player("JaMarr Chase", index()).gsis_id == "00-0000004"


def test_duplicate_names_are_ambiguous_not_a_coin_flip():
    """Two real Josh Allens exist. Guessing would silently corrupt the answer."""
    with pytest.raises(AmbiguousPlayerError) as exc:
        find_player("Josh Allen", index())
    assert len(exc.value.matches) == 2


def test_position_disambiguates():
    assert find_player("Josh Allen", index(), position="QB").gsis_id == "00-0000001"
    assert find_player("Josh Allen", index(), position="LB").gsis_id == "00-0000003"


def test_partial_surname_match_when_unique():
    assert find_player("Bijan", index()).gsis_id == "00-0000006"


def test_ambiguous_partial_raises_rather_than_picking_first():
    with pytest.raises(AmbiguousPlayerError):
        find_player("Allen", index())


def test_unknown_name_raises_with_fuzzy_suggestions():
    """A typo must still point somewhere useful — substring search can't."""
    with pytest.raises(PlayerNotFoundError) as exc:
        find_player("Jamar Chse", index())
    assert any("Chase" in s for s in exc.value.suggestions)


def test_completely_unknown_name_raises_cleanly():
    with pytest.raises(PlayerNotFoundError):
        find_player("Zzzzz Qqqqq", index())
