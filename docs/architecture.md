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

- **Draft-prep player comparison** *(next feature — see below)* — "would I
  rather draft A or B" is a question about scored history plus market signal.
  Both sides need every player scored in league terms, not just rostered ones.
- **Consistency analysis** — total points hide how they were accumulated. Mean
  and standard deviation over scored weeks separate a steady starter from a
  boom/bust flex. `season_totals()` already emits both.
- **Waiver evaluation** — scoring the free-agent pool in league terms is only
  possible if you can score unrostered players.
- **What-if scenarios** — re-scoring historical weeks against alternate lineups
  or alternate rules is just calling the same function with different inputs.

Because it is a pure function over a table, it works identically on one week and
on twenty seasons.

## Next feature: draft-prep player comparison

**Decided 2026-08-15**, replacing the live draft assistant (see Resolved
Decisions below).

Take one or more player names and return what's needed to choose between them:

| Signal | Source | Auth needed |
|---|---|---|
| Scored past performance (per season, per week) | nflverse weekly stats → `scoring/` | none |
| Consistency — mean, std dev, floor/ceiling week counts | `season_totals()` | none |
| Market price — ADP across scoring formats | Sleeper season projections | none |
| Forward projection | Sleeper projections | none |
| Injury context | RotoWire RSS | none |

**Nothing in that table requires Yahoo.** This is the key property: the feature
is usable this season regardless of whether the API application is approved.

The scoring basis is settled too — the league's rules are transcribed in
[scoring-rules.md](scoring-rules.md) (**full PPR**, 1.0 per reception), so a
`ScoringRules` can be hand-built today rather than waiting on
`league/{key}/settings`. Reading the settings endpoint later becomes a
*validation* step against that document, not a prerequisite.

Design notes for whoever builds it:

- It belongs in a new `analysis/` layer above `scoring/`, importing from
  `scoring/` and `sources/` but never from `yahoo/`. That keeps the no-auth
  guarantee structurally enforced rather than merely intended.
- Resolving a typed player name to a `gsis_id` is the same identity problem as
  everything else, minus the Yahoo side — so it can use nflverse rosters
  directly and does not need `IdentityResolver`'s Yahoo path. `normalize_name`
  is already implemented and tested for this.
- Comparison output is a table, which means the underlying function should
  return a DataFrame and let the caller format it.

## Target architecture: hosted for the league (decided 2026-08-15)

The app is going from a local CLI to a private web app for the league's members
(a family league; the kids are members too). Stack: **Python pipeline → Supabase
Postgres → Next.js on Vercel**, with Supabase Auth gated on a hard-coded email
allowlist.

```
Python (scheduled job)                Supabase Postgres          Vercel
──────────────────────                ─────────────────          ──────
nflverse parquet ──┐                  scored_weekly_stats        Next.js app
Sleeper ADP ───────┼─→ score with  →  player_index          →    Supabase Auth
RotoWire RSS ──────┤   LEAGUE_SCORING adp_projections            (email allowlist)
Yahoo (read-only) ─┘                  injury_news
                                      league_* (Yahoo mirrors)
```

### Why the split is forced, not stylistic

`ff compare` currently downloads nflverse parquet and scores it in Polars per
invocation. That is fine in a terminal and hostile inside a serverless function:
cold starts, memory ceilings, and multi-second downloads on every page view.

So ingestion and scoring move to a **scheduled batch job**, and the web app only
ever reads pre-scored rows out of Postgres. Two consequences worth stating:

- **Adding users adds no Yahoo requests.** The app never calls Yahoo; the job
  does, on a fixed cadence. This is what makes the audience size irrelevant to
  Yahoo's load, and it is the strongest thing we can say in the API application.
- **Page loads become a Postgres query.** ~18.5k player-weeks per regular season
  means a decade of scored history is under 200k rows — nothing for Postgres,
  with the right index on `(player_id, season, week)`.

### What survives, what changes

| Layer | Fate |
|---|---|
| `scoring/` | **Unchanged.** Pure functions over tables; it does not care whether the output goes to a terminal or Postgres. This is the payoff for keeping it I/O-free. |
| `sources/` | **Unchanged.** Still the ingestion side, now called from the job. |
| `analysis/` | **Mostly survives** as the job's scoring step; the presentation half moves to the web app. |
| `identity/` | **Unchanged**, and more important — the crosswalk gets persisted and reused rather than recomputed. |
| `yahoo/` | **Unchanged** client; only the caller moves (scheduled job, not CLI). |
| `store.py` | **Replaced.** SQLite gives way to Supabase. Its caching role largely disappears — Postgres becomes the cache. ~190 lines, no ORM, deliberately thin, so the blast radius is small. |
| `cli.py` | **Kept** for local development and for running the pipeline by hand. |

### Credential handling changes materially

A refresh token on a laptop and a refresh token on a server are different risks.
In deployment it lives in server-side environment variables only, is never
committed, and is never sent to the browser. No Yahoo credential may be reachable
from client-side code — that is a hard rule, not a preference, because Next.js
makes it genuinely easy to leak a secret into a client bundle by accident.

