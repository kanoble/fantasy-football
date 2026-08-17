import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COST_MAX,
  COST_MIN,
  MIN_COHORT,
  RESIDUAL_MAX,
  buildModel,
  costX,
  figureFor,
  logCost,
  neighborhood,
  nextPick,
  normalCdf,
  rankRail,
  roundWindow,
  scopeModel,
  seatPicks,
  survivalOf,
  type FormSeason,
  type PickTarget,
  type RailMode,
  type ValuePlayer,
} from "./value.ts";

/**
 * The residual math, under test.
 *
 * This is the first test runner in the project, and it is here rather than
 * anywhere else because this is the first math in the app whose being wrong
 * would not look wrong. Every other number on screen is checkable by eye against
 * a table one route away; a baseline that quietly refits to a filtered set draws
 * a chart that is entirely plausible and entirely false.
 *
 * The scope-invariance case at the bottom is the one that matters most. The rest
 * would be caught eventually by a reader who knew the players.
 */

const STAT_SEASON = 2025;

/**
 * Costs spaced evenly in **log** space, which is the space the neighborhood is
 * measured in.
 *
 * Deliberate, and the reason the expectations below can be worked out by hand:
 * with uniform log spacing the nearest-k window is index-centered for any
 * interior point, so the moving median of a monotone series is that point's own
 * value and its residual is exactly zero. With evenly spaced *pick numbers* the
 * window would skew toward the expensive end, every expectation would need a
 * floating-point trace to predict, and the test would be asserting whatever the
 * code happened to do.
 */
const RATIO = 1.4;
const cost = (index: number) => RATIO ** index;

function player(overrides: Partial<ValuePlayer> & { name: string }): ValuePlayer {
  return {
    player_id: overrides.name.toLowerCase().replace(/\s+/g, "-"),
    position: "RB",
    team: "DET",
    norm_name: overrides.name.toLowerCase(),
    adp: 50,
    injury_status: null,
    games: 17,
    career_games: 17,
    median_delta: null,
    priced_seasons: 0,
    form: [],
    // No published spread by default, so a fixture that says nothing about
    // availability gets the step-function fallback rather than a made-up
    // dispersion. The availability cases below opt in explicitly.
    spread: null,
    ...overrides,
  };
}

/** A monotone falling curve: 20 backs, evenly log-spaced, value 100 down to 5. */
function fallingCurve(count = 20): ValuePlayer[] {
  return Array.from({ length: count }, (_, index) =>
    player({
      name: `RB ${index}`,
      adp: cost(index),
      form: [{ season: STAT_SEASON, games: 17, median: 100 - 5 * index, total: 0 }],
    }),
  );
}

