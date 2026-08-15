"""Yahoo OAuth2 for a personal script.

Two Yahoo-specific constraints drive this module:

1. **Redirect URI must be HTTPS; localhost is rejected.** For a personal script
   the supported path is the out-of-band flow (``oob``): Yahoo displays a
   verifier code in the browser and you paste it into the terminal. There is no
   local callback server, so nothing needs to listen on a port.

2. **The token file is a credential.** ``yahoo_oauth`` persists the access token
   *and the long-lived refresh token* to a JSON file in the working directory.
   That file is gitignored. Access tokens last ~1 hour; refresh tokens are
   long-lived, may rotate, and are all revoked on a Yahoo password change.

This module is a thin, lazily-imported wrapper so that importing ``ff`` never
requires Yahoo credentials to be present.
"""

from __future__ import annotations

import json
import stat
from pathlib import Path
from typing import Any

from ff.config import Settings, load_settings


class YahooNotConfiguredError(RuntimeError):
    """Raised when Yahoo credentials are missing.

    Yahoo API access is approval-gated with no published SLA, so the whole
    free-data layer is designed to work while this is still unresolved.
    """


class YahooAuth:
    """Owns the OAuth2 session and the on-disk token file."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or load_settings()
        self._session: Any | None = None

    # -- token file -------------------------------------------------------
    @property
    def token_file(self) -> Path:
        return self.settings.yahoo_token_file

    def _write_bootstrap_token_file(self) -> None:
        """Seed the token file with credentials for yahoo_oauth's first run.

        ``yahoo_oauth.OAuth2`` reads consumer key/secret from this JSON file and
        then writes tokens back into it. We create it from environment values so
        that credentials never appear in source, and chmod it to 0600.
        """
        if not self.settings.yahoo_configured:
            raise YahooNotConfiguredError(
                "YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET are not set. "
                "Copy .env.example to .env and fill them in."
            )
        self.token_file.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "consumer_key": self.settings.yahoo_client_id,
            "consumer_secret": self.settings.yahoo_client_secret,
        }
        self.token_file.write_text(json.dumps(payload, indent=2))
        self.token_file.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 0600

    # -- session ----------------------------------------------------------
    def session(self) -> Any:
        """Return an authenticated, auto-refreshing OAuth2 session.

        On first run this triggers the ``oob`` flow: a Yahoo URL is printed,
        you authorize in a browser, and paste the verifier code back.
        """
        if self._session is not None:
            return self._session

        try:
            from yahoo_oauth import OAuth2
        except ImportError as exc:  # pragma: no cover - dependency guard
            raise YahooNotConfiguredError("yahoo-oauth is not installed. Run: uv sync") from exc

        if not self.token_file.exists():
            self._write_bootstrap_token_file()

        session = OAuth2(None, None, from_file=str(self.token_file))
        if not session.token_is_valid():
            session.refresh_access_token()
        # Re-assert restrictive permissions: the library rewrites the file.
        self.token_file.chmod(stat.S_IRUSR | stat.S_IWUSR)

        self._session = session
        return session

    def is_authenticated(self) -> bool:
        """Cheap check that does not start an interactive flow."""
        return self.settings.yahoo_configured and self.token_file.exists()
