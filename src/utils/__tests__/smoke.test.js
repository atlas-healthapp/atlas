import { describe, it, expect } from "vitest";
import { sleepMinutesToHours } from "@/utils/huamiSleep";

describe("test infrastructure", () => {
  it("runs and resolves the @ alias", () => {
    expect(sleepMinutesToHours(555)).toBe(9.25);
  });
});

describe("sleepMinutesToHours", () => {
  it("converts exactly, without snapping to a quarter hour", () => {
    // 503min is 8h23m. The old quarter-hour rounding reported this as 8.5,
    // which displayed as 8H30: seven minutes adrift from what Zepp showed.
    expect(sleepMinutesToHours(503)).toBeCloseTo(8.3833, 4);
  });

  it("keeps every minute distinguishable within a quarter-hour band", () => {
    // Under the old rounding all of these collapsed to 8.5.
    const distinct = new Set([503, 505, 507, 510].map(sleepMinutesToHours));
    expect(distinct.size).toBe(4);
  });
});
