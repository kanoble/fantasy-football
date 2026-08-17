"""Tests for the bio columns `player_index` carries alongside a name.

The fold is the interesting part, and it is not the same fold for every column.
A player's *team* should come from his latest roster row; his *birth date*
should come from whichever row actually has one. Getting that backwards is
invisible in aggregate — the table still has 10,000 rows and the right names —
and shows up as a scattering of players mysteriously missing a portrait or a
college.

No network: `player_index` is exercised against hand-built roster frames
through a patched loader, the same way `test_analysis.py` avoids nflverse.
"""

from __future__ import annotations

import polars as pl
import pytest

from ff.analysis import players as players_module
from ff.analysis.players import BIO_COLUMNS, CURRENT_COLUMNS, player_index


def roster(season: int, rows: list[dict]) -> pl.DataFrame:
    """A roster file with every column `player_index` selects."""
    template = {
        "gsis_id": None,
        "full_name": None,
        "position": None,
        "team": None,
        "headshot_url": None,
        "birth_date": None,
        "college": None,
        "jersey_number": None,
        "years_exp": None,
        "draft_number": None,
        "draft_club": None,
        "rookie_year": None,
    }
    return pl.DataFrame([{**template, **row} for row in rows], strict=False)


@pytest.fixture
def fake_rosters(monkeypatch):
    """Patch the nflverse loader with a season -> frame mapping."""

    def install(mapping: dict[int, pl.DataFrame]):
        def load(seasons):
            if seasons not in mapping:
                raise FileNotFoundError(seasons)
            return mapping[seasons]

        monkeypatch.setattr(players_module.nflverse, "load_rosters", load)

    return install


def test_current_columns_take_the_latest_season(fake_rosters):
    """A traded player shows the team he is on now, not the one he left."""
    fake_rosters(
        {
            2024: roster(2024, [{"gsis_id": "1", "full_name": "A Back", "team": "DEN"}]),
            2025: roster(2025, [{"gsis_id": "1", "full_name": "A Back", "team": "ATL"}]),
        }
    )
    index = player_index([2024, 2025])
    assert index.row(0, named=True)["team"] == "ATL"


def test_bio_columns_survive_a_later_row_that_lacks_them(fake_rosters):
    """The fold that matters.

    92 of 3,137 players on the 2025 roster have no `headshot_url`. Taking the
    latest row wholesale would blank a portrait that an earlier season had —
    and it is the *same* portrait, because a face does not change with a trade.
    """
    fake_rosters(
        {
            2024: roster(
                2024,
                [
                    {
                        "gsis_id": "1",
                        "full_name": "A Back",
                        "team": "DEN",
                        "headshot_url": "https://example.test/a.png",
                        "college": "Texas",
                    }
                ],
            ),
            2025: roster(2025, [{"gsis_id": "1", "full_name": "A Back", "team": "ATL"}]),
        }
    )
    row = player_index([2024, 2025]).row(0, named=True)

    assert row["team"] == "ATL", "current job still comes from the newest row"
    assert row["headshot_url"] == "https://example.test/a.png"
    assert row["college"] == "Texas"


def test_a_newer_bio_value_still_wins(fake_rosters):
    """Last *non-null*, not first non-null — a corrected value must land."""
    fake_rosters(
        {
            2024: roster(
                2024,
                [{"gsis_id": "1", "full_name": "A Back", "headshot_url": "old.png"}],
            ),
            2025: roster(
                2025,
                [{"gsis_id": "1", "full_name": "A Back", "headshot_url": "new.png"}],
            ),
        }
    )
    assert player_index([2024, 2025]).row(0, named=True)["headshot_url"] == "new.png"


def test_empty_gsis_id_is_not_a_player(fake_rosters):
    """Rosters carry both nulls and empty strings in `gsis_id`.

    `is_not_null` alone lets the empty string through, and it becomes a row
    keyed on "" — a primary key that is perfectly valid to Postgres and is a
    player page for nobody.
    """
    fake_rosters(
        {
            2025: roster(
                2025,
                [
                    {"gsis_id": "1", "full_name": "A Back"},
                    {"gsis_id": "", "full_name": "Nobody At All"},
                    {"gsis_id": None, "full_name": "Also Nobody"},
                ],
            )
        }
    )
    index = player_index([2025])
    assert index.height == 1
    assert index.row(0, named=True)["gsis_id"] == "1"


def test_a_season_missing_a_bio_column_does_not_lose_the_season(fake_rosters):
    """nflverse has added and renamed roster columns before.

    A file without `draft_club` should cost that one column, not every player
    who appears only in that season.
    """
    thin = pl.DataFrame(
        [{"gsis_id": "2", "full_name": "B Receiver", "position": "WR", "team": "GB"}]
    )
    fake_rosters(
        {
            2024: roster(2024, [{"gsis_id": "1", "full_name": "A Back", "team": "DEN"}]),
            2025: thin,
        }
    )
    index = player_index([2024, 2025])
    assert set(index["gsis_id"]) == {"1", "2"}
    assert "draft_club" in index.columns


def test_every_declared_column_is_returned(fake_rosters):
    """The table's DDL and this select have to agree, or COPY fails at 3am."""
    fake_rosters({2025: roster(2025, [{"gsis_id": "1", "full_name": "A Back", "team": "ATL"}])})
    index = player_index([2025])
    for column in BIO_COLUMNS + CURRENT_COLUMNS:
        assert column in index.columns, column
    assert "norm_name" in index.columns
    assert "season" in index.columns
