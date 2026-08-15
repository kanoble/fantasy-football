"""Player identity: mapping Yahoo player IDs to nflverse ``gsis_id``.

This is the main engineering tax of the whole project, and it is not a
dictionary lookup.

Verified 2026-08-15 against the DynastyProcess crosswalk (12,472 rows):

===================  ==========================
draft class          rows with a ``yahoo_id``
===================  ==========================
2024                 115 / 356
2025                 **0 / 376**
2026                 **0 / 285**
===================  ==========================

Sleeper / ESPN / gsis IDs are 95%+ complete for those same players. So the
crosswalk is a fast path that silently fails for exactly the players a fantasy
tool cares most about — this year's and last year's rookies.

Hence the two-tier design in :mod:`ff.identity.crosswalk`: try the table, then
fall back to fuzzy matching on normalised name + position + team. The fallback
is the load-bearing path for recent classes, not an edge case.
"""

from ff.identity.crosswalk import (
    IdentityResolver,
    MatchMethod,
    PlayerMatch,
    normalize_name,
)

__all__ = [
    "IdentityResolver",
    "MatchMethod",
    "PlayerMatch",
    "normalize_name",
]
