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
database right now. **There is still no UI, but it is now designed** — a
direction is chosen and specified down to fonts and sort semantics, so the next
session builds rather than decides. See "The UI is the next body of work". The
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

## Working locally

Two files hold everything needed to talk to the live infrastructure, and both
are gitignored, so they do not survive a fresh clone:

| File | Rebuild with |
|---|---|
| `.vercel/project.json` | `vercel link --scope noble21 --project fantasy-football --yes` |
| `.env.local` | `vercel env pull` (after linking) |

### Git and deployment

**Commit directly to `main`.** History here is linear and this is a solo repo;
do not create a feature branch unless there is a specific reason, and if there
is, say what it is rather than branching by reflex. When work does warrant a
branch, it gets merged by PR.

**The deliberation belongs at push time, not commit time.** Vercel builds
production from `main`, so `git push` ships. Commits are cheap and local;
pushing is the outward-facing step worth confirming first.

### Three things that will otherwise cost you time

- **Most `vercel` commands need `--scope noble21`.** The CLI's current scope is
  the personal account; the project lives in the `noble21` team. Commands
  without it fail with "Deployment belongs to a different team".
- **`config.py` calls `load_dotenv()`, which reads `.env` — not `.env.local`.**
  So a local `ff refresh` does not pick up the pulled credentials on its own:

  ```bash
  export POSTGRES_URL_NON_POOLING="$(grep '^POSTGRES_URL_NON_POOLING=' .env.local | cut -d= -f2- | tr -d '"')"
  uv run ff refresh
  ```

- **`vercel env pull` appends `.env*` to `.gitignore`.** That line overrides the
  deliberate `!.env.example` negation higher up. Revert it; `.env.local` is
  already covered by `.env.*`.

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
| Test suite | 56 tests, all passing. `uv run pytest` |
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

### Scope: draft prep first

Chosen deliberately on 2026-08-16. Drafts are weeks away, the data for it exists
today, and nflverse has no 2026 rows yet — so in-season features have nothing to
render. Everything below serves "who should I take at my pick".

Note what this rules out: **the app knows nothing about the league itself.**
There are no rosters, matchups, standings or team names in the schema, because
all of that is Yahoo. No screen can say *your team* yet. The architecture is
player-centric so the league layer arrives later as an addition, not a redesign.

### Routes

Four, and anything else is a filter or a sort on one of them.

| Route | The question it answers | Reads |
|---|---|---|
| `/login` | The only route outside the auth boundary. Google sign-in. | — |
| `/` | **The board.** Who is worth taking, and who is priced below what they did? | `adp_projections` ⋈ `scored_weekly_stats`, ~923 rows |
| `/player/[id]` | What did they do week by week, and why is that score what it is? | `scored_weekly_stats` via `idx_scored_player_season` |
| `/compare?ids=…` | A or B. | same tables, 2–3 `player_id`s |

**Search is a control, not a route.** `player_index` is 10,146 rows indexed on
`norm_name`, which is an exact-match index. A command-bar that resolves a name
fits it; a typeahead does not, and would need a `pg_trgm` index added first.

### Design decisions, settled — do not relitigate

The board is a **distribution plot, not a points-per-game table**. Each of a
player's weeks is a dot; the app's whole thesis is that a 17-point average built
from 8-and-26 is a different asset from one built from 16-and-18, and averaging
throws that away. Three directions were mocked and this one was chosen.

