"""SQLite persistence and an aggressive response cache.

Caching policy is a politeness decision, not an optimisation. Yahoo publishes no
rate limits and only warns that it "may temporarily throttle or limit access" —
and when it does throttle, it returns HTML that breaks parsers. With no
documented ceiling to stay under, the safe posture is to never make the same
request twice.

Default TTLs follow how often the upstream data can actually change:

=======================  ========  ==========================================
payload                  TTL       why
=======================  ========  ==========================================
league settings          30 days   scoring rules change ~never mid-season
draft results            1 day     immutable once the draft is done
rosters / players        1 hour    moves happen continuously
scoreboard (live)        5 min     in-game scoring
nflverse weekly stats    12 hours  nightly rebuild + Thursday stat corrections
RotoWire injuries        5 min     5-item window; poll often or miss news
=======================  ========  ==========================================
"""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from ff.config import Settings, load_settings

#: Cache TTLs in seconds, keyed by logical payload kind.
DEFAULT_TTLS: dict[str, int] = {
    "league_settings": 30 * 24 * 3600,
    "draft_results": 24 * 3600,
    "standings": 3600,
    "roster": 3600,
    "players": 3600,
    "transactions": 1800,
    "scoreboard": 300,
    "nflverse_weekly": 12 * 3600,
    "sleeper_players": 24 * 3600,
    "sleeper_projections": 6 * 3600,
    "rotowire_injuries": 300,
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS response_cache (
    key         TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    fetched_at  REAL NOT NULL,
    expires_at  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_response_cache_kind ON response_cache(kind);
CREATE INDEX IF NOT EXISTS idx_response_cache_expires ON response_cache(expires_at);

-- Yahoo -> gsis_id resolutions, including how each was decided. Persisted so
-- fuzzy matching is done once and can be audited and corrected later.
CREATE TABLE IF NOT EXISTS player_identity (
    yahoo_id     TEXT PRIMARY KEY,
    gsis_id      TEXT,
    method       TEXT NOT NULL,
    confidence   REAL NOT NULL,
    matched_name TEXT,
    resolved_at  REAL NOT NULL
);

-- RotoWire's feed is a ~5-item sliding window, so history only exists if we
-- keep it. GUID primary key makes re-inserting the same item a no-op.
CREATE TABLE IF NOT EXISTS injury_news (
    guid        TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    summary     TEXT,
    link        TEXT,
    published   TEXT,
    ingested_at REAL NOT NULL
);
"""


class Store:
    """Thin SQLite wrapper. No ORM, no migrations framework — one schema file."""

    def __init__(self, settings: Settings | None = None, path: Path | None = None) -> None:
        self.settings = settings or load_settings()
        self.path = path or self.settings.db_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _init_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(SCHEMA)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        # WAL keeps a long-running read (an analysis notebook) from blocking a
        # concurrent write (a background poller).
        conn.execute("PRAGMA journal_mode=WAL")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # -- response cache ---------------------------------------------------
    def get_cached(self, key: str) -> Any | None:
        """Return a cached payload, or ``None`` if absent or expired."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT payload, expires_at FROM response_cache WHERE key = ?", (key,)
            ).fetchone()
        if row is None or row["expires_at"] < time.time():
            return None
        return json.loads(row["payload"])

    def put_cached(self, key: str, kind: str, payload: Any, ttl: int | None = None) -> None:
        """Store a payload under ``key``.

        ``ttl`` defaults to :data:`DEFAULT_TTLS` for ``kind``, falling back to
        one hour for an unrecognised kind.
        """
        seconds = ttl if ttl is not None else DEFAULT_TTLS.get(kind, 3600)
        now = time.time()
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO response_cache (key, kind, payload, fetched_at, expires_at) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET "
                "payload=excluded.payload, fetched_at=excluded.fetched_at, "
                "expires_at=excluded.expires_at",
                (key, kind, json.dumps(payload), now, now + seconds),
            )

    def purge_expired(self) -> int:
        """Delete expired rows. Returns how many were removed."""
        with self.connect() as conn:
            cursor = conn.execute("DELETE FROM response_cache WHERE expires_at < ?", (time.time(),))
            return cursor.rowcount

    # -- injury news ------------------------------------------------------
    def record_injury_items(self, items: list[Any]) -> int:
        """Persist feed items, ignoring GUIDs already seen.

        Returns the number of genuinely new items — which is what a poller
        should report, since most polls will return nothing new.
        """
        now = time.time()
        rows = [(i.guid, i.title, i.summary, i.link, i.published, now) for i in items]
        with self.connect() as conn:
            before = conn.total_changes
            conn.executemany(
                "INSERT OR IGNORE INTO injury_news "
                "(guid, title, summary, link, published, ingested_at) VALUES (?, ?, ?, ?, ?, ?)",
                rows,
            )
            return conn.total_changes - before

    # -- identity ---------------------------------------------------------
    def save_identity(self, match: Any) -> None:
        """Persist one :class:`~ff.identity.PlayerMatch`."""
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO player_identity "
                "(yahoo_id, gsis_id, method, confidence, matched_name, resolved_at) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(yahoo_id) DO UPDATE SET "
                "gsis_id=excluded.gsis_id, method=excluded.method, "
                "confidence=excluded.confidence, matched_name=excluded.matched_name, "
                "resolved_at=excluded.resolved_at",
                (
                    match.yahoo_id,
                    match.gsis_id,
                    match.method.value,
                    match.confidence,
                    match.matched_name,
                    time.time(),
                ),
            )

    def get_identity(self, yahoo_id: str) -> sqlite3.Row | None:
        with self.connect() as conn:
            return conn.execute(
                "SELECT * FROM player_identity WHERE yahoo_id = ?", (yahoo_id,)
            ).fetchone()
