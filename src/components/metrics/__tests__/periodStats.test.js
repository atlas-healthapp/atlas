import { describe, it, expect } from "vitest";
import { periodStats } from "../metricSummary";

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
