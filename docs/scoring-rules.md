# League scoring rules

Transcribed from the league's Yahoo settings page, 2026-08-15. This is the
canonical reference until `league/{key}/settings` can be read directly via the
API, at which point this document becomes the thing to validate the parser
against.

**The league differs from Yahoo's default in exactly one place: receptions are
worth 1.0, not 0.5. This is a full-PPR league.**

## Offense

| Stat | League value | nflverse column(s) | Notes |
|---|---|---|---|
| Passing Yards | 25 yds / point → **0.04** | `passing_yards` | |
| Passing TD | **4** | `passing_tds` | |
| Interceptions | **-1** | `passing_interceptions` | thrown, not defensive |
| Rushing Yards | 10 yds / point → **0.1** | `rushing_yards` | |
| Rushing TD | **6** | `rushing_tds` | |
| Receptions | **1.0** | `receptions` | **full PPR** (Yahoo default is 0.5) |
| Receiving Yards | 10 yds / point → **0.1** | `receiving_yards` | |
| Receiving TD | **6** | `receiving_tds` | |
| Return TD | **6** | `special_teams_tds` | |
| 2-Point Conversions | **2** | `passing_2pt_conversions` + `rushing_2pt_conversions` + `receiving_2pt_conversions` | **sum of 3** |
| Fumbles Lost | **-2** | `rushing_fumbles_lost` + `receiving_fumbles_lost` + `sack_fumbles_lost` | **sum of 3** |
| Offensive Fumble Return TD | **6** | — | rare; no direct column, see open questions |

## Kickers

| Stat | League value | nflverse column(s) |
|---|---|---|
| FG 0-19 | **3** | `fg_made_0_19` |
| FG 20-29 | **3** | `fg_made_20_29` |
| FG 30-39 | **3** | `fg_made_30_39` |
| FG 40-49 | **4** | `fg_made_40_49` |
| FG 50+ | **5** | `fg_made_50_59` + `fg_made_60_` — **league has one bucket, nflverse has two** |
| PAT Made | **1** | `pat_made` |

## Defense / Special Teams

Team-level unit, **not** in `load_player_stats` — see the two-table finding below.

| Stat | League value | Source |
|---|---|---|
| Sack | **1** | `team_stats.def_sacks` |
| Interception | **2** | `team_stats.def_interceptions` |
| Fumble Recovery | **2** | `team_stats.fumble_recovery_opp` |
| Touchdown | **6** | `team_stats.def_tds` |
| Safety | **2** | `team_stats.def_safeties` |
| Block Kick | **2** | `def_punt_blocks` + `def_pat_blocks` + `def_fg_blocks` — **sum of 3** |
| Kickoff/Punt Return TD | **6** | `team_stats.special_teams_tds` |
| Extra Point Returned | **2** | `team_stats.def_2pt_made` (verify) |
| Points Allowed 0 | **10** | derived from `schedules` — see open questions |
| Points Allowed 1-6 | **7** | " |
| Points Allowed 7-13 | **4** | " |
| Points Allowed 14-20 | **1** | " |
| Points Allowed 21-27 | **0** | " |
| Points Allowed 28-34 | **-1** | " |
| Points Allowed 35+ | **-4** | " |

---

## What this means for the design

Verified live against nflverse 2025 data on 2026-08-15.

### 1. Offense and kicking are fully expressible. Good news.

Every offensive and kicking rule maps to real columns in
`load_player_stats(summary_level="week")` (150 columns). Kicking in particular
is better supported than expected — nflverse carries made field goals already
bucketed by distance, which is exactly the shape the league scores in.

### 2. A rule is not always one column. This changes `StatRule`.

Three rules map to a **sum of columns**, not a single one:

- Fumbles Lost → 3 columns (rushing, receiving, sack)
- 2-Point Conversions → 3 columns (passing, rushing, receiving)
- Block Kick → 3 columns (punt, PAT, FG)

And one maps league-coarse to nflverse-fine: FG 50+ is a single league bucket
but two nflverse columns (`50_59`, `60_`).

