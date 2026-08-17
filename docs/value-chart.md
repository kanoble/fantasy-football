# The value chart, planned

The build plan for the screen mocked on 2026-08-17 and chosen by Kevin the same
day. Read [handover.md](handover.md) first for the state of the project; this
document is only about the one screen and it goes stale the moment it is built —
at which point its content moves into the handover as "The value chart, as
built" and this file is deleted.

Published mockup, live data, all three directions —
https://claude.ai/code/artifact/8560c9cc-a229-46e9-a96f-8932ae7e8b63

---

## What it is

A scatter plot answering the one question the board can only imply: **who is
priced below what he actually returns.** Cost on the horizontal, and on the
vertical *not* what a player produced but what he produced **above or below what
his price usually buys**. Zero is the market's own expectation, so a bargain is
literally at the top of the chart rather than being a diagonal the reader has to
eyeball.

Three directions were mocked against live rows. Kevin chose **direction C, the
residual**, and said why: it directly shows the thing he was otherwise inferring.
He also asked for it to be tied to who is still on the board, which the mock now
demonstrates.

**This is the first screen in the app that draws a verdict.** Every other one
refuses: no colour on the cost/rank pair, no winner on the IQR row, no crown on
the delta. That refusal was right for a table cell reporting one fact and is
wrong for an instrument whose whole job is to rank value — Kevin's words were
that the judgment should come from looking at the scatter. **It is a rule change,
not just a new screen**, and the career table will go on refusing to say the same
thing one route away. That inconsistency is accepted, not overlooked.

## The state it is being built from

Nothing is half-finished. `main` is at `6c33547` with PR #9 merged, migrations
`0001`–`0009` all applied, and no code for this written.

Kevin has said he expects to come back with changes after running a mock draft.
**Build the maths so it can be re-pointed rather than re-derived** — the
thresholds, the window and the vertical are all parameters, not literals.

---

## The maths, which is the part that has to be right

Everything else here is layout. This is the part where a plausible-looking chart
can be quietly wrong, and two ways of getting it wrong were found by building the
mock rather than by reasoning about it.

### The expectation is per position, always

The first version fitted one moving median across the whole market. Its three
biggest bargains came back **Mahomes, Stafford and Brissett** — because a
quarterback outscores a receiver every week of his life, so the residual was
mostly reporting what position a man plays. That is precisely the mistake
`0008`'s `position_context()` exists to prevent, arriving through a different
door.

So a player is measured against players **at his own position at his own price**,
whatever the position filter is showing. With every position on screen that means
one curve per position rather than one curve, and the gaps between those curves
are exactly the positional scoring a shared curve would have credited to
individuals.

### The baseline and the scale are computed before the draft scope is applied

Both, and both matter:

- **The curve**, because the players already drafted are by definition the good
  ones. Recompute the expectation from whoever is left and the baseline sinks
  with every pick, so a player's residual would improve while he sat there doing
  nothing.
- **The vertical domain**, for the reason `/compare`'s gauges run absolute
  domains rather than ones fitted to the three players on screen: a scale that
  refits as the room picks moves every dot when nobody's season changed.

**The scope removes dots. It moves nothing.** That was verified in the mock
rather than asserted — the draft was walked to 0, 12, 24, 48, 96 and 120 picks
and every dot's coordinates diffed against the un-scoped baseline: every dot in
its original place, axis unchanged, at all six. **Re-run that check whenever the
residual maths is touched.** It is the only thing that catches a baseline
quietly refitting, and a refitting baseline looks entirely reasonable on screen.

### A moving median, not a fit

Median of the 13 nearest players at that position in log-cost space. A
least-squares line through this data is dragged by exactly the injury seasons a
drafter is trying to discount, and a median is the refusal of means the whole app
is built on.

13 is a parameter worth naming rather than a constant worth hiding: it trades
smoothness against responsiveness at the sparse expensive end, and nobody has
tuned it.

### The cost axis is logarithmic

Linear ADP puts picks 1–24 in 8% of the width. `/compare` already found this and
dropped its ADP gauge over it — every top-ten price was an invisible sliver, and
the top ten is most of what the screen is for. Ticks sit on round boundaries for
a 12-team league so the axis reads in the unit a drafter thinks in.

**Cost rises to the right** — Kevin's original instinct, confirmed after seeing
both. Bargains are therefore top-left. The mock carries a flip control; the
built version does not need one.

