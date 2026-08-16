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
database right now. **The UI is built and live** — a Next.js app at the repo
root, reading those tables as plain SQL with no Python at request time, gated
behind Google sign-in and the same allowlist the database enforces. Three
screens: the board, a player page with a whole career, and a two-or-three-way
comparison. **Google sign-in is confirmed working in production**, which had
been the one unexercised path for two sessions. The Yahoo integration is still
stubbed, pending an API access application that has been submitted and is
awaiting a decision.

**The next thing this needs is a design pass**, not another feature. See "A
design pass is owed".

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

The web app needs `npm install` as well as `uv sync`; `.env.local` is what Next
reads for `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, so
`vercel env pull` has to have run before `npm run dev` will start.

```bash
npm install
npm run dev          # http://localhost:3000
npm run lint         # tsc --noEmit
```

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
| **Web UI — the board** | **Built and live.** Renders 923 ADP rows against live data. |
| **`/player` and `/player/[id]`** | **Built.** Search page plus a full career, one row per season. |
| **`/compare`** | **Built.** Two or three players on one shared axis. |
| **Google sign-in** | **Confirmed working in production**, 2026-08-16, by a human. |
| `draft_board()` / `player_week_log()` | Working. Verified under member and non-member JWTs. |
| `player_cards()` / `player_seasons()` | Working. Same verification: member gets rows, non-member and email-less get zero, `anon` is refused. |
| `data_freshness()` | Working. Powers the "data as of" line. |
| Next.js + Python cron on one deployment | **Verified in production**, not assumed. `/api/cron/refresh` answers 401 rather than a redirect. |

Published data as of the last run: 174,201 scored player-weeks, 10,146 players,
3,251 ADP rows, 5 injury items.

## The UI, as built

The read path turned out as thin as predicted: **no Python at request time**, no
nflverse download, no Polars, no scoring engine. Five SQL functions across
`0003_board.sql` and `0004_player.sql` are the whole thing.

| Function | Returns | Notes |
|---|---|---|
| `draft_board(adp, stat, ceiling, floor)` | 923 rows, one per player with an ADP | Median/IQR via `percentile_cont`, plus **every week's points as an array** so the plot can draw a dot per game |
| `player_week_log(player_id, season)` | One player's weeks, all 22 rule columns | Fetched only when a row or a season is expanded |
| `player_cards(ids[], adp, stat, ceiling, floor)` | `draft_board()`'s row shape for a named set of players | Migration `0004`. Input order preserved, duplicates collapsed |
| `player_seasons(ids[], ceiling, floor)` | One row per season of a career, each with its own weeks and points | Migration `0004`. What makes `/player/[id]` worth a route |
| `data_freshness()` | Two timestamps and the rules fingerprint | See "Staleness needed more than a policy" |

All are `SECURITY INVOKER` except `data_freshness()`, so the allowlist policies
still apply unchanged. Verified with HS256 JWTs: a member gets rows, a
non-member and a token with no `email` claim get **zero rows from every one of
them** — including the security-definer one, which re-checks membership itself —
and the `anon` role is refused outright with `permission denied for function`.

### Why `0004` exists rather than reusing `draft_board()`

`player_cards()` looks like a subset of `draft_board()` and nearly is. The
difference is which table it starts from, and it matters:

- **`draft_board()` starts at `adp_projections`.** Right for the board, which
  only shows players who have a price.
- **`player_cards()` starts at `player_index`.** A player page has to render for
  someone with no ADP — a veteran nobody is drafting still has a career worth
  reading, and a URL that 404s on him is a worse answer than an empty ADP cell.
  Its `player_id` is therefore never null, and `PlayerCard` narrows the type to
  say so, which is why the card routes never render an `unmatched` state.

The other reason is size. Rendering one player by filtering `draft_board()`
means fetching 923 rows with their arrays to use one of them, on every player
page, on every cache miss.

### Two things that were wrong in the last handover

Both were reasonable inferences that a real deployment disproved. They are
recorded because the reasoning that produced them will recur.

1. **Framework auto-detection does not apply here.** The previous entry said a
   throwaway deployment "detected `nextjs` as the framework". True — for a *new*
   project. This project was created as a Python one long before there was a UI,
   and its stored preset won: the Next build succeeded and the deploy then failed
   with *No Output Directory named "public"*. Fixed by pinning
   `"framework": "nextjs"` in `vercel.json`, which is now the source of truth
   rather than a dashboard setting nobody can see from the repo.

2. **A catch-all proxy matcher silently kills the cron.** `api/` is the Vercel
   Python function, not a Next route, and the daily cron calls it with no
   session. The first preview answered `/api/cron/refresh` with a **307 to
   `/login`** instead of running. That failure is close to invisible — Vercel
   sees a redirect rather than an error, `pipeline_runs` gets no row at all, and
   the only symptom is a board whose data quietly stops moving. `proxy.ts` now
   excludes `api/`, verified returning its own `401 {"error":"unauthorized"}`.
   **Any new matcher, rewrite or redirect needs the same exclusion.**

### Design decisions carried through unchanged

Everything under "Design decisions, settled" below was implemented as specified,
and the numbers were checked against the spec rather than assumed: Taylor's 16.9
median, Jefferson's 12.5 median with exactly one ceiling week and a 7.1-wide IQR,
McCaffrey's 10.5 around 24.1, and Gibbs's 55.4 setting the fixed 0–56 axis. All
reproduce exactly from SQL.

### The scoring rules are duplicated in TypeScript, on purpose

`lib/scoring.ts` mirrors `ff.scoring.rules.LEAGUE_SCORING`. Duplication across
languages is normally a mistake; it is here because the board's whole argument is
that a score can be **shown as arithmetic**, and the read path deliberately runs
no Python.

It is checked rather than trusted. `decompose()` returns the sum it reaches
alongside the value Postgres stored, and the panel renders a visible warning if
they disagree instead of showing confident wrong arithmetic. Measured across
**1000 player-weeks spanning 24 positions: zero disagreements, worst delta
0.000000**, including the spec's own example — Bijan's week 17,
`195×0.1 + 1×6 + 5×1.0 + 34×0.1 + 1×6 = 39.9`.

**If you change the Python rules, change this file too.** The fingerprint
mechanism does not cover it: it protects the stored scores, not the browser's
reconstruction of them.

### Staleness needed more than a policy

The previous handover called `pipeline_meta`'s missing read policy an oversight,
which it was — but adding one is not enough to answer "how old is this?".
`last_full_refresh` only moves on a **full** rebuild, and an incremental run
republishes ADP and the current season without touching it. A "data as of" line
reading that column would have shown a date days stale while the data underneath
was hours old.

The truthful timestamp is the last successful `pipeline_runs` row, and that table
stays closed on purpose — error strings and row counts are operational. So it is
exposed through `data_freshness()`, a security-definer function returning exactly
two timestamps and a fingerprint, which re-checks the allowlist itself because
security definer bypasses the RLS that would otherwise do it.

### Things a future session should know about the code

- **`lib/board.ts` holds types and constants; `lib/queries.ts` holds the server
  fetch.** They are split because `server-only` turned a shared module into a
  build error the moment a client component imported it. That is the guard
  working: it is the same class of mistake as leaking the service-role key.
- **Query by `player_id`, not `player_name`.** There is no index on
  `player_name`. `player_index` is indexed on `norm_name`.
- **`POSITION` is a reserved word** in a `RETURNS TABLE` column list. It has to
  be quoted, and is.
- **Three empty-row states are distinguished**, because they look identical
  otherwise: `unmatched` (ADP name resolved to nobody — flagged red, it is the
  one that is a *lie*), `rookie` (no NFL week ever), and `absent` (has a career,
  played none of 2025). The last is new — the previous design treated a veteran
  who missed the season as a rookie. Currently 92 unmatched, 307 rookie, 191
  absent, 78 carrying an injury flag.
- **`compare_players()` was not reused**, as predicted. It scores in-process from
  nflverse at request time, which is right for a CLI and wrong for a web app.
- **Four components are shared across the three screens**, and each exists
  because the alternative was a second copy of something that has to agree with
  itself: `app/plot.tsx` (the distribution and the axis — no `"use client"`, so
  it renders in the board's client tree and in the server-rendered compare page
  alike), `app/picker.tsx` (search-and-pick in two modes), `app/nav.tsx`, and
  `app/not-on-list.tsx` (the non-member explanation, which three screens would
  otherwise word three ways).
- **`PlayerCard` is `BoardRow` with a non-null `player_id`.** Not a parallel
  type: the plot must be drawn from the same numbers on all three screens. The
  narrowing is honest rather than cosmetic — see "Why `0004` exists".
- **`fetchPlayer` is wrapped in React's `cache()`, keyed on the id string.**
  `generateMetadata` needs the name and the page needs everything; without it
  that is two identical round trips per player page. Keyed on the string because
  `cache()` compares arguments by identity and `[id]` is a fresh array each call.

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
| `/player` | Find a player. | The board's read, slimmed |
| `/player/[id]` | What did they do week by week and season by season, and why is that score what it is? | `player_cards()` + `player_seasons()`, then `player_week_log()` on demand |
| `/compare` | Pick two or three. | The board's read, slimmed |
| `/compare?ids=…` | A or B. | `player_cards()` + `player_seasons()`, 2–3 ids |

All five carry the same **section nav** — Board · Players · Compare. It exists
because the first cut of `/player/[id]` and `/compare` was reachable only from
inside an expanded board row, which is a place you have to already know to look.
A route nobody can find is not built.

**Search is a control, not a route** — but it now appears as the body of two
landing pages as well as a box on the board. All three filter **client-side over
the ~830 players who have a price and resolved to somebody**, folded through
`normaliseName` in `lib/board.ts` so "jamarr" finds Ja'Marr Chase.

That makes the searchable universe "players with a 2026 ADP", which is the
draft-prep scope. **A player with no ADP still has a working `/player/[id]` URL;
he is just not findable by typing his name.** Widening it means substring-
searching `player_index`, and `norm_name` is an **exact-match** index — a prefix
search finds someone typing "justin" but not someone typing "jefferson", which
is how people actually search. Doing it properly needs `pg_trgm` added first.

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

### A design pass is owed

**Flagged 2026-08-16. This is the next thing the UI needs, ahead of any further
feature.**

The board was designed — three directions mocked against live data, one chosen,
its tokens and axis argued for. Everything built since has been *extended* from
it rather than designed: the career table, the compare columns, the pickers and
the section nav all borrow the board's palette, its row grid and its chip
styles because that was the honest way to keep them consistent while the
question was still "does this work". It shows in the places where the borrowing
does not quite fit:

- **The palette is defined on `.board` and `.career` and `.picker` separately.**
  Three selectors carrying the same nine custom properties is a design system
  that has not been named yet.
- **The instrument ground was chosen for a dense data table.** A player page is
  mostly a header and eight numbers, and it inherits the same near-black without
  anyone having asked whether that page wants it.
- **Hierarchy across the three screens is inconsistent.** The board leads with a
  title and the stat strip on `/player` leads with figures; `/compare` leads
  with a control. None of that was decided, it accumulated.
- **The mobile view is still nothing.** A 64rem grid does not survive a phone,
  and this is now three screens that do not, not one.

Nothing here is broken and none of it should block using the app for a draft.
It is worth doing before the other eleven members see it, because the first
impression is the one design decision that cannot be revised later.

### Still open on the UI

Four of the earlier items are now done: the staleness policy (see "Staleness
needed more than a policy"), pagination, the position filter and search, and
`/player/[id]` and `/compare` — the last two now with landing pages of their
own. What remains:

- **The 20-point ceiling and 10-point floor are inherited from the CLI**
  (`CEILING_THRESHOLD`, `FLOOR_THRESHOLD` in `analysis/compare.py`). Reasonable
  for a skill player, wrong for a quarterback. They probably want to vary by
  position once quarterbacks are on the board. They are now **parameters of
  `draft_board()`** rather than hardcoded, so varying them is a call-site change
  and not a migration.
- **Pagination is 100 rows at a time, not virtualised.** Enough to clear the 192
  picks of a 12-team draft in two clicks, and it keeps sorting instant because
  all 923 rows are already in memory — only the rendering is bounded. If it ever
  feels slow, virtualise the rows; do not start paging the query.
- **Search covers only players with an ADP.** See "Routes". A `pg_trgm` index on
  `player_index.norm_name` is what widens it to all 10,146.
- **The mobile view is still a separate design**, not this one reflowed. A 64rem
  grid does not survive a phone. Now true of three screens rather than one.

### Idea: mark players drafted, live, during the draft (logged 2026-08-16)

Kevin's, and not yet scoped. **Toggle a player as drafted so they drop off the
board**, so it tracks the room without any Yahoo connection. This is the feature
that turns the board from a prep screen into a draft-day screen, and it needs no
new data — only a per-player boolean and a filter.

Three things to settle before building it:

- **Where the state lives.** `localStorage` is free, needs no schema and no write
  policy, and survives a refresh — but it is one browser only. A table is shared,
  which is the better model because *drafted* is a fact about the room, not an
  opinion: whoever marks it, everyone should see it. That makes it the **first
  write path in the app**, so it needs an RLS `INSERT`/`DELETE` policy for
  allowlisted members where every other policy today is read-only. No conflict
  with the README's read-only guarantee — that is a promise about *Yahoo*, and
  this writes only to our own table.
- **Hide, or grey out.** A live draft is exactly where a mis-tap happens, and a
  player who vanishes is hard to get back. A `drafted` pill plus a "hide drafted"
  toggle is recoverable; deletion from the view is not.
- **Whether it records *who* took them.** Storing the drafting team costs one
  column and is the difference between "gone" and "gone to the guy picking two
  after me", but it is also the first thing in the schema that knows the league
  has teams — see "Scope: draft prep first".

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

## What is genuinely unverified

Read this before assuming the UI is finished.

**Sign-in is no longer on this list.** It was verified by a human on the preview
deployment and then again in production on 2026-08-16, which also settles the
Supabase redirect allowlist for both origins — that configuration is unreadable
by any API, so a working sign-in is the only evidence available and it is now in
hand. The callback at `app/auth/callback/route.ts` still surfaces
`error_description` on the login page rather than failing blankly, which is what
makes the next such problem a two-minute diagnosis.

Note the shape of that evidence: `redirectTo` is built from
`window.location.origin`, so **each origin is its own test.** Preview working
did not prove production, and neither proves `http://localhost:3000`, which is
what `npm run dev` needs in the allowlist.