const near = (actual: number, expected: number, what: string) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${what}: expected ${expected}, got ${actual}`,
  );

describe("costX", () => {
  // The first build had this backwards and shipped a caption that contradicted
  // its own plot: pick number was drawn ascending to the right, which puts the
  // CHEAPEST players on the right, which is a falling cost axis. Cost and pick
  // number run in opposite directions and these assertions are the guard.
  it("puts the most expensive pick on the right, because cost rises to the right", () => {
    near(costX(COST_MIN), 100, "pick 1 is the costliest player and sits at the right edge");
    near(costX(COST_MAX), 0, "the deepest price sits at the left edge");
  });

  it("falls in pick number from left to right", () => {
    assert.ok(
      costX(192) < costX(96) && costX(96) < costX(24) && costX(24) < costX(1),
      "a later pick is always further left than an earlier one",
    );
  });

  it("is logarithmic, so equal ratios take equal width", () => {
    // The whole reason the axis is not linear: picks 1-24 would otherwise take
    // 8% of the width, and the top 24 is most of what the screen is for.
    near(costX(2) - costX(4), costX(4) - costX(8), "a doubling is a fixed width");
    assert.ok(100 - costX(24) > 40, "the first two rounds take real width, not a sliver");
  });

  it("clamps rather than escaping the frame", () => {
    near(costX(0.5), 100, "a price above the axis");
    near(costX(5000), 0, "a price below it");
  });
});

describe("logCost", () => {
  // The neighborhood is a two-pointer walk over an ascending array. Running it
  // on the screen coordinate is what broke when the axis was reversed, so the
  // two are separate functions and this pins the one the math depends on.
  it("ascends with the pick number, whichever way the axis is drawn", () => {
    assert.ok(logCost(1) < logCost(12) && logCost(12) < logCost(192));
  });

  it("moves opposite to the screen coordinate", () => {
    assert.ok(logCost(12) < logCost(96) && costX(12) > costX(96));
  });
});

describe("the residual domain is fixed, not fitted", () => {
  it("does not move when an extreme outlier joins the set", () => {
    // Fitting the domain to the largest residual was the first version and was
    // measurably bad: one -84 bust set the career-value axis to ±100 and pushed
    // 96% of the field into the middle four tenths of the plot. It is also the
    // same class of mistake as a refitting baseline — the axis would move when
    // nobody's season had changed.
    const plain = buildModel(fallingCurve(), {
      vertical: "median",
      lookback: "last",
      statSeason: STAT_SEASON,
      neighbors: 5,
    });

    const withOutlier = buildModel(
      [
        ...fallingCurve(),
        player({
          name: "Outlier",
          adp: cost(6),
          form: [{ season: STAT_SEASON, games: 17, median: 5000, total: 0 }],
        }),
      ],
      { vertical: "median", lookback: "last", statSeason: STAT_SEASON, neighbors: 5 },
    );

    assert.equal(plain.range, RESIDUAL_MAX.median);
    assert.equal(withOutlier.range, RESIDUAL_MAX.median, "one absurd player does not rescale it");
  });

  it("marks a dot past the end of the axis rather than dropping or hiding it", () => {
    const model = buildModel(
      [
        ...fallingCurve(),
        player({
          name: "Outlier",
          adp: cost(6),
          form: [{ season: STAT_SEASON, games: 17, median: 5000, total: 0 }],
        }),
      ],
      { vertical: "median", lookback: "last", statSeason: STAT_SEASON, neighbors: 5 },
    );

    const outlier = model.dots.find((dot) => dot.player.name === "Outlier")!;
    assert.equal(outlier.clamped, true, "it says it is off the end");
    assert.equal(outlier.y, 0, "and is drawn against the frame rather than outside it");
    assert.ok(outlier.residual > RESIDUAL_MAX.median, "while keeping its true residual");

    const ordinary = model.dots.find((dot) => dot.player.name === "RB 10")!;
    assert.equal(ordinary.clamped, false);
  });
});

describe("neighborhood", () => {
  const xs = Array.from({ length: 20 }, (_, index) => index);

  it("centers on an interior point", () => {
    assert.deepEqual(neighborhood(xs, 10, 5), [8, 13]);
  });

  it("goes one-sided at the ends rather than returning fewer points", () => {
    assert.deepEqual(neighborhood(xs, 0, 5), [0, 5]);
    assert.deepEqual(neighborhood(xs, 19, 5), [15, 20]);
  });

  it("returns the whole set when the window is wider than it", () => {
    assert.deepEqual(neighborhood([0, 1, 2], 1, 13), [0, 3]);
  });
});

describe("figureFor", () => {
  const forms: FormSeason[] = [
    { season: 2025, games: 17, median: 20, total: 340 },
    { season: 2024, games: 17, median: 14, total: 238 },
    { season: 2023, games: 17, median: 8, total: 136 },
  ];

  it("reads the stat season alone under the `last` window", () => {
    const figure = figureFor(
      player({ name: "A", form: forms }),
      "median",
      "last",
      STAT_SEASON,
    );
    assert.deepEqual(figure, { value: 20, seasons: 1 });
  });

  it("weights three seasons 3/2/1 toward the recent one", () => {
    const figure = figureFor(player({ name: "A", form: forms }), "median", "weighted", STAT_SEASON);
    // (3*20 + 2*14 + 1*8) / 6
    near(figure!.value, 16, "weighted median week");
    assert.equal(figure!.seasons, 3);
  });

  it("renormalizes the weights over missing seasons rather than counting them as zero", () => {
    // The player missed 2025 entirely. Treating that as a zero would drag him to
    // (3*0 + 2*14 + 1*8)/6 = 6.0 — asserting he scored nothing in a year he was
    // not on a field, which is the same lie as plotting a rookie at the origin.
    const figure = figureFor(
      player({ name: "A", form: forms.slice(1) }),
      "median",
      "weighted",
      STAT_SEASON,
    );
    near(figure!.value, 12, "weighted over the seasons he played"); // (2*14 + 1*8)/3
    assert.equal(figure!.seasons, 2, "and says how thin the evidence is");
  });

  it("has no figure at all when the stat season is missing and the window is `last`", () => {
    assert.equal(
      figureFor(player({ name: "A", form: forms.slice(1) }), "median", "last", STAT_SEASON),
      null,
    );
  });

  it("ignores seasons older than the weights, rather than dividing by a missing weight", () => {
    const figure = figureFor(
      player({ name: "A", form: [...forms, { season: 2019, games: 17, median: 99, total: 999 }] }),
      "median",
      "weighted",
      STAT_SEASON,
    );
    near(figure!.value, 16, "the 2019 season is outside the window and is not counted");
    assert.equal(figure!.seasons, 3);
  });

  it("treats the career delta as a career figure, so the window control does nothing to it", () => {
    const subject = player({ name: "A", median_delta: 5, priced_seasons: 9, form: forms });
    assert.deepEqual(figureFor(subject, "delta", "last", STAT_SEASON), { value: 5, seasons: 9 });
    assert.deepEqual(figureFor(subject, "delta", "weighted", STAT_SEASON), { value: 5, seasons: 9 });
  });
});

describe("buildModel — a known curve reproduces known expectations", () => {
  const model = buildModel(fallingCurve(), {
    vertical: "median",
    lookback: "last",
    statSeason: STAT_SEASON,
    neighbors: 5,
  });

  const at = (index: number) => model.dots.find((dot) => dot.player.name === `RB ${index}`)!;

  it("plots every player on a monotone curve", () => {
    assert.equal(model.dots.length, 20);
    assert.equal(model.unplotted.length, 0);
  });

  it("gives an interior point a residual of exactly zero", () => {
    // The window is index-centered here, so the moving median of a monotone
    // series is the point's own value. Any drift means the neighborhood is not
    // centered where it claims to be.
    for (const index of [2, 5, 10, 16, 17]) {
      near(at(index).residual, 0, `RB ${index} sits on the curve`);
      near(at(index).expected, at(index).value, `RB ${index} expectation`);
    }
  });

  it("reports the one-sided window at the ends rather than hiding it", () => {
    // The most expensive player is judged against the four priced below him,
    // because there is nobody above him. That is inherent to a moving window and
    // is documented on `neighborhood` — it is a known edge effect, not a defect,
    // and it is asserted here so a future change cannot quietly remove it.
    near(at(0).expected, 90, "cheapest end expectation is the window's middle");
    near(at(0).residual, 10, "and the first pick reads above it");
    near(at(1).residual, 5, "second pick, same one-sided window");
    near(at(19).residual, -10, "the far end is one-sided the other way");
    near(at(18).residual, -5, "second from the end");
  });

  it("puts a zero residual on the center line and a positive one above it", () => {
    assert.equal(model.range, 10, "domain rounds up to a human number");
    near(at(10).y, 50, "the market's expectation is the middle of the plot");
    assert.ok(at(0).y < 50, "beating your price puts you above the line");
    assert.ok(at(19).y > 50, "and missing it puts you below");
  });
});

describe("buildModel — evidence is only marked when it actually differs", () => {
  it("says nothing varies when every figure rests on one season", () => {
    // Under the `last` window this is true BY CONSTRUCTION, and the first build
    // marked every dot on that view as thin evidence — which distinguished
    // nobody and, because the hollow style dropped the fill, threw away the
    // good/bad sign colour along with it.
    const model = buildModel(fallingCurve(), {
      vertical: "median",
      lookback: "last",
      statSeason: STAT_SEASON,
      neighbors: 5,
    });

    assert.ok(model.dots.every((dot) => dot.seasons === 1));
    assert.equal(model.evidenceVaries, false, "so the chart must not mark any of them");
  });

  it("says it varies when the window mixes one-season and three-season players", () => {
    const seasons = (n: number) =>
      [2025, 2024, 2023]
        .slice(0, n)
        .map((season) => ({ season, games: 17, median: 12, total: 200 }));

    const model = buildModel(
      Array.from({ length: 12 }, (_, index) =>
        player({ name: `RB ${index}`, adp: cost(index), form: seasons(index < 6 ? 1 : 3) }),
      ),
      { vertical: "median", lookback: "weighted", statSeason: STAT_SEASON, neighbors: 5 },
    );

    assert.equal(model.evidenceVaries, true);
  });

  it("carries the answer through a scope unchanged", () => {
    const model = buildModel(fallingCurve(), {
      vertical: "median",
      lookback: "last",
      statSeason: STAT_SEASON,
      neighbors: 5,
    });
    assert.equal(scopeModel(model, { maxCost: cost(5) }).evidenceVaries, model.evidenceVaries);
  });
});

describe("buildModel — the expectation is per position, always", () => {
  it("does not let one position's scoring level become another's residual", () => {
    // The failure this rule exists to prevent: a shared curve made the three
    // biggest bargains Mahomes, Stafford and Brissett, because a quarterback
    // outscores a receiver every week of his life. Here every quarterback scores
    // exactly twice every running back at the same price; with per-position
    // baselines nobody has a residual, because nobody is unusual *for his own
    // position*.
    const backs = fallingCurve(20);
    const quarterbacks = fallingCurve(20).map((entry, index) =>
      player({
        name: `QB ${index}`,
        position: "QB",
        adp: entry.adp,
        form: [{ season: STAT_SEASON, games: 17, median: (100 - 5 * index) * 2, total: 0 }],
      }),
    );

    const model = buildModel([...backs, ...quarterbacks], {
      vertical: "median",
      lookback: "last",
      statSeason: STAT_SEASON,
      neighbors: 5,
    });

    for (const dot of model.dots) {
      const interior = Number(dot.player.name.split(" ")[1]) >= 2;
      const nearEnd = Number(dot.player.name.split(" ")[1]) >= 18;
      if (interior && !nearEnd) near(dot.residual, 0, `${dot.player.name} is unremarkable`);
    }
  });
});

describe("buildModel — a thin position yields no baseline rather than a fabricated one", () => {
  it("sends a position below the cohort floor to the rail", () => {
    const fullbacks = Array.from({ length: MIN_COHORT - 1 }, (_, index) =>
      player({
        name: `FB ${index}`,
        position: "FB",
        adp: cost(index),
        form: [{ season: STAT_SEASON, games: 17, median: 5 + index, total: 0 }],
      }),
    );

    const model = buildModel(fullbacks, {
      vertical: "median",
      lookback: "last",
      statSeason: STAT_SEASON,
    });

    assert.equal(model.dots.length, 0, "no dots invented from a cohort this thin");
    assert.equal(model.unplotted.length, MIN_COHORT - 1);
    assert.ok(
      model.unplotted.every((entry) => entry.reason === "no-baseline"),
      "and they are named as such rather than as absent",
    );
  });

  it("plots the same players once the cohort clears the floor", () => {
    const fullbacks = Array.from({ length: MIN_COHORT }, (_, index) =>
      player({
        name: `FB ${index}`,
        position: "FB",
        adp: cost(index),
        form: [{ season: STAT_SEASON, games: 17, median: 5 + index, total: 0 }],
      }),
    );

    const model = buildModel(fullbacks, {
      vertical: "median",
      lookback: "last",
      statSeason: STAT_SEASON,
    });

    assert.equal(model.dots.length, MIN_COHORT);
  });
});

describe("buildModel — the three empty states survive onto the rail", () => {
  it("tells apart unmatched, rookie, absent and unpriced", () => {
    const rows = [
      ...fallingCurve(),
      player({ name: "Nobody", player_id: null, career_games: 0, games: 0 }),
      player({ name: "Rookie", career_games: 0, games: 0 }),
      player({ name: "Absent", career_games: 60, games: 0 }),
    ];

    const model = buildModel(rows, {
      vertical: "median",
      lookback: "last",
      statSeason: STAT_SEASON,
      neighbors: 5,
    });

    const reasonOf = (name: string) =>
      model.unplotted.find((entry) => entry.player.name === name)!.reason;

    assert.equal(reasonOf("Nobody"), "unmatched");
    assert.equal(reasonOf("Rookie"), "rookie");
    assert.equal(reasonOf("Absent"), "absent");
  });

  it("calls a played-but-never-priced player unpriced, not absent", () => {
    const rows = [
      ...fallingCurve().map((entry, index) =>
        player({ ...entry, name: `RB ${index}`, median_delta: 3, priced_seasons: 4 }),
      ),
      player({ name: "Undrafted", career_games: 40, games: 17, median_delta: null }),
    ];

    const model = buildModel(rows, {
      vertical: "delta",
      lookback: "last",
      statSeason: STAT_SEASON,
      neighbors: 5,
    });

    assert.equal(
      model.unplotted.find((entry) => entry.player.name === "Undrafted")!.reason,
      "unpriced",
    );
  });
});

/**
 * THE ONE THAT MATTERS.
 *
 * The plan for this screen names this as the check to re-run whenever the
 * residual math is touched, because it is the only thing that catches a baseline
 * quietly refitting — and a refitting baseline looks entirely reasonable on
 * screen. The mock was walked to 0, 12, 24, 48, 96 and 120 picks with every
 * dot's coordinates diffed against the un-scoped baseline; this is that walk,
 * kept.
 */
describe("scopeModel — the scope removes dots and moves nothing", () => {
  const roster = [
    ...fallingCurve(20),
    ...Array.from({ length: 20 }, (_, index) =>
      player({
        name: `WR ${index}`,
        position: "WR",
        adp: cost(index),
        form: [{ season: STAT_SEASON, games: 17, median: 60 - 2 * index, total: 0 }],
      }),
    ),
  ];

  const baseline = buildModel(roster, {
    vertical: "median",
    lookback: "last",
    statSeason: STAT_SEASON,
    neighbors: 5,
  });

  // Cheapest picks go first, which is what a draft actually does — and it is the
  // damaging order for this property, because the players removed are the good
  // ones and a refitting baseline would sink with each of them.
  const byPick = [...roster].sort((a, b) => a.adp - b.adp);

  for (const picks of [0, 12, 24, 48, 96, 120]) {
    it(`holds every coordinate after ${picks} picks`, () => {
      const drafted = new Set(byPick.slice(0, picks).map((entry) => entry.norm_name));
      const scoped = scopeModel(baseline, { drafted });

      assert.equal(scoped.range, baseline.range, "the axis does not rescale");

      for (const dot of scoped.dots) {
        const before = baseline.dots.find((other) => other.player.name === dot.player.name)!;
        near(dot.x, before.x, `${dot.player.name} x`);
        near(dot.y, before.y, `${dot.player.name} y`);
        near(dot.residual, before.residual, `${dot.player.name} residual`);
        near(dot.expected, before.expected, `${dot.player.name} expectation`);
      }

      const expectedSurvivors = baseline.dots.filter((dot) => !drafted.has(dot.player.norm_name));
      assert.equal(scoped.dots.length, expectedSurvivors.length, "only drafted players leave");
    });
  }

  it("holds when a position filter is applied too", () => {
    const scoped = scopeModel(baseline, { positions: new Set(["WR"]) });

    assert.equal(scoped.range, baseline.range, "looking at one position does not rescale the axis");
    assert.ok(scoped.dots.length > 0);
    assert.ok(scoped.dots.every((dot) => dot.player.position === "WR"));

    for (const dot of scoped.dots) {
      const before = baseline.dots.find((other) => other.player.name === dot.player.name)!;
      near(dot.y, before.y, `${dot.player.name} y under a position filter`);
    }
  });

  it("holds when the draft-range cutoff is applied, and keeps the cheap players in the baseline", () => {
    // The tempting simplification is to drop players past the cutoff before
    // building the model, which is one line shorter and quietly wrong: the
    // players beyond pick 192 are most of what defines the cheap end of every
    // position's curve, so cutting them first would move the expectation for
    // everyone still on screen. This asserts the coordinates are the same ones
    // computed against the full field.
    const cutoff = cost(12);
    const scoped = scopeModel(baseline, { maxCost: cutoff });

    assert.ok(scoped.dots.length > 0 && scoped.dots.length < baseline.dots.length);
    assert.ok(scoped.dots.every((dot) => dot.player.adp <= cutoff));

    for (const dot of scoped.dots) {
      const before = baseline.dots.find((other) => other.player.name === dot.player.name)!;
      near(dot.y, before.y, `${dot.player.name} y under a cost cutoff`);
      near(dot.expected, before.expected, `${dot.player.name} expectation under a cost cutoff`);
    }
  });

  it("holds when both are applied at once", () => {
    const drafted = new Set(byPick.slice(0, 24).map((entry) => entry.norm_name));
    const scoped = scopeModel(baseline, { drafted, positions: new Set(["RB"]) });

    assert.equal(scoped.range, baseline.range);
    for (const dot of scoped.dots) {
      const before = baseline.dots.find((other) => other.player.name === dot.player.name)!;
      near(dot.y, before.y, `${dot.player.name} y under both`);
      assert.ok(!drafted.has(dot.player.norm_name));
    }
  });
});

/* ===========================================================================
 * AVAILABILITY
 *
 * The rail asked "who is the best value in the draft" when a drafter is only
 * ever asking "who is the best value I can still get". These cover the fix, and
 * the last block is the one that matters: re-ranking a list must not move a dot.
 * =========================================================================== */

/**
 * Looser than `near`, and deliberately so.
 *
 * `normalCdf` is an approximation with an absolute error below 7.5e-8, so
 * asserting probabilities at `near`'s 1e-9 would be asserting the approximation
 * rather than the arithmetic. 1e-6 is three digits tighter than anything shown
 * on screen, where these are rendered as whole percents.
 */
const close = (actual: number, expected: number, what: string, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${what}: expected ${expected}, got ${actual}`,
  );

