# Handover

State of the project as of **2026-08-16**. Read this first, then
[architecture.md](architecture.md) for design rationale and
[scoring-rules.md](scoring-rules.md) for the league's scoring.

Repo: https://github.com/kanoble/fantasy-football (public)

---

## The one-paragraph version

A private, read-only analytics app for one 12-person family Yahoo fantasy
league. Its central idea: read the league's scoring settings once, compile them
into a pure function, and apply that to nflverse box scores — which scores
*every player in the NFL* in this league's terms, not just rostered ones. The
backend is now live and hosted: a Python pipeline publishes to Supabase Postgres
on a daily Vercel Cron, and 174,201 scored player-weeks are sitting in the
database right now. **There is no UI yet** — that is the next body of work. The
Yahoo integration is still stubbed, pending an API access application that has
been submitted and is awaiting a decision.

## Live infrastructure

Everything below was provisioned and verified on 2026-08-16.

| Thing | Value |
|---|---|
| Vercel project | `noble21/fantasy-football` (Hobby) |
| Production URL | https://fantasy-football-red.vercel.app |
| Supabase resource | `supabase-rose-cave`, project ref `sebizyhnwgarnbukqkxu` |
| Cron | `/api/cron/refresh`, daily 11:00 UTC |
| Database size | 78 MB of the 500 MB free tier |

**The Vercel account is deliberately a separate personal one, not
`group18-projects`.** Vercel Pro has no way to restrict a project from other
team members: project-level access requires the Contributor role, which is
Enterprise-only. Any Group 18 member would therefore have been able to read this
project's environment variables, including the Supabase service-role key. The
original `kanoble` login cannot host it either — its personal account was
converted into the Group 18 team, so `vercel switch` returns
`personal_scope_not_allowed`. Hence a fresh signup under `kanoble@gmail.com`.

**Supabase is Vercel-managed, so reach its dashboard through Vercel**, not by
logging in at supabase.com — a direct login lands in a different account where
this project is not listed:

```bash
vercel integration open supabase --scope noble21
```

## What works right now

Verified live on 2026-08-16.

| Thing | State |
|---|---|
| `ff compare "A" "B"` | Working. Scored history, consistency, ADP, injury status. |
| `ff rules` | Working. Prints the league ruleset and its fingerprint. |
| `ff refresh` | **Working against real Postgres.** Full and incremental both exercised. |
| `api/cron/refresh` deployed | **Working.** 401 without the secret, 200 and a full run with it. |
| Daily cron | Registered and enabled. |
| Supabase schema | Migrations `0001` and `0002` applied. 6 tables + allowlist. |
| Google sign-in | Provider enabled; signups disabled; allowlist enforced in RLS. |
| `scripts/smoke_test.py` | Working. All 4 no-auth sources green. |
| `scoring/`, `sources/`, `analysis/` | Fully implemented. |
| Test suite | 50 tests, all passing. `uv run pytest` |
| Lint | Clean. `uv run ruff check .` |
| **Web UI** | **Does not exist.** |

Published data as of the last run: 174,201 scored player-weeks, 10,146 players,
3,251 ADP rows, 5 injury items.

## The UI is the next body of work

The expensive half is done, and the read path is thinner than it looks. Every
metric `ff compare` produces was reproduced exactly as plain SQL over
`scored_weekly_stats` — 2025 Bijan Robinson returns 17 games / 370.8 / 21.8 ppg
/ 10.3 std / 39.9 best / 9 ceiling weeks / 3 floor weeks by both routes. So the
UI needs **no Python at request time**, no nflverse download, no Polars, no
scoring engine. It queries a table.

Three things to know before starting:

1. **`compare_players()` cannot be reused as-is.** It calls
   `nflverse.load_weekly_stats()` and scores in-process at request time. Correct
   for a CLI, wrong for a web app. The queries get written fresh against the
   published tables.
