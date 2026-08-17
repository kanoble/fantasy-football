"""Fantasy Football Calculator — historical ADP. Free, no auth.

The one thing this project could not otherwise answer. Sleeper serves the ADP
for the season being drafted and nothing else, and ``adp_projections`` is
TRUNCATEd on every refresh, so the database has only ever held one season of
prices. "What did a player drafted here actually return" needs a decade of
them.

FFC publishes exactly that: one JSON document per season, per scoring format,
per league size, aggregated from real mock and live drafts run on their site in
the fortnight before the season. Coverage verified 2026-08-16 for PPR/12-team:

    2012 —  93 players from    303 drafts
    2016 — 188 players from    956 drafts
    2020 — 203 players from  2,403 drafts
    2023 — 202 players from  3,146 drafts
    2025 — 249 players from  8,470 drafts

2008-2011 return nothing for this format — PPR was not yet the default — so
:data:`EARLIEST_SEASON` starts at 2012. The sample thins going back, which is
worth knowing before reading a 2012 ADP as confidently as a 2025 one; hence
``times_drafted`` and ``stdev`` are carried through rather than dropped.

**A different instrument from Sleeper.** FFC aggregates its own drafters;
Sleeper aggregates its own. The two are not one series and are never stored as
one — see the ``source`` column in ``adp_history``.

Roughly 200 players per season and one request per season, so a full historical
ingest is ~15 requests. This is a one-time backfill run by hand
(``scripts/ingest_adp_history.py``), not part of the daily cron.
"""

from __future__ import annotations

from typing import Any

import httpx

BASE = "https://fantasyfootballcalculator.com/api/v1"

DEFAULT_TIMEOUT = 30.0

#: The league this app is for: 12 teams, full PPR (`Receptions: 1.0` in
#: ff.scoring.rules). Asking for any other shape would return a real number
#: about somebody else's league.
DEFAULT_TEAMS = 12
DEFAULT_FORMAT = "ppr"

#: First season with usable PPR/12-team coverage. See the module docstring.
EARLIEST_SEASON = 2012


def _get(path: str, params: dict[str, Any], timeout: float = DEFAULT_TIMEOUT) -> Any:
    response = httpx.get(f"{BASE}/{path}", params=params, timeout=timeout, follow_redirects=True)
    response.raise_for_status()
    return response.json()


def fetch_adp(
    season: int,
    scoring: str = DEFAULT_FORMAT,
    teams: int = DEFAULT_TEAMS,
    timeout: float = DEFAULT_TIMEOUT,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """One season of ADP, as ``(players, meta)``.

    ``meta`` carries ``total_drafts`` and the date window the drafts ran in,
    which is the only evidence available for how much a given season's number
    is worth. Returned alongside the rows rather than discarded so the caller
    can record it.

    A season FFC has no data for returns ``([], meta)`` rather than raising:
    asking for 2009 is a reasonable question with an empty answer, and the
    ingest should skip it and carry on rather than abort a fifteen-season run.
    """
    payload = _get(
        f"adp/{scoring}",
        {"teams": teams, "year": season, "position": "all"},
        timeout=timeout,
    )

    if payload.get("status") != "Success":
        return [], {}

    return payload.get("players") or [], payload.get("meta") or {}
