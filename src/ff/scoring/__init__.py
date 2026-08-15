"""The heart of the project: league scoring rules as a reusable function.

The central idea. Yahoo will only tell you fantasy *points* for players queried
inside your league context, one paginated request at a time. That is fine for
your roster and hopeless for "every player in the NFL, every week, since 1999".

So we invert it: read the league's scoring settings **once**, compile them into
a pure function over a stat table, and apply that function to nflverse weekly
box scores. Now every player in the league's history can be scored in *your*
league's terms — not just the ones on a roster, and without another Yahoo call.

That single move is what makes consistency analysis, waiver evaluation, and
what-if scenarios possible, which is why this package is kept pure: no network,
no database, no Yahoo client. Settings in, function out; table in, table out.
"""

from ff.scoring.engine import score_weekly_stats
from ff.scoring.rules import ScoringRules, StatRule, parse_league_settings

__all__ = [
    "ScoringRules",
    "StatRule",
    "parse_league_settings",
    "score_weekly_stats",
]
