// Extension included, unlike every other import in this app. `node --test` runs
// this file directly, and Node resolves ES modules by exact specifier — so a
// bare `./board` is the one thing standing between the residual math and having
// any tests at all. `allowImportingTsExtensions` in tsconfig.json is what keeps
// `tsc --noEmit` happy with it; Turbopack resolves it unchanged.
import { LEAGUE_TEAMS, median } from "./board.ts";

/**
 * The residual math behind `/market`.
 *
 * The board can say what a player cost and what he returned, and leaves the
 * comparison to the reader's eye. This turns that comparison into a coordinate:
 * the vertical is not what a player produced but what he produced **above or
 * below what his price usually buys**, so the market's own expectation is a flat
 * line at zero and a bargain is at the top of the chart rather than being a
 * diagonal somebody has to eyeball.
 *
 * Everything here is a pure function over plain numbers, which is the point.
 * This is the first math in the app that a wrong answer would not make obviously
 * wrong on screen — a quietly refitting baseline draws a chart that looks
 * entirely reasonable — so it lives apart from the components and is covered by
 * `lib/value.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * THE TWO RULES THAT MATTER MOST, both found by building the mock rather than by
 * reasoning about it:
 *
 * 1. **The expectation is per position, always.** The first version fit one
 *    curve across the whole market and its three biggest bargains came back
 *    Mahomes, Stafford and Brissett — because a quarterback outscores a receiver
 *    every week of his life, so the residual was mostly reporting what position
 *    a man plays. That is the mistake `0008`'s `position_context()` exists to
 *    prevent, arriving through a different door.
 *
 * 2. **The baseline and the scale are computed before any scope is applied.**
 *    The players already drafted are by definition the good ones, so recomputing
 *    the expectation from whoever is left sinks the baseline with every pick and
 *    a player's residual would improve while he sat there doing nothing. Scope
 *    removes dots; it moves nothing. `buildModel` and `scopeModel` are separate
 *    functions so that ordering is structural rather than remembered.
 */

/**
 * How many players at the same position make up the neighborhood a price is
 * judged against.
 *
 * A parameter worth naming rather than a constant worth hiding: it trades
 * smoothness against responsiveness at the sparse expensive end, and nobody has
 * tuned it. 13 is wide enough that one injury season cannot define what a price
 * buys and narrow enough that the top of a position is not averaged into its
 * middle.
 */
export const NEIGHBORS = 13;

/**
 * The fewest priced players a position needs before a baseline drawn from it
 * means anything.
 *
 * Below this the moving median is fit to almost nothing, every residual comes
 * out near zero by construction, and the chart would assert that a fullback is
 * exactly as valuable as his price implies — an answer manufactured by having no
 * data rather than derived from any. Those players go to the rail instead, which
 * is the same refusal the board's three empty states already make.
 *
 * Live: WR 160, RB 109, TE 71, QB 51, K 45 clear it comfortably; FB (3) and P
 * (1) do not, which is exactly the intent.
 */
export const MIN_COHORT = 8;

/**
 * The cost axis, in overall pick numbers, on a log scale.
 *
 * Logarithmic because linear ADP puts picks 1–24 in 8% of the width, and the top
 * 24 is most of what this screen is for. `/compare` already found this and
 * dropped its ADP gauge over it: every top-ten price was an invisible sliver.
 *
 * Fixed rather than fit to the rows on screen, for the same reason `/compare`'s
 * gauges run absolute domains and the plot runs a fixed 0–56 — a scale that
 * refits as the room picks moves every dot when nobody's season changed. 768 is
 * generous against the deepest 2026 price (700) and is 12 × 64, so every tick
 * below is a real round boundary in a 12-team league.
 *
 * ---------------------------------------------------------------------------
 * **COST RISES TO THE RIGHT, WHICH MEANS THE PICK NUMBER FALLS TO THE RIGHT.**
 *
 * The first build got this backwards and shipped a legend that contradicted its
 * own plot. Cost and pick number run in opposite directions: pick 1 is the most
 * expensive player in the draft and pick 192 is the cheapest. Plotting the pick
 * number ascending rightward therefore puts the *cheapest* players on the right,
 * which is a falling cost axis — and it put the bargains top-right under a
 * caption promising them top-left.
 *
 * So the axis is reversed: pick 768 at the left edge, pick 1 at the right.
 * Cheap is left, expensive is right, a bargain is cheap and over the line, and
 * bargains are genuinely top-left.
 */
export const COST_MIN = 1;
export const COST_MAX = 768;

/**
 * Ticks on round boundaries, doubling — the end of rounds 1, 2, 4, 8, 16 and 32.
 * A drafter thinks in rounds, not in log units, and doubling is what spaces
 * evenly once the axis is logarithmic.
 */
