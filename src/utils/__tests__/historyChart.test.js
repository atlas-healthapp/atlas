import { describe, it, expect } from "vitest";
import { barGeometry, lineGeometry, rollingMean, meanLinePoints, weekRuleX, trimLeadingBlanks, CHART_H } from "@/utils/historyChart";

describe("barGeometry", () => {
  it("scales to the goal when no day beat it, so the target line stays on screen", () => {
    const { targetY, max } = barGeometry([40, 60, 80], 160);
    expect(max).toBe(160);
    expect(targetY).toBe(0);
  });

  it("scales to the biggest day when one beat the goal, so its bar still fits", () => {
    const { bars, max, targetY } = barGeometry([40, 200], 160);
    expect(max).toBe(200);
    expect(targetY).toBeGreaterThan(0);
    expect(bars[bars.length - 1].h).toBeLessThanOrEqual(CHART_H);
  });

  // Nothing logged and a day you drank nothing are different facts, and a row
  // of zero-height stubs reads as the second.
  it("draws no bar for a missing day rather than a flat one", () => {
    const { bars } = barGeometry([50, null, 50], 100);
    expect(bars).toHaveLength(2);
    expect(bars.map((b) => b.i)).toEqual([0, 2]);
  });

  it("marks the most recent day and which days met the goal", () => {
    const { bars } = barGeometry([200, 50, 180], 160);
    expect(bars.map((b) => b.met)).toEqual([true, false, true]);
    expect(bars.filter((b) => b.last)).toHaveLength(1);
    expect(bars.find((b) => b.last).i).toBe(2);
  });

  it("survives an empty series and a goal of zero", () => {
    expect(barGeometry([], 100).bars).toEqual([]);
    expect(() => barGeometry([1, 2], 0)).not.toThrow();
  });
});

describe("lineGeometry", () => {
  it("is null below two readings, because one point is not a trend", () => {
    expect(lineGeometry([])).toBeNull();
    expect(lineGeometry([74])).toBeNull();
    expect(lineGeometry([null, 74, null])).toBeNull();
    expect(lineGeometry([74, 74.5])).not.toBeNull();
  });

  // A straight segment drawn across a fortnight you did not weigh yourself is
  // an invention, and it looks exactly like a fortnight of steady weight.
  it("breaks the line across a gap instead of interpolating over it", () => {
    const solid = lineGeometry([74, 74.2, 74.1, 73.9]);
    expect(solid.paths).toHaveLength(1);

    const gappy = lineGeometry([74, 74.2, null, null, 73.9, 73.8]);
    expect(gappy.paths).toHaveLength(2);
  });

  it("drops a run of one point from the path but keeps the endpoint", () => {
    const g = lineGeometry([74, null, 73.5, 73.4]);
    // The lone first reading cannot be a segment on its own.
    expect(g.paths).toHaveLength(1);
    expect(g.endY).toBeGreaterThan(0);
  });

  it("puts the newest reading at the right-hand edge", () => {
    const g = lineGeometry([74, 74.2, 73.9]);
    expect(Math.round(g.endX)).toBe(310);
  });

  it("does not divide by zero on a flat series", () => {
    const g = lineGeometry([74, 74, 74]);
    expect(g).not.toBeNull();
    expect(Number.isFinite(g.endY)).toBe(true);
  });
});

describe("rollingMean", () => {
  it("is trailing, so early days average fewer readings rather than none", () => {
    const m = rollingMean([10, 20, 30], 7);
    expect(m[0]).toBe(10);
    expect(m[1]).toBe(15);
    expect(m[2]).toBe(20);
  });

  it("only ever looks back by the window", () => {
    const m = rollingMean([0, 0, 0, 0, 0, 0, 0, 70], 7);
    expect(m.at(-1)).toBeCloseTo(10, 5);
  });

  it("skips missing days instead of counting them as zero", () => {
    // A day you did not log is not a day you ate nothing, and averaging it in
    // as zero would drag the line down for a week.
    expect(rollingMean([100, null, 200], 7).at(-1)).toBe(150);
  });

  it("is null only where nothing at all is in reach", () => {
    expect(rollingMean([null, null], 7)).toEqual([null, null]);
  });
});

