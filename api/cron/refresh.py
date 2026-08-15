"""Vercel Cron entry point: rebuild the published tables.

Invoked on the schedule in ``vercel.json``. This is the ONLY place that reaches
out to Yahoo and the public data sources — the web app never does, which is what
keeps Yahoo request volume independent of how many league members are using the
site.

Measured cost of a full run: ~4s and ~311 MB for a decade of history, so this
fits comfortably inside Vercel's function limits with no incremental logic.

Security
--------
Vercel Cron sends ``Authorization: Bearer $CRON_SECRET``. That header is
verified before any work happens; without it this endpoint would be a public
button for anyone who guessed the URL. Missing config fails closed.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))


def _authorized(headers) -> bool:
    """Constant-time check of the cron secret. Fails closed if unset."""
    import hmac

    secret = os.environ.get("CRON_SECRET")
    if not secret:
        return False
    provided = headers.get("Authorization", "")
    return hmac.compare_digest(provided, f"Bearer {secret}")


class handler(BaseHTTPRequestHandler):  # noqa: N801 — Vercel requires this name
    def _respond(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler API
        if not _authorized(self.headers):
            self._respond(401, {"error": "unauthorized"})
            return

        dsn = os.environ.get("SUPABASE_DB_URL")
        if not dsn:
            self._respond(500, {"error": "SUPABASE_DB_URL is not set"})
            return

        try:
            from ff.pipeline import run_refresh

            result = run_refresh(dsn)
            self._respond(200, {"status": "ok", **result})
        except Exception as exc:  # noqa: BLE001 — report, never 500 silently
            traceback.print_exc()
            self._respond(500, {"status": "error", "error": f"{type(exc).__name__}: {exc}"})