export const COST_TICKS = [12, 24, 48, 96, 192, 384];

/**
 * A 12-team draft, in picks. The default scope, and the reason this screen is
 * legible at all.
 *
 * Measured before choosing it: with every priced name on the plot, the ten
 * biggest bargains came back Ted Ginn, Golden Tate, Marvin Jones and Mohamed
 * Sanu — players who are retired, priced past 400, and whose career figures were
 * earned a decade ago. The chart was not wrong; it was answering "who once beat
 * his price" when the question is "who will beat it on Sunday". Inside the
 * draft the same list reads Travis Hunter, Rico Dowdle, Michael Wilson,
 * Wan'Dale Robinson — names that are actually going to be called.
 *
 * A scope and **not** an input filter, for the reason every other scope here is
 * one: it removes dots and moves nothing. The baseline is still computed against
 * every player at that position, including the ones past the cutoff.
 */
export const DRAFT_PICKS = 192;

/**
 * The residual axis, per vertical — fixed, and not fitted to whatever is on
 * screen.
 *
 * The same decision as `AXIS_MAX` on the plot and `TOTAL_MAX` on `/compare`'s
 * gauges, and it is load-bearing for the same reason: a scale that refits moves
 * every dot when nobody's season changed. Fitting it to the largest residual was
 * tried first and was measurably bad — one -84 bust set the career-value domain
 * to ±100 and squeezed 96% of the field into the middle four tenths of the plot.
 *
 * Chosen from the live distribution inside the draft rather than picked: each
 * clears p98 on both sides and clamps 1-2% of dots, which is the trade this
 * screen should make. The tails are asymmetric by construction — a back drafted
 * RB1 can finish RB68 and lose 67 ranks, and nobody drafted RB1 can gain 67 —
 * so a domain generous enough to hold every bust would waste the half of the
 * plot the screen is actually for.
 *
 * A clamped dot is drawn against the frame edge and marked, never dropped.
 */
export const RESIDUAL_MAX: Record<Vertical, number> = {
  delta: 50,
  median: 10,
  total: 150,
};

/**
 * How a three-season window is weighted, newest first.
 *
 * Here rather than in SQL because it is a judgment and not a fact: 3/2/1 is
 * defensible and so is 5/3/1, and the one that ships should be visible in a file
 * someone reads. `season_form()` returns the raw per-season figures precisely so
 * this stays in TypeScript, where the toggle is instant and the arithmetic is
 * testable.
 */
export const FORM_WEIGHTS = [3, 2, 1];

/** Which figure the vertical is built from. Kevin's choice: these three. */
export type Vertical = "delta" | "median" | "total";

/**
 * How much history the vertical reads.
 *
 * `last` is the stat season alone — what every other screen in the app shows.
 * `weighted` is `FORM_WEIGHTS` across the window `season_form()` returned, which
 * is the steadier predictor and the reason the toggle exists.
 *
 * The career median delta ignores this: it is a career figure by construction,
 * and pretending a window applies to it would be a control that does nothing.
 */
export type Lookback = "last" | "weighted";

/**
 * One row of `market_value()` — a player's career median of cost-minus-finish.
 *
 * The two raw row types for migration `0010` live here rather than in
 * `lib/board.ts` with the others, because they are read by exactly one screen
 * and the model that consumes them is in this file. `lib/board.ts` is what four
 * screens share; growing it for a fifth screen's private read is how a shared
 * module becomes a junk drawer.
 */
export type MarketValue = {
  player_id: string;
  median_delta: number | null;
  priced_seasons: number;
};

/**
 * One row of `adp_spread()` — how firm this year's price is.
 *
 * `adp` is **this source's own price**, which is not the price on the cost axis.
 * Both travel because the gap between them is evidence rather than noise; see
 * `survivalOf` for what is done with it and migration `0011` for the numbers
 * that forced it.
 */
export type AdpSpread = {
  /** FFC's own pick number for the same player. */
  adp: number;
  /** Standard deviation of the pick he actually went at. */
  stdev: number;
  /** How many drafts stand behind it, where the source says. */
  drafts: number | null;
};

/** One row of `season_form()`. Only seasons actually played appear. */
export type FormSeason = {
  player_id?: string;
  season: number;
  games: number;
  median: number | null;
  total: number;
};

/**
 * A board row with the two new reads folded in — the input to the whole model.
 *
 * Assembled by the page rather than by a query: `draft_board()` supplies who a
 * player is and what he costs, `market_value()` the career delta, and
 * `season_form()` the window. Three reads in one `Promise.all` rather than one
 * wider function, for the reasons in migration `0010`.
 */