describe("meanLinePoints", () => {
  it("shares the bar chart's axis rather than deriving its own", () => {
    const values = [80, 100, 120];
    const { max } = barGeometry(values, 100);
    const pts = meanLinePoints(values, max, { window: 7, height: CHART_H });
    // The last mean is 100, which is the goal, so it must land at the same
    // height as the target line barGeometry computes.
    expect(pts.at(-1).y).toBeCloseTo(barGeometry(values, 100).targetY, 5);
  });

  it("centres each point over its own bar", () => {
    const pts = meanLinePoints([1, 2], 2, { width: 100, height: 50 });
    expect(pts[0].x).toBe(25);
    expect(pts[1].x).toBe(75);
  });

  it("survives an empty series or a missing axis", () => {
    expect(meanLinePoints([], 100)).toEqual([]);
    expect(meanLinePoints([1, 2], 0)).toEqual([]);
  });
});

describe("weekRuleX", () => {
  it("counts back from today, so rules land on weeks relative to now", () => {
    const xs = weekRuleX(15, 140);
    // 14 intervals over 140 wide, so a week is 70: rules at day 7 only, since
    // day 0 is the left edge.
    expect(xs).toEqual([70]);
  });

  it("draws none when the window is a week or shorter", () => {
    expect(weekRuleX(8, 100)).toEqual([]);
    expect(weekRuleX(3, 100)).toEqual([]);
  });

  it("spaces a month evenly", () => {
    const xs = weekRuleX(29, 280);
    expect(xs).toHaveLength(3);
    expect(xs[0] - xs[1]).toBeCloseTo(70, 5);
  });
});

describe("lineGeometry include", () => {
  it("pulls extra values into the scale without plotting them", () => {
    const plain = lineGeometry([48, 50], { include: [] });
    const wide = lineGeometry([48, 50], { include: [40, 60] });
    expect(plain.lo).toBe(48);
    expect(wide.lo).toBe(40);
    expect(wide.hi).toBe(60);
    expect(wide.points).toHaveLength(2);
  });

  it("gives a point per reading and skips the missing days", () => {
    const g = lineGeometry([48, null, 50, 51]);
    expect(g.points.map((p) => p.i)).toEqual([0, 2, 3]);
  });

  it("exposes the scale so a band can be drawn behind the line", () => {
    const g = lineGeometry([40, 60]);
    expect(g.yOf(60)).toBeLessThan(g.yOf(40));
  });
});

describe("trimLeadingBlanks", () => {
  const has = (d) => d.v != null;

  it("drops the empty run at the start", () => {
    const out = trimLeadingBlanks([{ v: null }, { v: null }, { v: 1 }, { v: 2 }], has);
    expect(out).toHaveLength(2);
    expect(out[0].v).toBe(1);
  });

  // The line this whole rule sits on: a gap in the middle is a day you did not
  // weigh yourself, and a blank at the end is today, still running.
  it("keeps a gap in the middle and a blank at the end", () => {
    const out = trimLeadingBlanks([{ v: 1 }, { v: null }, { v: 2 }, { v: null }], has);
    expect(out).toHaveLength(4);
  });

  it("returns a wholly empty series untouched", () => {
    // Or the empty state describes one day rather than the period asked about.
    const all = [{ v: null }, { v: null }];
    expect(trimLeadingBlanks(all, has)).toHaveLength(2);
  });

  it("leaves a series that starts with a reading alone", () => {
    const all = [{ v: 1 }, { v: 2 }];
    expect(trimLeadingBlanks(all, has)).toBe(all);
  });

  it("copes with nothing at all", () => {
    expect(trimLeadingBlanks(null, has)).toEqual([]);
  });
});
