"""Sleeper API — projections, ADP, trending adds. Free, no auth.

Two hosts, deliberately distinguished:

* ``api.sleeper.app/v1`` — documented and stable. State, players, trending.
* ``api.sleeper.com`` — undocumented but live. Weekly stats, weekly projections,
  and season projections with ADP in seven scoring formats. **No stability
  guarantee**: these can change without notice, so everything that touches them
  is isolated in :func:`season_projections` / :func:`weekly_projections` and
  should be treated as best-effort.

Rate limit is roughly 1000 calls/min. Non-commercial use only.
"""

from __future__ import annotations

from typing import Any

import httpx

DOCUMENTED_BASE = "https://api.sleeper.app/v1"
UNDOCUMENTED_BASE = "https://api.sleeper.com"

DEFAULT_TIMEOUT = 20.0


def _get(url: str, params: dict[str, Any] | None = None, timeout: float = DEFAULT_TIMEOUT) -> Any:
    response = httpx.get(url, params=params, timeout=timeout, follow_redirects=True)
    response.raise_for_status()
    return response.json()


# -- documented endpoints -------------------------------------------------


def nfl_state(timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
    """Current NFL season state: week, season, season_type, leg.

    This is the canonical "what week is it" source for the whole project.
    """
    return _get(f"{DOCUMENTED_BASE}/state/nfl", timeout=timeout)


def trending_players(
    kind: str = "add",
    lookback_hours: int = 24,
    limit: int = 25,
    timeout: float = DEFAULT_TIMEOUT,
) -> list[dict[str, Any]]:
    """Most-added or most-dropped players across all Sleeper leagues.

    Returns a list of ``{"player_id": str, "count": int}``. Player IDs are
    Sleeper IDs — join through :mod:`ff.identity` to get anywhere else.

    Parameters
    ----------
    kind:
        ``"add"`` or ``"drop"``.
    """
    if kind not in {"add", "drop"}:
        raise ValueError(f"kind must be 'add' or 'drop', got {kind!r}")
    return _get(
        f"{DOCUMENTED_BASE}/players/nfl/trending/{kind}",
        params={"lookback_hours": lookback_hours, "limit": limit},
        timeout=timeout,
    )


def all_players(timeout: float = 60.0) -> dict[str, dict[str, Any]]:
    """The full Sleeper player universe, keyed by Sleeper player_id.

    This is a ~5MB response. Sleeper asks that it be fetched at most once per
    day — cache it via :mod:`ff.store` rather than calling this repeatedly.
    """
    return _get(f"{DOCUMENTED_BASE}/players/nfl", timeout=timeout)


# -- undocumented endpoints (no stability guarantee) ----------------------


def season_projections(
    season: int,
    position: str,
    order_by: str = "adp_dd_ppr",
    season_type: str = "regular",
    timeout: float = DEFAULT_TIMEOUT,
) -> list[dict[str, Any]]:
    """Season-long projections plus ADP for one position.

    UNDOCUMENTED endpoint. ``order_by`` is required in practice — omitting it
    returns placeholder rows. ADP is available in several formats, e.g.
    ``adp_dd_ppr``, ``adp_dd_half_ppr``, ``adp_dd_std``, ``adp_dd_2qb``.
    """
    return _get(
        f"{UNDOCUMENTED_BASE}/projections/nfl/{season}",
        params={"season_type": season_type, "position[]": position, "order_by": order_by},
        timeout=timeout,
    )


def weekly_projections(
    player_id: str,
    season: int,
    season_type: str = "regular",
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Week-by-week projections for one player (RotoWire-sourced).

    UNDOCUMENTED endpoint.
    """
    return _get(
        f"{UNDOCUMENTED_BASE}/projections/nfl/player/{player_id}",
        params={"season_type": season_type, "season": season, "grouping": "week"},
        timeout=timeout,
    )


def weekly_stats(
    player_id: str,
    season: int,
    season_type: str = "regular",
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Week-by-week actual stats for one player (63 fields/week).

    UNDOCUMENTED endpoint. Prefer nflverse for historical stats — this is a
    convenience path when a Sleeper ID is what you already have in hand.
    """
    return _get(
        f"{UNDOCUMENTED_BASE}/stats/nfl/player/{player_id}",
        params={"season_type": season_type, "season": season, "grouping": "week"},
        timeout=timeout,
    )