describe("seatPicks — the snake, and why a seat matters at all", () => {
  it("runs odd rounds forward and even rounds back", () => {
    assert.deepEqual(seatPicks(1, { rounds: 4 }), [1, 24, 25, 48]);
    assert.deepEqual(seatPicks(12, { rounds: 4 }), [12, 13, 36, 37]);
    assert.deepEqual(seatPicks(6, { rounds: 4 }), [6, 19, 30, 43]);
  });

  it("gives every seat the same number of picks", () => {
    for (let seat = 1; seat <= 12; seat += 1) {
      assert.equal(seatPicks(seat).length, 16, `seat ${seat} gets sixteen picks`);
    }
  });

  it("covers every pick in the draft exactly once across the twelve seats", () => {
    const all = Array.from({ length: 12 }, (_, index) => seatPicks(index + 1)).flat().sort((a, b) => a - b);
    assert.deepEqual(all, Array.from({ length: 192 }, (_, index) => index + 1));
  });

  it("makes the gap between your picks wildly seat-dependent, which is the point", () => {
    // The documented reason a seat is worth having rather than just a round: at
    // the turn you wait twenty-two picks and then pick twice, and in the middle
    // you wait twelve every time. "Who will still be there" is a different
    // question in those two seats, and a round window cannot tell them apart.
    const gaps = (seat: number) =>
      seatPicks(seat)
        .slice(1)
        .map((pick, index) => pick - seatPicks(seat)[index]!);

    assert.deepEqual(new Set(gaps(1)), new Set([23, 1]), "seat 1 alternates a long wait and a pair");
    assert.deepEqual(new Set(gaps(12)), new Set([1, 23]), "seat 12 likewise, offset by one round");
    assert.deepEqual(new Set(gaps(6)), new Set([13, 11]), "a middle seat waits about a round every time");
  });
});

