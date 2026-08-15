# fantasy-football

A personal, non-commercial fantasy football analytics tool for **one private
Yahoo Fantasy league** that I play in, used by **two people** (me and one
league-mate). It is **strictly read-only**: it reads my league's settings and
results, combines them with free public NFL data, and produces analysis for my
own use. It does not modify league state, does not automate gameplay, and does
not redistribute Yahoo data.

> **Fantasy data provided by Yahoo Fantasy**

---

## At a glance

| | |
|---|---|
| **Purpose** | Personal analytics for one private league I am a member of |
| **Users** | 2 (the author and one league-mate) |
| **Commercial use** | None. Not a product, not hosted, no ads, no users beyond the two above |
| **Yahoo access needed** | **Read only** |
| **Writes to Yahoo** | **None.** No roster moves, no adds/drops, no trades, no lineup changes |
| **Data redistribution** | **None.** All data stays in a local SQLite file on my machine |
| **Deployment** | Runs locally from a terminal. No public server, no public endpoint |
| **Request volume** | Low. Responses are cached aggressively (league settings for 30 days) |

## What it does

Fantasy scoring is league-specific. The same stat line is worth different points
in different leagues, so generic "fantasy points" numbers published elsewhere
don't describe my league.

This tool solves that by reading my league's scoring settings **once**, turning
them into a scoring function, and applying that function to public NFL box
scores. That makes it possible to evaluate any player in the league's own
scoring terms — including players nobody has rostered — which is what makes
waiver-wire evaluation, week-to-week consistency analysis, and what-if lineup
scenarios possible.

Yahoo supplies the league truth (what the rules are, what happened). Free public
sources supply the statistical backbone.

## Which Yahoo endpoints are read, and why

All are `GET` requests against `https://fantasysports.yahooapis.com/fantasy/v2`.
This list is exhaustive — the client exposes no other Yahoo calls, and no
write-capable method exists anywhere in the codebase.

| Endpoint | Why it is needed |
|---|---|
| `league/{key}/settings` | **The core read.** Scoring rules and roster positions. Compiled once into the scoring function that everything else depends on. Cached 30 days. |
| `league/{key}/standings` | Team names and records, to label analysis with real teams. |
| `league/{key}/scoreboard;week={n}` | Weekly matchup results, to compare projected vs actual outcomes. |
| `league/{key}/draftresults` | Draft picks and cost, for post-draft value review. |
| `league/{key}/transactions` | Add/drop/trade history, to see how the league's player pool moved. |
| `league/{key}/players;status=...` | Which players are free agents vs rostered — a waiver evaluation is meaningless without knowing who is actually available. |
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

Yahoo does not publish rate limits. Rather than probe for the ceiling, this tool
caches aggressively in local SQLite, with TTLs matched to how often the data can
actually change (league settings 30 days, rosters 1 hour, live scoreboard 5
minutes). Throttled responses — which Yahoo returns as HTML rather than JSON —
are detected explicitly and backed off, not retried in a tight loop. Paginated
endpoints are walked at Yahoo's own 25-per-page limit with a hard page cap.

## Data sources and attribution

**Fantasy data provided by Yahoo Fantasy** — league settings, rosters,
standings, scoreboards, draft results, and transactions for the author's private
league. Used with permission of the league's members, read-only, not
redistributed.

**[nflverse](https://github.com/nflverse/nflverse-data)** — historical play-by-play,
weekly player stats, rosters, and depth charts, accessed via
[`nflreadpy`](https://github.com/nflverse/nflreadpy). Licensed
**[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)**. Underlying NFL data
is subject to its own terms.

**[Sleeper](https://docs.sleeper.com/)** — projections, ADP, and trending
add/drop signal, via their free public API. Non-commercial use.

**[RotoWire](https://www.rotowire.com/)** — NFL injury news via their public RSS
feed. Non-commercial use.

All public sources here are non-commercial-use only, which suits a personal tool.
None of this data is republished, resold, or exposed publicly.

## Status

Early scaffolding. The project structure, the free public data layer, and the
scoring engine's core are in place and tested. The Yahoo integration is stubbed
pending an API access application — which is why the free data layer is designed
to be fully usable without any Yahoo credentials.

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

`ff compare` scores every player's real box scores under this league's rules
(full PPR), then sets that against Sleeper ADP and current injury news — so
production and market price can be read together. It touches no Yahoo endpoint.

For the Yahoo layer (once API access is approved):

```bash
cp .env.example .env    # then fill in YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET
```

Yahoo rejects `localhost` redirect URIs, so this uses the out-of-band (`oob`)
flow: authorize in a browser, paste the code back into the terminal.

### A note on credentials

The Yahoo OAuth libraries persist a **live refresh token** to a JSON file in the
working directory. That is an account credential, not a config file. It is
gitignored (`oauth2.json`, `*token*.json`, `.env`) and written with `0600`
permissions. This repository is public and contains no credentials.

## Layout

```
src/ff/
├── cli.py           `ff compare`, `ff rules`. No credentials needed.
├── config.py        Settings from the environment. No secrets in code.
├── store.py         SQLite persistence + aggressive response cache.
├── yahoo/           OAuth (oob) and a read-only client. The only authed layer.
├── sources/         nflverse, Sleeper, RotoWire. No auth, independently testable.
├── scoring/         League settings -> scoring function -> scored stat tables.
├── analysis/        Player comparison for draft prep. Never imports yahoo/.
└── identity/        Yahoo ID <-> gsis_id crosswalk, with fuzzy-match fallback.
docs/
├── architecture.md  Layering, design rationale, open questions.
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
