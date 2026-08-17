# Handover

State of the project as of **2026-08-17**. Read this first, then
[architecture.md](architecture.md) for design rationale and
[scoring-rules.md](scoring-rules.md) for the league's scoring.

Repo: https://github.com/kanoble/fantasy-football (public)

---

## Start here: which branch you are on

**The working tree is on `draft-cost`, not `main`, and that is deliberate.**
PR #7 is open and carries the draft-cost pass plus this document. `main` is at
`7f27c21` and has none of it — including none of this handover, so if you are
reading an older version of this file, `git checkout draft-cost`.

This cost a confusion worth not repeating. The commits were made on `main`
locally, then moved to a branch with `git branch draft-cost && git reset --hard
origin/main` — which is the documented working shape for this repo, and which
also silently reverted the working tree. **The dev server on port 3000 reads the
working tree**, so it went on serving the old UI and the new column looked like
it had never been built. If a change you just made is not on screen, check
`git branch --show-current` before you check anything else.

Immediate state:

| | |
|---|---|
| Branch | `draft-cost`, pushed, **PR #7 open** |
| `main` | `7f27c21`, untouched |
| Migration `0009` | **Applied to the live database.** Nothing to run. |
| Checks | `tsc`, `next build`, 62 pytest, `ruff` — all clean |
| Unreviewed | Kevin has not yet looked at the cost column |

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

**The app has a name: Noble Family Football.** Founded 2021; the 2026 draft is
30 August. Until 2026-08-16 the largest words on every screen named a *page*
("Draft board"), so the product was anonymous — the header pass fixed that and
rebuilt the navigation around it. See "The header and the brand, as built".

**The design pass is done for the board and merged.** Three directions were
mocked against live data, one was chosen, and the consolidation it needed — one
palette instead of three copies — is what made a working light/dark toggle
possible. See "The design pass, as built".

**The draft-day toggle is merged.** Players can be marked drafted so the board
tracks the room, which is the feature that turns a prep screen into a draft-day
one. It is **the app's first write path** — every policy before it was
read-only. See "The draft-day toggle, as built".

**The player pages got their depth pass, and it is on a branch.** `/player/[id]`
has a face and a bio, every season shows where it ranked among startable players
at that position, an opened season draws its weeks in order as well as in
distribution, and a bar says what the season's points were actually made of. The
database also gained a decade of historical draft prices, backfilled once from
Fantasy Football Calculator, which makes "was he worth his ADP" answerable for
the first time. See "The player depth pass, as built".

