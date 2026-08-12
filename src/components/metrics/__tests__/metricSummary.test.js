import { describe, it, expect } from "vitest";
import {
  isGoalMetric,
  goalSummary,
  trendSummary,
  deviationBars,
} from "../metricSummary";

describe("isGoalMetric", () => {
  it("splits the two kinds of page by whether there is a target", () => {
    expect(isGoalMetric({ goal: 160 })).toBe(true);
    expect(isGoalMetric({ key: "hrv" })).toBe(false);
    expect(isGoalMetric(null)).toBe(false);
  });
});

describe("goalSummary", () => {
  // A day with no reading is a day the question was not asked, not a miss.
  it("counts against the days that actually have a reading", () => {
    const s = goalSummary([160, null, 120, 165], 160);
    expect(s.met).toBe(2);
    expect(s.recorded).toBe(3);
  });

  it("averages only what was recorded", () => {
    expect(goalSummary([100, null, 200], 160).average).toBe(150);
  });

  // The same rule utils/streak.js follows: an unfinished day treated as a miss
  // resets the run every midnight and rebuilds it each evening.
  it("treats an unfinished today as pending rather than as a miss", () => {
    expect(goalSummary([165, 170, 40], 160).streak).toBe(2);
    expect(goalSummary([165, 170, null], 160).streak).toBe(2);
  });

  it("counts today when today has already met the goal", () => {
    expect(goalSummary([165, 170, 180], 160).streak).toBe(3);
  });

  it("breaks the streak on a missed day that is not today", () => {
    expect(goalSummary([165, 40, 170, 180], 160).streak).toBe(2);
  });

  it("finds the best run in the window", () => {
    expect(goalSummary([165, 170, 175, 40, 165, 40], 160).best).toBe(3);
  });

  it("has nothing to say without readings or without a goal", () => {
    expect(goalSummary([null, null], 160)).toBe(null);
    expect(goalSummary([160], null)).toBe(null);
  });
});

describe("trendSummary", () => {
  it("reports the direction of travel between the halves of the window", () => {
    const t = trendSummary([70, 70, 70, 74, 74, 74]);
    expect(t.change).toBeCloseTo(4, 5);
  });

  // A regression line on a handful of weigh-ins is a precise answer to a
  // question the data cannot support.
  it("ignores days with no reading rather than treating them as zero", () => {
    const t = trendSummary([70, null, 70, null, 74, 74]);
    expect(t.change).toBeGreaterThan(0);
    expect(t.n).toBe(4);
  });

  it("reports the same usual range the baseline band on Home claims", () => {
    const t = trendSummary([46, 44, 49, 47, 51, 45, 48, 43]);
    expect(t.low).toBeLessThan(t.baseline);
    expect(t.high).toBeGreaterThan(t.baseline);
  });

  it("says nothing from one or two readings", () => {
    expect(trendSummary([70, 71])).toBe(null);
    expect(trendSummary([])).toBe(null);
  });
});

describe("deviationBars", () => {
  it("signs each day against the baseline", () => {
    const bars = deviationBars([40, 50, 60], 50);
    expect(bars[0]).toBeLessThan(0);
    expect(bars[1]).toBe(0);
    expect(bars[2]).toBeGreaterThan(0);
  });

  // Scaled to the window, not to the range: most days sit inside normal, and a
  // bar scaled to the range would leave the list a row of nothing.
  it("gives the widest departure the full bar", () => {
    const bars = deviationBars([40, 48, 52], 50);
    expect(Math.abs(bars[0])).toBe(1);
  });

  it("leaves a missing day null rather than drawing it at the baseline", () => {
    expect(deviationBars([null, 50], 50)[0]).toBe(null);
  });

  it("does not divide by zero on a perfectly flat window", () => {
    expect(deviationBars([50, 50], 50).every(Number.isFinite)).toBe(true);
  });
});
