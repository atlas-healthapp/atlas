import { describe, it, expect } from "vitest";
import {
  goalGeometry,
  dotGeometry,
  rangeGeometry,
  compositionSegments,
  hypnogramSegments,
} from "@/components/marks/markGeometry";

describe("dotGeometry", () => {
  it("counts out whole tenths of the goal", () => {
    expect(dotGeometry(80, 160).filled).toBe(5);
    expect(dotGeometry(1.25, 2.5).filled).toBe(5);
  });

  it("only shows an empty row when nothing is logged", () => {
    expect(dotGeometry(0, 2.5).filled).toBe(0);
    // 4% of the goal rounds to nothing, and a row that looks identical to
    // "you have not started" is the one thing this must not say.
    expect(dotGeometry(0.1, 2.5).filled).toBe(1);
  });

  it("only fills the last dot when the goal is actually met", () => {
    // 96% would round up to a full row and read as done.
    expect(dotGeometry(2.4, 2.5).filled).toBe(9);
    expect(dotGeometry(2.5, 2.5).filled).toBe(10);
  });

  it("caps at the goal rather than drawing overshoot", () => {
    expect(dotGeometry(5, 2.5).filled).toBe(10);
  });

  it("survives missing and nonsense inputs", () => {
    expect(dotGeometry(null, 2.5).filled).toBe(0);
    expect(dotGeometry(undefined, 2.5).filled).toBe(0);
    expect(dotGeometry(NaN, 2.5).filled).toBe(0);
    expect(dotGeometry(-3, 2.5).filled).toBe(0);
    expect(dotGeometry(1, 0).filled).toBe(10);
  });
});

describe("goalGeometry", () => {
  it("fills proportionally and puts the tick at the right edge when under the goal", () => {
    const { fillPct, tickPct } = goalGeometry(80, 160);
    expect(fillPct).toBe(50);
    expect(tickPct).toBe(100);
  });

  // The reason this is a tick and not a plain progress bar. PAI at 104 against
  // a threshold of 100 has to read as past its line, not as maxed out.
  it("moves the tick left rather than clipping when the goal is exceeded", () => {
    const { fillPct, tickPct } = goalGeometry(104, 100);
    expect(fillPct).toBe(100);
    expect(tickPct).toBeCloseTo(96.15, 1);
  });

  it("treats an empty metric as zero rather than as an error", () => {
    expect(goalGeometry(null, 160).fillPct).toBe(0);
    expect(goalGeometry(undefined, 160).fillPct).toBe(0);
  });

  it("never renders a negative fill", () => {
    expect(goalGeometry(-5, 160).fillPct).toBe(0);
  });

  it("survives a missing or zero goal without dividing by zero", () => {
    expect(Number.isFinite(goalGeometry(50, 0).fillPct)).toBe(true);
    expect(Number.isFinite(goalGeometry(50, null).tickPct)).toBe(true);
  });
});