export type ValuePlayer = {
  player_id: string | null;
  name: string;
  position: string | null;
  team: string | null;
  norm_name: string;
  adp: number;
  injury_status: string | null;
  /** Games in the stat season, and across the whole career. */
  games: number;
  career_games: number;
  median_delta: number | null;
  priced_seasons: number;
  /** Newest first. */
  form: FormSeason[];
  /**
   * How firm his price is, or `null` where no source publishes a spread for him.
   *
   * A nested object rather than three nullable fields beside each other, so that
   * "we have dispersion evidence" is one check and a half-populated spread
   * cannot be represented at all. `survivalOf` branches on exactly this.
   */
  spread: AdpSpread | null;
};

/** A player who made it onto the plot. */
export type Dot = {
  player: ValuePlayer;
  /** Where he sits on the log cost axis, 0–100 from the left. */
  x: number;
  /** Where he sits on the residual axis, 0–100 **from the top**. */
  y: number;
  /** The raw figure — median week, season total, or career median delta. */
  value: number;
  /** What that price usually buys at his position. */
  expected: number;
  /** `value - expected`. Positive means he beat his price. */
  residual: number;
  /** How many seasons stand behind `value`. Thin evidence is drawn dimmer. */
  seasons: number;
  /**
   * His residual is past the end of the fixed axis and he is drawn against the
   * frame edge.
   *
   * Carried rather than left implicit so the dot can be marked. A clamped dot
   * sitting silently on the edge would read as "just about the worst here" when
   * the truth is "further than this chart draws" — and it is always a bust,
   * because the lower tail is the long one.
   */
  clamped: boolean;
};

/**
 * Why a player has no dot.
 *
 * Every one of these is a fact worth stating rather than a row to drop.
 * `draft_board()` coalesces its counts to zero, which is right in a table cell
 * and a lie on a plot: a rookie drawn at zero season points is being asserted to
 * have scored none rather than to have had no season. Roughly two thirds of the
 * board is in one of these states, and on a draft-day screen a rookie inside
 * your pick window is a live decision that has no dot by definition.
 */
export type Reason = "unmatched" | "rookie" | "absent" | "unpriced" | "no-baseline";

export type Unplotted = { player: ValuePlayer; reason: Reason };

export type ValueModel = {
  dots: Dot[];
  unplotted: Unplotted[];
  /**
   * The residual axis runs symmetrically from `-range` to `+range`.
   *
   * Symmetric because zero is the market's expectation and the whole reading of
   * the chart is "which side of it" — an axis with more room above than below
   * would make the same residual look larger as a bargain than as a bust.
   */
  range: number;
  /**
   * Whether `seasons` differs between players at all in this view.
   *
   * It does not always. Under the `last` window every figure rests on exactly
   * one season **by construction**, so drawing thin evidence differently there
   * marks the entire chart and distinguishes nobody. The first build did exactly
   * that: every dot on the 2025-only view went hollow, and because the hollow
   * style dropped the fill it also threw away the good/bad sign colour — a
   * meaningless encoding displacing a working one.
   *
   * So the chart asks the model rather than assuming, and the answer is derived
   * from the dots rather than from a table of which combinations vary.
   */
  evidenceVaries: boolean;
};

/**
 * Price in log space, ascending with the pick number.
 *
 * The neighborhood math runs on this and never on `costX`, deliberately. Which
 * way the axis is drawn is a presentation decision; which players are nearest in
 * price is not, and the two were tangled in the first build — reversing the axis
 * silently reversed the sort the two-pointer window depends on. Keeping them
 * apart means the display direction can be argued about without anything in
 * `buildModel` having an opinion.
 */
export function logCost(adp: number): number {
  return Math.log(Math.min(Math.max(adp, COST_MIN), COST_MAX));
}

/**
 * Where a pick number sits on screen, as a percentage from the left.
 *
 * **Reversed**: the cheapest picks are at the left and the first pick is at the
 * right, so that *cost* rises to the right. See the note on `COST_MAX`.
 */
export function costX(adp: number): number {
  const span = Math.log(COST_MAX / COST_MIN);
  return 100 - ((logCost(adp) - Math.log(COST_MIN)) / span) * 100;
}

/**
 * The player's own figure for this vertical and window, with the number of
 * seasons standing behind it.
 *
 * Missing seasons **renormalize the weights rather than counting as zero**. A
 * player who missed 2024 gets the weighted mean of the seasons he did play, not
 * a figure dragged toward the floor by a year he was not on a field — which
 * would be the same lie as plotting a rookie at zero. The season count travels
 * with the value so the chart can dim thin evidence rather than hide it.
 *
 * A weighted **mean** and not a weighted median, which is the one place this app
 * does not reach for a median. The median-over-mean argument is about outliers
 * among many observations — 17 weeks, where one 49.6-point game drags an average
 * somewhere the season never was. Here there are at most three observations and
 * each is already a median or a total, so the weights encode recency rather than
 * robustness, and a weighted median over three points with weights 3/2/1 simply
 * returns the middle season and discards the other two.
 */
