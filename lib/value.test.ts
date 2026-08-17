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
  neighborhood,
  scopeModel,
  type FormSeason,
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
  it("pins the ends of the axis and rises to the right", () => {
    near(costX(COST_MIN), 0, "the first pick sits at the left edge");
    near(costX(COST_MAX), 100, "the last pick sits at the right edge");
    assert.ok(costX(12) < costX(24) && costX(24) < costX(192), "cost rises to the right");
  });

  it("is logarithmic, so equal ratios take equal width", () => {
    // The whole reason the axis is not linear: picks 1-24 would otherwise take
    // 8% of the width, and the top 24 is most of what the screen is for.
    near(costX(4) - costX(2), costX(8) - costX(4), "a doubling is a fixed width");
    assert.ok(costX(24) > 40, "the first two rounds take real width, not a sliver");
  });

  it("clamps rather than escaping the frame", () => {
    near(costX(0.5), 0, "a price below the axis");
    near(costX(5000), 100, "a price beyond the axis");
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