describe("nextPick", () => {
  it("is your first pick before anybody has gone", () => {
    assert.equal(nextPick(6, 0), 6);
    assert.equal(nextPick(1, 0), 1);
  });

  it("advances as the room picks", () => {
    assert.equal(nextPick(6, 5), 6, "you are on the clock");
    assert.equal(nextPick(6, 6), 19, "your pick has gone, the next is at the turn");
    assert.equal(nextPick(6, 18), 19);
    assert.equal(nextPick(6, 19), 30);
  });

  it("returns null past the end of the draft rather than a pick that does not exist", () => {
    assert.equal(nextPick(6, 192), null);
    assert.equal(nextPick(12, 191), null, "seat 12's last pick is 181, so 191 is past it");
  });
});

describe("roundWindow — what a round says without a seat", () => {
  it("is the twelve picks of that round, whichever way the snake runs", () => {
    assert.deepEqual(roundWindow(1), { kind: "round", from: 1, to: 12 });
    assert.deepEqual(roundWindow(4), { kind: "round", from: 37, to: 48 });
    assert.deepEqual(roundWindow(16), { kind: "round", from: 181, to: 192 });
  });
});

describe("normalCdf", () => {
  it("reproduces the values everybody knows", () => {
    close(normalCdf(0), 0.5, "the middle");
    close(normalCdf(1), 0.8413447, "one sigma", 1e-6);
    close(normalCdf(-1), 0.1586553, "minus one sigma", 1e-6);
    close(normalCdf(1.959964), 0.975, "the 97.5th percentile", 1e-6);
    close(normalCdf(2.575829), 0.995, "the 99.5th percentile", 1e-6);
  });

  it("is symmetric about zero", () => {
    for (const z of [0.1, 0.5, 1, 2, 3]) {
      close(normalCdf(z) + normalCdf(-z), 1, `symmetry at ${z}`);
    }
  });
});