export function figureFor(
  player: ValuePlayer,
  vertical: Vertical,
  lookback: Lookback,
  statSeason: number,
): { value: number; seasons: number } | null {
  if (vertical === "delta") {
    // A career figure; the window control does not apply to it.
    if (player.median_delta == null) return null;
    return { value: player.median_delta, seasons: player.priced_seasons };
  }

  const pick = (season: FormSeason) => (vertical === "median" ? season.median : season.total);

  if (lookback === "last") {
    const row = player.form.find((season) => season.season === statSeason);
    const value = row ? pick(row) : null;
    return value == null ? null : { value, seasons: 1 };
  }

  let weighted = 0;
  let weight = 0;
  let seasons = 0;

  for (const season of player.form) {
    const w = FORM_WEIGHTS[statSeason - season.season];
    const value = pick(season);
    if (w == null || value == null) continue;
    weighted += w * value;
    weight += w;
    seasons += 1;
  }

  return weight === 0 ? null : { value: weighted / weight, seasons };
}

/**
 * The half-open index range of the `k` entries nearest to `xs[index]`.
 *
 * `xs` must be sorted ascending, which makes the nearest `k` a contiguous window
 * and turns this into two pointers rather than a sort per player.
 *
 * **The point itself is included**, so this is a moving median in the ordinary
 * smoothing sense. Leaving it out would make each expectation a leave-one-out
 * estimate, which is arguably purer for a residual; with 13 points a single
 * member moves a median barely at all, and including it is both the plain
 * reading of "the median of the 13 nearest players" and the cheaper explanation.
 *
 * KNOWN EDGE EFFECT, worth not rediscovering as a bug: at the ends of the price
 * range the window is one-sided. The most expensive back at his position is
 * judged against the twelve backs priced below him, because there is nobody
 * above him, so the baseline flattens across the top of each position. That is
 * inherent to a moving window and it is the honest cost of a median over a fit —
 * a local-linear fit would extrapolate through the ends and would be dragged by
 * exactly the injury seasons a drafter is trying to discount.
 */
export function neighborhood(xs: number[], index: number, k: number): [number, number] {
  let lo = index;
  let hi = index + 1;

  while (hi - lo < k && (lo > 0 || hi < xs.length)) {
    if (lo === 0) hi += 1;
    else if (hi === xs.length) lo -= 1;
    // Tie goes left, so the window is deterministic rather than depending on
    // which side happened to be tested first.
    else if (xs[index]! - xs[lo - 1]! <= xs[hi]! - xs[index]!) lo -= 1;
    else hi += 1;
  }

  return [lo, hi];
}

/**
 * The whole model, computed over **every** player handed to it.
 *
 * Call this once with the full board and then narrow with `scopeModel`. The two
 * are separate functions so that a future change cannot accidentally recompute
 * the baseline from a filtered set — the failure that would cause is invisible,
 * because a chart drawn from a sinking baseline looks entirely reasonable.
 */
export function buildModel(
  players: ValuePlayer[],
  {
    vertical,
    lookback,
    statSeason,
    neighbors = NEIGHBORS,
    minCohort = MIN_COHORT,
    range = RESIDUAL_MAX[vertical],
  }: {
    vertical: Vertical;
    lookback: Lookback;
    statSeason: number;
    /** The fixed residual domain. Overridable so tests can state their own. */
    range?: number;
    neighbors?: number;
    minCohort?: number;
  },
): ValueModel {
  const unplotted: Unplotted[] = [];
  // Grouped by position because the expectation is per position, always.
  const groups = new Map<string, { player: ValuePlayer; value: number; seasons: number }[]>();

  for (const player of players) {
    if (!player.player_id) {
      // The ADP name resolved to nobody. The one empty state that is a lie, and
      // the reason it is named apart from the two below.
      unplotted.push({ player, reason: "unmatched" });
      continue;
    }

    const figure = figureFor(player, vertical, lookback, statSeason);

    if (!figure) {
      unplotted.push({
        player,
        reason:
          player.career_games === 0
            ? "rookie"
            : // Has a career, but nothing this vertical can read: either no season
              // inside the window, or — for the career delta — never carried a
              // price the market can be judged against.
              vertical === "delta"
              ? "unpriced"
              : "absent",
      });
      continue;
    }

    const position = (player.position ?? "?").toUpperCase();
    const group = groups.get(position);
    if (group) group.push({ player, ...figure });
    else groups.set(position, [{ player, ...figure }]);
  }

  const dots: Dot[] = [];

  for (const group of groups.values()) {
    if (group.length < minCohort) {
      for (const entry of group) unplotted.push({ player: entry.player, reason: "no-baseline" });
      continue;
    }

    // Sorted by cost in log space, which is the space the neighborhood is
    // measured in — nearest by *price ratio*, not by pick-number difference.
    // Picks 3 and 15 are twelve apart and nothing alike; picks 203 and 215 are
    // twelve apart and interchangeable.
    //
    // `logCost` and not `costX`: the window is a two-pointer walk and needs an
    // ascending array, so running it on the screen coordinate would break the
    // moment somebody reversed the axis — which is exactly what happened.
    const sorted = [...group].sort((a, b) => a.player.adp - b.player.adp);
    const xs = sorted.map((entry) => logCost(entry.player.adp));

    for (let index = 0; index < sorted.length; index += 1) {
      const [lo, hi] = neighborhood(xs, index, neighbors);
      const expected = median(sorted.slice(lo, hi).map((entry) => entry.value));
      // `median` only returns null for an empty array, which cannot happen here
      // — the window always contains the point itself.
      if (expected == null) continue;

      const entry = sorted[index]!;
      const residual = entry.value - expected;

      dots.push({
        player: entry.player,
        x: costX(entry.player.adp),
        // From the top, so a positive residual sits above the zero line.
        y: Math.max(0, Math.min(100, 50 - (residual / range) * 50)),
        value: entry.value,
        expected,
        residual,
        seasons: entry.seasons,
        clamped: Math.abs(residual) > range,
      });
    }
  }

  return {
    dots,
    unplotted,
    range,
    evidenceVaries: dots.some((dot) => dot.seasons !== dots[0]!.seasons),
  };
}

