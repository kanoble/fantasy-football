"""Settings, read from the environment. No secrets live in this file.

Everything sensitive (Yahoo client id/secret, the OAuth token file path) comes
from the environment or a local ``.env`` that is gitignored. Import-time is
side-effect free apart from loading ``.env``; call :func:`load_settings` to get
a validated snapshot.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Repo root: src/ff/config.py -> src/ff -> src -> repo root
REPO_ROOT = Path(__file__).resolve().parents[2]


def _env_path(name: str, default: Path) -> Path:
    raw = os.getenv(name)
    return Path(raw).expanduser() if raw else default


# The Vercel Supabase integration provisions both POSTGRES_URL (Supavisor
# transaction pooler, :6543) and POSTGRES_URL_NON_POOLING (session mode, :5432).
# The refresh COPYs ~174k rows inside one explicit transaction and psycopg3
# issues prepared statements by default; neither survives a transaction-mode
# pooler, so the non-pooling URL is the correct one here.
#
# SUPABASE_DB_URL is checked first so an explicit override still wins. Falling
# back to the integration-managed variable — rather than copying its value into
# a second env var — means a Supabase credential rotation propagates by itself.
DSN_ENV_VARS = ("SUPABASE_DB_URL", "POSTGRES_URL_NON_POOLING")


def resolve_dsn() -> str | None:
    """First Postgres URL set in :data:`DSN_ENV_VARS`, or None if none are."""
    for name in DSN_ENV_VARS:
        value = os.getenv(name)
        if value:
            return value
    return None


@dataclass(frozen=True)
class Settings:
    """Runtime configuration.

    The Yahoo fields are optional on purpose: the free data layer
    (nflverse / Sleeper / RotoWire) must be usable with no credentials at all,
    so nothing here raises just because Yahoo is not configured yet.
    """

    # --- Yahoo (optional until API access is approved) ---------------------
    yahoo_client_id: str | None = None
    yahoo_client_secret: str | None = None
    # Yahoo rejects localhost redirect URIs. "oob" (out-of-band) is the
    # correct choice for a personal script: Yahoo shows a code to paste back.
    yahoo_redirect_uri: str = "oob"
    # yahoo_oauth persists a LIVE REFRESH TOKEN here. Gitignored. Never commit.
    yahoo_token_file: Path = REPO_ROOT / "oauth2.json"
    # e.g. "461.l.123456". Resolve the game key at runtime via /game/nfl rather
    # than hardcoding a season number.
    yahoo_league_key: str | None = None

    # --- Local storage -----------------------------------------------------
    db_path: Path = REPO_ROOT / "data" / "ff.sqlite"
    cache_dir: Path = REPO_ROOT / "data" / "cache"

    # --- HTTP politeness ---------------------------------------------------
    # Yahoo's rate limits are undocumented and throttling returns HTML, not
    # JSON. We cache aggressively and back off rather than probe the ceiling.
    http_timeout_seconds: float = 20.0
    user_agent: str = "fantasy-football-personal/0.1 (personal, non-commercial)"

    @property
    def yahoo_configured(self) -> bool:
        return bool(self.yahoo_client_id and self.yahoo_client_secret)


def load_settings() -> Settings:
    """Build a :class:`Settings` from the current environment."""
    return Settings(
        yahoo_client_id=os.getenv("YAHOO_CLIENT_ID"),
        yahoo_client_secret=os.getenv("YAHOO_CLIENT_SECRET"),
        yahoo_redirect_uri=os.getenv("YAHOO_REDIRECT_URI", "oob"),
        yahoo_token_file=_env_path("YAHOO_TOKEN_FILE", REPO_ROOT / "oauth2.json"),
        yahoo_league_key=os.getenv("YAHOO_LEAGUE_KEY"),
        db_path=_env_path("FF_DB_PATH", REPO_ROOT / "data" / "ff.sqlite"),
        cache_dir=_env_path("FF_CACHE_DIR", REPO_ROOT / "data" / "cache"),
        http_timeout_seconds=float(os.getenv("FF_HTTP_TIMEOUT", "20")),
    )