Do not use the word *dearer*. It is British for "more expensive", it was mine
rather than the domain's, and Kevin had to ask.

---

## The data, and what it costs

### The one new query

A career median delta for every player with a price. Both halves of a delta rank
**set-wise** — `draft_value()` ranks 2,936 historical prices, `position_context()`
ranks season totals — so computing it for a thousand players costs barely more
than for three. This was measured against the live database rather than guessed:

| | |
|---|---|
| `draft_board()` as it is | **183 ms**, 1,050 rows with their weekly arrays |
| `draft_board()` with the delta joined in SQL | **409 ms** |
| Board rows that get a delta | **299 of 1,050** |
| Rows inside the first 192 picks that get one | **153 of 179 — 85%** |

Best of three runs each. **The caveat is coverage, not speed:** a delta needs a
past price *and* a scored season, so across the whole board it is missing more
often than not, and across the players actually drafted it is there five times in
six. It is a top-of-the-draft statistic and the screen should not pretend
otherwise.

### Recommendation: a separate function, joined in TypeScript

Not a wider `draft_board()`. Three reasons, in order of weight:

1. **Postgres cannot change a function's return type with `CREATE OR REPLACE`.**
   Widening `draft_board()` means `DROP` and recreate — and **dropping a function
   drops its grants**, which is the `0005` lesson and the reason its
   `revoke`/`grant` pair is repeated. Doing that to the function the entire board
   depends on, for a column the board does not yet show, is risk with no return.
2. **It runs in parallel instead of in series.** Joined in SQL the board's read
   goes 183ms → 409ms. As its own RPC inside the existing `Promise.all` the wall
   clock is the slower of the two, about 230ms.
3. **The chart wants it without the weekly arrays**, and a future Trends screen
   will want it without the board at all.

So: `0010_market_value.sql`, one function, `SECURITY INVOKER` like every other
read here so `0002`'s allowlist applies unchanged, additive — nothing dropped or
narrowed. Take the ADP season and the `p_source` parameter for the same reason
`draft_value()` does: `adp_history`'s primary key includes `source` precisely
because one player in one season can carry a price from more than one aggregator.

Apply it to the live database **before** the code that reads it ships, the way
`0001`–`0009` were, and verify it with the HS256-JWT harness the same way: a
member reads, a member in different email casing reads, a non-member reads zero, a
token with no `email` claim reads zero, and `anon` is refused outright.

### Three values that are not honest on an axis

`draft_board()` coalesces its counts to zero, which is right in a table cell and a
lie on a plot: **a rookie drawn at zero season points is being asserted to have
scored none rather than to have had no season.** The board's three empty states —
rookie, absent, unmatched — have to survive into the chart.

They cannot be plotted, so they get a **rail beside the plot** naming them and
saying which kind each is. On a draft-day screen this matters more than anywhere
else: a rookie in your pick window is a live decision and he has no dot by
definition. **Roughly two thirds of the board has no 2025 season.** Dropping them
silently is the worst option available.

---

## The build

### Migration

`supabase/migrations/0010_market_value.sql` — one function returning
`(player_id, median_delta, priced_seasons)` for every player with an ADP in the
named season. The prototype CTE is in the mock's build script and reproduces the
app's own arithmetic exactly: McCaffrey `0` over 9 seasons, St. Brown `+5`,
Chase `−3` — the three figures the handover already records from `/player/[id]`.
**Check those three again after writing the migration.** If they do not
reproduce, the function is wrong, not the handover.

### Where the maths lives, and the test gap

The residual arithmetic — the moving median, the per-position grouping, the
interpolation onto the curve — is the most consequential un-tested code this app
would have. The handover already names this as the largest gap it left: *"If you
touch `decomposeSeason`, `shares`, the arc geometry or `ageFrom`, there is no
test that will catch you."* This makes it worse.

**Add `node --test` and cover the residual maths.** It ships with Node, needs no
dependency, and `npm run lint` is currently `tsc --noEmit` with no runner at all.
Three cases are enough to be worth having: a known curve reproduces known
expectations, a position with too few players yields `null` rather than a
fabricated baseline, and the scope-invariance property above.

This is the point where a runner earns its keep. It has been deferred three times
and each deferral was defensible; this one would not be.

### Route and navigation