1. **`disable_signup` blocks the first OAuth sign-in.** `kanoble@gmail.com` is
   pre-created, so this is settled for Kevin — but it is the most likely failure
   for the other eleven, and the callback reports it in words.

2. **Nobody but Kevin has used the app.** Deliberate: he does not want the other
   eleven added until there is something he is ready to share, and the design
   pass above is the thing standing between here and that. Do not add them
   without being asked.

3. **The layout has never been looked at in a browser by the machine that built
   it.** Data, routing, auth, RLS and server-rendered markup are all verified
   end to end; the visual result is verified only by Kevin looking at it. If a
   grid looks wrong, that is the gap.

4. **Yahoo stat IDs** in `YAHOO_STAT_ID_TO_NFLVERSE` are the widely-circulated
   values, never checked against a live payload. Not on the critical path.

5. **Fuzzy identity matching accuracy is unmeasured.** The *need* is confirmed
   (below); how well it works is not. The ADP-side match has a position gate
   after it resolved three top-40 players to their namesakes — see "Namesakes
   broke the ADP join". The Yahoo-side resolver has not had the same treatment
   because it is still stubbed.

   The board makes the remaining damage visible rather than fixing it: 92 of the
   923 ADP rows resolve to nobody and now render with a red **no match** pill.
   That is a measurement, not a defect list — most are genuinely not NFL
   players — but it is the place to look if a name you expect is blank.

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
| **The read path is SQL functions, not PostgREST table queries** | The plot needs every week's points per player. One `draft_board()` call returns 923 rows with their arrays; the table-query equivalent is an N+1 over players or a 15,000-row download the client then has to group. |
| **The scoring rules are mirrored in TypeScript** | The board shows a score as arithmetic, and the read path runs no Python. Made safe by checking the reconstruction against the stored value and surfacing disagreement. See "The scoring rules are duplicated in TypeScript". |
| **Plain CSS, no Tailwind** | The design arrived as a hand-written stylesheet with specific tokens; porting it to utility classes would have been a translation step with nothing gained. |
| **Row expansion fetches on demand** | 923 game logs is a payload almost none of which gets read. |
| **`player_cards()` starts at `player_index`, not `adp_projections`** | A player page must render for someone with no price. See "Why `0004` exists". |
| **`/compare` caps at three** | The plots share one axis and a fourth column makes the shapes incomparable, which is the only thing the screen is for. Extra ids in the URL are dropped, not shrunk. |
| **The middle 50% has no "winner" on `/compare`** | A narrow spread is a different asset, not a better one. Highlighting the narrower one is the mistake the board's "safest floor" sort already avoids. |
| **The plot lives in `app/plot.tsx`** | Three screens drawing the same axis from three copies of the arithmetic is how a fixed scale stops being fixed. |
| **Search is client-side over the priced players** | Instant, no index, no round trip. The alternative needs `pg_trgm`. See "Routes". |
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