/**
 * Narrow a model to what is still on the board, without touching a coordinate.
 *
 * **The scope removes dots. It moves nothing.** `range` is passed through
 * unchanged and no residual is recomputed, which is what makes the property
 * testable rather than merely intended — see the scope-invariance test.
 *
 * Positions are filtered here too, and for the same reason: a chart that
 * rescaled when you looked at quarterbacks alone would be telling you about the
 * filter rather than about the quarterbacks.
 */
export function scopeModel(
  model: ValueModel,
  {
    drafted,
    positions,
    maxCost,
  }: {
    /** `norm_name` of every player already taken. */
    drafted?: Set<string>;
    /** Positions to keep. Undefined or empty means all of them. */
    positions?: Set<string>;
    /**
     * The deepest pick worth drawing. `DRAFT_PICKS` by default at the call site.
     *
     * A scope rather than an input filter, which is the whole point: the players
     * past the cutoff still shape the baseline their position is judged against,
     * they simply are not drawn. Cutting them before `buildModel` would change
     * every expectation at the cheap end of each position.
     */
    maxCost?: number;
  },
): ValueModel {
  const keep = (player: ValuePlayer) => {
    if (drafted?.has(player.norm_name)) return false;
    if (maxCost != null && player.adp > maxCost) return false;
    if (positions && positions.size > 0) {
      return positions.has((player.position ?? "?").toUpperCase());
    }
    return true;
  };

  return {
    dots: model.dots.filter((dot) => keep(dot.player)),
    unplotted: model.unplotted.filter((entry) => keep(entry.player)),
    // Both carried through untouched. They are properties of the field the
    // model was built against, not of whoever is left on screen.
    range: model.range,
    evidenceVaries: model.evidenceVaries,
  };
}

/** What each vertical is called, and what it means, in one place. */
export const VERTICALS: Record<Vertical, { label: string; hint: string; unit: string }> = {
  delta: {
    label: "Career delta",
    hint:
      "How many positional ranks a player typically beats his own draft price by, across every season the market put a price on him. Positive means he beat it. The residual then asks whether that is more or less than others at his position and price manage.",
    unit: "ranks",
  },
  median: {
    label: "Median week",
    hint:
      "His typical week's points — the middle one, not the average, so one huge game cannot stand in for a season. The residual is how far that sits above or below what his price usually buys at his position.",
    unit: "pts",
  },
  total: {
    label: "Season points",
    hint:
      "Everything he scored across the regular season. Rewards availability: a player who missed six weeks is marked down for it, which is either the signal or the noise depending on your view.",
    unit: "pts",
  },
};

/** What each rail state means, in the reader's words rather than the schema's. */
export const REASONS: Record<Reason, { label: string; hint: string }> = {
  unmatched: {
    label: "Not identified",
    hint:
      "The draft list names him but the name resolved to nobody in the player index. This is the one empty state that is a defect rather than a fact — the app should have something to say about him and does not.",
  },
  rookie: {
    label: "No NFL season",
    hint: "A price with no past. He has never played a regular-season game, so there is nothing to measure a price against.",
  },
  absent: {
    label: "Did not play",
    hint: "He has a career but played no games inside the window this chart is reading. Widening the window to three seasons will bring some of these back.",
  },
  unpriced: {
    label: "Never priced",
    hint: "He has played, but the market never put a draft price on him in a season with scored games — so there is no cost to compare a finish against.",
  },
  "no-baseline": {
    label: "Too few at the position",
    hint: `Fewer than ${MIN_COHORT} players at his position carry both a price and a season, so any baseline drawn for them would be fit to almost nothing and every residual would come out near zero by construction.`,
  },
};

