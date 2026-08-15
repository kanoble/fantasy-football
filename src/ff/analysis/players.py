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


def player_index(seasons: list[int]) -> pl.DataFrame:
    """Build the searchable player universe for ``seasons``.

    Returns one row per player with ``gsis_id``, ``name``, ``norm_name``,
    ``position``, ``team``, and the latest ``season`` they appear in. Later
    seasons win, so a traded player shows their most recent team.
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
        frames.append(
            roster.select(
                pl.col("gsis_id"),
                pl.col("full_name").alias("name"),
                pl.col("position"),
                pl.col("team"),
                pl.lit(season).alias("season"),
            ).filter(pl.col("gsis_id").is_not_null())
        )

    if not frames:
        raise RuntimeError(f"No nflverse roster data available for seasons {seasons}.")

    combined = pl.concat(frames, how="vertical_relaxed")
    return (
        combined.sort("season")
        .group_by("gsis_id")
        .last()
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
