import { describe, it, expect } from "vitest";
import {
  ZONE_NAMES,
  formulaMax,
  maxHeartRate,
  zoneOf,
  zonePosition,
  zones,
} from "@/utils/hrZones";

describe("formulaMax", () => {
  it("is Tanaka, not 220 minus age", () => {
    expect(formulaMax(32)).toBe(186);
    expect(formulaMax(32)).not.toBe(188);
  });

  it("crosses 220-age around forty, which is the point of using it", () => {
    // The two agree near 40 and separate either side, and the direction matters:
    // `220 - age` runs HIGH for the young and LOW for the old, and it is the
    // second of those that gets somebody a set of zones they can never reach.
    // Tanaka is the correction, so at 60 it must sit above `220 - age`.
    expect(formulaMax(25)).toBeLessThan(220 - 25);
    expect(formulaMax(60)).toBeGreaterThan(220 - 60);
    expect(Math.abs(formulaMax(40) - (220 - 40))).toBeLessThanOrEqual(1);
  });

  it("has nothing to say without an age", () => {
    expect(formulaMax(null)).toBe(null);
    expect(formulaMax(0)).toBe(null);
  });
});

describe("maxHeartRate", () => {
  it("uses the formula when nothing has been observed", () => {
    expect(maxHeartRate({ ageYears: 32 })).toBe(186);
  });

  it("is raised by a peak actually reached", () => {
    expect(maxHeartRate({ ageYears: 32, observedPeak: 194 })).toBe(194);
  });

  it("is never lowered by a peak not reached", () => {
    // Somebody who has not yet worked hard has not disproved the formula.
    expect(maxHeartRate({ ageYears: 32, observedPeak: 150 })).toBe(186);
  });

  it("falls back to the observed peak when there is no date of birth", () => {
    expect(maxHeartRate({ ageYears: null, observedPeak: 180 })).toBe(180);
    expect(maxHeartRate({ ageYears: null })).toBe(null);
  });
});

describe("zones", () => {
  const five = zones(186);

  it("is the conventional five, lowest first", () => {
    expect(five).toHaveLength(5);
    expect(five.map((z) => z.name)).toEqual(ZONE_NAMES);
  });

  it("starts at half of maximum, because below that is sitting down", () => {
    expect(five[0].from).toBe(93);
  });

  it("runs contiguously up to the maximum with no gaps or overlaps", () => {
    expect(five.at(-1).to).toBe(186);
    for (let i = 1; i < five.length; i++) {
      expect(five[i].from).toBe(five[i - 1].to);
    }
  });

  it("has nothing to draw without a maximum", () => {
    expect(zones(null)).toEqual([]);
  });
});

describe("zoneOf", () => {
  it("places the author's real session averages", () => {
    // Measured on the archive: session averages ran 116 to 138.
    expect(zoneOf(116, 186)).toBe(2);
    expect(zoneOf(138, 186)).toBe(3);
  });

  it("puts a reading exactly on a boundary in the higher zone", () => {
    expect(zoneOf(93, 186)).toBe(1);
    expect(zoneOf(186, 186)).toBe(5);
  });

  it("refuses to call a resting rate a zone at all", () => {
    // 47 is this archive's real overnight resting rate. Calling that "very
    // light exercise" would put a sleeping heart rate on an effort scale.
    expect(zoneOf(47, 186)).toBe(null);
    expect(zoneOf(92, 186)).toBe(null);
  });

  it("keeps a reading above maximum in the top zone rather than off the scale", () => {
    expect(zoneOf(200, 186)).toBe(5);
  });
});

describe("zonePosition", () => {
  it("measures across the strip's own span, not from zero", () => {
    expect(zonePosition(93, 186)).toBeCloseTo(0, 5);
    expect(zonePosition(186, 186)).toBeCloseTo(1, 5);
    // 134 on a 93-186 strip.
    expect(zonePosition(134, 186)).toBeCloseTo((134 - 93) / 93, 3);
  });

  it("clamps rather than running the caret off the axis", () => {
    expect(zonePosition(220, 186)).toBe(1);
    expect(zonePosition(40, 186)).toBe(0);
  });
});