2. **Next.js goes at the repo root**, alongside `api/`, `src/ff/` and
   `pyproject.toml`. This was tested, not assumed: a throwaway deployment with
   Next.js App Router, a root `pyproject.toml` and `api/cron/refresh.py` served
   all three routes correctly, detected `nextjs` as the framework, registered
   the cron, *and* installed the Python dependencies. The "framework preset takes
   precedence over file-based functions" rule applies only to **Python** presets.
3. **Query by `player_id`, not `player_name`.** Resolve the name in
   `player_index` (indexed on `norm_name`), then hit `scored_weekly_stats` via
   `idx_scored_player_season`. There is no index on `player_name`.

## Auth and access control

Two independent barriers. Neither depends on the other.

1. **Signups are disabled** in Supabase, so no new account can be created.
2. **RLS checks an allowlist.** `league_members` holds the permitted addresses;
   `is_league_member()` compares the lowercased `email` claim from the JWT.
   A token whose email is absent reads **zero rows from every table**.

`league_members` currently holds one address: `kanoble@gmail.com`. Adding the
other eleven is a plain `INSERT`; no migration needed.

Verified with HS256 tokens signed by the project JWT secret: anonymous,
non-allowlisted, and allowlisted-with-different-casing all behave as intended
across every table, and members cannot enumerate each other's addresses.

Sign-in is **Google OAuth**. Email/password was rejected because Supabase's
built-in mail service sends only 2 messages per hour and is explicitly not for
production — magic links and password resets would have run straight into it,
requiring custom SMTP as an extra service to run. Google needs no email at all.

The Google Cloud consent screen is External/Testing with a test-user list.
**Treat that list as a convenience gate, not a security control**: publishing the
app to Production silently disables it and lets any Google account through. The
database allowlist is what actually protects the data.

## What is deliberately stubbed

All raise `NotImplementedError`. None block current functionality.

| Stub | Needs |
|---|---|
| `scoring.parse_league_settings` | One real `league/{key}/settings` payload. **Not blocking** — `LEAGUE_SCORING` is hand-built from the settings page, so this is a *validation* path. |
| `YahooClient._page_count` | A real players-endpoint payload to learn Yahoo's nesting. |
| `YahooClient.game_key` | A real `/game/nfl` payload. |
| `IdentityResolver._exact_match` | Crosswalk lookup, guarding the literal `"NA"` sentinel. |
| `IdentityResolver._fuzzy_match` | Position-gated fuzzy match. See "the rookie problem". |
| `IdentityResolver.resolve_many` | Vectorised `resolve()`. |

Yahoo payload shapes were **deliberately not guessed**. Yahoo's JSON is a
mechanical transform of XML — numeric-string keys, collections that collapse
from list to dict when they hold one item. Guessing produces confident wrong
parsers. Capture one real payload into `tests/fixtures/` and implement against
it.

## Unverified — treat with suspicion

Two items that used to head this list are now verified and have moved to "what
works": the database write path, and the deployed cron endpoint. What remains:

1. **Yahoo stat IDs** in `YAHOO_STAT_ID_TO_NFLVERSE` are the widely-circulated
   values, never checked against a live payload. Not on the critical path.

2. **Fuzzy identity matching accuracy is unmeasured.** The *need* is confirmed
   (below); how well it works is not.

3. **Supabase redirect URL configuration is unverified.** Site URL and the
   redirect allowlist were set by hand and are not exposed on any API this
   project can read. A mistake surfaces at first sign-in as a bounce to a dead
   localhost address *after* Google succeeds — a confusing failure, because the
   Google half looks fine.

## Upstream data has holes, and the schema rejects them

Found by running the write path for the first time. Each of these aborted the
whole `COPY`, because a constraint violation kills the transaction rather than
dropping a row. All three are now filtered with a `log.warning` — a jump in the
counts means upstream changed shape.

| Table | Bad rows | What they are |
|---|---|---|
| `player_index` | 1 of 10,147 | Roster entry with no `player_name` (gsis_id `00-0031605`, a 2016 Viking). Both name columns are `NOT NULL`. |
| `scored_weekly_stats` | 175 across the decade | All-zero placeholder per team-week with no `player_id`, which is part of the primary key. |
| `adp_projections` | — | Not a data hole: Polars inferred `Null` for `injury_status` from the first rows and then failed on `"Questionable"`. Schema is now declared explicitly. |

