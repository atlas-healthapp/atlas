import { describe, it, expect } from "vitest";
import { buildSummary } from "../nativeSummary";

// The bar fills are the only maths in the summary, and they exist here rather
// than in the notification layout so there is one implementation of them. These
// cover the cases a notification renders wrong rather than not at all: a bar
// drawn empty when there is no reading reads as a day gone badly.
describe("buildSummary", () => {
  it("publishes a fill for every metric that has a reading and a goal", () => {
    const summary = buildSummary({
      steps: 4000,
      stepsGoal: 10000,
      routineDone: 2,
      routineDue: 9,
      recovery: 25,
      sleepHours: 6,
      sleepGoal: 8,
      protein: 110,
      proteinGoal: 160,
    });
    expect(summary.stepsPct).toBe(40);
    expect(summary.routinePct).toBe(22);
    expect(summary.recoveryPct).toBe(25);
    expect(summary.sleepPct).toBe(75);
    expect(summary.proteinPct).toBe(69);
  });

  it("withholds a fill rather than sending zero when the reading is missing", () => {
    const summary = buildSummary({
      steps: null,
      stepsGoal: 10000,
      sleepHours: null,
      sleepGoal: 8,
      protein: null,
      proteinGoal: 160,
      recovery: null,
    });
    expect(summary.stepsPct).toBeNull();
    expect(summary.sleepPct).toBeNull();
    expect(summary.proteinPct).toBeNull();
    expect(summary.recoveryPct).toBeNull();
  });

  it("withholds a fill when the goal is missing or zero", () => {
    expect(buildSummary({ steps: 4000, stepsGoal: null }).stepsPct).toBeNull();
    expect(buildSummary({ protein: 110, proteinGoal: 0 }).proteinPct).toBeNull();
  });

  // A day with nothing due is the routine's own "no goal" case, and a bar of
  // zero over zero would otherwise render as a goal missed.
  it("withholds the routine fill on a day with nothing due", () => {
    const summary = buildSummary({ routineDone: 0, routineDue: 0 });
    expect(summary.routinePct).toBeNull();
    expect(summary.routineDue).toBe(0);
  });

  it("clamps an overshoot to a full bar and leaves the figure alone", () => {
    const summary = buildSummary({
      sleepHours: 10,
      sleepGoal: 8,
      sleepText: "10h 00m",
      protein: 200,
      proteinGoal: 160,
      recovery: 104,
    });
    expect(summary.sleepPct).toBe(100);
    expect(summary.sleepText).toBe("10h 00m");
    expect(summary.proteinPct).toBe(100);
    expect(summary.protein).toBe(200);
    expect(summary.recoveryPct).toBe(100);
  });
});
