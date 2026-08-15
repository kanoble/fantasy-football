"""Tests for name normalisation — the highest-leverage part of the fuzzy path.

The fuzzy matcher itself is still a stub, but ``normalize_name`` is pure and
implemented, and it is what decides whether the fallback can work at all for the
2025/2026 rookie classes that have no Yahoo ID in any public crosswalk.
"""

from __future__ import annotations

import pytest

from ff.identity import MatchMethod, PlayerMatch, normalize_name


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Marvin Harrison Jr.", "marvin harrison"),
        ("Marvin Harrison", "marvin harrison"),
        ("Ja'Marr Chase", "jamarr chase"),
        ("JaMarr Chase", "jamarr chase"),
        ("T.J. Hockenson", "tj hockenson"),
        ("TJ Hockenson", "tj hockenson"),
        ("D'Andre Swift", "dandre swift"),
        ("Odell Beckham Jr", "odell beckham"),
        ("Michael Pittman Jr.", "michael pittman"),
        ("  Amon-Ra   St. Brown  ", "amon ra st brown"),
        ("Robert Griffin III", "robert griffin"),
    ],
)
def test_normalize_name_collapses_source_differences(raw, expected):
    assert normalize_name(raw) == expected


def test_suffix_and_punctuation_variants_agree():
    """The same player written two ways must normalise identically."""
    pairs = [
        ("Marvin Harrison Jr.", "Marvin Harrison"),
        ("Ja'Marr Chase", "JaMarr Chase"),
        ("T.J. Hockenson", "TJ Hockenson"),
    ]
    for a, b in pairs:
        assert normalize_name(a) == normalize_name(b), f"{a!r} != {b!r}"


def test_distinct_players_do_not_collide():
    assert normalize_name("Josh Allen") != normalize_name("Keenan Allen")
    assert normalize_name("Michael Thomas") != normalize_name("Michael Pittman")


def test_accents_are_stripped():
    assert normalize_name("José Ramírez") == "jose ramirez"


def test_unresolved_match_is_a_value_not_an_exception():
    """A failed match must be representable, so gaps can be counted."""
    match = PlayerMatch(
        yahoo_id="12345", gsis_id=None, method=MatchMethod.UNRESOLVED, confidence=0.0
    )
    assert not match.resolved
    assert not match.needs_review


def test_fuzzy_matches_are_flagged_for_review():
    match = PlayerMatch(
        yahoo_id="12345",
        gsis_id="00-0039000",
        method=MatchMethod.FUZZY_NAME,
        confidence=0.91,
        matched_name="marvin harrison",
    )
    assert match.resolved
    assert match.needs_review  # usable, but auditable
