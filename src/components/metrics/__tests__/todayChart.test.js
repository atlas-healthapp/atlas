import { describe, it, expect } from "vitest";
import { stepsChart, TICK_HOURS } from "../todayChart";
import { intradayModel, HOURS } from "@/utils/intradaySteps";

const DAY = new Date(2026, 7, 27, 0, 0, 0, 0).getTime();
const at = (h) => DAY + h * 3600000;

const priors = new Array(12).fill(0).map(() => {
  const c = new Array(HOURS + 1).fill(0);
  for (let h = 1; h <= HOURS; h++) c[h] = h * 200;
  return c;
});

const model = (over = {}) =>
  intradayModel({
    todaySamples: [
      { t: at(9) + 60000, v: 300 },
      { t: at(14) + 60000, v: 900 },
    ],
    priorCurves: priors,
    nowMs: at(15),
    dayStartMs: DAY,
    goal: 8000,
    ...over,
  });

describe("stepsChart", () => {
  it("stops today's line at the hour reached", () => {
    const c = stepsChart(model(), { width: 100, height: 60 });
    const points = c.today.split("L").length;
    // Sixteen hour boundaries have a value, 0 through 15.
    expect(points).toBe(16);
  });

  it("draws the projection from where today stopped, not from zero", () => {
    const c = stepsChart(model(), { width: 100, height: 60 });
    expect(c.projection.startsWith(`M${c.now.x.toFixed(2)}`)).toBe(true);
  });

  // A target off the top of the frame cannot be judged against, so the model
  // scales to include it and the line has to land inside the box.
  it("keeps the goal line on the chart", () => {
    const c = stepsChart(model({ goal: 40000 }), { width: 100, height: 60 });
    expect(c.goalY).toBeGreaterThanOrEqual(0);
    expect(c.goalY).toBeLessThanOrEqual(c.axisY);
  });

  it("withholds the goal line when there is no goal", () => {
    const c = stepsChart(model({ goal: null }), { width: 100, height: 60 });
    expect(c.goalY).toBeNull();
  });

  // Both ends inset: the finish is a dot on the last hour and at the box's own
  // edge half of it falls outside the frame.
  it("insets both ends", () => {
    const c = stepsChart(model(), { width: 100, height: 60, inset: 1.2 });
    expect(c.ticks[0].x).toBeCloseTo(1.2, 5);
    expect(c.ticks.at(-1).x).toBeCloseTo(98.8, 5);
  });

  it("labels four hours plus both ends of the day", () => {
    const c = stepsChart(model(), {});
    expect(c.ticks.map((t) => t.label)).toEqual(["00", "06", "12", "18", "24"]);
    expect(TICK_HOURS.at(-1)).toBe(HOURS);
  });

  it("draws no band, median or projection on a short history", () => {
    const c = stepsChart(model({ priorCurves: priors.slice(0, 3) }), {});
    expect(c.band).toBe("");
    expect(c.median).toBe("");
    expect(c.projection).toBe("");
    expect(c.end).toBeNull();
    // Today's own line still draws: it needs no baseline to be true.
    expect(c.today.length).toBeGreaterThan(0);
  });

  it("never draws above the top of the box or below the axis", () => {
    const c = stepsChart(model({ goal: 100 }), { width: 100, height: 60, padBottom: 10 });
    const ys = [...c.today.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(c.axisY);
    }
  });
});