/* ===========================================================================
 * AVAILABILITY — who is still going to be there.
 *
 * Everything above answers "who is the best value in this draft". A drafter is
 * only ever asking "who is the best value **I can still get**", and those are
 * different questions: with the axis corrected, the rail's top two came back
 * McCaffrey (ADP 5.2) and Puka Nacua (4.6), which is arithmetically right and
 * useless at pick 40 because they went twenty-five picks ago.
 *
 * ---------------------------------------------------------------------------
 * THE TWO RULES HERE, and they are the same two rules as above wearing
 * different clothes:
 *
 * 1. **None of this may reach `buildModel`.** Narrowing the players by who is
 *    likely available would refit every baseline, which is the exact failure the
 *    scope-invariance test exists to catch. Availability re-ranks a list; it is
 *    not an input to the model.
 *
 * 2. **None of this may move a dot.** `rankRail` returns a reordered, filtered
 *    view of dots it did not create and does not touch. The scatter is the field
 *    as it stands; the rail is the recommendation. Changing the round must change
 *    only the second, or the reader loses the one thing this screen guarantees.
 *
 * Deliberately, availability is also kept out of `scopeModel` — which *would* be
 * allowed to drop dots, since dropping is not moving. It is kept out anyway,
 * because a scatter that reshuffled every time the round selector moved would
 * make exploring rounds feel like the data was changing underneath. The round
 * control touches the rail and nothing else.
 * =========================================================================== */

/**
 * Below this chance of lasting, `value` mode stops listing a player at all.
 *
 * The division of labour between the two modes, and the reason this number can
 * be low: **the floor removes the arithmetically impossible, not the merely
 * unlikely.** Discounting the unlikely is what `draft` mode does, continuously
 * and without a threshold. So this only has to catch the players a rail headed
 * "best available" would be lying about — the ones who cannot be had at all —
 * and 10% is comfortably past that line while leaving genuine long shots in a
 * list that is explicitly not weighted by availability.
 *
 * The count of who this removed travels with the result rather than being
 * swallowed, because a list that silently shortens is indistinguishable from a
 * shorter board.
 */
export const SURVIVAL_FLOOR = 0.1;

/** How the rail is ordered. Kevin's call: both, as a toggle. */
export type RailMode = "value" | "draft";

/**
 * Where the reader's next pick is, as far as anything can know.
 *
 * Two shapes because the seat arrives at the last possible moment. **A seat is
 * set moments before the draft starts**, so "no seat" is not an edge case — it is
 * the state this screen is in for every prep session anybody will ever run, and
 * the round has to be enough on its own.
 *
 * - `round` is a 12-wide window of pick numbers, which is all a round tells you
 *   without a seat.
 * - `pick` is the exact number, available once the seat is known and the room has
 *   started picking.
 */
export type PickTarget =
  | { kind: "round"; from: number; to: number }
  | { kind: "pick"; pick: number };

/** What a survival number is actually resting on. */
export type SurvivalBasis =
  /** A normal built from a published spread. */
  | "modeled"
  /** No spread for him, so his price alone, as a step. */
  | "step"
  /** No target chosen, so availability is not in play. */
  | "none";

/**
 * The picks belonging to one seat in a snake draft, in order.
 *
 * Odd rounds run 1→T and even rounds run T→1, which is the whole of a snake.
 * Worth having as its own function because the consequence is not obvious and it
 * is the reason a seat matters at all: **the gap between your picks is wildly
 * seat-dependent.** At seat 6 you wait about twelve picks every time. At seat 1
 * or seat 12 you wait twenty-two picks and then pick twice back to back. "Who
 * will still be there" is a different question at the turn than in the middle,
 * and a round window cannot tell the two apart.
 */
export function seatPicks(
  seat: number,
  { teams = LEAGUE_TEAMS, rounds = DRAFT_PICKS / LEAGUE_TEAMS }: { teams?: number; rounds?: number } = {},
): number[] {
  const picks: number[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const inRound = round % 2 === 1 ? seat : teams - seat + 1;
    picks.push((round - 1) * teams + inRound);
  }
  return picks;
}

/**
 * The reader's next pick, given a seat and how many picks have gone.
 *
 * `picksGone` comes from `drafted.size`, which this screen already polls every
 * 15 seconds — so once the seat is known, "when am I up" needs nothing from
 * anybody. Returns `null` past the end of the draft rather than a pick that does
 * not exist.
 */