describe("survivalOf — with no spread it degrades to a step, and says so", () => {
  const plain = player({ name: "No Spread", adp: 100 });

  it("is not in play at all without a target", () => {
    assert.deepEqual(survivalOf(plain, null), { p: null, basis: "none" });
  });

  it("is a step function on his price alone", () => {
    assert.deepEqual(survivalOf(plain, { kind: "pick", pick: 50 }), { p: 1, basis: "step" });
    assert.deepEqual(survivalOf(plain, { kind: "pick", pick: 150 }), { p: 0, basis: "step" });
    assert.deepEqual(survivalOf(plain, { kind: "pick", pick: 100 }), { p: 1, basis: "step" });
  });

  it("averages the step across a round window", () => {
    // Picks 96-107, of which he survives 96 through 100 — five of twelve.
    const result = survivalOf(plain, { kind: "round", from: 96, to: 107 });
    close(result.p!, 5 / 12, "a step averaged over a window is a fraction");
    assert.equal(result.basis, "step");
  });
});

describe("survivalOf — the spread is widened before it is used", () => {
  it("is a coin flip at his own price when the two sources agree", () => {
    // Gap zero, so sigma is the stdev and the pick is the mean.
    const agreed = player({ name: "Agreed", adp: 20, spread: { adp: 20, stdev: 4, drafts: 900 } });
    const result = survivalOf(agreed, { kind: "pick", pick: 20 });
    close(result.p!, 0.5, "at the centre of his own distribution");
    assert.equal(result.basis, "modeled");
  });

  it("falls as the pick gets later and never leaves 0..1", () => {
    const subject = player({ name: "Any", adp: 20, spread: { adp: 20, stdev: 4, drafts: 900 } });
    const at = (pick: number) => survivalOf(subject, { kind: "pick", pick })!.p!;

    assert.ok(at(5) > at(15) && at(15) > at(20) && at(20) > at(30) && at(30) > at(40));
    for (const pick of [1, 10, 20, 50, 200]) {
      const p = at(pick);
      assert.ok(p >= 0 && p <= 1, `a probability at pick ${pick}, got ${p}`);
    }
  });

  it("lands near the other source's own answer, which is what makes the widening more than a fudge", () => {
    // Saquon Barkley, 2026: Sleeper says 13.9, FFC says 20.1 with a stdev of 3.5.
    // Believing Sleeper's centre with FFC's raw spread says he cannot last to
    // pick 25 — a fifth of a percent. Adding the disagreement in quadrature says
    // 6%, against the 8% FFC's own centre and spread give on their own terms.
    const barkley = player({ name: "Barkley", adp: 13.9, spread: { adp: 20.1, stdev: 3.5, drafts: 1945 } });
    const widened = survivalOf(barkley, { kind: "pick", pick: 25 }).p!;

    const naive = 1 - normalCdf((25 - 13.9) / 3.5);
    const native = 1 - normalCdf((25 - 20.1) / 3.5);

    assert.ok(naive < 0.005, `the naive mixture is overconfident: ${naive}`);
    close(widened, 0.0595, "the widened estimate", 5e-4);
    assert.ok(
      Math.abs(widened - native) < 0.03,
      `the widening should land near the native answer: ${widened} against ${native}`,
    );
  });

  it("widens more where the sources disagree more", () => {
    const stdev = 3;
    const agreeing = player({ name: "Agreeing", adp: 40, spread: { adp: 40, stdev, drafts: 500 } });
    const arguing = player({ name: "Arguing", adp: 40, spread: { adp: 60, stdev, drafts: 500 } });

    // Both are priced at 40 on the axis; only the disagreement differs. The one
    // nobody agrees about must be less certain to be gone by pick 55.
    const target = { kind: "pick", pick: 55 } as const;
    assert.ok(
      survivalOf(arguing, target).p! > survivalOf(agreeing, target).p!,
      "disagreement between sources is uncertainty, and uncertainty cuts both ways",
    );
  });

  it("answers a zero-width spread as the step function it is, rather than dividing by zero", () => {
    const certain = player({ name: "Certain", adp: 30, spread: { adp: 30, stdev: 0, drafts: 10 } });
    assert.deepEqual(survivalOf(certain, { kind: "pick", pick: 40 }), { p: 0, basis: "step" });
    assert.deepEqual(survivalOf(certain, { kind: "pick", pick: 20 }), { p: 1, basis: "step" });
  });
});