| Decision | Why |
|---|---|
| **Fixed axis, 0–56** | Every row on one scale, or a tight end looks like a running back. 56 clears Gibbs's 55.4-point week 12, the largest score in the published set. |
| **Median, not mean** | Taylor's 49.6-point week drags his mean to 21.3 against a median of 16.9. The mean describes a season he mostly did not have. |
| **Band is the IQR** | Forced by the median — an SD band around a median mixes two notions of centre, and the SD is vulnerable to the same outliers. |
| **Rows expand to a game log** | The 22 stored rule columns let a week be shown as arithmetic. Bijan's week 17: `195×0.1 + 1×6 + 5×1.0 + 34×0.1 + 1×6 = 39.9`, matching the stored value exactly. |
| **"Safest floor" sorts on the 25th percentile, not IQR width** | Sorting on spread alone rewards being *consistently bad*: it ranked Jefferson (12.5 median) third. The floor encodes level and reliability together. The IQR column still sorts by raw width. |
| **Libre Franklin for text, IBM Plex Mono for figures** | Kevin's working typeface, and it suits the subject. But it has **no `tnum` feature and proportional digits** — `1` is 438 units against `0` at 675 — so numeric columns jitter. Plex Mono is genuinely tabular. Both OFL; in Next.js both come from `next/font/google`. |
| **Desktop-first** | The draft happens on a multi-monitor setup, so density is a feature. Mobile matters for in-season and gets its own design rather than this one reflowed. |

Published mockups, both with live data:

- Three directions and the route map — https://claude.ai/code/artifact/e83a01f2-b1f6-46ee-8049-c2a349f8a06b
- The build spec for the chosen direction — https://claude.ai/code/artifact/0171c074-a92e-4a3f-a452-69e2b4794c48

### Three row states the board must handle

Found by querying the live tables, not by imagining edge cases.

1. **Rookie** — a price with no past. Jeremiyah Love is ADP 25.5 with a 238.5
   projection and no NFL snaps; five of the top 100 are like this. Must look
   deliberately empty, not broken.
2. **Unmatched** — an empty row that is a lie. A name that resolved to nobody,
   or to the wrong person. Identical to a rookie on screen unless designed
   apart, which is why they carry different labels.
3. **Flagged** — `injury_status` is null for everyone healthy and a string
   otherwise. Nacua and McCaffrey both sit in the top five carrying one.

### Still open on the UI

- **`pipeline_meta` has RLS enabled and no read policy**, so the app cannot read
  it and a "data as of…" line is impossible today. The schema comment only
  documents `pipeline_runs` as deliberately closed, so this looks like an
  oversight rather than a decision. A staleness indicator needs a policy.
- **The 20-point ceiling and 10-point floor are inherited from the CLI**
  (`CEILING_THRESHOLD`, `FLOOR_THRESHOLD` in `analysis/compare.py`). Reasonable
  for a skill player, wrong for a quarterback. They probably want to vary by
  position once quarterbacks are on the board.
- **~923 players have an ADP.** That many absolutely-positioned plots needs
  virtualised rows or pagination; the mockup shows fifteen.
- **Position filter and search** are controls on the board, not new routes.

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
   (below); how well it works is not. Note that the ADP-side name match has now
   been given a position gate after it resolved three top-40 players to their
   namesakes — see "Namesakes broke the ADP join". The Yahoo-side resolver has
   not had the same treatment because it is still stubbed.

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

## Namesakes broke the ADP join (found and fixed 2026-08-16)

Worth reading even though it is fixed, because the failure mode will recur
anywhere else names are matched.

`attach_player_ids` joined ADP rows to players on normalised name alone and then
called `.unique(subset="norm_name")`, which keeps an **arbitrary** row among
duplicates. `player_index` holds **143 normalised names shared by more than one
player**, so the result was silently wrong for exactly the players a draft board
is about:

| Player | ADP | Resolved to |
|---|---|---|
| Justin Jefferson | 11.0 | a Browns **linebacker** of the same name |
| Josh Allen | 23.1 | an offensive lineman |
| DeVonta Smith | 38.3 | a defensive back |

159 rows resolved across a position boundary. **19 of those inherited a
stranger's stat line**, which is the worse half — an empty row reads as missing,
a wrong row reads as fact. "Tyler Davis" was showing a Rams defensive lineman's
16 games under a Packers tight end's name.

