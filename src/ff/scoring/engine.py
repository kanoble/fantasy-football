"""Apply a league's scoring rules to a weekly stats table.

Pure and fully implemented: no network, no database, no Yahoo. Give it a
:class:`~ff.scoring.rules.ScoringRules` and any Polars frame with the right
columns and it returns that frame plus a ``fantasy_points`` column.

Because this is just a function over a table, it works equally well on this
week's stats and on twenty years of them — which is the whole point.
"""

from __future__ import annotations

import polars as pl

from ff.scoring.rules import ScoringRules

FANTASY_POINTS_COLUMN = "fantasy_points"


def scoring_expression(rules: ScoringRules) -> pl.Expr:
    """Build the Polars expression that computes fantasy points.

    Exposed separately so it can be reused inside a larger ``select`` /
    ``group_by`` without materialising an intermediate frame. Every column the
    expression references must exist in the frame it is evaluated against;
    :func:`score_weekly_stats` guarantees that.
    """
    if not rules.mappable:
        raise ValueError(
            "ScoringRules contains no mappable stat rules — nothing to compute. "
            "Check the stat_id -> nflverse column mapping."
        )

    terms: list[pl.Expr] = []
    for rule in rules.mappable:
        # Sum the rule's columns first, then apply the multiplier once. This is
        # what makes "Fumbles Lost" a single -2 rule over three nflverse
        # columns instead of three rules that each look complete on their own.
        #
        # Null means "did not record this stat", which is zero points, not an
        # unknown — a WR with no passing_yards scores 0 for passing, not null.
        parts = [pl.col(c).cast(pl.Float64).fill_null(0.0) for c in rule.columns]
        combined = parts[0] if len(parts) == 1 else pl.sum_horizontal(parts)
        terms.append(combined * rule.points_per_unit)

    total = terms[0]
    for term in terms[1:]:
        total = total + term
    return total.alias(FANTASY_POINTS_COLUMN)


def score_weekly_stats(
    stats: pl.DataFrame,
    rules: ScoringRules,
    strict: bool = False,
) -> pl.DataFrame:
    """Return ``stats`` with a ``fantasy_points`` column appended.

    Parameters
    ----------
    stats:
        A weekly stats frame, typically from
        :func:`ff.sources.nflverse.load_weekly_stats`. One row per player-week.
    rules:
        The league's compiled scoring rules.
    strict:
        If ``True``, raise on any rule whose column is missing from ``stats``.
        Default is lenient: missing columns score zero, which is what you want
        when scoring a partial or historical frame.

    Raises
    ------
    ValueError
        If ``strict`` and a required column is missing, or if ``rules`` has no
        mappable entries.
    """
    missing = sorted(c for c in rules.required_columns() if c not in stats.columns)
    if missing:
        if strict:
            raise ValueError(
                f"Stats frame is missing columns required by the scoring rules: {missing}"
            )
        # Lenient: add the absent columns as zeros so the expression is valid.
        stats = stats.with_columns([pl.lit(0.0).alias(c) for c in missing])

    return stats.with_columns(scoring_expression(rules))


def season_totals(
    scored: pl.DataFrame,
    group_by: tuple[str, ...] = ("player_id", "season"),
) -> pl.DataFrame:
    """Aggregate a scored weekly frame to totals, means, and volatility.

    ``std`` is the seed of the consistency analysis this project is aimed at:
    two players with the same total are not the same asset if one of them got
    there through three spike weeks.
    """
    keys = [k for k in group_by if k in scored.columns]
    if not keys:
        raise ValueError(f"None of {group_by} are columns of the scored frame.")
    return (
        scored.group_by(keys)
        .agg(
            pl.len().alias("weeks"),
            pl.col(FANTASY_POINTS_COLUMN).sum().alias("total_points"),
            pl.col(FANTASY_POINTS_COLUMN).mean().alias("mean_points"),
            pl.col(FANTASY_POINTS_COLUMN).std().alias("std_points"),
        )
        .sort("total_points", descending=True)
    )
