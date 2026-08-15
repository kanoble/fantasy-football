# Fantasy Football App — Data Source Research

Researched 2026-08-15. All findings verified live on that date unless flagged.

## Verdict

A personal Yahoo-connected fantasy app is buildable. Yahoo supplies league truth
(scoring rules, rosters, waiver wire, transactions, draft results) read-only.
Free public sources supply the analytics layer (stats, projections, ADP, injuries).
The main engineering tax is joining Yahoo player IDs to everything else.

## Yahoo Fantasy Sports API

- Base: `https://fantasysports.yahooapis.com/fantasy/v2` — alive, OAuth 2.0.
- **Docs moved**: developer.yahoo.com/fantasysports now redirects to
  https://sports.yahoo.com/developer/ . Docs: /developer/docs/
- **Access is now approval-gated** (human review, no published SLA):
  https://sports.yahoo.com/developer/access/ — APPLY EARLY, it's a lead-time item.
- **Read access only.** Verbatim from the access page: "The Yahoo Fantasy Sports
  API currently provides read access only. Write access is not available at this
  time." You can petition for write in the application notes.
- Private leagues: readable if you are a member. Public leagues readable by anyone.
- Tokens: access token 1 hour, refresh token long-lived but may rotate; all refresh
  tokens revoked on password change.
- Redirect URI must be HTTPS; **localhost is rejected**. Use `oob` for a personal
  script, or ngrok/local-ssl-proxy for a web flow.
- No webhooks. Polling only.
- JSON via `?format=json` (default is XML). JSON is an awkward XML transform —
  numeric-string keys, mixed array/object shapes. Use a wrapper library.
- Players endpoint paginates at 25/page.
- Rate limits undocumented. Yahoo: "we may temporarily throttle or limit access."
  When throttled it returns non-JSON HTML that crashes parsers — handle it.
- Attribution required: "Fantasy data provided by Yahoo Fantasy" + logo + links.

### Endpoints that matter

```
league/{key}/settings                       # scoring settings + roster positions
league/{key}/standings
league/{key}/scoreboard;week={n}
league/{key}/draftresults                   # pick, round, cost, team, player
league/{key}/transactions;types={t}         # add/drop/trade log
league/{key}/players;status=A|FA|W|T|K      # waiver wire / free agents
league/{key}/players;player_keys=.../stats  # points UNDER LEAGUE SCORING
team/{key}/roster;week={n}                  # historical starters vs bench
```

Key detail: fantasy **points** only appear when queried in *league context*.
Outside it you get raw stat_id/value pairs.

Game key shortcut: use `nfl` instead of the numeric ID to always get the current
season (461 = 2025; 2026's number unverified — resolve at runtime via `/game/nfl`).

### Libraries

- Python: `yahoo_fantasy_api` (v2.12.3, Apr 2026) — best pick, has write methods.
  `yfpy` (17.0.0, Sep 2025) — read-only, best docs. `yahoofantasy` — nice CLI OAuth.
- TypeScript: `yfs-api` (v2.2.1, Jul 2026) — actively maintained, fully typed.
  The popular `yahoo-fantasy` (whatadewitt) has had no release since Apr 2024.

### Open questions

- Whether `draftresults` populates live mid-draft, and at what latency. Unverified.
  Yahoo's live draft runs through a separate draft client; some tools scrape the
  DOM via Chrome extension instead. **Prototype against a mock draft before
  committing to a live draft assistant.**
- Whether newly approved apps ever get write scope.

## Free data layer

### nflverse (the historical/statistical backbone)
- `nfl_data_py` is **deprecated and archived** (Sep 2025) → successor is
  **`nflreadpy`** (returns Polars, not pandas). R: `nflreadr`.
- Or skip the library — plain HTTP off GitHub releases:
  `https://github.com/nflverse/nflverse-data/releases/download/<tag>/<file>.csv`
- Available: play-by-play back to 1999, weekly player stats (150 cols), rosters,
  weekly rosters, depth charts, snap counts, Next Gen Stats, PFR advanced, injuries,
  schedules, draft picks, trades.
- Cadence: rosters + depth charts daily 07:00 UTC; pbp/stats nightly after game days
  (refresh Thursday nights for stat corrections); schedules every 5 min in-season.
- License CC-BY-4.0. Attribution required. Underlying NFL data has its own terms.

### Sleeper (free, no auth, best free projections)
- Documented: `https://api.sleeper.app/v1/` — players, state, trending add/drop
  (`/players/nfl/trending/add?lookback_hours=24`). Limit ~1000 calls/min. Non-commercial.
- **Undocumented but live** — `https://api.sleeper.com/`:
  - `stats/nfl/player/{id}?season_type=regular&season=2025&grouping=week` — 63 stat fields/week
  - `projections/nfl/player/{id}?season_type=regular&season=2025&grouping=week` — RotoWire projections
  - `projections/nfl/2026?season_type=regular&position[]=RB&order_by=adp_dd_ppr` — season
    projections + ADP in 7 formats (ppr, half, std, 2qb, dynasty variants)
  - No stability guarantee. Use `order_by` or you get placeholder rows.

### Other
- **RotoWire injury RSS** (verified current):
  `https://www.rotowire.com/rss/news.php?sport=NFL&view=injuries`
  — only 5 items per fetch, so poll every few minutes and dedupe.
- **FantasyPros consensus rankings, free & daily** via DynastyProcess:
  `https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_fpecr_latest.csv`
  (5,849 rows, ecr + stdev + best/worst, redraft/dynasty/BB/SF/IDP).
- **ESPN v3** (undocumented, works, no auth):
  `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/players?scoringPeriodId=0&view=players_wl`
  — gives free `ownership.percentOwned`.
- **Fantasy Football Calculator ADP** — free, commercial use explicitly permitted:
  `https://fantasyfootballcalculator.com/api/v1/adp/ppr?teams=12&year=2026` (unverified live).
- Paid, only if consolidation is worth it: Tank01 ~$10/mo (custom-scoring fantasy
  points + odds + news), API-Sports ~$15/mo (injuries + odds).
  SportsDataIO's free trial returns **scrambled fake data** — useless for building.
  Sportradar is enterprise-only with no public pricing.

## The player ID problem

Public crosswalks have **zero Yahoo IDs for the 2025 and 2026 rookie classes**
(0 of 171 and 0 of 141 skill players). Confirmed across DynastyProcess
`db_playerids.csv`, nflverse `roster_2026.csv`, and the FantasyPros ECR file.
Sleeper/ESPN/gsis IDs are 95%+ complete for the same players.

Mitigation: pull the player universe from Yahoo's own API (you get Yahoo IDs
natively), then fuzzy-match to `gsis_id` on normalized name + position + team +
birthdate. `roster_2026.csv` is the best join target for active players
(gsis_id 100%, espn/sleeper/sportradar/pfr ~82%).

Crosswalk source:
`https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv`

Note: missing values in the crosswalk are the literal string `"NA"`, not empty.
Naive emptiness checks will report 100% coverage.

## Licensing summary

Nearly everything free here is non-commercial-only (Sleeper, FantasyPros/
DynastyProcess, RotoWire, ESPN's undocumented endpoints). Fine for a personal app
shared with a friend. All of it needs re-sourcing if it ever ships commercially.
Yahoo requires visible attribution.
