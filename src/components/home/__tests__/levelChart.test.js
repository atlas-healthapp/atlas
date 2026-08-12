import { describe, it, expect } from "vitest";
import {
  levelSeries,
  levelCeiling,
  levelLine,
  levelDistribution,
  levelLadder,
  sleepBars,
  floorFor,
  DISTRIBUTION_BINS,
} from "@/components/home/levelChart";

/** n days of rollups, oldest first, with the values given. */
function window(values, metric = "hrv") {
  return values.map((v, i) => {
    const d = new Date("2026-07-01T00:00:00");
    d.setDate(d.getDate() + i);
    return { date: d.toLocaleDateString("sv"), values: { [metric]: v } };
  });
}

describe("levelSeries", () => {
  it("gives one trailing average per day once the window has filled", () => {
    const out = levelSeries(window([10, 10, 10, 10, 10, 10, 10, 10]));
    expect(out).toHaveLength(2);
    expect(out[0].value).toBeCloseTo(10, 5);
  });

  it("has nothing to say before there are seven nights", () => {
    expect(levelSeries(window([10, 10, 10]))).toEqual([]);
  });

  it("dates each average by the night it ends on", () => {
    const out = levelSeries(window(new Array(8).fill(50)));
    expect(out.at(-1).date).toBe("2026-07-08");
  });

  it("skips days with no reading rather than averaging across them", () => {
    const w = window(new Array(8).fill(50));
    delete w[3].values.hrv;
    const out = levelSeries(w);
    // Seven usable readings left, so exactly one average.
    expect(out).toHaveLength(1);
  });
});

describe("levelCeiling", () => {
  const at = (...values) => values.map((value, i) => ({ date: `d${i}`, value }));

  it("takes the good end of the distribution, which is the low one when lower is better", () => {
    const series = at(50, 52, 54, 56, 58, 60);
    const hrvWay = levelCeiling(series);
    const restingWay = levelCeiling(series, { higherIsBetter: false });
    expect(hrvWay).toBeGreaterThan(restingWay);
  });

  it("has no ceiling to offer from nothing", () => {
    expect(levelCeiling([])).toBeNull();
    expect(levelCeiling(null)).toBeNull();
  });
});