1. **Merge the open PR.** `/player`, `/compare` and the section nav are on a
   branch; merging deploys them. Migration `0004` is *already* applied to the
   live database, so there is no schema step — it is additive and nothing read
   it until this code shipped.
2. **Do the design pass.** See "A design pass is owed". This is the thing
   standing between the app as it is and the app being shown to eleven relatives.
3. **Then add the other eleven league members** to `league_members`. Each needs
   pre-creating, because `disable_signup` blocks a first OAuth sign-in. **Do not
   do this before Kevin asks** — he has said explicitly he wants something he is
   ready to share first.
4. **Then the draft-day toggle**, if it still looks right: see "Idea: mark
   players drafted, live, during the draft". It is the feature that turns this
   from a prep screen into a draft-day screen.
5. **In-season: run the Yahoo score diff** to close Q2 and Q3.
6. **Then team defense** (Q4), once Q3 is settled.

Not on this list, deliberately: **the sign-in branding**. Google shows
`sebizyhnwgarnbukqkxu.supabase.co` because an unverified OAuth brand falls back
to showing the client's domain, and the Supabase callback host *is* that domain.
Both fixes need a domain Kevin owns — Supabase's custom-domain add-on (Pro at
$25/mo plus $10/mo, since the add-on is not sold on Free) or Google brand
verification (a domain, ~$12/yr, plus publishing the consent screen out of
Testing, which disables the test-user list). **Deferred until onboarding**, and
worth revisiting then because a domain would also replace
`fantasy-football-red.vercel.app`.