describe("rangeGeometry", () => {
  const window14 = [50, 47, 49, 52, 46, 48, 51, 45, 49, 47, 48, 44, 49];

  it("marks a value inside its typical range as not outside", () => {
    const geo = rangeGeometry(50, { low: 45, high: 58, series: window14 });
    expect(geo.outside).toBe(false);
    expect(geo.valueX).toBeGreaterThan(geo.bandStart);
    expect(geo.valueX).toBeLessThan(geo.bandStart + geo.bandWidth);
  });

  it("marks a value below its range as outside", () => {
    expect(rangeGeometry(38, { low: 45, high: 58 }).outside).toBe(true);
  });

  it("marks a value above its range as outside", () => {
    expect(rangeGeometry(70, { low: 45, high: 58 }).outside).toBe(true);
  });

  // The whole reason this replaced baselineGeometry. That one derived the axis
  // from the range, so every in-range reading landed near the middle whatever
  // it was, and three vitals with three different stories drew one picture.
  it("moves the marker as the reading moves, not just as the range does", () => {
    const low = rangeGeometry(45, { low: 44, high: 52, series: window14 });
    const high = rangeGeometry(52, { low: 44, high: 52, series: window14 });
    expect(high.valueX - low.valueX).toBeGreaterThan(50);
  });

  it("takes its axis from the window, so the range is a segment inside it", () => {
    const geo = rangeGeometry(48, { low: 46, high: 50, series: window14 });
    // The window runs 44-52 against a 46-50 range, so the band must not fill
    // the axis: that is precisely what made the old mark unreadable.
    expect(geo.bandWidth).toBeLessThan(70);
    expect(geo.bandStart).toBeGreaterThan(0);
  });

  it("does not let today stretch the axis it is judged against", () => {
    const ordinary = rangeGeometry(48, { low: 44, high: 52, series: window14 });
    const outlier = rangeGeometry(80, { low: 44, high: 52, series: window14 });
    // Today is clamped on screen rather than rescaling everything around it,
    // so the band keeps the position it had.
    expect(outlier.bandStart).toBeCloseTo(ordinary.bandStart, 5);
  });

  it("puts one rug tick per distinct prior reading, today excluded", () => {
    const geo = rangeGeometry(45, { low: 44, high: 52, series: [46, 46, 48] });
    expect(geo.rug).toHaveLength(2);
  });

  it("places the baseline when given one, and omits it otherwise", () => {
    expect(rangeGeometry(48, { low: 44, high: 52, baseline: 47 }).baselineX).toBeGreaterThan(0);
    expect(rangeGeometry(48, { low: 44, high: 52 }).baselineX).toBeNull();
  });

  // Before the baseline window fills there is no range, and a band drawn from
  // three nights would look identical to one drawn from thirty.
  it("returns null when there is no usable range", () => {
    expect(rangeGeometry(50, { low: null, high: null })).toBeNull();
    expect(rangeGeometry(50, { low: 45, high: null })).toBeNull();
    expect(rangeGeometry(null, { low: 45, high: 58 })).toBeNull();
    expect(rangeGeometry(50)).toBeNull();
  });

  it("returns null for an inverted or empty range rather than drawing it backwards", () => {
    expect(rangeGeometry(50, { low: 58, high: 45 })).toBeNull();
    expect(rangeGeometry(50, { low: 50, high: 50 })).toBeNull();
  });

  it("keeps a far-out value on screen", () => {
    const geo = rangeGeometry(500, { low: 45, high: 58, series: window14 });
    expect(geo.valueX).toBeLessThanOrEqual(96.8);
    expect(geo.valueX).toBeGreaterThanOrEqual(3.2);
  });

  it("survives a window with no variation in it", () => {
    const geo = rangeGeometry(97, { low: 96, high: 98, series: [97, 97, 97] });
    expect(Number.isFinite(geo.valueX)).toBe(true);
    expect(Number.isFinite(geo.bandWidth)).toBe(true);
  });
});

describe("compositionSegments", () => {
  const night = { deep: 95, light: 240, rem: 75, awake: 20 };

  it("lays stages out in depth order, left to right", () => {
    const segs = compositionSegments(night, { color: "var(--fam-body)" });
    expect(segs.map((s) => s.key)).toEqual(["deep", "light", "rem", "awake"]);
    expect(segs[0].x).toBe(0);
  });

  it("sizes each stage by its share of the night", () => {
    const segs = compositionSegments(night, { color: "var(--fam-body)" });
    const light = segs.find((s) => s.key === "light");
    // 240 of 430 minutes, less the gap that bounds it.
    expect(light.width).toBeCloseTo((240 / 430) * 100 - 1.6, 5);
  });

  it("keeps a one-minute stage visible instead of letting the gap swallow it", () => {
    const segs = compositionSegments({ deep: 1, light: 600 }, { color: "x" });
    expect(segs.find((s) => s.key === "deep").width).toBeGreaterThan(0);
  });

  it("skips stages with no minutes rather than drawing empty slivers", () => {
    const segs = compositionSegments({ light: 300, rem: 60 }, { color: "x" });
    expect(segs.map((s) => s.key)).toEqual(["light", "rem"]);
  });

  it("leaves a visible gap between stages, since one hue cannot separate four", () => {
    const segs = compositionSegments(night, { color: "var(--fam-body)" });
    for (let i = 1; i < segs.length; i++) {
      const gap = segs[i].x - (segs[i - 1].x + segs[i - 1].width);
      expect(gap).toBeGreaterThan(1);
    }
  });

  it("returns nothing for a night with no data", () => {
    expect(compositionSegments({}, { color: "x" })).toEqual([]);
    expect(compositionSegments(null, { color: "x" })).toEqual([]);
  });

  // On Home the BODY card has to read as one idea, so stages are shades of the
  // family colour rather than four competing hues.
  it("uses shades of one colour in the family variant", () => {
    const segs = compositionSegments(night, { color: "var(--fam-body)" });
    const sleepStages = segs.filter((s) => s.key !== "awake");
    expect(sleepStages.every((s) => s.fill === "var(--fam-body)")).toBe(true);
    expect(new Set(sleepStages.map((s) => s.opacity)).size).toBe(3);
  });

  it("pushes awake outside the family hue, because it is not a kind of sleep", () => {
    const segs = compositionSegments(night, { color: "var(--fam-body)" });
    expect(segs.find((s) => s.key === "awake").fill).toBe("var(--dim)");
  });

  // Inside the sleep sheet nothing competes with sleep, so hue is free to name
  // each stage instead.
  it("uses named stage colours at full strength in the stage variant", () => {
    const segs = compositionSegments(night, { color: "x", variant: "stage" });
    expect(segs.map((s) => s.fill)).toEqual([
      "var(--stage-deep)",
      "var(--stage-light)",
      "var(--stage-rem)",
      "var(--stage-awake)",
    ]);
    expect(segs.every((s) => s.opacity === 1)).toBe(true);
  });
});

