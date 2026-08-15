"""A thin, read-only Yahoo Fantasy Sports client.

Design constraints, all from verified behaviour (docs/data-sources.md):

* **Read-only by construction.** Only GET is ever issued. There is no method
  here that changes league state, and ``_get`` is the single egress point.
* **Throttling returns HTML, not JSON.** Yahoo's rate limits are undocumented;
  when it throttles, the response body is an HTML error page that crashes a
  naive ``.json()`` call. Every response is sniffed before parsing and raises
  :class:`YahooThrottledError` instead of a ``JSONDecodeError``.
* **The players endpoint paginates at 25/page.** Callers must never assume a
  single request returned the whole collection; :meth:`iter_players` walks the
  ``start`` cursor until a short page comes back.
* **JSON is an awkward transform of XML** — numeric-string keys and mixed
  array/object shapes. This module deliberately returns raw payloads and stays
  about transport; shape-normalisation lives with the consumer that needs it
  (see ``_iter_stats`` in :mod:`ff.scoring.rules`).

Every method here is a stub in this scaffold: the shapes and the failure
handling are real, the parsing is deliberately deferred until we have a live
league payload to write tests against.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Any

from ff.config import Settings, load_settings
from ff.yahoo.auth import YahooAuth

BASE_URL = "https://fantasysports.yahooapis.com/fantasy/v2"

#: Yahoo returns at most this many players per request on the players endpoint.
PLAYERS_PAGE_SIZE = 25


class YahooThrottledError(RuntimeError):
    """Yahoo returned a non-JSON (HTML) body — almost always throttling.

    Yahoo publishes no rate limits and only says it "may temporarily throttle or
    limit access". Treat this as back-off-and-retry-later, not a bug.
    """


class YahooAPIError(RuntimeError):
    """A non-2xx response from Yahoo that is not throttling."""


def _looks_like_html(body: str) -> bool:
    head = body.lstrip()[:200].lower()
    return head.startswith(("<!doctype", "<html", "<?xml-stylesheet")) or "<html" in head


class YahooClient:
    """Read-only access to one Yahoo fantasy league.

    Parameters
    ----------
    auth:
        An authenticated :class:`~ff.yahoo.auth.YahooAuth`. Constructed lazily so
        that importing this module never requires credentials.
    """

    def __init__(
        self,
        auth: YahooAuth | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or load_settings()
        self.auth = auth or YahooAuth(self.settings)

    # -- transport --------------------------------------------------------
    def _get(self, path: str, *, retries: int = 2, backoff: float = 2.0) -> dict[str, Any]:
        """GET ``{BASE_URL}/{path}`` as JSON. The only egress point in this class.

        Raises
        ------
        YahooThrottledError
            If the body is HTML rather than JSON, after exhausting ``retries``.
        YahooAPIError
            On a non-2xx response that is not throttling.
        """
        session = self.auth.session()
        sep = "&" if "?" in path else "?"
        url = f"{BASE_URL}/{path.lstrip('/')}{sep}format=json"

        last_error: Exception | None = None
        for attempt in range(retries + 1):
            response = session.session.get(url, timeout=self.settings.http_timeout_seconds)
            body = response.text

            if _looks_like_html(body):
                last_error = YahooThrottledError(
                    f"Yahoo returned HTML instead of JSON for {path!r} "
                    f"(HTTP {response.status_code}) — likely throttled."
                )
                if attempt < retries:
                    time.sleep(backoff * (2**attempt))
                    continue
                raise last_error

            if response.status_code >= 400:
                raise YahooAPIError(f"HTTP {response.status_code} for {path!r}: {body[:300]}")

            try:
                return response.json()
            except ValueError as exc:  # non-HTML but still unparseable
                raise YahooThrottledError(f"Unparseable body for {path!r}: {body[:200]!r}") from exc

        raise last_error or YahooAPIError(f"Request failed: {path!r}")

    # -- league reads -----------------------------------------------------
    # Each maps to one endpoint from docs/data-sources.md. Parsing is deferred;
    # these return the raw payload so callers can be written against real data.

    def game_key(self, code: str = "nfl") -> str:
        """Resolve the current NFL game key (e.g. "461").

        Always resolve at runtime — the numeric key changes each season and the
        2026 value is unverified.
        """
        raise NotImplementedError("stub: parse /game/nfl response")

    def league_settings(self, league_key: str) -> dict[str, Any]:
        """``league/{key}/settings`` — scoring rules + roster positions.

        This is the single most important read in the project: it is the input
        to :mod:`ff.scoring`, which turns it into a scoring function.
        """
        return self._get(f"league/{league_key}/settings")

    def standings(self, league_key: str) -> dict[str, Any]:
        """``league/{key}/standings`` — teams, records, season totals."""
        return self._get(f"league/{league_key}/standings")

    def scoreboard(self, league_key: str, week: int) -> dict[str, Any]:
        """``league/{key}/scoreboard;week={n}`` — weekly matchups and results."""
        return self._get(f"league/{league_key}/scoreboard;week={week}")

    def draft_results(self, league_key: str) -> dict[str, Any]:
        """``league/{key}/draftresults`` — pick, round, cost, team, player.

        OPEN QUESTION: whether this populates live mid-draft, and at what
        latency. Unverified. Prototype against a mock draft before relying on it.
        """
        return self._get(f"league/{league_key}/draftresults")

    def transactions(self, league_key: str, types: str = "add,drop,trade") -> dict[str, Any]:
        """``league/{key}/transactions;types={t}`` — the add/drop/trade log."""
        return self._get(f"league/{league_key}/transactions;types={types}")

    def team_roster(self, team_key: str, week: int | None = None) -> dict[str, Any]:
        """``team/{key}/roster;week={n}`` — historical starters vs bench."""
        path = f"team/{team_key}/roster"
        if week is not None:
            path += f";week={week}"
        return self._get(path)

    # -- paginated reads --------------------------------------------------
    def iter_players(
        self,
        league_key: str,
        status: str | None = None,
        page_size: int = PLAYERS_PAGE_SIZE,
        max_pages: int = 200,
    ) -> Iterator[dict[str, Any]]:
        """Walk ``league/{key}/players`` a page at a time.

        Yahoo caps this endpoint at 25 results per request regardless of what
        ``count`` asks for, so the only correct way to read the player universe
        is to advance ``start`` until a short page comes back.

        Parameters
        ----------
        status:
            ``A`` (available), ``FA`` (free agent), ``W`` (waivers),
            ``T`` (taken), ``K`` (keepers). ``None`` reads all players.
        max_pages:
            Hard stop so a parsing bug cannot become an unbounded request loop
            against an API with undocumented rate limits.

        Yields
        ------
        dict
            One raw page payload per iteration.
        """
        start = 0
        for _ in range(max_pages):
            path = f"league/{league_key}/players;start={start};count={page_size}"
            if status:
                path += f";status={status}"
            page = self._get(path)
            yield page

            if self._page_count(page) < page_size:
                return
            start += page_size

    @staticmethod
    def _page_count(page: dict[str, Any]) -> int:
        """How many players a raw page actually contained.

        Stub: Yahoo's JSON nests this under numeric-string keys with a sibling
        ``count`` field. Implement against a real payload.
        """
        raise NotImplementedError("stub: count players in a raw Yahoo page")

    def player_stats(
        self,
        league_key: str,
        player_keys: list[str],
        week: int | None = None,
    ) -> dict[str, Any]:
        """``league/{key}/players;player_keys=...;/stats`` — points in league context.

        Fantasy *points* only appear when queried inside a league context.
        Outside it, Yahoo returns raw ``stat_id``/``value`` pairs.

        Note this endpoint is also capped at 25 player keys per request.
        """
        if len(player_keys) > PLAYERS_PAGE_SIZE:
            raise ValueError(
                f"Yahoo accepts at most {PLAYERS_PAGE_SIZE} player_keys per request; "
                f"got {len(player_keys)}. Chunk the call."
            )
        keys = ",".join(player_keys)
        path = f"league/{league_key}/players;player_keys={keys}/stats"
        if week is not None:
            path += f";type=week;week={week}"
        return self._get(path)