/**
 * THE OTHER ONE THAT MATTERS.
 *
 * `scopeModel`'s invariance is asserted above. This is the same property for the
 * new control: changing the round, the seat or the ranking mode re-orders a list
 * and must not touch a coordinate. If this ever fails, the screen has started
 * telling the reader about the control rather than about the players.
 */
describe("rankRail — re-ranking moves nothing", () => {
  const roster = Array.from({ length: 20 }, (_, index) =>
    player({
      name: `RB ${index}`,
      adp: 4 + index * 9,
      spread: { adp: 4 + index * 9 + (index % 3) * 4, stdev: 2 + index * 0.6, drafts: 900 - index * 40 },
      form: [{ season: STAT_SEASON, games: 17, median: 24 - index + (index % 4) * 3, total: 0 }],
    }),
  );

  const baseline = buildModel(roster, {
    vertical: "median",
    lookback: "last",
    statSeason: STAT_SEASON,
    neighbors: 5,
  });

  const targets: (PickTarget | null)[] = [
    null,
    roundWindow(1),
    roundWindow(4),
    roundWindow(9),
    roundWindow(16),
    { kind: "pick", pick: 6 },
    { kind: "pick", pick: 40 },
    { kind: "pick", pick: 137 },
  ];

  for (const mode of ["value", "draft"] as RailMode[]) {
    for (const target of targets) {
      const label = target == null ? "no target" : target.kind === "pick" ? `pick ${target.pick}` : `round ${target.from}-${target.to}`;

      it(`holds every coordinate in ${mode} mode at ${label}`, () => {
        const { entries } = rankRail(baseline.dots, { mode, target });

        for (const entry of entries) {
          const before = baseline.dots.find((dot) => dot.player.name === entry.dot.player.name)!;
          near(entry.dot.x, before.x, `${entry.dot.player.name} x`);
          near(entry.dot.y, before.y, `${entry.dot.player.name} y`);
          near(entry.dot.residual, before.residual, `${entry.dot.player.name} residual`);
          near(entry.dot.expected, before.expected, `${entry.dot.player.name} expectation`);
          assert.equal(entry.dot.clamped, before.clamped, "and the clamp flag is untouched");
        }
      });
    }
  }

  it("leaves the model's own dot array alone", () => {
    const order = baseline.dots.map((dot) => dot.player.name);
    rankRail(baseline.dots, { mode: "draft", target: roundWindow(4) });
    rankRail(baseline.dots, { mode: "value", target: { kind: "pick", pick: 40 } });
    assert.deepEqual(baseline.dots.map((dot) => dot.player.name), order, "sorted a copy, not the model");
  });
});