### Open questions for the migration

### Where the job runs (decided 2026-08-15)

**Vercel Cron**, invoking `api/cron/refresh.py` on the schedule in `vercel.json`.
The endpoint verifies `Authorization: Bearer $CRON_SECRET` before doing any work
and fails closed if the secret is unset — without that check it would be a public
button for anyone who guessed the URL.

Note Vercel's Hobby plan permits daily cron only; more frequent schedules need
Pro. Daily at 11:00 UTC sits after nflverse's ~07:00 UTC roster refresh and its
overnight stats rebuild.
All three are now decided — see below.

### Refresh strategy (decided 2026-08-15)

**Incremental by default; full rebuild when the scoring rules change.**

A completed season never changes, so the routine run rebuilds only the current
season. Full rebuilds are not scheduled — they are *triggered*, by the scoring
rules themselves.

The trap incremental refresh sets is staleness: change a scoring rule, re-score
only the current season, and history quietly keeps numbers computed under rules
that no longer exist — two rulesets mixed in one table with nothing to reveal
it. So `ScoringRules.fingerprint()` hashes the ruleset, the fingerprint is stored
in `pipeline_meta` beside the published data, and a mismatch forces a full
rebuild on the next run. Nobody has to remember a flag.

The fingerprint deliberately covers `unmapped` too: promoting a category from
unmapped to mapped changes scores while the mapped rules alone look unchanged.

`ff refresh --full` forces one anyway. Measured cost of a full rebuild is ~4s and
311 MB for a decade (174k player-weeks), so forcing one is cheap when warranted —
the reason to skip it is that the work is pointless, not that it is expensive.

### What gets stored (decided 2026-08-15)

Scored output plus the **22 stat columns the scoring rules actually read** — not
all 150 nflverse columns. That is enough for the UI to explain *why* a week was
worth 24.7 points rather than just asserting it, and it keeps the row narrow.

These tables are a **cache, not a system of record**. nflverse parquet and the
Sleeper API are the sources of truth, both public and permanent, so anything here
can be rebuilt. That is what makes storing only scored output safe.

## Resolved decisions

**Live draft assistant — dropped (2026-08-15).** Open question #1 below asked
whether `draftresults` populates live mid-draft. Rather than resolve it, the
feature was cut: it was the only planned capability gated on unverified Yahoo
behavior, and the evidence pointed the wrong way (Yahoo's live draft runs
through a separate client, and existing tools scrape the draft-room DOM instead
of using the API). Draft-prep comparison replaces it and depends on nothing
unverified.

`draftresults` is still read, but only **post-draft**, for reviewing pick value
after the fact — a use where latency is irrelevant, so the open question no
longer blocks anything.

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

**1. ~~Does `draftresults` populate live during a draft?~~ CLOSED 2026-08-15** —
not by answering it, but by cutting the feature that needed it. See Resolved
Decisions above. `draftresults` is still read post-draft, where latency does not
matter.

**2. Will Yahoo API access be approved, and how long will it take?** Access is
approval-gated with human review and no published SLA. This is a lead-time item.
The architecture's response is that the entire free data layer works without it.

**3. Do newly approved apps ever get write scope?** The API is read-only as of
2026. Immaterial here — this project wants read-only — but it caps what the
project could ever become.

**4. Are the Yahoo `stat_id` values in `scoring/rules.py` correct?**
*(no longer blocking, as of 2026-08-15)* `YAHOO_STAT_ID_TO_NFLVERSE` uses the
widely-circulated NFL stat IDs, unverified. But the league's actual scoring
values are now transcribed in [scoring-rules.md](scoring-rules.md), so a working
`ScoringRules` can be built by hand with no Yahoo call and no stat-ID guessing.
The ID map now only matters for *validating* a parsed API payload against that
document later. `parse_league_settings` still reports unmapped stat IDs rather
than silently scoring them zero.

**4b. `StatRule.column` cannot express this league.** *(new, blocking)* Three
rules map to a **sum** of nflverse columns rather than one — Fumbles Lost (3
columns), 2-Point Conversions (3), Block Kick (3) — and FG 50+ is one league
bucket spanning two nflverse columns. `column: str | None` must become
`columns: tuple[str, ...]`. Fix this **before** building on top of the engine: a
naive one-column mapping undercounts fumbles by ~two thirds and every downstream
number inherits the error silently. Detail in
[scoring-rules.md](scoring-rules.md).

**4c. DST scoring needs a second table and a second entry point.** *(new)*
Offense and kicking come from `load_player_stats`; team defense does not
(individual `def_sacks` are per-player, the league scores a team unit). DST needs
`load_team_stats`, and Points Allowed needs deriving from `load_schedules`
scores. `score_weekly_stats(stats, rules)` structurally cannot cover this.
Decide between a separate `score_team_defense()` and per-rule source
declarations before implementing. Also unresolved: Yahoo's exact definition of
"Points Allowed" (see open question A in scoring-rules.md).

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