### Why this went through a PR

The standing rule is still commit-to-`main`, and it has not changed. Kevin asked
for a PR on this one. The previous UI change also took a branch, for a different
and now-historical reason: it was the first push that changed which framework
Vercel builds the project with.

## State as of the end of the 2026-08-16 player/compare session

- **Production runs the merged board (`fc34f8c`).** `/player`, `/compare` and
  the nav are on a branch with an open PR.
- **Both post-merge checks passed on production**: `/api/cron/refresh` answers
  `401 {"error": "unauthorized"}` with no redirect — the regression that hides —
  and the board serves a 307 to `/login` when signed out.
- **Google sign-in works in production.** Confirmed by Kevin. This closes the
  item that had been open across two handovers.
- **Migration `0004_player.sql` is applied to the live database.** Applied
  directly, the same way `0001`–`0003` were, before the code that uses it
  shipped. It is additive: two new functions, no existing object touched.
- **Every route was rendered end to end as the allowlisted user** against the
  live database, including the awkward states: a full career, a rookie with a
  price and no past (Jeremiyah Love), a veteran absent from the stat season
  (Jonathon Brooks, whose 2024 still lists), an unknown id (404), and a
  comparison mixing a rookie with a full season.
- **A bug in the sign-in redirect was found and fixed** while checking the new
  routes: it dropped the query string, so a shared `/compare?ids=a,b` link would
  have sent a signed-out member to the board with the ids silently lost — and
  cloning the request URL was also carrying those ids onto `/login` itself.