`StatRule.column: str | None` therefore cannot express this league. It needs to
become something like `columns: tuple[str, ...]`, summed before the multiplier
is applied. The engine change is small — `pl.sum_horizontal` over the group —
but the interface change should happen before anything is built on top of it.

**This is the single most important thing to fix before writing the comparison
feature.** A naive one-column mapping would silently undercount fumbles by
roughly two thirds, and every downstream number would be quietly wrong.

### 3. DST needs a second table, and the current signature can't take it.

Offense and kicking come from `load_player_stats`. DST does not — individual
defenders' `def_sacks` are per-player, while the league scores a **team unit**.
The team-level equivalents live in `load_team_stats`, which has `def_sacks`,
`def_interceptions`, `def_tds`, `def_safeties`, `fumble_recovery_opp`, and the
block columns.

Points Allowed is a third case again: it isn't in either stats table. It has to
be derived from `load_schedules` (`home_score` / `away_score`) by taking the
opponent's score, then bucketed.

So `score_weekly_stats(stats, rules)` — one frame in, one frame out — covers
offense and kicking but structurally cannot cover DST. The options are a
separate `score_team_defense()` entry point, or letting a `ScoringRules` declare
which source each rule group draws from. Worth deciding deliberately rather than
discovering mid-implementation.

### 4. Yahoo stat IDs are no longer on the critical path.

`YAHOO_STAT_ID_TO_NFLVERSE` in `scoring/rules.py` was a guess at Yahoo's numeric
stat IDs, and open question #4 flagged it as unverified. With the rules
transcribed here, a complete `ScoringRules` can be built **by hand, today**,
with no Yahoo call and no stat-ID guessing. The ID map only matters later, for
validating that the parsed API payload agrees with this document.

The practical effect: the draft-prep comparison feature is not blocked on Yahoo
approval in any way.

---

### 5. Postseason rows must be filtered out. *(found while building)*

`load_player_stats(summary_level="week")` includes **postseason** rows at weeks
19-22, tagged `season_type = "POST"`. Counting them inflates season totals and
games played — and it does so worst for the good players you are most likely to
be comparing, because they are the ones whose teams make the playoffs.

Observed: Puka Nacua's 2025 read as 19 games / 452.6 points including
postseason, versus **16 games / 375.0** for the regular season alone.

Fantasy leagues score the regular season, so `compare_players` filters to
`season_type == "REG"` by default (`--season-type` overrides).

## Open questions specific to scoring

**Resolution plan for A and B (decided 2026-08-15):** answer them empirically
once the season is live, by scoring a completed week with `LEAGUE_SCORING` and
diffing against the official Yahoo box score for the same week. A systematic
per-player offset points at the 2-point-conversion rule; a DST-only offset
points at Points Allowed. This turns two guesses into a measurable check, and is
why the engine keeps `unmapped` visible rather than folding unscored categories
into zero.

**A. What exactly counts as "Points Allowed" for a DST?** Taking the opponent's
final score from `schedules` is the obvious reading, but leagues differ on
whether points scored *against* your defense by the opposing special teams or
defense (a pick-six against your offense) count toward it. Yahoo's own
definition should be confirmed before trusting DST scores. Getting this wrong
shifts DST scores by a full bucket.

**B. Does the passing 2-point conversion score for the QB?** The league table
lists "2-Point Conversions: 2" once, without splitting passer from scorer.
Yahoo's default awards the passer as well, which is why
`passing_2pt_conversions` is included in the sum above — but confirm against a
real box score.

**C. Offensive Fumble Return TD (6) has no clean nflverse column.** It is rare
enough to be near-noise, and omitting it will almost never change a comparison.
Flagged so the gap is deliberate rather than accidental.

**D. Are DST and K worth supporting at all for draft prep?** Both are famously
low-signal and streamed rather than drafted in most leagues. Scoring offense and
kicking first — which needs only the one-table path — may be entirely sufficient
for the "who would I rather draft" question, with DST deferred.