export function nextPick(
  seat: number,
  picksGone: number,
  options: { teams?: number; rounds?: number } = {},
): number | null {
  return seatPicks(seat, options).find((pick) => pick > picksGone) ?? null;
}

/**
 * The pick numbers a round covers, which is all a round says without a seat.
 *
 * Independent of the snake's direction: round `r` is always picks
 * `(r-1)T+1 … rT`, and only *which* of them is yours depends on your seat and
 * the parity. That is exactly why this is honest when the seat is unknown — the
 * window is a fact, and the position inside it is the missing part.
 */
export function roundWindow(round: number, teams: number = LEAGUE_TEAMS): PickTarget {
  return { kind: "round", from: (round - 1) * teams + 1, to: round * teams };
}

/**
 * The standard normal CDF.
 *
 * Zelen & Severo (A&S 26.2.17), whose absolute error is below 7.5e-8 — several
 * orders of magnitude tighter than anything here needs, since the output is a
 * probability shown to the reader as a whole percent. Written out rather than
 * pulled in as a dependency: it is nine lines, the project has no runtime deps
 * for math, and `lib/value.test.ts` pins it against known values.
 */
export function normalCdf(z: number): number {
  if (z < 0) return 1 - normalCdf(-z);
  const t = 1 / (1 + 0.2316419 * z);
  const poly =
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const density = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  return 1 - density * poly;
}

/**
 * The chance a player is still on the board at a given pick.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SPREAD IS WIDENED BEFORE IT IS USED, which is the one piece of
 * arithmetic here that is a judgment rather than a fact.
 *
 * Two aggregators price this draft and they do not agree. The cost axis plots
 * Sleeper's number, because that is the price every other screen in this app
 * shows; the only published *dispersion* is FFC's. Using one source's centre
 * with the other's spread is the obvious move and it is measurably wrong —
 * across the 178 matched rows inside the draft, the two prices differ by a median
 * of 1.20 of FFC's own standard deviations, the p90 is 2.74, and **42 of 178
 * players (24%) sit more than two sigma apart.** Saquon Barkley is 13.9 to
 * Sleeper and 20.1 to FFC on a stdev of 3.5: believing those three numbers
 * together says he cannot possibly last, while the drafts FFC actually watched
 * had him going six picks later with a low of 33.
 *
 * The correlation between that gap and the stdev is 0.427, which is what says
 * the disagreement is a *separate* uncertainty and not one the stdev already
 * contains. So the two are added in quadrature — the standard way to combine
 * independent uncertainties — and the result is centred on the board's own
 * price. It behaves correctly at both ends: near the top of the draft the two
 * sources agree closely and the widening is negligible, while in the middle
 * rounds where they disagree by twenty picks it widens enough to stop the model
 * claiming a precision nobody has.
 *
 * Checked against the alternative: for Barkley this returns 6% survival to pick
 * 25 where FFC's own centre and spread, used natively, give 8%. The widening
 * lands close to the answer the other source would have given on its own terms,
 * which is the property that makes it more than a fudge.
 *
 * ---------------------------------------------------------------------------
 * TWO LIMITS, both stated because they are invisible in the output.
 *
 * **A normal is symmetric and draft position is not.** A player cannot go before
 * pick 1 but can fall a long way, so the real distribution has a fatter right
 * tail than this — Barkley's observed low of 33 is 3.7 sigma out where a normal
 * would put it near zero probability. The bias therefore runs one way: this
 * *understates* the chance a player falls to you. Erring toward "he will be
 * gone" is the safer direction for a draft aid, but it is an error.
 *
 * **Where there is no spread, this degrades to a step function** rather than
 * inventing a dispersion — available if his price is at or past your pick, gone
 * if it is not. That is the honest floor: FFC's 2026 file stops at pick 190, so
 * essentially everyone past the draft has no spread, and inside the draft it is
 * one player (Andy Borregales). The basis travels with the number so the screen
 * can say which of the two it is looking at.
 */