describe("rankRail — the fix itself", () => {
  /**
   * The shape of the actual defect. An elite player who beats his price and is
   * long gone by pick 40, against a modest one who will still be there.
   *
   * With the axis corrected the real rail topped out at McCaffrey (ADP 5.2) and
   * Puka Nacua (4.6) — arithmetically right and useless at pick 40.
   */
  const elite = player({
    name: "Elite",
    adp: 5,
    spread: { adp: 5, stdev: 1.5, drafts: 1200 },
    form: [{ season: STAT_SEASON, games: 17, median: 22, total: 0 }],
  });

  const modest = player({
    name: "Modest",
    adp: 45,
    spread: { adp: 45, stdev: 6, drafts: 700 },
    form: [{ season: STAT_SEASON, games: 17, median: 17, total: 0 }],
  });

  const field = [
    elite,
    modest,
    ...Array.from({ length: 14 }, (_, index) =>
      player({
        name: `Filler ${index}`,
        adp: 8 + index * 11,
        spread: { adp: 8 + index * 11, stdev: 3 + index, drafts: 600 },
        form: [{ season: STAT_SEASON, games: 17, median: 14 - index * 0.4, total: 0 }],
      }),
    ),
  ];

  const model = buildModel(field, {
    vertical: "median",
    lookback: "last",
    statSeason: STAT_SEASON,
    neighbors: 5,
  });

  const rank = (mode: RailMode, target: PickTarget | null) =>
    rankRail(model.dots, { mode, target });

  it("ranks the elite player first when no round is chosen, in both modes", () => {
    // Before a round is chosen the screen must behave exactly as it did before
    // any of this existed, and the two modes must be indistinguishable.
    for (const mode of ["value", "draft"] as RailMode[]) {
      assert.equal(rank(mode, null).entries[0]!.dot.player.name, "Elite", `${mode} with no target`);
      assert.equal(rank(mode, null).excluded, 0, "and nobody is dropped");
    }
  });

  it("drops him from `value` mode at pick 40, because he cannot be had", () => {
    const { entries, excluded } = rank("value", { kind: "pick", pick: 40 });
    assert.ok(!entries.some((entry) => entry.dot.player.name === "Elite"), "gone from the list");
    assert.ok(excluded > 0, "and counted rather than silently dropped");
    assert.equal(entries[0]!.dot.player.name, "Modest", "the best value actually available leads");
  });

  it("demotes rather than drops him in `draft` mode", () => {
    const { entries, excluded } = rank("draft", { kind: "pick", pick: 40 });
    assert.equal(excluded, 0, "the blend excludes nobody; the penalty does the work");

    const names = entries.map((entry) => entry.dot.player.name);
    assert.ok(names.indexOf("Modest") < names.indexOf("Elite"), "the available player ranks higher");
    assert.ok(names.includes("Elite"), "but a genuine value stays visible in case he falls");
  });

  it("still ranks him first when you pick ahead of his price, in both modes", () => {
    for (const mode of ["value", "draft"] as RailMode[]) {
      const { entries } = rank(mode, { kind: "pick", pick: 2 });
      assert.equal(entries[0]!.dot.player.name, "Elite", `${mode} at pick 2`);
    }
  });

  it("treats a player priced at exactly your pick as the coin flip he is", () => {
    // A consequence of ranking on an expectation, and worth pinning because it
    // surprises: "available at pick 5" means nobody took him in picks 1-4, and
    // his own mean is 5 — so it is even money, and `draft` mode halves him. That
    // is the right answer to "what should I expect to capture" and it does make
    // the mode conservative about reaching. `value` mode is the one that ignores
    // it, which is most of why both exist.
    const target = { kind: "pick", pick: 5 } as const;

    const eliteEntry = rank("draft", target).entries.find((e) => e.dot.player.name === "Elite")!;
    close(eliteEntry.survival!, 0.5, "even money at his own price", 1e-6);
    // Against the exact product rather than against 0.5, because `near`'s 1e-9
    // is tighter than `normalCdf`'s own approximation error.
    near(
      eliteEntry.score,
      eliteEntry.survival! * eliteEntry.dot.residual,
      "so the blend halves his residual",
    );
    close(eliteEntry.score, 0.5 * eliteEntry.dot.residual, "which is half of it", 1e-6);

    assert.equal(
      rank("value", target).entries[0]!.dot.player.name,
      "Elite",
      "while value mode still leads with him",
    );
  });

  it("keeps the residual as the score in `value` mode and changes it in `draft`", () => {
    const target = { kind: "pick", pick: 40 } as const;
    for (const entry of rank("value", target).entries) {
      near(entry.score, entry.dot.residual, `${entry.dot.player.name} scores on residual alone`);
    }

    const blended = rank("draft", target).entries.find((entry) => entry.dot.player.name === "Elite")!;
    assert.ok(blended.score < blended.dot.residual, "the blend discounts a player who will be gone");
    near(
      blended.score,
      blended.survival! * blended.dot.residual,
      "and the score is exactly the expected residual",
    );
  });

  it("discounts a bargain but never flatters a bust", () => {
    // Multiplying a negative residual by a small probability would rank the
    // busts most likely to be gone above the ones still on the board — true
    // arithmetic and a useless list. The survival factor applies to bargains
    // only, and the two branches agree at zero so the score stays continuous.
    const busts = [
      player({
        name: "Gone Bust",
        adp: 5,
        spread: { adp: 5, stdev: 1.5, drafts: 1200 },
        form: [{ season: STAT_SEASON, games: 17, median: 2, total: 0 }],
      }),
      player({
        name: "Present Bust",
        adp: 60,
        spread: { adp: 60, stdev: 5, drafts: 700 },
        form: [{ season: STAT_SEASON, games: 17, median: 2, total: 0 }],
      }),
      ...field,
    ];

    const withBusts = buildModel(busts, {
      vertical: "median",
      lookback: "last",
      statSeason: STAT_SEASON,
      neighbors: 5,
    });

    const { entries } = rankRail(withBusts.dots, { mode: "draft", target: { kind: "pick", pick: 40 } });
    const gone = entries.find((entry) => entry.dot.player.name === "Gone Bust")!;
    const present = entries.find((entry) => entry.dot.player.name === "Present Bust")!;

    assert.ok(gone.dot.residual < 0 && present.dot.residual < 0, "both are genuinely bad");
    near(gone.score, gone.dot.residual, "a bust keeps its own residual, undiscounted");
    near(present.score, present.dot.residual, "and so does the one still available");
  });

  it("orders ties deterministically, so a poll cannot reshuffle the list", () => {
    const tied = Array.from({ length: 10 }, (_, index) =>
      player({
        name: `Same ${index}`,
        adp: 20 + index * 12,
        form: [{ season: STAT_SEASON, games: 17, median: 12, total: 0 }],
      }),
    );

    const flat = buildModel(tied, {
      vertical: "median",
      lookback: "last",
      statSeason: STAT_SEASON,
      neighbors: 5,
    });

    const once = rankRail(flat.dots, { mode: "value", target: null });
    const again = rankRail([...flat.dots].reverse(), { mode: "value", target: null });

    assert.deepEqual(
      once.entries.map((entry) => entry.dot.player.name),
      again.entries.map((entry) => entry.dot.player.name),
      "the same input in a different order gives the same list",
    );
  });
});
