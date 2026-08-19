# fantasy-football

A private, non-commercial fantasy football analytics app for **one Yahoo Fantasy
league** that I play in. It is a family league — no money changes hands, it is
played for bragging rights — and the app is used by that league's own members,
behind a login. **Everyone who can log in is a member of the league whose data
they are viewing.** It is **strictly read-only**: it reads the league's settings
and results, combines them with free public NFL data, and shows analysis back to
the league. It does not modify league state, does not automate gameplay, and does
not redistribute Yahoo data.

> **Fantasy data provided by Yahoo Fantasy**

---

## At a glance

| | |
|---|---|
| **Purpose** | Private analytics for one league I am a member of |
| **Audience** | The members of that same league — my family, 12 people. Everyone with access is in the league |
| **Access control** | Fixed allowlist of email addresses, enforced in the database. Signups are disabled: no signup form, no invite links, no self-service access |
| **Public access** | **None.** All league data sits behind authentication; unauthenticated visitors see nothing from Yahoo |
| **Commercial use** | None. No money in the league, no ads, no payments, nothing sold, not a product |
| **Yahoo access needed** | **Read only** |
| **Writes to Yahoo** | **None.** No roster moves, no adds/drops, no trades, no lineup changes |
| **Data redistribution** | **None.** Yahoo data is shown only to the closed group above and never published |
| **Deployment** | Private web app (Vercel + Supabase), plus a local CLI for development |
| **Request volume** | Low. A scheduled job polls on a fixed cadence; the app itself never calls Yahoo |

## What it does

Fantasy scoring is league-specific. The same stat line is worth different points
in different leagues, so generic "fantasy points" published elsewhere don't
describe my league.

This app reads my league's scoring settings **once**, turns them into a scoring
function, and applies that function to public NFL box scores. That makes it
possible to evaluate any player in the league's own scoring terms — including
players nobody has rostered — which is what makes draft preparation, waiver-wire
evaluation, week-to-week consistency analysis, and what-if lineup scenarios
possible.

Yahoo supplies the league truth (what the rules are, what happened). Free public
sources supply the statistical backbone.

## How Yahoo data is accessed and protected

This section is the important one, so it is explicit.

**Everyone with access is a league member.** The app shows one league's data to
the people who play in that league. Nobody sees data from a league they are not
in, and there is no path by which league data reaches anyone outside it.

**A single service account, disclosed.** Rather than have each member authorize
their own Yahoo access, one scheduled server-side job authenticates as me, reads
the league once, and stores the results. Other members never authenticate to
Yahoo and never obtain Yahoo credentials of their own — they read already-fetched
data from our own database. This is a deliberate choice to *minimise* Yahoo
credentials in circulation and to keep request volume flat, not a workaround: as
league members, they would each be entitled to read this league themselves.

**Access is a fixed allowlist.** Login is restricted to a fixed list of email
addresses — the league's members — held in a `league_members` table and enforced
by database row-level security: a session whose email is not on that list reads
zero rows from every table. Account signups are disabled at the auth provider, so
there is no signup form, no invite link, and no self-service path to access.
Adding a person is a deliberate administrative act by me, on the server side.

**The app never calls Yahoo.** All Yahoo reads happen in a scheduled background
job, never in response to a page view. A user refreshing a page cannot generate a
Yahoo request. This bounds request volume to a fixed cadence no matter how many
family members use the app, and it is why the load on Yahoo is unaffected by the
audience size.

**Credentials stay server-side.** The OAuth refresh token lives in server
environment variables, is never committed to this repository, and is never sent
to the browser. No Yahoo credential is reachable from client-side code.

**No public surface.** There is no anonymous view of any Yahoo-derived data, no
public API, and no sharing link. Every route that touches league data requires an
authenticated session belonging to an allowlisted address.

## Which Yahoo endpoints are read, and why

All are `GET` requests against `https://fantasysports.yahooapis.com/fantasy/v2`.
This list is exhaustive — the client exposes no other Yahoo calls, and no
write-capable method exists anywhere in the codebase.

| Endpoint | Why it is needed |
|---|---|
| `league/{key}/settings` | **The core read.** Scoring rules and roster positions. Compiled once into the scoring function everything else depends on. Cached 30 days. |
| `league/{key}/standings` | Team names and records, to label analysis with real teams. |
| `league/{key}/scoreboard;week={n}` | Weekly matchup results, to compare projected vs actual outcomes. |
| `league/{key}/draftresults` | Draft picks and cost, for post-draft value review. Read after the draft, not during. |
| `league/{key}/transactions` | Add/drop/trade history, to see how the league's player pool moved. |
| `league/{key}/players;status=...` | Which players are free agents vs rostered — waiver evaluation is meaningless without knowing who is available. |
| `team/{key}/roster;week={n}` | Historical starters vs bench, for start/sit review. |
| `game/nfl` | Resolve the current season's game key at runtime instead of hardcoding it. |

**Not used:** any endpoint that changes state. The Yahoo Fantasy Sports API is
read-only as of 2026, and this project has no use for write access even if it
became available.

