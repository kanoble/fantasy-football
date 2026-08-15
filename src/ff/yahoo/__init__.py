"""Yahoo Fantasy Sports API access — strictly read-only.

The Yahoo Fantasy Sports API provides read access only (write access is not
available as of 2026), and this project does not want write access regardless:
it never modifies league state. See ``client.py`` for the enforced surface.
"""

from ff.yahoo.auth import YahooAuth, YahooNotConfiguredError
from ff.yahoo.client import YahooClient, YahooThrottledError

__all__ = [
    "YahooAuth",
    "YahooClient",
    "YahooNotConfiguredError",
    "YahooThrottledError",
]