**The player depth pass is merged (PR #6).** What is new since is the draft-cost
pass: the career table now says what a season *cost* beside what it returned,
which is the feature `adp_history` was backfilled for and the first thing to
read that table. See "Draft cost, as built".

**This machine now has a browser**, for the first time in the project's life.
That closes the gap every previous handover ended on — see "The machine has a
browser now", which is the most useful thing in this document for the next
session.

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
| Supabase schema | Migrations `0001`–`0008` applied. 8 tables + allowlist. |
| Google sign-in | Provider enabled; signups disabled; allowlist enforced in RLS. |
| `scripts/smoke_test.py` | Working. All 4 no-auth sources green. |
| `scoring/`, `sources/`, `analysis/` | Fully implemented. |
| Test suite | 62 tests, all passing. `uv run pytest` |
| Lint | Clean. `uv run ruff check .` |
| **Web UI — the board** | **Built and live.** Renders 923 ADP rows against live data. |
| **`/player` and `/player/[id]`** | **Built.** Search page plus a full career, one row per season. |
| **`/compare`** | **Built.** Two or three players on one shared axis. |
| **Google sign-in** | **Confirmed working in production**, 2026-08-16, by a human. |
| `draft_board()` / `player_week_log()` | Working. Verified under member and non-member JWTs. |
| `player_cards()` / `player_seasons()` | Working. Same verification: member gets rows, non-member and email-less get zero, `anon` is refused. |
| `position_context()` | Working. Same verification. 252ms warm over REST against 171ms for `player_cards()`. |
| `adp_history` table | **Backfilled, 2,936 rows, 2012–2026.** Read-only to members; INSERT/UPDATE/DELETE all 403. **Now read by the UI** — see "Draft cost, as built". |
| `draft_value()` | **Written, tested under rollback, NOT applied.** Migration `0009`. The one outstanding step before `draft-cost` can merge. |
| **Player bio and portraits** | **Built, on `player-bio`.** 8,940 of 10,145 players have a headshot; 1,190 of 1,259 current skill players. |
| `data_freshness()` | Working. Powers the dateline on all four screens. |
| **The app bar and the brand** | **Built and merged.** Crest, wordmark, section tabs, avatar menu, dateline. Markup verified server-side; visuals confirmed by Kevin locally, not on production. |
| **`drafted` table + write policies** | **Working, and the first write path.** Verified with HS256 JWTs across member, non-member, email-less and `anon`. |
| Next.js + Python cron on one deployment | **Verified in production**, not assumed. `/api/cron/refresh` answers 401 rather than a redirect. |

Published data as of the last run: 174,201 scored player-weeks, **10,145**
players, 3,251 ADP rows, 5 injury items, and **2,936 historical ADP rows**.

The player count dropped by one and that is a fix, not a loss: rosters carry
`gsis_id` values that are the empty string as well as ones that are null, and
`is_not_null()` alone let the empty string through to become a `player_index`
row keyed on `""` — a valid primary key and a player page for nobody.

## The UI, as built

The read path turned out as thin as predicted: **no Python at request time**, no
nflverse download, no Polars, no scoring engine. Six SQL functions across
`0003_board.sql`, `0004_player.sql` and `0008_position_context.sql` are the
whole thing.

| Function | Returns | Notes |
|---|---|---|
| `draft_board(adp, stat, ceiling, floor)` | 923 rows, one per player with an ADP | Median/IQR via `percentile_cont`, plus **every week's points as an array** so the plot can draw a dot per game |
| `player_week_log(player_id, season)` | One player's weeks, all 22 rule columns | Fetched only when a row or a season is expanded |
| `player_cards(ids[], adp, stat, ceiling, floor)` | `draft_board()`'s row shape for a named set of players | Migration `0004`. Input order preserved, duplicates collapsed |
| `player_seasons(ids[], ceiling, floor)` | One row per season of a career, each with its own weeks and points | Migration `0004`. What makes `/player/[id]` worth a route |
| `position_context(ids[], teams)` | One row per (player, season): his rank among startable players at his position, the cohort size, and the cohort's weekly quartiles | Migration `0008`. The denominator the fixed axis never had |
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
- **Six components are shared across the screens**, and each exists because the
  alternative was a second copy of something that has to agree with itself:
  `app/plot.tsx` (the distribution and the axis — no `"use client"`, so it
  renders in the board's client tree and in the server-rendered compare page
  alike), `app/picker.tsx` (search-and-pick in two modes), `app/chrome.tsx` (the
  crest, the lockup, the app bar and the page head), `app/nav.tsx` (the section
  tabs), `app/account.tsx` (the avatar popover, and the only `"use client"` one
  of the four chrome pieces), and `app/not-on-list.tsx` (the non-member
  explanation, which four screens would otherwise word four ways).
- **`PageHead` takes the raw `Freshness` row, not a formatted string.** That is
  deliberate: the four screens cannot word the dateline four ways if none of them
  can reach the wording. `dateline()` and `datelineStamp()` live in
  `lib/board.ts` beside the constants they read.
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

Five, and anything else is a filter or a sort on one of them.

| Route | The question it answers | Reads |
|---|---|---|
| `/login` | The only route outside the auth boundary. Google sign-in. | — |
| `/` | **The board.** Who is worth taking, and who is priced below what they did? | `adp_projections` ⋈ `scored_weekly_stats`, ~923 rows |
| `/player` | Find a player. | The board's read, slimmed |
| `/player/[id]` | What did they do week by week and season by season, and why is that score what it is? | `player_cards()` + `player_seasons()`, then `player_week_log()` on demand |
| `/compare` | Pick two or three. | The board's read, slimmed |
| `/compare?ids=…` | A or B. | `player_cards()` + `player_seasons()`, 2–3 ids |

All four signed-in routes carry the same **app bar** — crest, wordmark, the three
section tabs, one avatar — and under it a **page head** whose `<h1>` names the
screen. The nav exists because the first cut of `/player/[id]` and `/compare` was
reachable only from inside an expanded board row, which is a place you have to
already know to look; a route nobody can find is not built. The two-level split
exists because collapsing it left the app nameless. See "The header and the
brand, as built".

**A non-member gets no app bar on any of them** — just `NotOnList`. Tabs to
sections that would return that reader zero rows are an invitation to three more
empty pages. `/` used to be the exception and no longer is.

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

### The design pass, as built

**Done for the board on 2026-08-16, merged as PR #3.** Three directions
were mocked against live `draft_board()` rows and Kevin chose the dense one, then
asked for colour and depth, which a second pass added.

Published mockups:

- Three directions, light and dark — https://claude.ai/code/artifact/f4bbd144-2265-4724-ab84-5abc19f2f170
- The chosen direction, second pass — https://claude.ai/code/artifact/4e34177f-33b3-4ece-8302-f9e22581a279

**One palette, defined once, is the load-bearing change.** The stylesheet
carried two unrelated colour systems: a page shell keyed on a teal `--accent`
and an instrument keyed on an amber `--c-amber`, with the same ten `--c-*`
properties declared separately on `.board`, `.career` and `.picker`. That is why
the nav underline was teal while everything inside the table was amber, and it
is why the board was **theme-deaf** — it committed to a near-black ground in
*both* themes, so a toggle would have recoloured only the frame around a
permanently black table.

| Decision | Why |
|---|---|
| **Colour comes from the team** | Four honest sources existed on a screen this dense — position, team, performance, or nothing. Team is already in every row and is the subject's own vernacular. `lib/teams.ts` maps it to a `tm-*` class; the dots, the row stripe, the hover wash and the expanded panel's left edge all read `--tm`. |
| **Team hues keep the hue and drop the value** | Raiders black and Colts navy are invisible at their brand values on a dark ground. A column where a third of the league reads as "off" is worse than one approximately right about a shade. |
| **Ceiling and floor are shape, not a traffic light** | A ceiling week comes to full strength and grows; a floor week is a hollow ring. The old red fired on **all five of the top five**, which is an alarm that has stopped meaning anything. Colour rewards, shape reports. |
| **The arithmetic leads the expanded row** | `195×0.1 + 1×6 + 5×1.0 + 34×0.1 + 1×6 = 39.9` is the app's whole argument, and it was set smaller than the table above it, under a heading, as a footnote. Each term now names its stat, and the agreement check reads as a quiet confirmation rather than appearing only on failure. |
| **Depth is machined, not glossy** | The plot is a milled channel — dark inner top edge, light inner bottom edge — so the season sits *inside* the surface. Hover lifts with a gradient in the row's own team hue. All `inset` shadows; nothing that costs anything across 923 rows. |
| **Desktop only** | Mobile stays its own design. Deliberate, and unchanged from the previous handover. |

Two defects fixed on the way, both of which had been on screen for weeks: the
masthead and the board each rendered the words "Draft board" 150px apart, and
`POS` was a column *and* a field in the line under every name, so "RB" sat
directly left of "RB · DET · 17g".

### The theme toggle, and the trap in it

Three states — Auto / Light / Dark — in the masthead of all three signed-in
screens. **"Auto" is the absence of `data-theme`**, which is what lets
`prefers-color-scheme` keep deciding; a control that stamps a value on first
paint has silently opted everyone out of following their OS.

**`THEME_SCRIPT` lives in `lib/theme.ts`, not in the `"use client"` component,
and it must stay there.** Every export of a client module becomes a *client
reference* when a server component imports it, so the first version reached
`layout.tsx` as an opaque proxy and `dangerouslySetInnerHTML` rendered **nothing
at all**. The failure is silent and looks fine in the source — the only symptom
is a white flash on every navigation for anyone in dark mode. It was caught by
curling the served HTML, which is the only way to see it. Same class of mistake
as the `server-only` split between `lib/board.ts` and `lib/queries.ts`.

**Lightning CSS compiles `light-dark()` into its own `var()` polyfill and
discards the plain-colour fallback declared in front of it.** The compiled
output was checked: it emits correct definitions for all four theme states, so
the team hues resolve everywhere. But the belt-and-braces pattern of writing a
literal colour before a `light-dark()` does **not** survive this toolchain — the
polyfill is what is actually shipping.

### Still owed on design

- **`/player` and `/compare` have the new chrome but not a new interior.** The
  header pass gave all four screens the same app bar, page head and dateline, so
  the *hierarchy above the fold* is now decided and consistent. What was never
  decided is what sits below it: the eight-figure stat strip on `/player` and the
  metric table on `/compare` are the board's tokens applied to layouts nobody
  designed. That is the oldest outstanding design debt.
- **The mobile view is still nothing.** A 62rem grid does not survive a phone,
  and this is three screens that do not, not one. The app bar wraps rather than
  collapsing — a slim bar with a crest is the easiest thing here to make work on
  a phone, and it has not been done.
- **This is no longer true of the machine, only of the screens it has not been
  pointed at.** Every handover before 2026-08-16 said nobody but Kevin had seen
  the built result in a browser, because the machine had none. It has one now —
  see "The machine has a browser now" — and it immediately found a contrast
  defect that three sessions of reading the source had not. What it still
  cannot do is hold a session, so it renders components with fixture data
  rather than driving the real signed-in app.

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
  `player_index.norm_name` is what widens it to all 10,145.
- **The mobile view is still a separate design**, not this one reflowed. A 64rem
  grid does not survive a phone. Now true of three screens rather than one.

### The draft-day toggle, as built

**Built and merged 2026-08-16 (PR #4).** All three of the
questions this was parked on are answered, and a fourth surfaced during
exploration that mattered more than any of them.

| Decision | Why |
|---|---|
| **A shared table, not `localStorage`** | *Drafted* is a fact about the room, not an opinion. It also survives switching device mid-draft, which is the benefit that is real today given the allowlist still holds one address. |
| **Keyed on `(season, norm_name)`, not `player_id`** | 92 of the 923 ADP rows have no `player_id`, and **exactly one is inside the 192 picks of a 12-team draft** — Kenny Gainwell, ADP 110.8; the rest sit at 246+. Keying on `player_id` would have left one real, draftable player permanently unmarkable, and the only symptom would have been a button that silently did nothing. `norm_name` is unique across all 923 rows, so a mark is never ambiguous. |
| **Hidden behind a chip, not greyed in place** | Kevin's call. The board shrinking is the point. The recoverability cost is paid by an inline **Undo** line, because a mark made while hiding is on makes a player vanish. |
| **A toggle column, not a draft mode** | A mode whose mis-tap does the wrong thing is the classic modal error, and this is a two-hour high-stress window. |
| **No record of who took them** | One boolean fact. The schema stays ignorant of the league having teams — see "Scope: draft prep first". Adding a column later to a small table is a plain `ALTER`. |
| **A 15s visible-tab poll, not Realtime** | Realtime needs the table added to the `supabase_realtime` publication and cannot be verified without two browsers. One `alter publication` line away if it is ever wanted. |

**`draft_board()` and `player_cards()` were recreated to return `norm_name`,**
because the browser cannot derive it. `normalize_name()` in
`ff/identity/crosswalk.py` strips generational suffixes ("Marvin Harrison Jr." →
`marvin harrison`); `normaliseName` in `lib/board.ts` does not. They are
different functions for different jobs — a join key and a search box — and the
drafted table has to be keyed on the one the pipeline actually stored. Postgres
cannot change a function's return type with `CREATE OR REPLACE`, so both are
`DROP`ped and recreated in `0005`, and **dropping a function drops its grants**,
which is why the `revoke`/`grant` pair is repeated there.

**No foreign key to `adp_projections`, and that is load-bearing.**
`replace_table()` runs `TRUNCATE adp_projections` on every refresh; a referencing
FK aborts it outright, and `TRUNCATE ... CASCADE` would delete the draft.
Verified rather than reasoned about: a mark was seeded, a real refresh was run,
and both survived.

**The toggle is a sibling of the row button, not a child.** The row button is
`disabled` for rookies, unmatched and absent players — 307, 92 and 191 rows,
including top-30 picks like Jeremiyah Love — which are precisely the rows most in
need of marking. `.r` is itself the grid, so the row is now a wrapper and the
button spans it through `grid-template-columns: subgrid`, keeping every existing
cell in its column. `.row` is shared with the career table, so the restructure is
scoped to a board-only `.brow` class.

**A poll cannot clobber an in-flight mark.** A `pending` ref holds
`norm_name → intended state` and is merged over every server read; without it the
15s poll flips a just-pressed row back under the reader's hand.

Still open on it:

- **Nobody has used it in a real draft.** Every path is verified against the live
  database and Kevin has seen it in a browser, but the thing it is for has not
  happened yet.
- **`/player` and `/compare` do not show drafted state.** Deliberate — the board
  is the draft-day screen, and `player_cards()` starts at `player_index` with no
  ADP guarantee.
- **The other eleven have still not been added**, so "shared" is currently a
  promise rather than an exercised path.

### The player depth pass, as built

Four changes to `/player/[id]`, one to the pipeline, and one one-time backfill.
The through-line: the page could rank a player and could not tell you anything
about him, and every number on it was a figure with no referent.

**A player page now has a player.** `player_index` carries eight more columns —
`headshot_url`, `birth_date`, `college`, `jersey_number`, `years_exp`,
`draft_number`, `draft_club`, `rookie_year` — and every one of them was already
in the nflverse roster file `player_index()` has read since day one. They were
being selected away.

The fold is the part worth understanding before touching it. **`team` and
`position` come from the latest roster row; the bio columns come from the last
row that actually has one.** 92 of 3,137 players on the 2025 roster have no
`headshot_url`, and taking the newest row wholesale blanks a portrait that an
earlier season had — the same portrait, because a face does not change with a
trade. `BIO_COLUMNS` and `CURRENT_COLUMNS` in `ff/analysis/players.py` name
which is which, and `tests/test_player_bio.py` pins the behaviour.

No backfill script was needed: `replace_table()` TRUNCATEs and rewrites
`player_index` whole on every refresh, so the next cron run filled all ten
thousand rows.

**Headshots are on the player page and must stay off the board.** Vercel bills
image optimization per cache *miss*, not per image in the project, and Hobby
includes 5,000 transformations a month. One portrait per player page means the
ceiling is "distinct players opened in a month", which twelve relatives will not
approach. One portrait per board row would be 923 transformations in a single
page view and would spend the month in five refreshes. The reasoning is written
into `next.config.ts` where someone would look before changing it. Overrun fails
soft: new images 402 and render their `alt`, cached ones keep working, Hobby is
never charged.

**The season arc** draws the weeks in order, in the expanded season above the
game log. The distribution discards week order on purpose — that is what makes a
median and an IQR better than an average — but a slow start that became a
breakout and a hot start that collapsed produce the *same* distribution. No new
query: `player_seasons()` has always returned `weeks` and `points`.

Weeks with no game break the line rather than being interpolated through, and
they are **listed, never called "missed"**. Every player has a bye,
`scored_weekly_stats` holds no schedule, and the app cannot tell a bye from four
weeks on IR. Naming the weeks is a fact; naming them missed would be a
diagnosis. **Storing `load_schedules()` is what would let the app tell them
apart** — the source wrapper exists in `ff/sources/nflverse.py` and the table
does not.

**The composition bar** says what a season's points were made of.
`0001_init.sql` has always claimed the 22 stat columns exist "so the UI can
explain a score, not just assert it", and until now the UI explained one week a
season. Gibbs 2025 takes 29% of his points from touchdowns; Chase takes 15% —
that is the difference between a regression candidate and a volume asset, and
the page was showing a total. `decompose()` became a special case of
`decomposeSeason()` over one week; `GameLog` already had the array.

Two rules in it that should survive edits. **Every segment is the player's own
team hue at a different opacity, never a different hue** — colour on this app
means team, and a categorical palette here would be a second colour language
competing with the one the board teaches. **Amber stays out**: it marks the
median and nothing else earns it. And the drift tolerance **scales with the
number of weeks** rather than staying at a flat tenth of a point, because 17
weeks of float arithmetic accumulates more error than one and a check that
trips on rounding alone would cry wolf every season.

**The positional band** is the denominator the fixed 0–56 axis never had. Median
14.2 is either an excellent running back or a replaceable one and the app could
not say which. `idx_scored_position_points` was built for this in `0001` and had
never been used by anything.

**The cohort is the feature, not a parameter.** Measured on 2025:

| cohort | p25 | median | p75 |
|---|---|---|---|
| top 12 RBs | 11.4 | 17.0 | 22.8 |
| top 24 RBs | 8.7 | **14.3** | 20.1 |
| top 36 RBs | 7.2 | 12.1 | 18.7 |
| all 151 RBs | 1.1 | **5.1** | 11.4 |

The number moves enough with the cutoff that it could not be buried, so it is
**derived** — `p_teams` × starters at that position — rather than picked. The
lineup that implies (1 QB, 2 RB, 3 WR, 1 TE, 1 K) is stated in the migration as
the assumption it is: **the Yahoo integration that would tell us this league's
real roster settings is still stubbed.** When it lands, `position_starters()` is
the one function to change and every band moves at once.

Two decisions in it worth not reversing. **Position comes from the weeks via
`mode()`, never from `player_index.position`** — the index holds what a player
is *now* and this ranks seasons up to a decade old, so a receiver who finished
at tight end must be ranked against receivers in the years he was one. And **a
rank past the cohort is shown, not hidden**: Allen's rookie year reads `QB21 of
12`, which is the truth about it, and blanking out-of-cohort seasons would empty
exactly the rows carrying the worst news.

It also landed on `/compare`, which was already paying for the query. That is
the screen where it matters most — comparing a back with a receiver on raw
points compares two different jobs. **The rank row is never marked as a win**:
`RB3 of 24` and `QB1 of 12` are ranks in differently sized pools, the same
reason the IQR row refuses to crown anything.

### Historical ADP, and why it is a separate table

The app has scored every NFL week in this league's terms for ten seasons and
could never say whether a player was *worth* his draft slot, because it only
ever knew one slot: `replace_table()` TRUNCATEs `adp_projections` on every
refresh and Sleeper serves the season being drafted. Each August overwrote the
last one.

Fantasy Football Calculator publishes the missing half as free JSON, no auth,
one document per season — **PPR and 12-team, which is this league exactly**.
`ff/sources/ffc.py` wraps it; `scripts/ingest_adp_history.py` is a one-time
backfill run by hand, not part of the cron. 2,936 rows, 2012–2026, now in
`adp_history`.

**A separate table rather than a wider `adp_projections`, and that is
load-bearing.** `adp_projections` is a cache the cron rebuilds each morning;
this is accumulated history that cannot be re-derived if lost — the same
distinction `0001` draws for `injury_news`. Keeping them apart means the daily
TRUNCATE can never reach it. It is also why `authenticated` gets `SELECT` and
nothing else: Supabase's default grants hand out `TRUNCATE`, and **RLS is not
consulted for `TRUNCATE` at all**.

The sample thins going back — 303 drafts in 2012 against 8,470 in 2025 — so
`times_drafted` and `stdev` are carried rather than dropped. A 2012 ADP and a
2025 ADP are not equally trustworthy and the table can say so.

Match rates, measured 2026-08-16:

| scope | rate |
|---|---|
| all rows, all seasons | 91.2% |
| excluding team defences | 96.4% |
| excluding DEF, 2016+ | **99.2%** (2,075 of 2,091) |

The widest number is the least useful. Team defences are ~9% of every FFC season
and have no `gsis_id` by definition. Below 2016 the misses are players who
retired before `player_index`'s window opens — Calvin Johnson, Peyton Manning,
Ray Rice — who have no scored weeks to compare a price against anyway. What is
left at 99.2% is **16 rows over eleven seasons, every one a first-name variant**:
Hollywood/Marquise Brown, Joshua/Josh Palmer, Steven/Steve Hauschka,
Michael/Mike Badgley, Chris/Christopher Herndon, Kenny Gainwell.
`attach_player_ids()` matches exact normalised names only, and `ff.identity`'s
fuzzy resolver is **deliberately not reached for** — 16 auditable nulls beat a
threshold that might quietly attach the wrong man.

**The UI now reads `adp_history`.** See "Draft cost, as built" below.

### Draft cost, as built

**Built 2026-08-16, on `draft-cost`. Migration `0009` is written and tested but
NOT applied** — see "State as of the end of the 2026-08-16 draft-cost session".

The career table could say where a season finished among startable players at a
position and could not say where it *started*. Every rank on the page was a
result with no price beside it, which is half of the only question a drafter is
asking. `draft_value()` in `0009` supplies the other half, and `/player/[id]`
gains a **Cost** column immediately left of **Rank**.

It reads as a career in two columns. St. Brown: WR63→WR22, WR30→WR7, WR8→WR3,
WR3→WR3, WR7→WR3 — a player who has beaten his price every year he has played.
McCaffrey: RB1→RB54 and RB1→RB68 in the two seasons he got hurt, RB1→RB1 and
RB4→RB1 in two he did not. Neither of those was answerable before.

| Decision | Why |
|---|---|
| **The price is a positional rank, not the ADP** | `13.2` beside `WR3` asks the reader to convert between an overall pick number and a positional finish, which is exactly what `0008` was written to stop doing. `WR8` beside `WR3` needs no conversion. The raw ADP and the drafts behind it go in the `title`. |
| **The two pools are different sizes on purpose** | Cost is out of the players *drafted* at that position (64 backs in 2025); rank is out of everyone who *played* there (151). Forcing them to share one denominator would cap a bust at the end of its own draft pool, and `RB68` is the fact about McCaffrey's 2024. Both denominators travel in the titles. |
| **No verdict is drawn from the pair** | No green, no arrow, no delta column. A back returning RB6 on an RB2 price had a fine season, and the same refusal is already in the IQR column and the compare page's rank row. The subtraction is one glance away for anyone who wants it. |
| **Position comes from whoever priced him** | `position_context()` takes position from the weeks, because it describes what a player *did*; this takes FFC's label, because it describes what the market *bought*. They differ on **8 of 1,818 pairs, 0.4%** — 2025's only case is Travis Hunter, drafted WR33 and playing corner, and `WR33 / CB1` describes that season better than either label alone. |
| **`PK` folds to `K`** | FFC spells kickers `PK`. Unfolded, all 184 of them read as position disagreements and each is ranked in a pool of one. That fold is where the 0.4% above comes from not being 10%. |
| **Cost is dimmed against Rank** | The columns run cost-first because that is the order the season happened in, but the row should still read result-first. `--muted` against `.rank`'s `--ink` does that without a second colour. |
| **An empty cell is an em dash** | He was not worth drafting that year, or the season predates the data. Same treatment as every other honest absence on the screen. |

It also lands on `/compare` as a **`2025 draft cost`** row directly above the
position-rank row, so the pair reads there too. Never marked as a win, and for a
stronger reason than the rank below it: being drafted earlier is not being
better — it is the number the row underneath is the answer to.

**The comparison window is 2016–2025, not 2012–2025.** `adp_history` goes back
to 2012 but `scored_weekly_stats` starts in 2016, so the four earliest seasons
have a price and nothing to compare it against. They render as ordinary rows
with no cost, because the career table only lists seasons a player actually
played. Coverage inside the window is ~99% of matched ADP rows.

**`.career .grid` is `66rem` where `.grid` is `62rem`.** The extra column needs
its width, and `.grid` is shared with the board and the pickers, which have no
cost column. Raising the shared value would have made the board scroll earlier
for nothing.

### The machine has a browser now

Every previous handover ended on the same line: *nobody has seen the built
result in a browser except Kevin*. That is no longer true, and the setup is
worth ten minutes of the next session's time because it found two things in this
one that no amount of reading the source would have.

```bash
npx playwright install chromium                    # ~/Library/Caches, not the repo
cd <scratchpad> && npm install playwright pngjs    # NOT in the repo's package.json
```

Keep it out of `package.json` deliberately: it is a development instrument, not a
dependency of the app, and the repo has no JS test runner to hang it off.

**The trick that makes it useful is the throwaway probe.** `proxy.ts` treats
`/auth/` as public, so a page at `app/auth/probe/page.tsx` renders any component
tree to an **unauthenticated** URL that Playwright can open with no session.
Feed it real rows pulled straight from Postgres — `player_seasons()`,
`position_context()`, `player_week_log()` all return JSON via `row_to_json` — and
what renders is the real layout with the real fonts and the real compiled CSS.
**Delete it before committing.** It was deleted at the end of this session.

Three things it is good for, in descending order of how much they were worth:

1. **Measuring contrast, not judging it.** Screenshot an element, cluster its
   pixels by luminance, and compute the ratio between the two clusters. That is
   what caught the composition bar — a defect that had been described in the
   handover as a *guess* about light mode for two sessions and turned out to be
   real in both themes. See "The composition bar was wrong in both themes".
2. **Sweeping the viewport.** Thirteen widths from 1920 down to 390, reporting
   `documentElement.scrollWidth` and every element whose right edge is past the
   viewport. This is how the `.page-head` overflow was disproved rather than
   guessed at.
3. **Sweeping the palette.** The probe takes a `?tm=` parameter, so one script
   renders the same component in sixteen team hues. Anything that depends on
   `--tm` — and on this app that is the plot, the row stripe, the composition
   bar and the page head — is only as correct as its worst hue, and Detroit's
   blue is not a representative sample of a palette that also contains
   Pittsburgh's gold.

**The scripts themselves are gone.** They lived in the session scratchpad and
were never committed, because they depend on a `playwright` install that is
deliberately not in `package.json`. Rebuilding them is minutes, and only one is
non-obvious — the contrast measurement, which is worth restating because
eyeballing a screenshot is exactly what let this defect survive three sessions:

> Screenshot the *label element* rather than the page. Convert each pixel to
> relative luminance, sort, and take the mean of the darkest 8% and the mean of
> the lightest 8% — those two clusters are the glyphs and the fill behind them,
> whichever way round. The WCAG ratio between them is the number. It works
> without knowing what colour anything resolved to, which is the point when the
> colour is coming from `opacity` over a custom property under a blend mode.

The other three were a width sweep (13 viewports, reporting `scrollWidth` and
any element whose right edge passes the viewport), a hue sweep (the probe's
`?tm=` parameter across 16 teams), and a plain `psycopg` query helper that reads
`POSTGRES_URL_NON_POOLING` out of `.env.local` — which `config.py` does not,
because it loads `.env`.

**What it still cannot do is sign in.** `getUser()` revalidates against the auth
server, and reading `auth.users` to mint a matching token is blocked from here.
So the probe renders components with fixture data; it does not exercise a real
session. Both remaining browser checks in "Next steps" still need Kevin.

### The composition bar was wrong in both themes

The previous handover flagged this as a light-mode risk: *"the composition bar's
opacity steps are the thing most likely to be wrong on a light ground."* Right
instinct, wrong scope. Measured, the labels failed in **both** themes.

The cause was mechanical rather than aesthetic. `opacity` was set on `.comp-seg`
itself, and **opacity applies to the whole subtree** — so every step past the
first faded its own label by exactly as much as it faded the background behind
it. No label could ever win, in any theme, for any team. The third segment
measured **2.19:1 in light and 2.42:1 in dark**, against the 4.5:1 an 8.8px
label needs.

The fix moves the fill to a `::before` so the step never reaches the label. **The
bar looks exactly as it did** — which matters, because Kevin approved that look.

Choosing the label colour then took three attempts, and the two that failed are
the interesting part:

| Attempt | Why it failed |
|---|---|
| Knock every label out to the ground colour | What was already there. Ground on ground as soon as a step fades. |
| One threshold, ink below it and knockout above | Passes for Detroit and fails for Pittsburgh. The crossover depends on the **hue**, and the threshold that fixes a blue inverts for a gold. |
| Halo on everything, no knockout | Fails in dark mode on the bright hues — PIT 3.76, LV 3.90, SEA 4.14 — where near-white ink sits on a near-white fill. |

What shipped is both: **faded steps take `--ink` on a halo of the ground, in both
themes; only the full-strength segment knocks out, and only in dark mode.** That
asymmetry is a fact about the palette rather than a preference — the `.tm-*`
dark-mode variants are genuinely bright, so a dark ground knocks out of them
cleanly, while the light-mode variants are mid-value golds and oranges that
white cannot sit on. White on Pittsburgh's `#977f0d` is 3.32:1.

**Worst case after the fix: 4.75:1**, across sixteen hues, both themes, all
three segments. `mix-blend-mode: luminosity` is gone — it gave the glyphs the
backdrop's own hue and chroma, which is the opposite of what a label on a
coloured field needs.

**Re-run the sweep if `STEPS` or any `.tm-*` value moves.** It is the only check
that covers this, and there is no test that will catch you.

### The `.page-head` overflow does not reproduce

The previous handover's next-step 4 recorded a defect spotted in a screenshot:
*"On `/player/[id]` the dateline runs to the very edge of the viewport while the
career panel below stops short of it."* It was deferred deliberately, so it was a
known thing rather than a discovery.

Measured at thirteen viewport widths from 1920 to 390, on the full player page
with a portrait, a bio, a stat strip and a five-season career table:
`documentElement.scrollWidth` **equals the viewport at every one of them**, and
`.page-head`, `.dateline`, `.appbar`, `.stats` and `.career` share a right edge
to the pixel at every one of them. There is no page-level overflow and no
misalignment between the head and the panel.

What is genuinely there, and is the likeliest thing the screenshot showed, is
that **`.career` has `1.4rem` of padding inside its border while `.page-head`
has none** — so the panel's *contents* stop 23px short of the dateline while
their borders align. That is the panel behaving as a panel, not a bug.

The one thing not ruled out is a state the fixture did not have: a much longer
name, or an injury pill on the bio line. If it is seen again, grab the viewport
width with it — the sweep above will find it in a minute given a width.

### The one thing sized by eyeball, and what it cost

The arc shipped at a viewBox of 720×150, chosen against an assumed container
width. `.shell` is `max-width: 90rem`, so the plot area is about 1330px, which
scaled that box by 1.85: a **277px chart under a 30px row, with 20px axis
labels — larger than anything else on the page.** SVG text scales with the
viewBox, so the height and the labels were wrong for the same reason and were
fixed by the same change (1080×160).

Everything else in this pass was verified against real data before shipping.
This was not. **If you add another SVG here, size its viewBox against 1330px**,
and remember that its `font-size` is in viewBox units.

### The header and the brand, as built

**Built and merged 2026-08-16 (PR #5).** Kevin supplied the name, chose
"family-league personality" as the tone, and named the sections worth designing
for: Draft day, the League layer, and Trends. Three directions were mocked
against live `draft_board()` rows and he chose the Crest, with the Almanac's
dateline folded into it.

Published mockup — https://claude.ai/code/artifact/4f1ea6be-6a1e-4315-ae65-b01f9a93e082

**The problem was structural, not visual.** The masthead put a *page* name —
"Draft board" — in the largest type on screen, so the app had no name at all, and
wedged the section nav above it where it read as that title's subtitle. Two
levels of identity had collapsed into one. And `.who-am-i` was a junk drawer: how
old the data is (a fact about the **data**), an email and a sign-out (the
**account**), and a theme control (a **preference** set once) in a single flex
row — which made the rarest action in the app as loud as the screen you were on.

| Decision | Why |
|---|---|
| **A crest, not a wordmark alone** | Twelve relatives. A mark goes on a trophy, a group chat and a shirt; a typographic lockup does not. Drawn as inline SVG in `app/chrome.tsx` so it inherits the theme — shield in `--ink`, the initial **knocked out** to `--panel` so it works on the bar and the sign-in card alike, and the bar beneath it in the one amber. |
| **No new colour** | The palette already spends amber on the median, `--good` on good and `--bad` on bad. A brand hue would be a fourth claim on a screen whose whole argument is that colour means something. Nothing in this pass added a token, which is also why all four theme states still resolve without re-checking them. |
| **No third typeface** | Character comes from weight, case and tracking in Libre Franklin, which was already loaded. A display face would have been a third `next/font` download for the sake of one line of chrome. |
| **The dateline is identical on all four screens** | That is what makes it a dateline rather than a caption: one place to look for "how current is this", whether you are on the board or in a career. `2026 season · draft in 14 days · data 6h ago`. |
| **Tabs are set in the text face** | Mono-uppercase at 0.62rem is exactly what made the old nav read as a caption. These are words you read, not figures you compare. |
| **Two families, not six peers** | Board · Players · Compare are about *players*; League and Trends will be about *teams*. `.tab-div` is written, styled and **deliberately unused** — the hairline is what says which family a section is in before anyone reads a word. |
| **Draft day is a mode, not a tab** | It is a state the board is in, not a fourth screen. Its live pill belongs beside the avatar, and `app/chrome.tsx` marks the spot. |
| **The account popover is a disclosure, not an ARIA menu** | `role="menu"` promises arrow-key navigation over `menuitem` children. This holds an address, a three-state toggle and a form; declaring the role without the behaviour is worse for a screen reader than not declaring it. |
| **A player's page takes his team's hue** | The bar beside his name *and* the hairline under the page head read `--tm`, the same hue his row carries on the board — `.page-head::after` is `linear-gradient(to right, var(--tm, var(--amber)), transparent)`, so the amber is the fallback rather than the rule. |

**The countdown fails quiet.** `DRAFT_DATE` is an ISO date with no time, because
nobody has fixed one and an invented hour would render as fact. Once the date has
passed the dateline **drops the segment entirely** rather than counting down to a
day in the past, so a forgotten constant next August reads as absent rather than
wrong. Both sides compare in UTC: local midnight would tick the number over at a
different moment for relatives in other zones. The exact date and the refresh
stamp both live in the dateline's `title`, because pages revalidate hourly and a
rendered "6h ago" can itself be an hour stale.

**Freshness now reaches every screen without an extra round trip.** It is
threaded through `fetchPlayerOptions` (which already called `fetchBoard`) and
added to `fetchPlayers`' existing `Promise.all`, rather than given its own
`cache()`d fetch.

**`LEAGUE_NAME`, `LEAGUE_FOUNDED` and `DRAFT_DATE` are constants in
`lib/board.ts`**, and `layout.tsx`'s metadata template reads the first — so a
browser tab says `Compare · Noble Family Football` and the name is written once.

Still open on it:

- **`/player` and `/compare` got the new chrome, not a new interior.** The bar,
  the page head and the dateline are theirs; the stat strip and the comparison
  table below them were not touched. See "Still owed on design".
- **The mobile view is still nothing.** The app bar wraps rather than collapsing,
  which is not a design.
- **The League and Trends tabs do not exist yet.** The structure holds them; no
  route does.

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
   eleven added until there is something he is ready to share. Every blocker he
   named for that is now merged and live — the board's design pass, the
   draft-day toggle, and the header pass that gave the app a name to be shared
   *as*. **Still do not add them without being asked**, but this is the item with
   a closing window: the draft is 30 August. It also gates the drafted table's
   *shared* half — with one address on the allowlist, "everyone sees the same
   board" is a property nothing has exercised.

3. **The layout can now be looked at by the machine, but only signed out.**
   This used to read "never been looked at in a browser". Playwright plus a
   throwaway public probe covers layout, contrast and the theme states with
   real components and real CSS. What it does not cover is anything behind a
   session — the drafted toggle round-tripping, the account popover, a real
   sign-in — because `getUser()` revalidates against the auth server and
   minting a matching token is blocked. Those still need Kevin.

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
| `player_index` | 1 more | Roster entry whose `gsis_id` is the empty string rather than null. Would have become a row keyed on `""`. |
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
| **One palette on `:root`, not per-component** | Three copies of the same ten properties on `.board`, `.career` and `.picker` is what made the board theme-deaf and let the screens drift. See "The design pass, as built". |
| **Colour on the board encodes the team** | On a screen this dense colour either encodes something or it is a sticker, and team is already in every row. |
| **`THEME_SCRIPT` is in `lib/theme.ts`, not the client component** | A client module's exports become client references in a server component, and the flash-prevention silently rendered nothing. |
| **Row expansion fetches on demand** | 923 game logs is a payload almost none of which gets read. |
| **`player_cards()` starts at `player_index`, not `adp_projections`** | A player page must render for someone with no price. See "Why `0004` exists". |
| **`/compare` caps at three** | The plots share one axis and a fourth column makes the shapes incomparable, which is the only thing the screen is for. Extra ids in the URL are dropped, not shrunk. |
| **The middle 50% has no "winner" on `/compare`** | A narrow spread is a different asset, not a better one. Highlighting the narrower one is the mistake the board's "safest floor" sort already avoids. |
| **The plot lives in `app/plot.tsx`** | Three screens drawing the same axis from three copies of the arithmetic is how a fixed scale stops being fixed. |
| **Search is client-side over the priced players** | Instant, no index, no round trip. The alternative needs `pg_trgm`. See "Routes". |
| **The app bar carries identity, the page head carries the page** | Collapsing the two left the product nameless and the nav reading as a subtitle. See "The header and the brand, as built". |
| **The brand gets no colour of its own** | Amber is the median, `--good` is good, `--bad` is bad. A fourth hue on a screen that argues colour means something is one claim too many. |
| **The dateline is the same on every screen** | One place to look for "how current is this". A per-screen wording would make it a caption again. |
| **`.tab-div` exists and is unused** | Board/Players/Compare are about players; League and Trends will be about teams. The divider is the structure that keeps a sixth section from being a sixth peer. |
| **Commit to `main`, branch only with a reason** | Linear history, solo repo. See "Git and deployment". |
| **Drafted marks live in Postgres, not `localStorage`** | *Drafted* is a fact about the room, and it survives a device switch. See "The draft-day toggle, as built". |
| **Drafted is keyed on `(season, norm_name)`** | One draftable player has no `player_id`. See the same section. |
| **No FK from `drafted` to `adp_projections`** | The refresh truncates that table daily; an FK aborts it. |
| **Drafted state is client state over a server-rendered board** | The board revalidates hourly; a mark has to appear the instant it is pressed. |
| **Draft cost is a positional rank, not an ADP** | An overall pick number beside a positional finish makes the reader convert between two scales, which is the mistake `0008` exists to stop. See "Draft cost, as built". |
| **Cost and rank keep different denominators** | Drafted-at-that-position against everyone-who-played-there. One shared pool would cap a bust at the end of its own draft pool. |
| **The cost/rank pair gets no verdict** | Same refusal as the IQR column and the compare page's rank row: earlier is not better, it is the number the result answers. |
| **Composition labels are measured, not judged** | The bar's labels failed in both themes for two sessions while being described as a light-mode risk. See "The composition bar was wrong in both themes". |
| **The palette is swept by hue, not sampled** | Anything keyed on `--tm` is only as correct as its worst of thirty-two hues, and Detroit's blue is not a representative sample of one that also holds Pittsburgh's gold. |

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

PRs #1–#6 are merged. **The draft-cost pass is on `draft-cost`.**

**The draft is 30 August. That is the deadline everything below is ranked
against**, and as of this handover it is fourteen days away.

0. **Kevin looks at the cost column, then PR #7 merges.** Migration `0009` is
   already applied, so merging is the only step left and the database needs
   nothing. Check out `draft-cost` before starting the dev server or the screen
   will not have it — see "Start here".

   The thing worth his eye rather than the machine's: whether **Cost dimmed
   against Rank** is the right weighting. The machine can prove both are
   legible and cannot judge whether the row still reads result-first, which is
   the whole intent of the dimming.

1. **Rehearse a mock draft on production.** Mark thirty players, hide them, undo
   one, clear the board. The feature has never met the thing it is for, and this
   is the last cheap moment to discover that "hide" was the wrong call over "grey
   out". It also closes the one path never exercised through a real browser
   session on the hosted origin: the write path has only ever been driven against
   the live database with hand-signed JWTs.

   **What was already checked on production after PR #5 merged**, 2026-08-16:
   `/login` serves the crest and `Sign in · Noble Family Football`, so the deploy
   shipped; `/api/cron/refresh` answers **401 with no redirect** — the regression
   that hides; and `/` serves a **307 to `/login`** signed out.

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
     https://fantasy-football-red.vercel.app/api/cron/refresh
   ```

   **Still owed and needs a browser:** that both themes render on a *signed-in*
   screen. Everything verified above is either signed-out or machine-readable.

2. **Then add the other eleven league members** to `league_members`. Each needs
   pre-creating, because `disable_signup` blocks a first OAuth sign-in. **Do not
   do this before Kevin asks** — he has said he wants something he is ready to
   share first, and the header pass was the last thing he named as standing
   between here and that. With a draft in a fortnight, this is the item whose
   window closes: eleven people cannot use a shared drafted board on the day if
   they were added the night before.

3. **Then the mobile view**, if the eleven are in. Eleven relatives invited to a
   URL will open it on a phone, and today that is a 62rem grid on a 24rem screen.
   The app bar is the easy half; the board is the hard half and probably wants
   its own layout rather than a reflow — see "Still owed on design".

4. **The `/player` and `/compare` interiors**, which is the oldest outstanding
   design debt now that their chrome is settled. Lower stakes than the three
   above: those screens are consistent and not broken. The cost column is one
   more reason to look at `/compare`'s metric table, which is now eleven rows
   of the board's tokens in a layout nobody designed.

5. **The rest of what `adp_history` can answer.** The per-player half is built
   (see "Draft cost, as built"); the cross-player half is not. "What has a pick
   at RB4 actually returned, over ten seasons" is a `group by` away and would
   put a curve behind every price on the board rather than beside one career.
   That is a Trends screen, and the nav already holds a slot for it.

6. **In-season: run the Yahoo score diff** to close Q2 and Q3.
7. **Then team defense** (Q4), once Q3 is settled.

Two items are gone from this list rather than done:

- **The `.page-head` overflow** was measured at thirteen widths and does not
  reproduce. See "The `.page-head` overflow does not reproduce".
- **The composition bar's light-mode risk** was real, was worse than described,
  and is fixed. See "The composition bar was wrong in both themes".

Worth knowing about item 3: **the arc, the composition bar and the field band
are all desktop-sized**, and the arc's labels shrink with the container because
SVG text scales with its viewBox. The mobile pass now has three more components
to think about, not one board.

Worth doing at some point, and not urgent: **close the default grants on the
other seven tables** (see "Things that will bite you"). Harmless today because
they are all caches, but the reasoning that leaves them open is wrong about
`TRUNCATE`.

Not on this list, deliberately: **the sign-in branding**. Google shows
`sebizyhnwgarnbukqkxu.supabase.co` because an unverified OAuth brand falls back
to showing the client's domain, and the Supabase callback host *is* that domain.
Both fixes need a domain Kevin owns — Supabase's custom-domain add-on (Pro at
$25/mo plus $10/mo, since the add-on is not sold on Free) or Google brand
verification (a domain, ~$12/yr, plus publishing the consent screen out of
Testing, which disables the test-user list). **Deferred until onboarding**, and
worth revisiting then because a domain would also replace
`fantasy-football-red.vercel.app`.

That deferral is worth more now than it was. The app has a name, a crest and a
sign-in page that carries both — and the Google consent screen in the middle of
that flow still says `sebizyhnwgarnbukqkxu.supabase.co`. It is the one place the
branding stops, and eleven people are about to walk through it. Nothing here has
changed technically; the cost/benefit has. A domain like
`noblefamilyfootball.com` would fix the consent screen, the deployment URL and
the sign-in host in one purchase.

### Why these went through a PR

The standing rule is still commit-to-`main`, and it has not changed. Kevin asked
for a PR on the design pass, again on the draft-day toggle, and again on the
header pass. The first UI change also took a branch, for a different and
now-historical reason: it was the first push that changed which framework Vercel
builds the project with.

Read the pattern rather than the rule: **every change to what the app looks like
has gone through a PR, and Kevin has asked for one each time.** Offer it.

Note the working shape this settled into: the work is committed to `main`
locally, then moved onto a branch when a PR is wanted. Committing is cheap and
local; **pushing is the outward-facing step**, and on this repo it is also the
step that ships.

## State as of the end of the 2026-08-16 draft-cost session

- **PR #6 is merged. The draft-cost pass is on `draft-cost` as PR #7**, three
  commits: the composition-label fix, the cost column, and this handover.
  **`main` does not have any of it.**
- **Migration `0009_draft_value.sql` IS applied to the live database**, before
  the code that reads it shipped — the same order `0001`–`0008` used. Verified
  after the fact: `prosecdef` false (SECURITY INVOKER), `provolatile` `s`
  (stable), and `EXECUTE` granted to `authenticated` and `service_role` but not
  `anon`. It is additive: one function, one grant, nothing dropped or narrowed.
- **RLS on it was verified with HS256 tokens**, the way `0002`–`0008` were: a
  member reads 16 rows, a member in different email casing reads 16, a
  non-member reads 0, a token with no `email` claim reads 0, and `anon` is
  refused outright with `permission denied for function draft_value`.
- **Note this asymmetry, because it is the one thing that could confuse a
  rollback:** the function exists in production while `main` has no code that
  calls it. That is harmless — nothing deployed references it — but it means
  reverting the branch does not require touching the database, and re-applying
  `0009` is not something a future session needs to do.
- **This machine has a browser for the first time.** See "The machine has a
  browser now". It is the reason two of the three findings below exist.
- **The composition bar's labels were failing in both themes**, not just light
  as the previous handover guessed — 2.19:1 and 2.42:1 on the third segment.
  Fixed and measured to a worst case of 4.75:1 across sixteen team hues.
- **The `.page-head` overflow does not reproduce** at any of thirteen viewport
  widths. Recorded rather than silently dropped, with what to grab if it is
  seen again.
- **The cost column was verified against real data**, not reasoned about: the
  rows on screen are `draft_value()`'s own output, and the edge cases were
  exercised — a never-drafted player returns zero rows and renders an em dash,
  `PK` folds to `K` across all 184 kickers, and the position-disagreement rate
  is 8 of 1,818 rather than the ~7% a first count suggested before the fold.
- `tsc`, `next build`, 62 Python tests and `ruff` all clean.
- **The throwaway probe under `app/auth/` was deleted**, as it must be.
- **Still not seen by a human**: the cost column in a browser. The machine has
  looked at it in both themes; Kevin has not.
- **A `next dev` server may still be running on port 3000.**
- Nothing is half-finished.

## State as of the end of the 2026-08-16 player depth session

- **PR #6 (`player-bio`) is open. Everything else is merged.** Seven commits:
  bio and portraits, historical ADP, the college fix, the arc, the composition
  bar, the positional band, and its use on `/compare`.
- **Migrations `0006`, `0007` and `0008` are applied to the live database**,
  each in one transaction, before the code that uses them shipped — the same
  order `0001`–`0005` used. `0006` and `0008` recreate `player_cards()` and add
  a function; `0007` adds a table. Nothing existing was dropped or narrowed.
- **A refresh was run after `0006`** so the bio columns are populated: 10,145
  rows, 8,940 with a portrait, 1,190 of 1,259 current skill players.
- **`adp_history` is backfilled**: 2,936 rows, 2012–2026, 99.2% matched on the
  seasons that have scored data.
- **RLS on the new objects was verified with HS256 JWTs**, not assumed: a member
  reads (in any email casing), a non-member and an email-less token read zero
  from every RPC including `position_context()`, `anon` is refused outright, and
  a member's INSERT, UPDATE and DELETE against `adp_history` all return 403 with
  the row count unchanged.
- **Arithmetic was verified against real data rather than reasoned about.**
  Season composition is exact against a back, a receiver, a quarterback and a
  kicker — four different rule sets. The arc's run-splitting was checked against
  McCaffrey and Gibbs (both split correctly on their byes) and its geometry
  clamps at both ends. `ageFrom`, `ordinal` and `tenure` were exercised across
  23 edge cases including birthday boundaries and 11th/12th/13th.
- **Those JS checks are not committed.** The repo has no JS test runner —
  `npm run lint` is `tsc --noEmit` — and adding one was out of scope. They were
  run from the scratchpad. **If you touch `decomposeSeason`, `shares`, the arc
  geometry or `ageFrom`, there is no test that will catch you.** That is the
  largest gap this session leaves.
- **Two bugs were found by looking at a screenshot, not by testing.** The
  college field renders `Alabama; Georgia Tech` for the 1,027 players nflverse
  lists a transfer for, and the arc was sized against a guessed container width.
  Both are fixed. Both would have shipped if nobody had looked.
- **Not a bug, checked: Jahmyr Gibbs really does wear #0.** The number has been
  legal since 2023 and 34 players have one.
- `tsc`, `next build`, 62 Python tests and `ruff` all clean.
- **Phases 2–4 have not been seen in light mode.** Kevin reviewed the dark
  theme; the composition bar's opacity steps are the thing most likely to be
  wrong on a light ground.
- Nothing is half-finished.

## State as of the end of the 2026-08-16 header session

- **PR #5 is merged (`0e3a50f`). Nothing is on a branch and `main` is pushed.**
  Everything under "The header and the brand, as built" is live in the repo.
- **The app is called Noble Family Football**, founded 2021, drafting 30 August.
  Kevin supplied all three; none was inferred, and the first commit deliberately
  shipped without the date and the year rather than guessing them.
- **Production is confirmed running the merged header pass.** `/login` serves the
  crest and the title `Sign in · Noble Family Football`; `/api/cron/refresh`
  answers `401` with no redirect; `/` `307`s to `/login` signed out.
- **Two checks still need a browser**, and they are item 1 of "Next steps": both
  themes rendering on a *signed-in* screen, and a drafted mark round-tripping
  through a real browser session on the hosted origin.
- `tsc`, `next build`, 56 Python tests and `ruff` all clean.
- **Verified without a browser**: the production build; that the pass introduces
  **no new CSS token**, which is what makes "all four theme states still resolve"
  a fact rather than a hope; the countdown's boundaries at 14 days, tomorrow,
  today and both sides of the date; and the server-rendered markup of the app
  bar, page head, dateline, team hue and sign-in card, read back off a throwaway
  public route under `app/auth/` which was then deleted.
- **Kevin confirmed the visual result locally.** The machine that built it still
  has no browser.
- **A `next dev` server may still be running on port 3000.**
- Nothing is half-finished.

## State as of the end of the 2026-08-16 draft-day session

- **Production runs the merged board redesign (`9dbce48`).** Both post-merge
  checks from the previous handover were re-run and passed: the cron answers
  `401` with no redirect, and the board `307`s to `/login` signed out. The
  served HTML carries the inline theme script and the compiled CSS carries all
  four theme states, so the design pass is confirmed live.
- **The draft-day toggle is built and on `draft-day`, with an open PR.**
  Everything under "The draft-day toggle, as built" is in it.
- **Migration `0005_drafted.sql` is applied to the live database**, the same way
  `0001`–`0004` were, before the code that uses it shipped.
- **The write path was verified against the live database with HS256 JWTs**: a
  member inserts and deletes, a non-member and an email-less token are refused
  the insert outright and read zero rows, and `anon` is refused all three.
- **The `TRUNCATE` prediction was tested, not assumed**: a mark was seeded, a
  real `ff refresh` was run, the refresh succeeded and the mark survived.
- **A grants hole was found and closed on `drafted`**: Supabase's default
  privileges had handed `authenticated` `TRUNCATE`, which no RLS policy is ever
  consulted about. The other seven tables still carry it — see "Things that will
  bite you".
- `tsc`, `next build`, 56 Python tests and `ruff` all clean.
- **Kevin confirmed the visual result locally**; the machine that built it still
  has no browser.
- **A `next dev` server may still be running on port 3000.**
- Nothing is half-finished.

## State as of the end of the 2026-08-16 design session

- **The board's design pass is built and on `board-design`, with an open PR.**
  Everything under "The design pass, as built" is in it.
- **`tsc`, `next build`, 56 pytest and `ruff` are all clean.**
- **Verified without a browser, because the machine had none**: the production
  build, the compiled CSS (all four theme states resolve, including the
  Lightning CSS polyfill), the inline theme script's presence in the served
  `<head>`, and the grid column counts against the markup on both screens whose
  templates changed. Kevin confirmed the visual result locally on
  `http://localhost:3000`.
- **`/player` and `/compare` were re-tokenised, not redesigned.** Deliberate —
  see "Still owed on design".
- **A `next dev` server may still be running on port 3000.**
- Nothing is half-finished.

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

- **A new season is four constants, not one.** `ADP_SEASON`, `STAT_SEASON` and
  `DRAFT_DATE` in `lib/board.ts` all have to move together, and the pipeline's
  seasons with them. Getting `DRAFT_DATE` wrong is the quiet one — it fails by
  disappearing from the dateline rather than by showing something false, which
  is the right failure but also the one nobody notices.

- **A `"use client"` module's exports are client references, even the strings.**
  `THEME_SCRIPT` imported into `layout.tsx` from the client component arrived as
  a proxy, and `dangerouslySetInnerHTML` rendered nothing — no error, no warning,
  just a white flash on every navigation in dark mode. Constants a server
  component needs go in a plain module. See "The theme toggle, and the trap in
  it".

- **Lightning CSS rewrites `light-dark()` and eats the fallback in front of it.**
  Writing a literal colour before a `light-dark()` for older browsers does not
  survive the build: only the polyfilled declaration ships. Check the compiled
  CSS rather than the source when a colour does not appear.

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

- **Supabase grants `ALL` on every new table in `public` to `authenticated`, and
  RLS is never consulted for `TRUNCATE`.** A `grant select, insert, delete` on a
  new table is therefore a *no-op* — the table already arrives with `UPDATE`,
  `TRUNCATE`, `TRIGGER` and `REFERENCES` as well. `UPDATE` is held closed by the
  absence of an update policy, but **no policy is ever asked about `TRUNCATE`**,
  so the table privilege is the only barrier. `0005` therefore revokes from
  `authenticated` explicitly before re-granting. **Every other table still
  carries the defaults** — harmless on tables the cron rebuilds every morning,
  and worth closing anyway, because the reasoning that says "RLS has it covered"
  is wrong for exactly one verb.

- **A new table's write policy needs the non-member case exercised, not
  assumed.** Read policies fail visibly — you get no rows. A missing or wrong
  `with check` fails the other way. The HS256-JWT harness used for `0002`–`0005`
  is the cheapest way to prove it: member inserts, non-member and email-less
  tokens are refused, `anon` is refused everything.

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

- **An empty string is not a null, and `gsis_id` has both.** nflverse rosters
  carry a handful of each. `is_not_null()` alone let the empty string through to
  become a `player_index` row keyed on `""` — a valid Postgres primary key and a
  player page for nobody. Fixed in `player_index()`; the same shape of hole is
  worth checking wherever an upstream id is filtered.

- **SVG text scales with its viewBox, and this app's plot area is ~1330px.**
  `.shell` is `max-width: 90rem`. A `font-size: 11px` inside a 720-unit-wide
  viewBox renders at 20px, which is how the season arc shipped with axis labels
  larger than the page's headings. Size a new chart's viewBox against 1330 and
  its height follows; both are the same decision.

- **Vercel bills image optimization per cache miss, not per image.** Hobby
  includes 5,000 transformations a month. That is generous for one portrait per
  player page and would be spent in five refreshes by one portrait per board
  row. **Headshots belong on `/player/[id]` and nowhere else** — the reasoning
  is in `next.config.ts`, and moving them is the change that breaks the budget.

- **`adp_history` is the second table that cannot be rebuilt from upstream.**
  `injury_news` was the first. Everything else in the schema is a cache the cron
  restores every morning; these two are not. Neither belongs in a
  `replace_table()` call, and `authenticated` deliberately has no `TRUNCATE` on
  either — RLS is never consulted for it.

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
