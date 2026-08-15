# Handover

State of the project as of **2026-08-15**. Read this first, then
[architecture.md](architecture.md) for design rationale and
[scoring-rules.md](scoring-rules.md) for the league's scoring.

Repo: https://github.com/kanoble/fantasy-football (public)

---

## The one-paragraph version

A private, read-only analytics app for one 12-person family Yahoo fantasy
league. Its central idea: read the league's scoring settings once, compile them
into a pure function, and apply that to nflverse box scores — which scores
*every player in the NFL* in this league's terms, not just rostered ones. Today
it is a working CLI (`ff compare`) on free public data. It is being moved to a
private web app: Python pipeline → Supabase Postgres → Next.js on Vercel. The
Yahoo integration is stubbed pending an API access application that has not been
submitted yet.

## What works right now

Verified live on 2026-08-15. **None of this needs credentials.**

| Thing | State |
|---|---|
| `ff compare "A" "B"` | Working. Scored history, consistency, ADP, injury status. |
| `ff rules` | Working. Prints the league ruleset and its fingerprint. |
| `ff refresh` | Written, **DB path never executed** — see Unverified below. |
| `scripts/smoke_test.py` | Working. All 4 no-auth sources green. |
| `scoring/` | Fully implemented and tested. The heart of the project. |
| `sources/` | Fully implemented (nflverse, Sleeper, RotoWire). |
| `analysis/` | Fully implemented. |
| `pipeline.py` | Build functions verified; write functions unverified. |
| Test suite | 50 tests, all passing. `uv run pytest` |
| Lint | Clean. `uv run ruff check .` |

```bash
uv sync
uv run ff compare "Bijan Robinson" "Jahmyr Gibbs"
uv run pytest
```

## What is deliberately stubbed

All raise `NotImplementedError` with a note on what to implement against. None
of them block current functionality.

| Stub | Needs |
|---|---|
| `scoring.parse_league_settings` | One real `league/{key}/settings` payload. **Not blocking** — `LEAGUE_SCORING` is hand-built from the settings page, so this is a *validation* path, not a prerequisite. |
| `YahooClient._page_count` | A real players-endpoint payload to learn Yahoo's nesting. |
| `YahooClient.game_key` | A real `/game/nfl` payload. |
| `IdentityResolver._exact_match` | Crosswalk lookup, guarding the literal `"NA"` sentinel. |
| `IdentityResolver._fuzzy_match` | Position-gated fuzzy match. See "the rookie problem" below. |
| `IdentityResolver.resolve_many` | Vectorised `resolve()`. |

Yahoo payload shapes were **deliberately not guessed**. Yahoo's JSON is a
mechanical transform of XML — numeric-string keys, collections that collapse
from list to dict when they hold one item. Guessing produces confident wrong
parsers. Capture one real payload into `tests/fixtures/` and implement against
it.

## Unverified — treat with suspicion

1. **The database write path has never run.** No Supabase project exists.
   `COPY`, the transaction boundaries, `replace_season`, and the `pipeline_meta`
   upsert in `pipeline.py` are all unexecuted. The *decision* logic around them
   is tested against a fake connection (`tests/test_pipeline.py`), but the SQL
   itself is untested. First real run should be
   `ff refresh --dsn <url>` locally, not a deploy.

2. **`api/cron/refresh.py` has never been deployed.** Vercel's Python runtime
   handler shape, the `sys.path` insertion for `src/`, and whether Polars fits
   the deployment bundle size are all unconfirmed.

3. **Yahoo stat IDs** in `YAHOO_STAT_ID_TO_NFLVERSE` are the widely-circulated
   values, never verified against a live payload. Not on the critical path.

4. **Fuzzy identity matching accuracy is unmeasured.** The *need* is confirmed
   (below); how well it works is not.

## The rookie problem (verified, and it matters)

Public crosswalks have **zero Yahoo IDs for recent rookie classes**. Measured
against the DynastyProcess crosswalk (12,472 rows) on 2026-08-15:

| draft class | rows with a `yahoo_id` |
|---|---|
| 2024 | 115 / 356 |
| **2025** | **0 / 376** |
| **2026** | **0 / 285** |

Sleeper/ESPN/gsis IDs are 95%+ complete for the same players. So a
dictionary-only resolver returns "unknown" for exactly the population a fantasy
tool cares most about. The fuzzy fallback in `identity/crosswalk.py` is
load-bearing, not defensive.

`analysis/players.py` sidesteps this entirely — it matches names against
nflverse rosters with no Yahoo side — so draft prep is unaffected.

## Decisions already made (do not relitigate without reason)