describe("hypnogramSegments", () => {
  // A short night with every stage in it, and a one-minute wake: the detail
  // this chart exists to show and the one a rounding error would erase.
  const timeline = [
    { stage: "light", startMinute: 0, minutes: 30 },
    { stage: "deep", startMinute: 30, minutes: 60 },
    { stage: "awake", startMinute: 90, minutes: 1 },
    { stage: "rem", startMinute: 91, minutes: 29 },
  ];

  it("puts awake at the top and deep at the bottom", () => {
    const segs = hypnogramSegments(timeline, { color: "x" });
    const rowOf = (stage) => segs.find((s) => s.stage === stage).row;
    expect(rowOf("awake")).toBe(0);
    expect(rowOf("deep")).toBe(3);
    expect(rowOf("rem")).toBeLessThan(rowOf("light"));
  });

  it("places each segment at its own start, not end to end", () => {
    const segs = hypnogramSegments(timeline, { color: "x" });
    // 30 of 120 minutes in.
    expect(segs[1].x).toBeCloseTo(25, 5);
    expect(segs[1].width).toBeCloseTo(50, 5);
  });

  it("keeps a one-minute wake visible instead of rounding it away", () => {
    const segs = hypnogramSegments(timeline, { color: "x" });
    const wake = segs.find((s) => s.stage === "awake");
    // 1/120 is 0.83%, but on a ten-hour night the same minute is 0.16%.
    const tiny = hypnogramSegments(
      [
        { stage: "light", startMinute: 0, minutes: 614 },
        { stage: "awake", startMinute: 614, minutes: 1 },
      ],
      { color: "x" }
    );
    expect(wake.width).toBeGreaterThan(0);
    expect(tiny.find((s) => s.stage === "awake").width).toBeGreaterThan(0.3);
  });

  it("returns nothing for a night with no timeline, so the caller can fall back", () => {
    expect(hypnogramSegments(null, { color: "x" })).toEqual([]);
    expect(hypnogramSegments([], { color: "x" })).toEqual([]);
    expect(hypnogramSegments([{ stage: "light", startMinute: 0, minutes: 0 }], {})).toEqual([]);
  });

  it("drops a stage it has no row for rather than stacking it on awake", () => {
    const segs = hypnogramSegments(
      [...timeline, { stage: "unknown", startMinute: 120, minutes: 10 }],
      { color: "x" }
    );
    expect(segs.every((s) => s.stage !== "unknown")).toBe(true);
  });

  it("takes awake off the family hue, because it is not a kind of sleep", () => {
    const segs = hypnogramSegments(timeline, { color: "var(--fam-body)" });
    expect(segs.find((s) => s.stage === "awake").fill).toBe("var(--dim)");
    expect(segs.find((s) => s.stage === "deep").fill).toBe("var(--fam-body)");
  });
});
