"""RotoWire NFL injury news via RSS. Free, no auth.

The feed returns only ~5 items per fetch, so it is a *sliding window*, not a
history: polling every few minutes and de-duplicating on GUID is the only way
to avoid missing news. Persistence belongs in :mod:`ff.store`; this module just
fetches and normalises.

Non-commercial use. Credit RotoWire.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import feedparser

INJURY_FEED_URL = "https://www.rotowire.com/rss/news.php?sport=NFL&view=injuries"

# Generic NFL news (not injury-filtered), kept for reference.
NEWS_FEED_URL = "https://www.rotowire.com/rss/news.php?sport=NFL"


@dataclass(frozen=True)
class InjuryItem:
    """One normalised feed entry."""

    guid: str
    title: str
    summary: str
    link: str
    published: str | None

    @classmethod
    def from_entry(cls, entry: Any) -> InjuryItem:
        return cls(
            # Fall back to link then title: RotoWire entries always have a link,
            # and a stable key is what de-duplication depends on.
            guid=getattr(entry, "id", None) or entry.get("link") or entry.get("title", ""),
            title=entry.get("title", ""),
            summary=entry.get("summary", ""),
            link=entry.get("link", ""),
            published=entry.get("published"),
        )


def fetch_injuries(url: str = INJURY_FEED_URL) -> list[InjuryItem]:
    """Fetch the current injury feed window.

    Returns at most ~5 items. Callers that want history must poll and dedupe on
    :attr:`InjuryItem.guid`.
    """
    parsed = feedparser.parse(url)
    # feedparser does not raise on HTTP/parse errors; it sets `bozo`.
    if parsed.bozo and not parsed.entries:
        raise RuntimeError(f"Could not parse RotoWire feed {url!r}: {parsed.bozo_exception!r}")
    return [InjuryItem.from_entry(e) for e in parsed.entries]