describe("levelLine", () => {
  const series = [
    { date: "2026-08-01", value: 100 },
    { date: "2026-08-02", value: 110 },
    { date: "2026-08-03", value: 90 },
  ];

  it("puts the ceiling above the floor on the drawn axis", () => {
    const geo = levelLine(series, { ceiling: 115, floor: 69, showFloor: true });
    // SVG y grows downward, so a higher value has a smaller y.
    expect(geo.ceilingY).toBeLessThan(geo.floorY);
  });

  it("keeps both rules inside the box rather than on its edges", () => {
    const geo = levelLine(series, { ceiling: 115, floor: 69, height: 110, showFloor: true });
    expect(geo.ceilingY).toBeGreaterThan(0);
    expect(geo.floorY).toBeLessThan(110);
  });

  // The floor is the ceiling times 0.6 rather than anything ever recorded, so on
  // real data the axis spent most of its height on a region never visited: 7% of
  // the box for every resting heart rate in a fortnight.
  it("leaves the floor out of the axis unless asked for it", () => {
    const withFloor = levelLine(series, { ceiling: 115, floor: 69, showFloor: true });
    const without = levelLine(series, { ceiling: 115, floor: 69 });
    expect(without.floorY).toBeNull();
    // The same readings therefore occupy more of the drawn height.
    const spread = (g) => Math.abs(g.today.y - g.ceilingY);
    expect(spread(without)).toBeGreaterThan(spread(withFloor));
  });

  it("keeps the ceiling put while the readings move under it", () => {
    // The reason the ceiling stays in the extent with the floor gone: it is what
    // the line is judged against, so it must not chase the readings.
    const calm = levelLine(
      [
        { date: "a", value: 100 },
        { date: "b", value: 101 },
      ],
      { ceiling: 115, floor: 69 }
    );
    const wild = levelLine(
      [
        { date: "a", value: 80 },
        { date: "b", value: 114 },
      ],
      { ceiling: 115, floor: 69 }
    );
    expect(calm.ceilingY).toBeCloseTo(wild.ceilingY, 1);
    // What moves is the reading: a week sitting well under the ceiling draws
    // further from it than one that reached it.
    expect(calm.today.y - calm.ceilingY).toBeGreaterThan(wild.today.y - wild.ceilingY);
  });

  it("will not shrink the scale down onto a quiet fortnight", () => {
    // RangeMark's defect, which this axis could otherwise reinvent: with the
    // floor out of the extent the bottom follows the worst reading, so two
    // milliseconds of wobble would be drawn full height.
    const quiet = levelLine(
      [
        { date: "a", value: 114 },
        { date: "b", value: 115 },
      ],
      { ceiling: 115, floor: 69, height: 150 }
    );
    // One millisecond, over a scale that must span at least 15% of 115.
    expect(quiet.today.y - quiet.ceilingY).toBeLessThan(15);
  });

  it("makes the extra room at the bad end, not around the ceiling", () => {
    const quiet = levelLine(
      [
        { date: "a", value: 114 },
        { date: "b", value: 115 },
      ],
      { ceiling: 115, floor: 69, height: 150 }
    );
    // The ceiling stays near the top of the box rather than being pushed to the
    // middle by padding added symmetrically.
    expect(quiet.ceilingY).toBeLessThan(30);
  });

  it("keeps an outside reference on the axis rather than off the end of it", () => {
    // The age band sits well below every resting heart rate reading, and with the
    // floor gone it is the only thing holding the bottom of the scale open.
    const geo = levelLine(resting, { ceiling: 48, floor: 80, invert: true, reference: 61 });
    expect(geo.referenceY).not.toBeNull();
    expect(geo.referenceY).toBeLessThan(geo.height);
  });

  it("gives today its own figure in the gutter", () => {
    const geo = levelLine(series, { ceiling: 115, floor: 69, gutter: 44 });
    const lit = geo.axisLabels.find((l) => l.lit);
    expect(lit.value).toBe(90);
    expect(lit.y).toBeCloseTo(geo.today.y, 5);
  });

  it("drops today's figure rather than overprinting the ceiling's", () => {
    const geo = levelLine(
      [
        { date: "a", value: 100 },
        { date: "b", value: 115 },
      ],
      { ceiling: 115, floor: 69, gutter: 44 }
    );
    expect(geo.axisLabels.map((l) => l.key)).not.toContain("today");
    expect(geo.axisLabels.map((l) => l.key)).toContain("ceiling");
  });

  it("does not rescale the axis around the readings", () => {
    // The point of the chart is where the line sits between two fixed rules, so
    // a quiet fortnight must not move them.
    const opts = { ceiling: 115, floor: 69, showFloor: true };
    const calm = levelLine(
      [
        { date: "a", value: 100 },
        { date: "b", value: 101 },
      ],
      opts
    );
    const wild = levelLine(
      [
        { date: "a", value: 80 },
        { date: "b", value: 114 },
      ],
      opts
    );
    expect(calm.ceilingY).toBeCloseTo(wild.ceilingY, 1);
    expect(calm.floorY).toBeCloseTo(wild.floorY, 1);
  });

  it("marks today at the end of the line", () => {
    const geo = levelLine(series, { ceiling: 115, floor: 69 });
    expect(geo.today.value).toBe(90);
    expect(geo.today.x).toBeGreaterThan(geo.width / 2);
  });

  it("draws nothing from one point or no ceiling", () => {
    expect(levelLine([{ date: "a", value: 90 }], { ceiling: 115, floor: 69 })).toBeNull();
    expect(levelLine(series, { ceiling: null, floor: 69 })).toBeNull();
  });

  // Resting heart rate. Its ceiling is the LOWEST sustained average and its floor
  // is a higher figure, which is the opposite arrangement to HRV's.
  const resting = [
    { date: "2026-08-01", value: 52 },
    { date: "2026-08-02", value: 50 },
    { date: "2026-08-03", value: 54 },
  ];

  it("keeps the ceiling at the top when the metric runs the other way", () => {
    // The whole reason the axis flips: the two cards sit one above the other, so
    // a line climbing toward the ceiling has to mean the same thing on both.
    const geo = levelLine(resting, { ceiling: 48, floor: 80, invert: true, showFloor: true });
    expect(geo.ceilingY).toBeLessThan(geo.floorY);
  });

  it("keeps both inverted rules inside the box", () => {
    // The extent used to be built from the floor alone, which on an inverted
    // metric is the larger figure, so both rules fell outside the drawn axis.
    const geo = levelLine(resting, {
      ceiling: 48,
      floor: 80,
      invert: true,
      height: 110,
      showFloor: true,
    });
    expect(geo.ceilingY).toBeGreaterThan(0);
    expect(geo.floorY).toBeLessThan(110);
  });

  it("draws a better reading nearer the ceiling when inverted", () => {
    const better = levelLine(
      [
        { date: "a", value: 60 },
        { date: "b", value: 50 },
      ],
      { ceiling: 48, floor: 80, invert: true }
    );
    expect(better.today.y).toBeLessThan(better.ceilingY + 20);
  });

  it("places an outside reference below the ceiling on an inverted axis", () => {
    const geo = levelLine(resting, { ceiling: 48, floor: 80, invert: true, reference: 61 });
    expect(geo.reference).toBe(61);
    expect(geo.referenceY).toBeGreaterThan(geo.ceilingY);
  });

  it("says nothing about a reference nobody asked for", () => {
    expect(levelLine(series, { ceiling: 115, floor: 69 }).referenceY).toBeNull();
  });

  it("keeps the plot clear of the gutter the figures are set in", () => {
    // A figure and the line overprinting each other is the whole reason the
    // gutter exists, so nothing drawn may start inside it.
    const geo = levelLine(series, { ceiling: 115, floor: 69, gutter: 44 });
    const xs = geo.line.split(" ").map((p) => Number(p.split(",")[0]));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(44);
    expect(geo.plotLeft).toBe(44);
    expect(geo.labelX).toBeLessThan(44);
  });

  it("still fills the box across when there is no gutter", () => {
    const geo = levelLine(series, { ceiling: 115, floor: 69 });
    expect(geo.plotLeft).toBe(0);
  });

  it("gives every rule a figure at the height it is drawn at", () => {
    const geo = levelLine(series, { ceiling: 115, floor: 69, gutter: 44, showFloor: true });
    const byKey = Object.fromEntries(geo.axisLabels.map((l) => [l.key, l]));
    expect(byKey.ceiling.value).toBe(115);
    expect(byKey.ceiling.y).toBeCloseTo(geo.ceilingY, 5);
    expect(byKey.floor.value).toBe(69);
    expect(byKey.floor.y).toBeCloseTo(geo.floorY, 5);
  });

  it("reads the gutter top to bottom", () => {
    const geo = levelLine(series, { ceiling: 115, floor: 69, gutter: 44 });
    const ys = geo.axisLabels.map((l) => l.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  it("labels an outside reference that stands clear of the other two", () => {
    const geo = levelLine(resting, {
      ceiling: 48,
      floor: 80,
      invert: true,
      reference: 61,
      gutter: 44,
      height: 150,
    });
    expect(geo.axisLabels.map((l) => l.key)).toContain("reference");
  });

  it("drops a reference figure that would overprint the ceiling's", () => {
    // On resting heart rate the age band lands just under your own ceiling far
    // more often than not, which is exactly where the ceiling's figure is.
    const geo = levelLine(resting, {
      ceiling: 48,
      floor: 80,
      invert: true,
      reference: 48.4,
      gutter: 44,
      height: 150,
    });
    // The rule itself still draws; only the figure beside it stands down.
    expect(geo.referenceY).not.toBeNull();
    expect(geo.axisLabels.map((l) => l.key)).not.toContain("reference");
  });
});

describe("levelDistribution", () => {
  const at = (...values) => values.map((value, i) => ({ date: `d${i}`, value }));

  it("counts every week into a band of the scale", () => {
    const out = levelDistribution(at(70, 71, 114, 90), { ceiling: 115, floor: 69 });
    expect(out.total).toBe(4);
    expect(out.bins).toHaveLength(DISTRIBUTION_BINS);
    expect(out.bins.reduce((s, b) => s + b.count, 0)).toBe(4);
  });

  it("lights the band today's reading falls in", () => {
    const out = levelDistribution(at(70, 114, 90), { ceiling: 115, floor: 69 });
    const lit = out.bins.filter((b) => b.today);
    expect(lit).toHaveLength(1);
    expect(lit[0].index).toBe(out.todayBin);
  });

  it("puts a reading above the ceiling in the top band rather than off the end", () => {
    const out = levelDistribution(at(130), { ceiling: 115, floor: 69 });
    expect(out.todayBin).toBe(DISTRIBUTION_BINS - 1);
  });

  it("puts a reading under the floor in the bottom band", () => {
    const out = levelDistribution(at(40), { ceiling: 115, floor: 69 });
    expect(out.todayBin).toBe(0);
  });

  it("scales the bars against the fullest band", () => {
    const out = levelDistribution(at(70, 70, 70, 114), { ceiling: 115, floor: 69 });
    const tallest = out.bins.find((b) => b.count === 3);
    expect(tallest.fill).toBe(1);
  });

  it("has nothing to draw without a scale", () => {
    expect(levelDistribution(at(90), { ceiling: null, floor: 69 })).toBeNull();
    expect(levelDistribution([], { ceiling: 115, floor: 69 })).toBeNull();
  });
});

describe("levelLadder", () => {
  const at = (...values) => values.map((value, i) => ({ date: `d${i}`, value }));
  const ladderOf = (series, opts) =>
    levelLadder(levelDistribution(series, { ceiling: 115, floor: 69 }), opts);

  it("gives a band one mark per day in it", () => {
    // The whole change: the count is the marks, so nothing has to be measured
    // against an axis to be read.
    const geo = ladderOf(at(114, 113, 112, 90));
    const top = geo.rows.at(-1);
    expect(top.count).toBe(3);
    expect(top.dots).toHaveLength(3);
  });

  it("draws the highest band at the top, like the line chart above it", () => {
    const geo = ladderOf(at(114, 70));
    const top = geo.rows.find((r) => r.index === DISTRIBUTION_BINS - 1);
    const bottom = geo.rows.find((r) => r.index === 0);
    expect(top.y).toBeLessThan(bottom.y);
  });

  it("puts a figure on every boundary, not just the two ends", () => {
    const geo = ladderOf(at(90, 100));
    expect(geo.edges).toHaveLength(DISTRIBUTION_BINS + 1);
    expect(Math.round(geo.edges.at(-1).value)).toBe(115);
    expect(Math.round(geo.edges[0].value)).toBe(69);
  });

  it("puts each boundary on the line between the two bands it separates", () => {
    const geo = ladderOf(at(90, 100));
    const row = geo.rows.find((r) => r.index === 3);
    const above = geo.edges.find((e) => Math.abs(e.y - row.y) < 0.001);
    const below = geo.edges.find((e) => Math.abs(e.y - (row.y + row.height)) < 0.001);
    expect(above).toBeTruthy();
    expect(below).toBeTruthy();
  });

  it("leaves an empty band empty rather than drawing a stub for it", () => {
    // The speck an empty band used to draw read as dirt, which is half of why
    // nobody could tell what the card was measuring.
    const geo = ladderOf(at(114, 113));
    const empty = geo.rows.find((r) => r.count === 0);
    expect(empty.dots).toEqual([]);
  });

  it("switches the whole card to bars once one band holds more days than fit", () => {
    // Never per row: some rows countable and others measured would be two charts
    // sharing an axis.
    const many = at(...new Array(60).fill(114));
    const geo = ladderOf(many);
    expect(geo.mode).toBe("bars");
    expect(geo.rows.at(-1).barWidth).toBeGreaterThan(0);
  });

  it("stays on marks for a history that still fits", () => {
    expect(ladderOf(at(114, 113, 112, 111, 90)).mode).toBe("dots");
  });

  it("keeps the marks clear of the gutter the figures sit in", () => {
    const geo = ladderOf(at(114, 90), { gutter: 40 });
    const first = geo.rows.flatMap((r) => r.dots)[0];
    expect(first.cx).toBeGreaterThan(40);
    expect(geo.labelX).toBeLessThan(40);
  });

  it("has nothing to draw without a distribution", () => {
    expect(levelLadder(null)).toBeNull();
    expect(levelLadder({ bins: [] })).toBeNull();
  });
});

describe("floorFor", () => {
  it("derives the floor from the ceiling, so nothing computes it twice", () => {
    expect(floorFor(100)).toBeCloseTo(60, 5);
    expect(floorFor(null)).toBeNull();
  });

  it("puts the floor above the ceiling when lower is better", () => {
    // A worse resting heart rate is a higher one, so multiplying here would have
    // drawn the scale upside down.
    expect(floorFor(48, { higherIsBetter: false })).toBeGreaterThan(48);
  });
});

describe("sleepBars", () => {
  const nights = (...scores) =>
    scores.map((score, i) => ({ date: `2026-08-0${i + 1}`, score }));

  it("keeps the axis at 0-100 so a bad week draws short", () => {
    const bad = sleepBars(nights(30, 32, 34));
    const good = sleepBars(nights(80, 82, 84));
    expect(bad.bars[0].height).toBeLessThan(good.bars[0].height);
  });

  it("rules the average across the nights it was made from", () => {
    const geo = sleepBars(nights(60, 80));
    expect(geo.average).toBe(70);
    // Between the two bars' tops, which is the only place an average can sit.
    expect(geo.averageY).toBeLessThan(geo.bars[0].y);
    expect(geo.averageY).toBeGreaterThan(geo.bars[1].y);
  });

  it("shows one bad night failing to move the week", () => {
    // The card's whole argument. A 20 among six good nights has to leave the rule
    // near the good ones rather than halfway down the chart.
    const geo = sleepBars(nights(85, 88, 84, 86, 87, 20));
    expect(geo.average).toBeGreaterThan(70);
  });

  it("draws the oldest night first however the caller collected them", () => {
    const geo = sleepBars([
      { date: "2026-08-03", score: 70 },
      { date: "2026-08-01", score: 90 },
      { date: "2026-08-02", score: 80 },
    ]);
    expect(geo.bars.map((b) => b.date)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(geo.from).toBe("2026-08-01");
    expect(geo.to).toBe("2026-08-03");
  });

  it("skips a night with no score rather than counting it as nought", () => {
    const geo = sleepBars([
      { date: "2026-08-01", score: 80 },
      { date: "2026-08-02", score: null },
      { date: "2026-08-03", score: 90 },
    ]);
    expect(geo.count).toBe(2);
    expect(geo.average).toBe(85);
  });

  it("draws nothing from a single night", () => {
    // One bar with a rule through it is not a picture of an average.
    expect(sleepBars(nights(80))).toBeNull();
    expect(sleepBars([])).toBeNull();
  });
});
