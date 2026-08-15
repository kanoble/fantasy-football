"""League scoring rules, and parsing them from a Yahoo settings payload.

Pure: no network, no I/O.

A rule is *not* one stat column
------------------------------
The obvious model — one scoring category maps to one data column — does not
survive contact with this league. Three categories map to a **sum** of nflverse
columns, and one maps a coarse league bucket onto two finer nflverse ones:

* Fumbles Lost   → ``rushing_`` + ``receiving_`` + ``sack_fumbles_lost``
* 2-Pt Conversions → ``passing_`` + ``rushing_`` + ``receiving_2pt_conversions``
* Block Kick     → ``def_punt_blocks`` + ``def_pat_blocks`` + ``def_fg_blocks``
* FG 50+         → ``fg_made_50_59`` + ``fg_made_60_``

So :class:`StatRule` holds ``columns: tuple[str, ...]``, summed before the
multiplier is applied. A single-column rule is just the one-element case. This
matters more than it looks: mapping Fumbles Lost to ``rushing_fumbles_lost``
alone silently drops receiving and sack fumbles — roughly a two-thirds
undercount on a -2 stat, with no error raised anywhere.

See docs/scoring-rules.md for the full transcription and its verification.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

#: Yahoo ``stat_id`` -> nflverse column(s).
#:
#: UNVERIFIED against a live league payload — these are the widely-circulated
#: NFL stat IDs. No longer on the critical path: :data:`LEAGUE_SCORING` is
#: hand-built from the league's settings page, so this map is only needed later
#: to validate a parsed API payload against docs/scoring-rules.md.
YAHOO_STAT_ID_TO_NFLVERSE: dict[int, tuple[str, ...]] = {
    4: ("passing_yards",),
    5: ("passing_tds",),
    6: ("passing_interceptions",),
    8: ("rushing_yards",),
    9: ("rushing_tds",),
    11: ("receiving_yards",),
    12: ("receiving_tds",),
    13: ("receptions",),
    15: ("special_teams_tds",),
    16: (
        "rushing_fumbles_lost",
        "receiving_fumbles_lost",
        "sack_fumbles_lost",
    ),
    18: (
        "passing_2pt_conversions",
        "rushing_2pt_conversions",
        "receiving_2pt_conversions",
    ),
    57: ("targets",),
}


@dataclass(frozen=True)
class StatRule:
    """One scoring line: this many points per unit of this stat.

    ``columns`` is summed before the multiplier is applied, so a category that
    nflverse splits across several columns stays a single rule.
    """

    name: str
    points_per_unit: float
    columns: tuple[str, ...] = ()
    #: Yahoo's numeric stat id. ``None`` for hand-built rules — we know the
    #: league's *values* from its settings page without knowing Yahoo's ids.
    stat_id: int | None = None

    @property
    def is_mappable(self) -> bool:
        return bool(self.columns)


@dataclass(frozen=True)
class ScoringRules:
    """A league's scoring system, ready to apply to a stat table."""

    league_key: str | None
    rules: tuple[StatRule, ...]
    #: Categories the league scores that we cannot map to nflverse columns.
    #: Non-empty is normal and must stay visible — a silently unscored category
    #: is indistinguishable from a category worth zero.
    unmapped: tuple[StatRule, ...] = field(default_factory=tuple)

    @property
    def mappable(self) -> tuple[StatRule, ...]:
        return tuple(r for r in self.rules if r.is_mappable)

    def required_columns(self) -> tuple[str, ...]:
        """Every nflverse column this ruleset reads, de-duplicated."""
        seen: dict[str, None] = {}
        for rule in self.mappable:
            for column in rule.columns:
                seen[column] = None
        return tuple(seen)

    def fingerprint(self) -> str:
        """A stable hash of this ruleset.

        The refresh pipeline stores this alongside the published data. When it
        stops matching, every previously-scored row was computed under different
        rules and is stale — which is what lets an incremental refresh skip
        completed seasons safely instead of hoping nobody edits the scoring.

        Deliberately covers ``unmapped`` too: moving a category from unmapped to
        mapped changes scores, even though the mapped rules alone look identical.
        """
        payload = json.dumps(
            {
                "rules": sorted([r.name, r.points_per_unit, sorted(r.columns)] for r in self.rules),
                "unmapped": sorted(r.name for r in self.unmapped),
            },
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode()).hexdigest()[:16]

    def describe(self) -> str:
        lines = [f"Scoring rules for {self.league_key or 'unknown league'}:"]
        for r in self.mappable:
            source = " + ".join(r.columns)
            lines.append(f"  {r.name:<26} {r.points_per_unit:+g}  x  {source}")
        if self.unmapped:
            names = ", ".join(r.name for r in self.unmapped)
            lines.append(f"  UNMAPPED (not scored): {names}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# The league's actual rules, transcribed from its Yahoo settings page
# 2026-08-15 and verified column-by-column against live nflverse 2025 data.
# See docs/scoring-rules.md.
#
# Offense and kicking only. Team defense is deliberately excluded: it lives in
# a different nflverse table and its Points Allowed definition is unresolved
# until we can compare against official Yahoo scores in-season.
# ---------------------------------------------------------------------------

OFFENSE_RULES: tuple[StatRule, ...] = (
    StatRule("Passing Yards", 0.04, ("passing_yards",)),  # 25 yds / point
    StatRule("Passing TD", 4.0, ("passing_tds",)),
    StatRule("Interceptions", -1.0, ("passing_interceptions",)),
    StatRule("Rushing Yards", 0.1, ("rushing_yards",)),  # 10 yds / point
    StatRule("Rushing TD", 6.0, ("rushing_tds",)),
    StatRule("Receptions", 1.0, ("receptions",)),  # FULL PPR
    StatRule("Receiving Yards", 0.1, ("receiving_yards",)),  # 10 yds / point
    StatRule("Receiving TD", 6.0, ("receiving_tds",)),
    StatRule("Return TD", 6.0, ("special_teams_tds",)),
    StatRule(
        "2-Pt Conversions",
        2.0,
        (
            "passing_2pt_conversions",
            "rushing_2pt_conversions",
            "receiving_2pt_conversions",
        ),
    ),
    StatRule(
        "Fumbles Lost",
        -2.0,
        (
            "rushing_fumbles_lost",
            "receiving_fumbles_lost",
            "sack_fumbles_lost",
        ),
    ),
)

KICKING_RULES: tuple[StatRule, ...] = (
    StatRule("FG 0-19", 3.0, ("fg_made_0_19",)),
    StatRule("FG 20-29", 3.0, ("fg_made_20_29",)),
    StatRule("FG 30-39", 3.0, ("fg_made_30_39",)),
    StatRule("FG 40-49", 4.0, ("fg_made_40_49",)),
    # The league has one 50+ bucket; nflverse splits it at 60.
    StatRule("FG 50+", 5.0, ("fg_made_50_59", "fg_made_60_")),
    StatRule("PAT Made", 1.0, ("pat_made",)),
)

#: Categories the league scores that we knowingly do not compute.
UNMAPPED_RULES: tuple[StatRule, ...] = (
    # Rare enough to be near-noise, and no clean nflverse column exists.
    StatRule("Offensive Fumble Return TD", 6.0, ()),
)

#: The league's scoring, for offensive and kicking players.
LEAGUE_SCORING = ScoringRules(
    league_key="league-2026",
    rules=OFFENSE_RULES + KICKING_RULES,
    unmapped=UNMAPPED_RULES,
)


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
        return _iter_stats([v for k, v in node.items() if k.isdigit()])
    if isinstance(node, list):
        return [item.get("stat", item) for item in node if isinstance(item, dict)]
    return []


def parse_league_settings(
    payload: dict[str, Any],
    stat_map: dict[int, tuple[str, ...]] | None = None,
) -> ScoringRules:
    """Turn a raw Yahoo settings payload into :class:`ScoringRules`.

    Still stubbed — Yahoo's exact nesting has not been observed, and guessing it
    produces confident wrong parsers. Not blocking: :data:`LEAGUE_SCORING` is
    hand-built from the settings page, so this is a *validation* path (does the
    API agree with docs/scoring-rules.md?) rather than a prerequisite.
    """
    raise NotImplementedError(
        "stub: implement against a real league/{key}/settings fixture. "
        "Traverse to stat_categories.stats and stat_modifiers.stats, join on "
        "stat_id via _iter_stats(), then validate against LEAGUE_SCORING."
    )
