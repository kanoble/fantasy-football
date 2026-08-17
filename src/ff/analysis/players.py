"""Resolve a typed player name to an nflverse ``gsis_id``.

This is the identity problem minus its hard half. :mod:`ff.identity` exists
because Yahoo IDs are missing from public crosswalks for recent rookie classes;
here there is no Yahoo side at all, so a normalised-name match against nflverse
rosters is enough.

Rosters rather than stats are the search universe on purpose: rookies who have
never played appear on a roster but have no stat rows, and "who should I draft"
is a question people ask about rookies constantly.
"""

from __future__ import annotations

import difflib
from dataclasses import dataclass

import polars as pl

from ff.identity import normalize_name
from ff.sources import nflverse


@dataclass(frozen=True)
class PlayerRef:
    """A resolved player."""

    gsis_id: str
    name: str
    position: str | None
    team: str | None
    season: int | None = None

    def __str__(self) -> str:
        bits = [self.name]
        if self.position or self.team:
            bits.append(f"({self.position or '?'}, {self.team or 'FA'})")
        return " ".join(bits)


class PlayerNotFoundError(LookupError):
    """No player matched. Carries near-misses so the CLI can suggest them."""

    def __init__(self, query: str, suggestions: list[str] | None = None) -> None:
        self.query = query
        self.suggestions = suggestions or []
        message = f"No player matching {query!r}."
        if self.suggestions:
            message += " Did you mean: " + ", ".join(self.suggestions) + "?"
        super().__init__(message)


class AmbiguousPlayerError(LookupError):
    """Several players matched. Never guess — a wrong pick corrupts the answer."""

    def __init__(self, query: str, matches: list[PlayerRef]) -> None:
        self.query = query
        self.matches = matches
        listed = "; ".join(str(m) for m in matches)
        super().__init__(f"{query!r} is ambiguous — matches: {listed}")


#: Roster columns that describe the *player* rather than his current job.
#:
#: These do not change when he is traded, and several of them are missing from
#: any single season's file — ``headshot_url`` is null for 92 of 3,137 rows in
#: 2025 alone. So they are folded with "last non-null wins" rather than "latest
#: season wins": a player whose newest roster row happens to lack a portrait
#: keeps the one an earlier season had, which is the same portrait.
BIO_COLUMNS = (
    "headshot_url",
    "birth_date",
    "college",
    "draft_number",
    "draft_club",
    "rookie_year",
)

#: Roster columns that describe his *current* job, where a later season is not
#: merely a fallback but the actual answer.
CURRENT_COLUMNS = ("name", "position", "team", "jersey_number", "years_exp")


def player_index(seasons: list[int]) -> pl.DataFrame:
    """Build the searchable player universe for ``seasons``.

    Returns one row per player with ``gsis_id``, ``name``, ``norm_name``,
    ``position``, ``team``, the latest ``season`` they appear in, and the bio
    columns in :data:`BIO_COLUMNS`. Later seasons win for the columns that
    describe a current job; see :data:`BIO_COLUMNS` for why the rest differ.
    """
    frames: list[pl.DataFrame] = []
    for season in sorted(seasons):
        try:
            roster = nflverse.load_rosters(seasons=season)
        except Exception:  # noqa: BLE001 — a future season simply has no file yet
            continue
        cols = {"gsis_id", "full_name", "position", "team"}
        if not cols.issubset(set(roster.columns)):
            continue
        available = set(roster.columns)
        frames.append(
            roster.select(
                pl.col("gsis_id"),
                pl.col("full_name").alias("name"),
                pl.col("position"),
                pl.col("team"),
                pl.lit(season).alias("season"),
                # Selected by name rather than assumed present: nflverse has
                # added and renamed roster columns before, and a season file
                # missing one should cost that column, not the whole season.
                *(
                    pl.col(column) if column in available else pl.lit(None).alias(column)
                    for column in BIO_COLUMNS + CURRENT_COLUMNS
                    if column not in {"name", "position", "team"}
                ),
            ).filter(
                # An empty gsis_id is not a null one. Rosters carry a handful of
                # each, and `is_not_null` alone lets the empty string through to
                # become a row keyed on "" — a player page for nobody.
                pl.col("gsis_id").is_not_null() & (pl.col("gsis_id") != "")
            )
        )

    if not frames:
        raise RuntimeError(f"No nflverse roster data available for seasons {seasons}.")

    combined = pl.concat(frames, how="vertical_relaxed")
    return (
        combined.sort("season")
        .group_by("gsis_id")
        .agg(
            pl.col("season").last(),
            *(pl.col(column).last() for column in CURRENT_COLUMNS),
            *(pl.col(column).drop_nulls().last() for column in BIO_COLUMNS),
        )
        .with_columns(
            pl.col("name").map_elements(normalize_name, return_dtype=pl.Utf8).alias("norm_name")
        )
    )


def find_player(
    query: str,
    index: pl.DataFrame,
    position: str | None = None,
) -> PlayerRef:
    """Resolve one name to a :class:`PlayerRef`.

    Exact normalised match first, then a prefix/substring match. Ambiguity
    raises rather than guessing: silently picking the wrong Josh Allen would
    make every number downstream wrong in a way nobody would notice.

    Parameters
    ----------
    position:
        Optional disambiguator, e.g. ``"QB"``.
    """
    target = normalize_name(query)
    pool = index
    if position:
        pool = pool.filter(pl.col("position") == position.upper())

    def to_refs(frame: pl.DataFrame) -> list[PlayerRef]:
        return [
            PlayerRef(
                gsis_id=r["gsis_id"],
                name=r["name"],
                position=r["position"],
                team=r["team"],
                season=r["season"],
            )
            for r in frame.iter_rows(named=True)
        ]

    exact = pool.filter(pl.col("norm_name") == target)
    if exact.height == 1:
        return to_refs(exact)[0]
    if exact.height > 1:
        raise AmbiguousPlayerError(query, to_refs(exact))

    partial = pool.filter(pl.col("norm_name").str.contains(target, literal=True))
    if partial.height == 1:
        return to_refs(partial)[0]
    if partial.height > 1:
        raise AmbiguousPlayerError(query, to_refs(partial.head(8)))

    # Nothing matched. Fall back to fuzzy suggestions — typos are the common
    # case here ("Jamar Chse"), and a substring search finds nothing for those.
    names = pool["norm_name"].to_list()
    close = difflib.get_close_matches(target, names, n=5, cutoff=0.6)
    suggested = pool.filter(pl.col("norm_name").is_in(close)) if close else pool.head(0)
    raise PlayerNotFoundError(query, [str(r) for r in to_refs(suggested)])
