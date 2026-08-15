# Architecture

## Layering

```
        ┌───────────────────────────────────────────────┐
        │  scripts/  ·  future analyses & notebooks     │
        └───────────────────────────────────────────────┘
                             │
        ┌────────────────────▼──────────────────────────┐
        │  scoring/   settings → scoring fn → scored df │  ← pure, no I/O
        └────────────────────┬──────────────────────────┘
                             │
        ┌──────────┬─────────┴──────────┬───────────────┐
        │ yahoo/   │  identity/         │  sources/     │
        │ (authed) │  (Yahoo ↔ gsis_id) │  (no auth)    │
        └──────────┴────────────────────┴───────────────┘
                             │
        ┌────────────────────▼──────────────────────────┐
        │  store.py (SQLite)   ·   config.py (env)      │
        └───────────────────────────────────────────────┘
```

Rules that keep the seams honest:

- **`scoring/` imports nothing from `yahoo/` or `sources/`.** It takes a decoded
  payload and a DataFrame. That is what makes it unit-testable with no network
  and no credentials, which matters a lot while Yahoo access is pending.
- **`sources/` never imports `yahoo/`.** The entire free data layer works with
  zero credentials, and `scripts/smoke_test.py` proves it on demand.
- **`yahoo/` is the only authenticated layer**, and its only network egress is
  `YahooClient._get`, which issues only `GET`.
- **`identity/` is the join seam.** It is the only place that knows Yahoo player
  IDs and nflverse `gsis_id`s are different things.

## Why the scoring function is the center

Yahoo will tell you fantasy points, but only for players queried inside your
league context, 25 per request, against an API with undocumented rate limits.
That is workable for your own roster and completely impractical for "every
player in the NFL, every week."

So the design inverts it:

1. Read `league/{key}/settings` **once** (cached 30 days — scoring rules
   essentially never change mid-season).
2. Compile it into `ScoringRules`: a list of `(stat, points_per_unit)` pairs.
3. Apply it to nflverse weekly box scores as a pure Polars expression.

The result is that **every player in the NFL is scored in this league's terms**,
not just the rostered ones, and no additional Yahoo call is needed to do it.

This is the enabling move for everything the project is eventually for:

- **Consistency analysis** — total points hide how they were accumulated. Mean
  and standard deviation over scored weeks separate a steady starter from a
  boom/bust flex. `season_totals()` already emits both.
- **Waiver evaluation** — scoring the free-agent pool in league terms is only
  possible if you can score unrostered players.
- **What-if scenarios** — re-scoring historical weeks against alternate lineups
  or alternate rules is just calling the same function with different inputs.

Because it is a pure function over a table, it works identically on one week and
on twenty seasons.

## Key design decisions

**Polars, not pandas.** `nfl_data_py` was deprecated and archived in Sep 2025;
its successor `nflreadpy` returns Polars DataFrames. Rather than convert at the
boundary, Polars is used throughout. The scoring engine is a Polars expression,
which keeps it both fast and composable into larger queries.

**Raw payloads from the Yahoo client.** `YahooClient` methods return undecoded
JSON rather than typed models. Yahoo's JSON is a mechanical transform of XML —
numeric-string keys, collections that collapse from list to dict when they hold
one item. Guessing that structure without a live payload produces confident
wrong parsers, so parsing is deferred until a real fixture exists.

**Failed identity matches are values, not exceptions.** `resolve()` returns a
`PlayerMatch` with `method=UNRESOLVED` rather than raising or guessing. A wrong
`gsis_id` silently corrupts every downstream number; a visible gap is far
cheaper to fix. Every match records how it was made and with what confidence.

**Caching is politeness, not performance.** Yahoo publishes no rate limits and
only warns it "may temporarily throttle." With no documented ceiling, the safe
posture is to never make the same request twice. TTLs in `store.py` are set by
how fast the upstream data can actually change.

**Throttling is a first-class failure mode.** A throttled Yahoo request returns
HTML, not JSON, which crashes a naive `.json()` call with a confusing decode
error. Every response is sniffed and raises `YahooThrottledError` instead.

## Current state

Implemented and tested:

- `scoring/engine.py` — fully implemented, 9 unit tests
- `identity.normalize_name` — fully implemented, 11 test cases
- `sources/` — all three sources working (verified live 2026-08-15)
- `store.py`, `config.py` — implemented
- `yahoo/` transport, pagination, and throttle handling — implemented

Deliberately stubbed, with interfaces settled:

- `scoring.parse_league_settings` — needs one real settings payload
- `YahooClient._page_count`, `game_key` — need a real payload
- `IdentityResolver._exact_match`, `_fuzzy_match`, `resolve_many`

---

## Open questions

Carried forward from [data-sources.md](data-sources.md). These are unverified
and should be resolved before anything depends on them.

**1. Does `draftresults` populate live during a draft?** *(highest risk)*
Unknown, and unknown at what latency. Yahoo's live draft runs through a separate
draft client, and some existing tools scrape the draft-room DOM via a Chrome
extension instead — which suggests the API may not be usable live. **Prototype
against a mock draft before committing to any live draft-assistant feature.**

**2. Will Yahoo API access be approved, and how long will it take?** Access is
approval-gated with human review and no published SLA. This is a lead-time item.
The architecture's response is that the entire free data layer works without it.

**3. Do newly approved apps ever get write scope?** The API is read-only as of
2026. Immaterial here — this project wants read-only — but it caps what the
project could ever become.

**4. Are the Yahoo `stat_id` values in `scoring/rules.py` correct?**
`YAHOO_STAT_ID_TO_NFLVERSE` uses the widely-circulated NFL stat IDs, but
data-sources.md did not verify them. Verify against the league's own
`stat_categories` payload, which returns names alongside IDs. `parse_league_settings`
is designed to *report* unmapped stat IDs rather than silently score them as
zero, so the gap is visible rather than quiet.

**5. What is the 2026 NFL game key?** 461 = 2025; the 2026 value is unverified.
Resolve at runtime via `/game/nfl` rather than hardcoding — `YahooClient.game_key`
exists for this.

**6. How stable are Sleeper's undocumented endpoints?** The projections/ADP and
weekly-stats endpoints on `api.sleeper.com` are live but undocumented, with no
stability guarantee. They are isolated in `sources/sleeper.py` and marked, so a
break is contained to that module. `order_by` is required in practice —
omitting it returns placeholder rows.

**7. Does fuzzy matching actually close the rookie gap, and at what accuracy?**
The need is confirmed: verified 2026-08-15 against the DynastyProcess crosswalk,
the 2025 class has **0 of 376** players with a `yahoo_id` and the 2026 class
**0 of 285** (2024: 115 of 356). The fallback is therefore load-bearing, not
defensive. Its accuracy is unmeasured — build a labelled sample and measure
before trusting it, and keep the manual-override table as the escape hatch.

**Correction to data-sources.md:** it warns that missing crosswalk values are
the literal string `"NA"` rather than empty. That holds for the raw CSV, but
when loaded via `nflreadpy.load_ff_playerids()` they arrive as genuine nulls
(verified: 6,983 nulls, 0 literal `"NA"`). Both cases must be handled — the
guard belongs in `_exact_match` regardless of load path.
