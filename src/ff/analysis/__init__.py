"""Analysis built on scored data. No auth, no Yahoo.

This layer imports from :mod:`ff.scoring` and :mod:`ff.sources` and **never**
from :mod:`ff.yahoo`. That is what keeps the promise that draft prep works
whether or not the Yahoo API application is ever approved — the guarantee is
structural, not a note in a README.
"""

from ff.analysis.compare import ComparisonResult, compare_players
from ff.analysis.players import PlayerRef, find_player, player_index

__all__ = [
    "ComparisonResult",
    "PlayerRef",
    "compare_players",
    "find_player",
    "player_index",
]