export function survivalOf(player: ValuePlayer, target: PickTarget | null): {
  p: number | null;
  basis: SurvivalBasis;
} {
  if (!target) return { p: null, basis: "none" };

  const picks =
    target.kind === "pick"
      ? [target.pick]
      : // Averaged across the window, which is the expectation over a seat that
        // is equally likely to be any of the twelve. Not the midpoint: the curve
        // is not linear across twelve picks near a player's own price, and the
        // mean of the probabilities is the quantity actually wanted.
        Array.from({ length: target.to - target.from + 1 }, (_, i) => target.from + i);

  const spread = player.spread;

  if (!spread) {
    const available = picks.filter((pick) => player.adp >= pick).length;
    return { p: available / picks.length, basis: "step" };
  }

  const gap = Math.abs(player.adp - spread.adp);
  const sigma = Math.sqrt(spread.stdev * spread.stdev + gap * gap);

  // A stdev of exactly 0 with no gap would divide by zero. It does not occur in
  // the live data — `adp_spread()` filters out null stdevs and the smallest real
  // one is 0.7 — but a zero-width distribution is a step function by definition,
  // so it is answered as one rather than guarded with an exception.
  if (sigma === 0) {
    const available = picks.filter((pick) => player.adp >= pick).length;
    return { p: available / picks.length, basis: "step" };
  }

  // P(his draft position >= this pick). Treated as continuous: the half-pick a
  // continuity correction would add is immaterial against a sigma of 3 to 20,
  // and pretending otherwise would imply a precision the inputs do not have.
  const total = picks.reduce((sum, pick) => sum + (1 - normalCdf((pick - player.adp) / sigma)), 0);

  return { p: total / picks.length, basis: "modeled" };
}

/** A rail row: a dot, what it is likely to cost you to wait, and the sort key. */
export type RailEntry = {
  dot: Dot;
  /** `null` when no round is chosen and availability is not in play. */
  survival: number | null;
  basis: SurvivalBasis;
  /** What the rail sorted on. Identical to `dot.residual` in `value` mode. */
  score: number;
};

/**
 * Order the rail, and say who was left out.
 *
 * This is the whole of the fix. It reorders and filters; it creates no
 * coordinate and mutates nothing, so the scatter beside it cannot be affected by
 * anything decided here.
 *
 * The two modes are Kevin's call — both, as a toggle, the same answer he gave for
 * the season window — and they ask genuinely different questions:
 *
 * - **`value`** ranks on the residual alone and *excludes* anyone below
 *   `SURVIVAL_FLOOR`. "What is the best value that could still fall to me."
 *   Honest and simple: one number decides the order, and availability only
 *   decides who is eligible to appear.
 * - **`draft`** ranks on the **expected** residual — the residual discounted by
 *   the chance of actually getting him. "What is the best value I can expect to
 *   capture." Nobody is excluded; a certainty sinks to the bottom on its own.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BLEND IS AN EXPECTATION AND NOT A PENALTY, which took a measurement
 * over the live board to settle.
 *
 * The first version docked a player a tunable share of the axis for how likely he
 * was to be gone — `residual - penalty * (1 - survival) * range`. It needed a
 * constant nobody could calibrate, and measured against real rows it was simply
 * too weak: on the `total` vertical at round 4, **Puka Nacua at a survival of
 * literally zero still ranked third** on a list headed "best available", because
 * his residual of +149 was further above the field than half the axis. Raising
 * the constant until that stopped happening pushed it to 1.0, at which point it
 * was no longer a weighting so much as an exclusion with extra arithmetic.
 *
 * `survival × residual` needs no constant, because it is a quantity rather than a
 * policy: the value you can expect to capture. A coin-flip at +40 scores 20 and
 * therefore ranks below a certainty at +25, which is the correct answer to "what
 * should I expect" and is exactly the trade a drafter is making. It also lands
 * the zero-survival cases where they belong — Nacua scores 0 rather than third.
 *
 * **Availability discounts a bargain and never flatters a bust.** For a negative
 * residual the survival factor is dropped, because multiplying a bust by a small
 * probability would rank the busts most likely to be gone *above* the ones still
 * there — arithmetically true and useless. The two branches agree at zero, so the
 * score is continuous across it.
 *
 * With no target the two modes are identical by construction, and that is
 * deliberate: **before a round is chosen this screen behaves exactly as it did
 * before any of this existed.**
 */
export function rankRail(
  dots: Dot[],
  {
    mode,
    target,
    floor = SURVIVAL_FLOOR,
  }: {
    mode: RailMode;
    target: PickTarget | null;
    floor?: number;
  },
): { entries: RailEntry[]; excluded: number } {
  const scored: RailEntry[] = dots.map((dot) => {
    const { p, basis } = survivalOf(dot.player, target);
    return {
      dot,
      survival: p,
      basis,
      score:
        mode === "draft" && p != null && dot.residual > 0 ? p * dot.residual : dot.residual,
    };
  });

  const entries =
    mode === "value"
      ? scored.filter((entry) => entry.survival == null || entry.survival >= floor)
      : scored;

  // Sorted on the score, then on the player id, so a rerun on unchanged input
  // cannot reorder ties — the same reason `market_value()` breaks its rank ties
  // on player_id rather than leaving them to the planner.
  entries.sort(
    (a, b) =>
      b.score - a.score ||
      (a.dot.player.player_id ?? "").localeCompare(b.dot.player.player_id ?? ""),
  );

  return { entries, excluded: scored.length - entries.length };
}
