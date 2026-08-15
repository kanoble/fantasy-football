"""Parse a Yahoo ``league/{key}/settings`` payload into scoring rules.

Pure: no network, no I/O. Input is the decoded JSON payload; output is a
:class:`ScoringRules` value object that :mod:`ff.scoring.engine` can apply.

Two Yahoo shapes matter:

``stat_categories.stats[]``
    Which stats the league scores, with ``stat_id``, ``name``, ``display_name``.
``stat_modifiers.stats[]``
    The points-per-unit ``value`` for each ``stat_id``.

A rule is the join of the two on ``stat_id``. Yahoo's JSON is a mechanical
transform of XML, so expect numeric-string keys and single-item collections that
collapse from list to dict — :func:`_iter_stats` absorbs that.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

#: Yahoo ``stat_id`` -> nflverse weekly-stats column.
#:
#: UNVERIFIED against a live league payload. These IDs are widely used and
#: stable in practice, but docs/data-sources.md did not verify them, so treat
#: this as a starting point. :func:`parse_league_settings` reports any stat_id
#: it cannot map rather than silently scoring it as zero — that report is how
#: you find the gaps for your specific league.
YAHOO_STAT_ID_TO_NFLVERSE: dict[int, str] = {
    4: "passing_yards",
    5: "passing_tds",
    6: "passing_interceptions",
    8: "rushing_yards",
    9: "rushing_tds",
    11: "receiving_yards",
    12: "receiving_tds",
    13: "receptions",
    15: "special_teams_tds",
    16: "fumbles_lost",
    18: "passing_2pt_conversions",
    57: "targets",
}


@dataclass(frozen=True)
class StatRule:
    """One scoring line: this many points per unit of this stat."""

    stat_id: int
    name: str
    points_per_unit: float
    #: nflverse column this maps to, or ``None`` if unmapped.
    column: str | None = None

    @property
    def is_mappable(self) -> bool:
        return self.column is not None


@dataclass(frozen=True)
class ScoringRules:
    """A league's scoring system, ready to apply to a stat table."""

    league_key: str | None
    rules: tuple[StatRule, ...]
    #: Stat IDs the league scores that we could not map to an nflverse column.
    #: Non-empty is normal (kicking, IDP, return yardage) — it just means those
    #: categories will not contribute to a computed score. Surface, don't hide.
    unmapped: tuple[StatRule, ...] = field(default_factory=tuple)

    @property
    def mappable(self) -> tuple[StatRule, ...]:
        return tuple(r for r in self.rules if r.is_mappable)

    def describe(self) -> str:
        lines = [f"Scoring rules for {self.league_key or 'unknown league'}:"]
        for r in sorted(self.mappable, key=lambda r: r.stat_id):
            lines.append(f"  {r.name:<28} {r.points_per_unit:+g} per {r.column}")
        if self.unmapped:
            names = ", ".join(f"{r.name}({r.stat_id})" for r in self.unmapped)
            lines.append(f"  UNMAPPED (will not be scored): {names}")
        return "\n".join(lines)


def _iter_stats(node: Any) -> list[dict[str, Any]]:
    """Yield ``stat`` dicts from a Yahoo collection, tolerating its JSON shapes.

    Yahoo emits collections as either a list of ``{"stat": {...}}`` wrappers or
    an object with numeric-string keys plus a ``count`` sibling. Single-item
    collections sometimes collapse to a bare dict.
    """
    if node is None:
        return []
    if isinstance(node, dict):
        if "stat" in node:
            return _iter_stats([node])
        items = [v for k, v in node.items() if k.isdigit()]
        return _iter_stats(items)
    if isinstance(node, list):
        out: list[dict[str, Any]] = []
        for item in node:
            if isinstance(item, dict):
                out.append(item.get("stat", item))
        return out
    return []


def parse_league_settings(
    payload: dict[str, Any],
    stat_map: dict[int, str] | None = None,
) -> ScoringRules:
    """Turn a raw Yahoo settings payload into :class:`ScoringRules`.

    Pure function — hand it a saved JSON fixture in tests, no client needed.

    Parameters
    ----------
    payload:
        Decoded ``league/{key}/settings`` response.
    stat_map:
        Override the ``stat_id`` -> nflverse column mapping.

    Raises
    ------
    NotImplementedError
        Stub. The traversal down to ``stat_categories`` / ``stat_modifiers``
        depends on Yahoo's exact nesting, which we deliberately have not guessed
        — capture one real payload into ``tests/fixtures/`` and implement
        against it. The helpers above and the tests are already shaped for it.
    """
    raise NotImplementedError(
        "stub: implement against a real league/{key}/settings fixture. "
        "Traverse to stat_categories.stats and stat_modifiers.stats, join on "
        "stat_id, and build StatRule entries via _iter_stats()."
    )