### How the read-only guarantee is enforced

* `src/ff/yahoo/client.py` has exactly one network egress point, `_get`, which
  issues only `GET`.
* No method on the client corresponds to a mutating operation.
* The `yahoo_fantasy_api` library does expose write methods; this project does
  not call them and wraps the API with its own restricted surface instead.

### Rate limiting and good citizenship

Yahoo does not publish rate limits. Rather than probe for the ceiling, this app
caches aggressively, with TTLs matched to how often the data can actually change
(league settings 30 days, rosters 1 hour, live scoreboard 5 minutes). Throttled
responses — which Yahoo returns as HTML rather than JSON — are detected
explicitly and backed off, not retried in a tight loop. Paginated endpoints are
walked at Yahoo's own 25-per-page limit with a hard page cap.

Because all Yahoo access happens in a scheduled job rather than per page view,
adding users does not add Yahoo requests.

## Architecture

```
Python pipeline (scheduled)          Supabase Postgres          Vercel
───────────────────────────          ─────────────────          ──────
nflverse parquet ──┐                 scored weekly stats        Next.js app
Sleeper ADP  ──────┼─→ score with →  player index          →    (Supabase Auth)
RotoWire RSS ──────┤   league rules  adp / projections
Yahoo (read-only) ─┘                 injury news
```

The Python side does ingestion and scoring, where `nflreadpy` and Polars have no
real equivalent elsewhere. The web app only ever reads our own database.

## Data sources and attribution

**Fantasy data provided by Yahoo Fantasy** — league settings, rosters, standings,
scoreboards, draft results, and transactions for my private league. Read-only,
shown only to that league's own members, never redistributed.

**[nflverse](https://github.com/nflverse/nflverse-data)** — historical
play-by-play, weekly player stats, rosters, and depth charts, accessed via
[`nflreadpy`](https://github.com/nflverse/nflreadpy). Licensed
**[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)**. Underlying NFL
data is subject to its own terms.

**[Sleeper](https://docs.sleeper.com/)** — projections, ADP, and trending
add/drop signal, via their free public API. Non-commercial use.

**[RotoWire](https://www.rotowire.com/)** — NFL injury news via their public RSS
feed. Non-commercial use.

All public sources here are non-commercial-use only, which suits a private family
app. None of this data is republished, resold, or exposed publicly.

## Status

Working today, with no credentials required:

* the scoring engine, compiled from this league's real rules (full PPR)
* the free public data layer (nflverse, Sleeper, RotoWire)
* `ff compare`, draft-prep player comparison

Live: the hosted app. The scoring pipeline runs on a daily schedule and
publishes scored player-weeks to Supabase Postgres, and a Next.js web app reads
them — a draft board, player pages, a comparison view and a value chart — behind
Google sign-in and the access controls described above.

Pending: the Yahoo integration, which is stubbed behind an API access
application. The free data layer is deliberately designed to work without any
Yahoo credentials, so the app is useful either way.

## Getting started

Requires [uv](https://docs.astral.sh/uv/) and Python 3.11+.

```bash
uv sync

# Compare players for draft prep, in this league's scoring terms.
# Requires NO credentials of any kind.
uv run ff compare "Bijan Robinson" "Jahmyr Gibbs"
uv run ff rules

# Verify the free data layer end to end.
uv run python scripts/smoke_test.py

uv run pytest
uv run ruff check .
```

For the Yahoo layer (once API access is approved):

```bash
cp .env.example .env    # then fill in YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET
```

Yahoo rejects `localhost` redirect URIs, so this uses the out-of-band (`oob`)
flow: authorize in a browser, paste the code back into the terminal.

### A note on credentials

The Yahoo OAuth libraries persist a **live refresh token** to a JSON file during
local development. That is an account credential, not a config file. It is
gitignored (`oauth2.json`, `*token*.json`, `.env`) and written with `0600`
permissions. In deployment it lives in server-side environment variables only.
This repository is public and contains no credentials.

## Layout

```
src/ff/
├── cli.py           `ff compare`, `ff rules`. No credentials needed.
├── config.py        Settings from the environment. No secrets in code.
├── store.py         Local persistence + response cache.
├── yahoo/           OAuth (oob) and a read-only client. The only authed layer.
├── sources/         nflverse, Sleeper, RotoWire. No auth, independently testable.
├── scoring/         League settings -> scoring function -> scored stat tables.
├── analysis/        Player comparison for draft prep. Never imports yahoo/.
└── identity/        Yahoo ID <-> gsis_id crosswalk, with fuzzy-match fallback.
docs/
├── architecture.md  Layering, design rationale, open questions. Start here.
├── scoring-rules.md The league's scoring settings and how they map to data.
└── data-sources.md  Verified API research this project is built on.
scripts/
└── smoke_test.py    Proves the free data layer works, with no credentials.
```

See [docs/architecture.md](docs/architecture.md) for why the scoring function
sits at the center of the design.

## License

MIT for this project's own code. The data it reads is governed by the terms of
each respective provider, listed above.