That third one deserves emphasis: it depended on how many *healthy* players
happened to sort first, so it would have passed all preseason and started
failing mid-season.

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
| **nflreadpy + Polars** | `nfl_data_py` is deprecated and archived (Sep 2025). |
| **Live draft assistant: cut** | It was the only feature gated on unverified Yahoo behaviour. Replaced by draft-prep comparison. |
| **Full PPR** | The league's only deviation from Yahoo defaults (1.0/reception vs 0.5). |
| **`StatRule.columns` is a tuple** | Fumbles Lost, 2-pt conversions and Block Kick each map to a *sum* of three nflverse columns. A one-column model undercounts fumbles by ~2/3 silently. |
| **Regular season only** | Postseason rows at weeks 19-22 inflated Puka Nacua's 2025 from 16 games/375.0 to 19/452.6. |
| **Sleeper `adp_ppr`, not `adp_dd_ppr`** | The latter is not a real field and silently returns unordered placeholder rows. |
| **Incremental refresh + rules fingerprint** | Completed seasons never change. A ruleset change is *detected* rather than assumed not to happen. |
| **Store scored output + the 22 rule columns** | Enough to *explain* a score, not just assert it. These tables are a cache; nflverse is the system of record. |
| **Vercel Cron** | Daily 11:00 UTC, after nflverse's ~07:00 roster refresh. Hobby allows daily only. |
| **SQLite → Supabase** | Driven by going multi-user and hosted, not by data volume. |
| **Separate personal Vercel account** | Pro cannot gate a project from teammates; Contributor is Enterprise-only. See "Live infrastructure". |
| **`POSTGRES_URL_NON_POOLING`, not `POSTGRES_URL`** | The refresh `COPY`s inside one explicit transaction and psycopg3 issues prepared statements by default. Neither survives Supavisor's transaction pooler on :6543. |
| **Resolve the DSN in code, don't copy the secret** | `config.resolve_dsn()` prefers `SUPABASE_DB_URL`, falls back to the integration-managed variable, so a Supabase credential rotation propagates by itself. |
| **Allowlist enforced in RLS, not just at signup** | A config toggle fails open; a policy fails closed. |
| **Google OAuth, not email** | Supabase's built-in mailer is 2 messages/hour and not for production. |
| **Next.js at the repo root** | Tested, see "The UI is the next body of work". |

## Open questions

### Blocking the Yahoo integration

**Q1. Will API access be approved, and when?** **Submitted as of 2026-08-16**,
awaiting a decision. Approval-gated, human review, no published SLA. Nothing
else depends on it — the whole free-data layer works without it, and the UI can
be built and shipped before any answer arrives.

### To be answered empirically once the season is live

Score a completed week with `LEAGUE_SCORING`, diff against the official Yahoo
box score for the same week. A systematic per-player offset implicates Q2; a
DST-only offset implicates Q3.

**Q2. Does the passing 2-point conversion score for the QB?** The settings page
lists "2-Point Conversions: 2" once, without splitting passer from scorer.
`passing_2pt_conversions` is currently included on the assumption it does.

**Q3. What exactly counts as "Points Allowed" for a DST?** Leagues differ on
whether points scored against your offense by the opposing defense count.
Getting this wrong shifts DST scores by a full bucket.

### Design, still open

**Q4. Team defense is not implemented at all.** Needs `load_team_stats` (the
league scores a team unit, but `def_sacks` is per-player) *and* Points Allowed
derived from `load_schedules`. `score_weekly_stats(stats, rules)` structurally
cannot cover it. Deferred deliberately: building it now would bake in a guess at
Q3 that is about to become testable.

**Q5. Kicker scoring is implemented but unexercised.** Rules encoded, columns
verified to exist, no kicker comparison sanity-checked against a real Yahoo
score.