- `tsc`, `next build`, 56 Python tests and `ruff` all clean.
- **A `next dev` server may still be running on port 3000.** If port 3000 is
  occupied for no reason, that is why.
- Nothing is half-finished.

## Things that will bite you

- **`typedRoutes` cannot resolve an array of literal hrefs.** Mapping a nav over
  `[{href: "/"}, {href: "/player"}]` widens to a union that `Link`'s generic
  rejects, and the only way through is casting back to `Route` — which throws
  away the exact check the flag is on for. `app/nav.tsx` writes its three links
  out longhand for that reason. Template literals like `` `/player/${id}` ``
  are fine; unions are not. Also note the route types are generated at build, so
  a fresh route fails `npm run lint` until `npm run build` has run once.

- **A catch-all proxy matcher swallows the cron.** `proxy.ts` must exclude
  `api/`, because that is the Python function and not a Next route. Get this
  wrong and the daily refresh receives a 307 to `/login` forever while looking
  entirely healthy from the outside: no error, no `pipeline_runs` row, just a
  board whose data stops moving. Any new matcher, rewrite or redirect needs the
  same exclusion.

- **`vercel.json` pins `"framework": "nextjs"` and must keep doing so.**
  Auto-detection only runs for a *new* project; this one is remembered as a
  Python project. Without the pin the Next build succeeds and the deploy then
  fails looking for a `public` directory.

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
