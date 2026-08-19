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

## Draft-prep player comparison (shipped)

**Decided 2026-08-15**, replacing the live draft assistant (see Resolved
Decisions below), and now built: `ff compare` in the CLI, and the board,
player and compare screens in the web app.

The signals it is built from, and why none of them needs Yahoo:

| Signal | Source | Auth needed |
|---|---|---|
| Scored past performance (per season, per week) | nflverse weekly stats → `scoring/` | none |
| Consistency — median, IQR, floor/ceiling week counts | `season_totals()` | none |
| Market price — ADP, current and a decade of history | Sleeper projections; Fantasy Football Calculator (backfill) | none |
| Forward projection | Sleeper projections | none |
| Injury context | RotoWire RSS | none |

**Nothing in that table requires Yahoo.** This is the key property: the feature
is usable regardless of whether the API application is approved. The scoring
basis is the league's rules transcribed in [scoring-rules.md](scoring-rules.md)
(**full PPR**), so reading `league/{key}/settings` later is a *validation* step
against that document, not a prerequisite.

Structurally: `analysis/` sits above `scoring/`, importing from `scoring/` and
`sources/` but never from `yahoo/`, which keeps the no-auth guarantee enforced
rather than merely intended. Resolving a typed name to a `gsis_id` uses
nflverse rosters directly via `normalize_name`, not `IdentityResolver`'s Yahoo
path.

## Target architecture: hosted for the league (decided 2026-08-15)

The app is going from a local CLI to a private web app for the league's members
(a family league; the kids are members too). Stack: **Python pipeline → Supabase
Postgres → Next.js on Vercel**, with Supabase Auth gated on an email allowlist
(a `league_members` table, enforced in row-level security).

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

### Where the job runs (decided 2026-08-15)

**Vercel Cron**, invoking `api/cron/refresh.py` on the schedule in `vercel.json`.
The endpoint verifies `Authorization: Bearer $CRON_SECRET` before doing any work
and fails closed if the secret is unset — without that check it would be a public
button for anyone who guessed the URL.

Note Vercel's Hobby plan permits daily cron only; more frequent schedules need
Pro. Daily at 11:00 UTC sits after nflverse's ~07:00 UTC roster refresh and its
overnight stats rebuild.

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

Live and in use (no credentials required for any of it):

- `scoring/engine.py` and `scoring/rules.py` — the compiled league rules,
  `StatRule.columns` as a tuple so summed categories score correctly
- `sources/` — nflverse, Sleeper and RotoWire, verified live
- `identity.normalize_name` and the ADP-side match, with a position gate
- the scheduled pipeline publishing to Supabase Postgres (Vercel Cron, daily)
- the Next.js app: board, player, compare, market, and an admin screen, behind
  Google sign-in and the RLS-enforced allowlist

Deliberately stubbed, with interfaces settled — all raise `NotImplementedError`
and none blocks current functionality:

- `scoring.parse_league_settings` — needs one real settings payload; a
  *validation* path, since `LEAGUE_SCORING` is hand-built from the settings page
- `YahooClient._page_count`, `game_key` — need a real payload
- `IdentityResolver._exact_match`, `_fuzzy_match`, `resolve_many`

Yahoo payload shapes were deliberately not guessed; capture one real payload
into `tests/fixtures/` and implement against it.

---

## Open questions

Carried forward from [data-sources.md](data-sources.md). The working to-do
list lives outside the repo; this is the public summary of what is unverified.

1. ~~Does `draftresults` populate live during a draft?~~ **Closed 2026-08-15**
   by cutting the feature that needed it. `draftresults` is still read
   post-draft, where latency does not matter.
2. **Will Yahoo API access be approved, and when?** Submitted 2026-08-16;
   approval-gated, human review, no published SLA. Nothing depends on it.
3. **Do newly approved apps ever get write scope?** Read-only as of 2026.
   Immaterial here — this project wants read-only.
4. **Are the Yahoo `stat_id` values in `scoring/rules.py` correct?** Not
   blocking: the league's scoring is transcribed by hand, so the ID map only
   matters for validating a parsed payload later. ~~4b, `StatRule.column`
   cannot express this league~~ — resolved, `columns` is a tuple. **4c, DST
   scoring needs a second table and a second entry point** — still open;
   team defense is not implemented, deliberately, until "Points Allowed" can
   be checked against a live Yahoo box score.
5. **What is the 2026 NFL game key?** Resolve at runtime via `/game/nfl`;
   `YahooClient.game_key` exists for this.
6. **How stable are Sleeper's undocumented endpoints?** Isolated in
   `sources/sleeper.py`; `order_by` is required in practice.
7. **Does fuzzy matching close the rookie gap, and at what accuracy?** The
   need is confirmed (the 2025 and 2026 classes have no `yahoo_id` in the
   crosswalk); accuracy is unmeasured. Build a labelled sample before trusting
   it; the manual-override table is the escape hatch.

**Correction to data-sources.md:** it warns that missing crosswalk values are
the literal string `"NA"` rather than empty. That holds for the raw CSV, but
when loaded via `nflreadpy.load_ff_playerids()` they arrive as genuine nulls
(verified: 6,983 nulls, 0 literal `"NA"`). Both cases must be handled — the
guard belongs in `_exact_match` regardless of load path.