**Q6. `Offensive Fumble Return TD` (6 pts) is knowingly unscored.** No clean
nflverse column. Listed in `LEAGUE_SCORING.unmapped` so it stays visible.

**Q7. How stable are Sleeper's undocumented endpoints?** `api.sleeper.com`
projections/ADP are live but undocumented. Isolated in `sources/sleeper.py`.

**Q8. Fuzzy match accuracy is unmeasured.** Build a labelled sample and measure
before trusting it. `MANUAL_OVERRIDE` exists as the escape hatch.

**Q9. What is the 2026 NFL game key?** 461 = 2025; 2026 unverified. Resolve at
runtime via `/game/nfl` rather than hardcoding.

## Next steps, in the order I would do them

1. **Scaffold the Next.js app** at the repo root with Supabase Auth (Google).
   First page: the player comparison, built on SQL against `scored_weekly_stats`.
2. **Verify the redirect URL configuration** at first sign-in (item 3 under
   Unverified).
3. **Add the other eleven league members** to `league_members` once there is
   something worth showing them.
4. **In-season: run the Yahoo score diff** to close Q2 and Q3.
5. **Then team defense** (Q4), once Q3 is settled.

## Things that will bite you

- **The service-role key bypasses RLS entirely.** It is now the single thing
  between the whole database and the internet. Everything in "Auth and access
  control" is irrelevant if it reaches the browser, which is an easy Next.js
  accident. Server components, route handlers and the Python job only.

- **`vercel env add` can store an empty value.** Piping a secret into it in
  non-interactive mode registered `CRON_SECRET` with a zero-length value and
  still printed "Added Environment Variable". Because `_authorized()` fails
  closed, the cron would have returned 401 forever while appearing to run. Set
  secrets via the REST API, and **verify by pulling the value back and checking
  its length** — do not trust the success message. (CLI was v54.11.1 against a
  current v59.x; upgrading may fix it.)

- **`disable_signup` blocks the *first* OAuth sign-in too**, because that
  creates a user. `kanoble@gmail.com` has been pre-created with a confirmed
  email so Google links to the existing user instead. Any *new* league member
  needs the same treatment, or signups temporarily re-enabled.

- **Env var changes need a redeploy** before functions see them.

- **Do not log in at supabase.com.** The project is Vercel-managed; a direct
  login lands in an empty personal account.

- **`data/` is gitignored.** Do not put anything version-controlled under it.

- **The Yahoo token file is an account credential.** `oauth2.json` holds a live
  refresh token. In deployment it must live in server-side env vars only —
  never in a client bundle.

- **RotoWire's feed is a ~5-item sliding window.** `injury_news` is the one
  append-only table because that history cannot be rebuilt from upstream.

- **nflverse applies stat corrections on Thursdays.** A Wednesday pull of last
  week's stats can still change.

- **nflverse has no data for the current season during preseason.** The refresh
  logs `skipping season 2026: ... 404` and carries on. That is expected, not a
  failure.

- **Vercel Hobby allows daily cron only.** More frequent needs Pro.

## Note on the README

`README.md` has a second audience: a Yahoo reviewer deciding whether to approve
API access. It deliberately states the read-only guarantee and its enforcement
mechanism, the single-service-account model, the email allowlist, and that the
app never calls Yahoo (all Yahoo reads happen in the scheduled job, so audience
size does not affect request volume).

As of 2026-08-16 the allowlist claim is stronger than when it was written: it is
now enforced in the database, not only at the auth layer. Two details in the
README have drifted and are worth a small edit before a reviewer reads it:

- It describes the allowlist as **"hard-coded"**. It is now a `league_members`
  table, which is more auditable but no longer literally hard-coded.
- "No signup" is now true in the strict sense — Supabase signups are disabled —
  which the README asserted before it was the case.

**If the scope changes — more users, a public view, anything written back to
Yahoo — update the README before the behaviour ships.** With an application now
pending, being approved on a description that no longer matches reality is the
failure mode to avoid.