A **fourth tab on the players side of the divider**, not Trends. `.tab-div`
exists and is deliberately unused because Board · Players · Compare are about
players while League and Trends will be about teams — and this screen is about
players. Trends is the cross-player historical screen `adp_history` can answer
("what has a pick at RB4 actually returned over ten seasons"), which is a bigger
and different thing.

Two known traps on the way in:

- **`typedRoutes` cannot resolve an array of literal hrefs**, which is why
  `app/nav.tsx` writes its links out longhand. A fourth is a fourth longhand
  link, not a loop.
- **Route types are generated at build**, so a fresh route fails `npm run lint`
  until `npm run build` has run once.

### Components

Follow the split PR #9 established, because it is what made that pass's
measurements possible at all:

| File | Job |
|---|---|
| `app/value/page.tsx` | Authenticates and fetches. Cannot be rendered by a probe — `getUser()` revalidates against the auth server. |
| `app/value/chart.tsx` | **Pure presentation over plain data.** A throwaway probe under `app/auth/` can render it with real rows and no session. Delete the probe before committing. |
| `lib/value.ts` | The residual maths, exported and tested. |

`app/plot.tsx` is the 1-D distribution and is **not** this — do not try to make
one component be both. Reuse `app/tip.tsx` for the definitions (CSS-only, so it
stays a server component), `PageHead`, `NotOnList`, and the nearest-point idea
from `app/plot-hover.tsx`: a dense scatter needs the same treatment a 5px dot
needed, and for the same reason.

### Colour

**No team hue anywhere on this screen.** Team hue would be 32 categories of noise
on a scatter, and `/compare` already established that position identifies a
player while hue is decoration — Kevin could not derive meaning from the team
colours quickly, and two Lions were indistinguishable.

The residual uses `--good` and `--bad`, and there is one constraint on that which
must not be dropped: **measured, they are ΔE 8.1 under deuteranopia in light and
7.8 in dark — the floor, passable only with a second encoding.** There is one:
the sign is already which side of the zero line a dot sits on. **Colour is
redundant here by design and must never become the only carrier.** If a future
change puts those two hues anywhere the position does not also state the sign,
re-measure before shipping it.

Everything else takes `--ink` at reduced opacity, with `--amber` spent where it is
spent everywhere else — on the thing being pointed at.

---

## Before it is called done

The compare pass's list, plus the one this screen adds:

- [ ] **Scope invariance.** Walk the draft across at least six positions and
      assert no dot moves and the axis does not rescale. **This is the new one
      and it is the important one.**
- [ ] The three reference deltas reproduce: McCaffrey `0`, St. Brown `+5`,
      Chase `−3`.
- [ ] Contrast on every new text style, both themes, against the 4.5:1 floor —
      using specified colours, not pixel clustering, which under-reads a
      block-level span whose text covers 3% of its area.
- [ ] Thirteen viewport widths with `documentElement.scrollWidth` equal to the
      viewport at each.
- [ ] Every definition tooltip contained and reachable by Tab.
- [ ] A clean browser console — read it, do not assume it.
- [ ] RLS on `0010` verified with HS256 tokens across member, differently-cased
      member, non-member, email-less, and `anon`.

**No hue sweep is needed**, and that is worth stating because every previous UI
pass needed one: nothing on this screen reads `--tm`.

---

## Open, and Kevin's to answer

Five, in the order they change the work. He has seen all of them on the mock.

1. **Which verticals ship.** The mock offers four — median week, season total,
   career median delta, ceiling weeks. All four are free once the delta is on the
   board. Shipping fewer is a legibility decision, not a cost one.
2. **Does the delta column go on the board as well.** Once `0010` exists the
   board can show it for the same query. It is the one figure that summarises a
   career in a number, and today you must open a player to see it.
3. **The ceiling threshold is wrong for quarterbacks.** `CEILING = 20` and
   `FLOOR = 10` are inherited from the CLI's `analysis/compare.py` and are
   reasonable for a skill player; a starting QB clears 20 most weeks, so that
   vertical currently flatters them. They are already parameters of
   `draft_board()` rather than hardcoded, so varying them by position is a
   call-site change and not a migration.
4. **2025 alone, or a multi-year weighted median.** Everything vertical is last
   season. Three years weighted is the same query shape and a steadier predictor,
   but the weighting is a decision that should not be made silently.
5. **The route's name.** "Value" is the working title.

Kevin has said he expects to come back after a mock draft. **Do not treat any of
the above as settled by silence.**
