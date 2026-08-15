"""Yahoo-ID -> gsis_id resolution, with a fuzzy fallback that carries real load.

Interface is settled; matching internals are stubbed.

Why the fallback is not optional
--------------------------------
Public crosswalks have zero Yahoo IDs for the 2025 and 2026 rookie classes
(verified: 0/376 and 0/285). A dictionary-only resolver would return "unknown"
for every rookie — the exact population a waiver-wire tool exists to evaluate.

Strategy
--------
1. **Exact** — look up ``yahoo_id`` in the DynastyProcess crosswalk. Fast,
   unambiguous, and useless for recent rookies.
2. **Fuzzy** — normalise the name (strip suffixes, punctuation, accents), then
   require ``position`` to match and use ``team`` to break ties. Score the
   remainder by string similarity and only accept above a threshold.
3. **Unresolved** — return a :class:`PlayerMatch` with ``method=UNRESOLVED``
   rather than raising or guessing. Never silently attach a wrong gsis_id: a
   bad join corrupts every downstream number, and a visible gap is cheaper to
   fix than a plausible wrong answer.

Every match records its ``method`` and ``confidence`` so callers can decide how
much to trust a row, and so a review pass can audit what fuzzy matching did.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

import polars as pl

#: Below this similarity, a fuzzy candidate is rejected as unresolved.
DEFAULT_FUZZY_THRESHOLD = 0.87

#: Generational/ordinal suffixes that differ freely between sources.
_NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}

_PUNCT_RE = re.compile(r"[^a-z0-9\s]")
_WS_RE = re.compile(r"\s+")


class MatchMethod(StrEnum):
    """How a match was arrived at. Always recorded, never inferred later."""

    EXACT_CROSSWALK = "exact_crosswalk"
    FUZZY_NAME = "fuzzy_name"
    MANUAL_OVERRIDE = "manual_override"
    UNRESOLVED = "unresolved"


@dataclass(frozen=True)
class PlayerMatch:
    """The result of resolving one Yahoo player.

    ``gsis_id`` is ``None`` when ``method is MatchMethod.UNRESOLVED``.
    """

    yahoo_id: str
    gsis_id: str | None
    method: MatchMethod
    confidence: float
    #: Populated on fuzzy matches so a human can audit the decision.
    matched_name: str | None = None
    candidates: tuple[tuple[str, float], ...] = ()

    @property
    def resolved(self) -> bool:
        return self.gsis_id is not None

    @property
    def needs_review(self) -> bool:
        """Fuzzy matches are usable but should be eyeballed before trusting."""
        return self.method is MatchMethod.FUZZY_NAME


def normalize_name(name: str) -> str:
    """Normalise a player name for comparison.

    Strips accents, punctuation (``D'Andre`` / ``DAndre``, ``T.J.`` / ``TJ``),
    generational suffixes, and case. Deliberately public and pure: it is the
    single highest-leverage function in the fuzzy path and deserves its own
    tests.

    >>> normalize_name("Marvin Harrison Jr.")
    'marvin harrison'
    >>> normalize_name("Ja'Marr Chase")
    'jamarr chase'
    """
    decomposed = unicodedata.normalize("NFKD", name)
    ascii_only = "".join(c for c in decomposed if not unicodedata.combining(c))
    lowered = ascii_only.lower().replace("'", "").replace(".", "")
    cleaned = _PUNCT_RE.sub(" ", lowered)
    tokens = [t for t in _WS_RE.split(cleaned) if t]
    while tokens and tokens[-1] in _NAME_SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


class SupportsResolve(Protocol):
    """The seam the rest of the app codes against."""

    def resolve(self, yahoo_id: str, name: str, position: str, team: str | None) -> PlayerMatch: ...


class IdentityResolver:
    """Two-tier Yahoo -> gsis_id resolver.

    Parameters
    ----------
    crosswalk:
        The DynastyProcess ID table, from
        :func:`ff.sources.nflverse.load_player_ids`.
    roster:
        A roster frame used as the fuzzy-match target. Season rosters have
        complete ``gsis_id`` coverage, which makes them a better target than the
        crosswalk for active players.
    overrides:
        Hand-curated ``yahoo_id -> gsis_id`` corrections. These win over
        everything: fuzzy matching will get some players wrong, and there has to
        be a way to pin the answer permanently.
    threshold:
        Minimum similarity for a fuzzy match to be accepted.
    """

    def __init__(
        self,
        crosswalk: pl.DataFrame,
        roster: pl.DataFrame | None = None,
        overrides: dict[str, str] | None = None,
        threshold: float = DEFAULT_FUZZY_THRESHOLD,
    ) -> None:
        self.crosswalk = crosswalk
        self.roster = roster
        self.overrides = overrides or {}
        self.threshold = threshold

    # -- public API -------------------------------------------------------
    def resolve(
        self,
        yahoo_id: str,
        name: str,
        position: str,
        team: str | None = None,
    ) -> PlayerMatch:
        """Resolve one Yahoo player to a ``gsis_id``.

        Never raises on a failed match — returns ``method=UNRESOLVED`` so the
        caller can count and report gaps instead of crashing a pipeline.
        """
        if yahoo_id in self.overrides:
            return PlayerMatch(
                yahoo_id=yahoo_id,
                gsis_id=self.overrides[yahoo_id],
                method=MatchMethod.MANUAL_OVERRIDE,
                confidence=1.0,
            )
        exact = self._exact_match(yahoo_id)
        if exact is not None:
            return exact
        return self._fuzzy_match(yahoo_id, name, position, team)

    def resolve_many(self, players: pl.DataFrame) -> pl.DataFrame:
        """Resolve a frame of Yahoo players.

        Expects columns ``yahoo_id``, ``name``, ``position``, and optionally
        ``team``. Returns the input plus ``gsis_id``, ``match_method``, and
        ``match_confidence``, so unresolved rows stay visible rather than being
        dropped by an inner join.
        """
        raise NotImplementedError("stub: vectorise resolve() over the frame")

    def coverage_report(self, matches: list[PlayerMatch]) -> dict[str, int]:
        """Summarise resolution outcomes by method.

        Worth running every time the player universe is refreshed: a jump in
        ``unresolved`` usually means a new rookie class just landed.
        """
        report = {m.value: 0 for m in MatchMethod}
        for match in matches:
            report[match.method.value] += 1
        return report

    # -- internals (stubs) ------------------------------------------------
    def _exact_match(self, yahoo_id: str) -> PlayerMatch | None:
        """Look ``yahoo_id`` up in the crosswalk.

        Returns ``None`` when absent — which is the *normal* case for 2025 and
        2026 rookies, not an error.

        Implementation note: when the crosswalk is read straight from CSV,
        missing values are the literal string ``"NA"``, so a null check alone
        will happily "find" a player whose ID is the text ``NA``. Filter both.
        """
        raise NotImplementedError("stub: filter crosswalk on yahoo_id, guard the 'NA' sentinel")

    def _fuzzy_match(
        self,
        yahoo_id: str,
        name: str,
        position: str,
        team: str | None,
    ) -> PlayerMatch:
        """Fuzzy-match on normalised name, gated by position and team.

        Intended shape: filter candidates to the same ``position`` (a hard gate
        — a RB is never the right answer for a WR), score
        :func:`normalize_name` similarity with ``difflib.SequenceMatcher``, add
        a bonus for a matching ``team``, and accept the best candidate only if
        it clears ``self.threshold`` *and* beats the runner-up by a margin.
        Ambiguity should resolve to UNRESOLVED, not a coin flip.
        """
        raise NotImplementedError("stub: position-gated fuzzy name match against roster/crosswalk")