| Decision | Why |
|---|---|
| **nflreadpy + Polars** | `nfl_data_py` is deprecated and archived (Sep 2025). nflreadpy returns Polars, not pandas. |
| **Live draft assistant: cut** | It was the only feature gated on unverified Yahoo behaviour, and evidence pointed the wrong way. Replaced by draft-prep comparison, which depends on nothing unverified. |
| **Full PPR** | The league's only deviation from Yahoo defaults (1.0/reception vs 0.5). |
| **`StatRule.columns` is a tuple** | Fumbles Lost, 2-pt conversions, and Block Kick each map to a *sum* of three nflverse columns; FG 50+ spans two. A one-column model undercounts fumbles by ~2/3 silently. |
| **Regular season only** | nflverse weekly stats include postseason rows at weeks 19-22. Counting them inflated Puka Nacua's 2025 from 16 games/375.0 to 19 games/452.6 — worst for exactly the players worth comparing. |
| **Sleeper `adp_ppr`, not `adp_dd_ppr`** | The latter (named in data-sources.md) is not a real field. It is not rejected — it silently returns unordered placeholder rows. |
| **Incremental refresh + rules fingerprint** | Completed seasons never change, so rebuilding them is pointless work. The staleness hazard is closed by hashing the ruleset: a mismatch forces a full rebuild automatically. |
| **Store scored output + the 22 rule columns** | Enough to *explain* a score, not just assert it. These tables are a cache; nflverse is the system of record. |
| **Vercel Cron** | Daily 11:00 UTC, after nflverse's ~07:00 roster refresh. Hobby plan allows daily only. |
| **SQLite → Supabase** | Driven by going multi-user and hosted, not by data volume. |

## Open questions

### Blocking the Yahoo integration

**Q1. Will API access be approved, and when?** Approval-gated, human review, no
published SLA. **Not submitted yet as of 2026-08-15** — this is a lead-time item,
apply early. The whole free-data layer is designed to work without it.

### To be answered empirically once the season is live

The agreed method: score a completed week with `LEAGUE_SCORING`, diff against the
official Yahoo box score for the same week. A systematic per-player offset
implicates Q2; a DST-only offset implicates Q3.

**Q2. Does the passing 2-point conversion score for the QB?** The league settings
page lists "2-Point Conversions: 2" once, without splitting passer from scorer.
`passing_2pt_conversions` is currently included in the sum on the assumption it
does.

**Q3. What exactly counts as "Points Allowed" for a DST?** Taking the opponent's
final score is the obvious reading, but leagues differ on whether points scored
against your offense by the opposing defense count. Getting this wrong shifts DST
scores by a full bucket.

### Design, still open

**Q4. Team defense is not implemented at all.** It needs a different nflverse
table (`load_team_stats`, since individual `def_sacks` are per-player while the
league scores a team unit) *and* Points Allowed derived from `load_schedules`
scores. `score_weekly_stats(stats, rules)` structurally cannot cover it — it
needs either a separate `score_team_defense()` or per-rule source declarations.
Deferred deliberately: building it now would bake in a guess at Q3 that is about
to become testable.

**Q5. Kicker scoring is implemented but unexercised.** The rules are encoded and
the columns verified to exist, but no kicker comparison has been sanity-checked
against a real Yahoo score.

**Q6. `Offensive Fumble Return TD` (6 pts) is knowingly unscored.** No clean
nflverse column. Rare enough to be near-noise. It is listed in
`LEAGUE_SCORING.unmapped` so it stays visible rather than silently counting zero.

**Q7. How stable are Sleeper's undocumented endpoints?** `api.sleeper.com`
projections/ADP are live but undocumented with no stability guarantee. Isolated
in `sources/sleeper.py` so a break is contained.

**Q8. Fuzzy match accuracy is unmeasured.** Build a labelled sample and measure
before trusting it. `MANUAL_OVERRIDE` exists as the escape hatch.

**Q9. What is the 2026 NFL game key?** 461 = 2025; 2026 unverified. Resolve at
runtime via `/game/nfl` rather than hardcoding.

## Next steps, in the order I would do them

1. **Submit the Yahoo application.** Longest lead time, nothing else depends on
   starting it. The README is written for this audience — see below.
2. **Create the Supabase project and run `supabase/migrations/0001_init.sql`.**
   Then `ff refresh --dsn <url>` locally to exercise the write path before any
   deploy. This is the highest-risk unverified code.
3. **Deploy the cron endpoint** and confirm Vercel's Python runtime works with
   Polars in the bundle.
4. **Scaffold the Next.js app** with Supabase Auth on the hard-coded email
   allowlist.
5. **In-season: run the Yahoo score diff** to close Q2 and Q3.
6. **Then team defense** (Q4), once Q3 is settled.

## Things that will bite you

- **`data/` is gitignored**, and `docs/data-sources.md` originally lived there —
  it was moved to `docs/` so it would be tracked. Do not put anything you want
  version-controlled under `data/`.
- **The token file is an account credential.** `oauth2.json` holds a live refresh
  token. Gitignored, written `0600`. In deployment it must live in server-side
  env vars only — **never** in a Next.js client bundle, which is an easy
  accident.
- **`CRON_SECRET` must be set** or `api/cron/refresh.py` returns 401 for
  everything. It fails closed on purpose; without it the endpoint is a public
  button.
- **RotoWire's feed is a ~5-item sliding window.** `injury_news` is the one
  append-only table because that history cannot be rebuilt from upstream.
- **nflverse applies stat corrections on Thursdays.** A Wednesday pull of last
  week's stats can still change.
- **Vercel Hobby allows daily cron only.** More frequent needs Pro.

## Note on the README

`README.md` has a second audience: a Yahoo reviewer deciding whether to approve
API access. It deliberately states the read-only guarantee and its enforcement
mechanism, the single-service-account model, the email allowlist, and that the
app never calls Yahoo (all Yahoo reads happen in the scheduled job, so audience
size does not affect request volume).

**If the scope changes — more users, a public view, anything written back to
Yahoo — update the README before the behaviour ships.** Being approved on a
description that no longer matches reality is the failure mode to avoid.