The fix ranks candidates by position agreement, then most recent season, then
`player_id`. That last tier is not decoration: non-determinism is what let this
hide, and a rerun on unchanged input must not produce a different answer. A small
alias table folds `FB`/`HB` onto `RB` and `PK` onto `K`, so a real match is not
rejected over a label difference between Sleeper and nflverse.

Two things to know:

- **This was the `IdentityResolver._fuzzy_match` problem arriving via a path
  that was not stubbed.** The stub list below still describes the Yahoo-side
  resolver; the same position gate belongs there when it is implemented.
- **25 cross-position matches remain and are all correct.** Each is an
  unambiguous single-candidate name where the two sources simply label the
  position differently, or the player genuinely changed position. The shallowest
  sits at ADP 269 — past the 192 picks in a 12-team draft.

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
| **Draft prep is v1** | The only scope whose data exists today, and the only one with a deadline. |
| **The board is a distribution plot** | Points-per-game discards the thing this app knows that ADP does not. See the UI decisions table. |
| **Commit to `main`, branch only with a reason** | Linear history, solo repo. See "Git and deployment". |

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
   First page is the board, not the comparison — the design above is specified
   and waiting, and the board is what draft prep actually needs. Build it
   against SQL over `scored_weekly_stats`; no Python at request time.
2. **Verify the redirect URL configuration** at first sign-in (item 3 under
   Unverified). This is the first moment it becomes testable — there is no
   sign-in flow to exercise until the app exists.
3. **Add a read policy to `pipeline_meta`** so the board can show a "data as of"
   line.
4. **Add the other eleven league members** to `league_members` once there is
   something worth showing them. Remember each needs pre-creating, because
   `disable_signup` blocks a first OAuth sign-in.
5. **In-season: run the Yahoo score diff** to close Q2 and Q3.
6. **Then team defense** (Q4), once Q3 is settled.

## State as of the end of the 2026-08-16 session

- Production runs `3d7a547`, pushed and deployed. The only commit after it is
  this handover refresh, which is docs-only and changes no runtime behaviour.
- The identity fix is **deployed but not yet reflected in the data**. No action
  needed: `adp_projections` is rebuilt whole on every run regardless of
  full/incremental mode, so the 11:00 UTC cron republishes it with the fix. If
  you want it sooner, trigger `/api/cron/refresh` with the secret. To confirm
  afterwards, check that Justin Jefferson's ADP row carries `00-0036322` (the
  Vikings receiver) rather than `00-0041075` (the Browns linebacker), and that
  his 2025 line shows 17 games.
- Vercel CLI has been upgraded to 59.1.3, which should resolve the empty-secret
  bug described under "Things that will bite you".
- Nothing is half-finished. The next session starts on the Next.js scaffold.

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
  its length** — do not trust the success message. (Seen on CLI v54.11.1; the
  CLI is now 59.1.3, which likely fixes it, but the habit of reading a secret
  back is worth keeping regardless — this failure is silent and fails closed.)

- **Names are not identifiers.** 143 normalised names in `player_index` belong
  to more than one player, and matching on name alone silently resolved three
  top-40 draft picks to their namesakes. Any new join on a name needs a gate and
  a deterministic tiebreak. See "Namesakes broke the ADP join".

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

**Corrected on 2026-08-16** (commit `4de9d85`), so no action is outstanding.
Three statements had drifted: the allowlist was described as "hard-coded" when it
is now a `league_members` table enforced in RLS; "no signup" was asserted before
Supabase signups were actually disabled, and is now true in the strict sense; and
Status listed the hosted deployment as pending when it had been live for hours —
the wrong direction to be inaccurate in, given the deployment is what a reviewer
would be approving.

The rest of the Yahoo-facing content was checked against the code and still
holds: the read-only guarantee and how it is enforced, the single-service-account
model, the endpoint table, and "the app never calls Yahoo".

**If the scope changes — more users, a public view, anything written back to
Yahoo — update the README before the behaviour ships.** With an application now
pending, being approved on a description that no longer matches reality is the
failure mode to avoid.
