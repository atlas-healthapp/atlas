import { describe, it, expect } from "vitest";
import { periodStats, isBinaryAgainstGoal } from "../metricSummary";

describe("periodStats", () => {
  it("averages only the days that have a reading", () => {
    // Not 30/4. A day you did not record is not a day you ate nothing.
    const s = periodStats([10, null, 20, null], 15);
    expect(s.average).toBe(15);
    expect(s.recorded).toBe(2);
  });

  it("counts the days that reached the goal", () => {
    const s = periodStats([100, 140, 120, null], 120);
    expect(s.met).toBe(2);
    expect(s.recorded).toBe(3);
  });

  it("returns null for a period with nothing in it", () => {
    // An average of nothing is not zero, and 0 of 0 reads as total failure.
    expect(periodStats([], 120)).toBeNull();
    expect(periodStats([null, null], 120)).toBeNull();
    expect(periodStats(undefined, 120)).toBeNull();
  });

  it("withholds the met count when the goal is switched off", () => {
    const s = periodStats([100, 140], null);
    expect(s.met).toBeNull();
    expect(s.average).toBe(120);
  });
});

describe("isBinaryAgainstGoal", () => {
  // Measured on the real archive: 24 logged creatine days, every one 5 or 0.
  // A bar with two states says less than the hero above it already did.
  it("calls a taken-or-not metric binary", () => {
    expect(isBinaryAgainstGoal([5, 5, null, 0, 5, null, 5], 5)).toBe(true);
  });

  it("is not binary the moment a dose is split", () => {
    expect(isBinaryAgainstGoal([5, 5, 2.5, 0, 5], 5)).toBe(false);
  });

  it("is not binary when a reading overshoots the target", () => {
    expect(isBinaryAgainstGoal([5, 10, 0], 5)).toBe(false);
  });

  // Nothing to judge from is not evidence of a binary, or a brand new install
  // would lose the mark on every goal metric it has.
  it("needs a reading, and a goal", () => {
    expect(isBinaryAgainstGoal([null, null], 5)).toBe(false);
    expect(isBinaryAgainstGoal([], 5)).toBe(false);
    expect(isBinaryAgainstGoal([5, 0], null)).toBe(false);
  });

  it("leaves a quantity metric alone", () => {
    expect(isBinaryAgainstGoal([7200, 8000, 4100, 12629], 8000)).toBe(false);
  });
});
