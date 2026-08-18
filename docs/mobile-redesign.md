# Mobile redesign — planning notes

**Status: open. Not started.** Logged 2026-08-18 after Kevin's first sign-in on
a phone ("the app really doesn't work there"). Kevin is going to use the app
more before deciding what the phone is *for*; nothing below is a decision yet
except the process. Come back to this when he does.

Desktop is, and stays, the primary target: the draft happens on a multi-monitor
setup and density is a feature. The phone gets **its own design over the same
components and data, not the desktop grid reflowed** — that was the standing
rule in the handover before this doc existed, and the CSS confirms it (see
"What is actually there").

## What is actually there

Measured 2026-08-18. `app/globals.css` is ~3,400 lines with exactly two width
breakpoints: `max-width: 34rem` (line ~510) and `max-width: 78rem` (~3380).
Everything else is fixed-width:

| Screen | Fixed width that breaks a 24rem phone |
|---|---|
| Board (`/`) | `.grid` `min-width: 62rem`, 9 fixed columns |
| Player (`/player/[id]`) | `.career .grid` `min-width: 70.25rem`; game log is a 12-column fixed grid; plots |
| Compare (`/compare`) | `14rem 4.5rem 1fr` grids, gauges |
| Market (`/market`) | Chart sized for desktop |
| App bar / nav / account | Squeezed but functional; the cheap half |

So four screens each need a *decision*, and only the app bar is a straight fix.
The desktop already passes a Playwright width sweep (1920 → 390,
`scrollWidth == viewport` at every width); that sweep is the regression guard
for anything done here.

## The plan, in order

### 1. Inventory, not impressions

Screenshot every screen at 390px and 430px, signed in, and write one line per
screen: what breaks, and what a person would actually be trying to do there on
a phone. Signed-out screens can use the throwaway `app/auth/probe` trick from
the handover; signed-in ones need a real session or Kevin's phone screenshots.
Output is a short table, not a design.

### 2. Decide the phone's job, per screen — Kevin's call

**Open questions.** These are the ones that decide the design and none is
answered yet:

- **What is the phone for on draft day?** Kevin drafts at a desktop. Is the
  phone a second glance from the couch ("who's gone, best available at a
  position, mark someone drafted"), or nothing on the day at all? This single
  answer decides whether the mobile board is a filtered list with search or
  something else entirely — do not draw the board before it is answered.
- **What is the phone for in-season?** Best guess: the player page ("is this
  guy any good, is he hurt") is what relatives will open on phones, and it
  becomes the primary surface once the season starts.
- **Are Compare and Market phone screens at all?** Best guess: no, not by the
  draft. An honest "this one is better on a desktop" state beats a bad reflow;
  design them properly in-season if anyone wants them.
- **Which of the eleven will only ever be on a phone?** Changes how much the
  in-season answer matters.

**Working guesses**, to be confirmed or overturned by use:

| Screen | Guess |
|---|---|
| App bar / nav | Just fix it. Every screen, cheap. |
| Board | Not the 9-column grid. A list: search, position filter, drafted toggle, top available. |
| Player | Career table → cards or a sticky-first-column scroller. Plots probably survive. |
| Compare / Market | Desktop screens; clean "open on desktop" state until designed. |

### 3. Sequence by the calendar

Draft is 30 August 2026. Anything wanted on a phone *on the day* (app bar,
board list, player page) ships as its own PRs before then. Compare, Market and
polish come after, in-season.

### 4. How each screen gets built once decided

1. Two or three quick mockup variants per screen for Kevin to pick from.
2. Agree the one.
3. Build it as a **separate narrow layout** using the existing components and
   queries — no forking of data code, no reflowing the desktop grid.
4. Verify with the existing Playwright width sweep (desktop must not regress)
   plus Kevin on his actual phone.
5. One PR per screen, so each is reviewable and revertable on its own.

## Constraints already settled elsewhere

- Desktop-first, density is a feature — `docs/handover.md`, "Desktop-first".
- Members sign in at `https://noblefamilyfootball.com`.
- Definitions are `<button>`s, not `title`s, precisely so they work on tap.
- The `drafted` table is shared across the room; a phone board that marks
  players writes to the same rows the desktop reads.
