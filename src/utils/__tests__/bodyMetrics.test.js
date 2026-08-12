import { describe, it, expect } from "vitest";
import {
  percentile,
  mean,
  isValidHr,
  restingHrFor,
  rollupFor,
  BODY_METRICS,
} from "@/utils/bodyMetrics";

describe("percentile", () => {
  it("interpolates between ranks", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
  });

  it("returns the extremes at 0 and 100", () => {
    expect(percentile([10, 20, 30], 0)).toBe(10);
    expect(percentile([10, 20, 30], 100)).toBe(30);
  });

  it("does not care about input order", () => {
    expect(percentile([30, 10, 20], 50)).toBe(20);
  });

  it("returns null for an empty list", () => {
    expect(percentile([], 10)).toBeNull();
  });
});

describe("mean", () => {
  it("averages", () => {
    expect(mean([2, 4, 6])).toBe(4);
  });

  it("returns null for an empty list", () => {
    expect(mean([])).toBeNull();
  });
});

describe("isValidHr", () => {
  it("rejects the 255 no-reading sentinel", () => {
    expect(isValidHr(255)).toBe(false);
  });

  it("rejects implausible lows", () => {
    expect(isValidHr(0)).toBe(false);
    expect(isValidHr(24)).toBe(false);
  });

  it("accepts the plausible range inclusively", () => {
    expect(isValidHr(25)).toBe(true);
    expect(isValidHr(60)).toBe(true);
    expect(isValidHr(200)).toBe(true);
  });
});

describe("restingHrFor", () => {
  it("prefers the device's own value when present", () => {
    expect(restingHrFor(47, [40, 50, 60, 70])).toBe(47);
  });

  it("falls back to the 10th percentile of the day's samples", () => {
    // 40..140 bpm, all physiologically plausible so none are filtered.
    // p10 of 101 evenly spaced values lands exactly on the 11th, 50.
    const samples = Array.from({ length: 101 }, (_, i) => i + 40);
    expect(restingHrFor(null, samples)).toBe(50);
  });

  it("ignores invalid heart-rate values in the fallback", () => {
    // 3bpm is a sensor artefact and 255 is the no-reading sentinel: both must
    // be filtered, or a single bad sample drags the percentile down.
    expect(restingHrFor(null, [50, 52, 54, 3, 255])).toBe(50.4);
  });

  it("returns null when there is neither a device value nor usable samples", () => {
    expect(restingHrFor(null, [])).toBeNull();
    expect(restingHrFor(null, [255, 255])).toBeNull();
  });
});

describe("rollupFor", () => {
  it("sums steps", () => {
    expect(rollupFor("sum", [18, 43, 9])).toBe(70);
  });

  it("averages", () => {
    expect(rollupFor("mean", [10, 20])).toBe(15);
  });

  it("takes the last value for latest", () => {
    expect(rollupFor("latest", [10, 20, 30])).toBe(30);
  });

  it("returns null for an empty list", () => {
    expect(rollupFor("sum", [])).toBeNull();
    expect(rollupFor("latest", [])).toBeNull();
  });
});

describe("BODY_METRICS registry", () => {
  it("uses seconds only for the extended activity table", () => {
    expect(BODY_METRICS.steps.tsUnit).toBe("s");
    expect(BODY_METRICS.hr.tsUnit).toBe("s");
    expect(BODY_METRICS.stress.tsUnit).toBe("ms");
    expect(BODY_METRICS.spo2.tsUnit).toBe("ms");
  });

  it("reads the 7-day rolling PAI score, not the daily contribution", () => {
    expect(BODY_METRICS.pai.column).toBe("PAI_TOTAL");
  });

  it("sums steps rather than taking a maximum", () => {
    // verified against real data: STEPS is a per-sample delta, not a counter
    expect(BODY_METRICS.steps.rollup).toBe("sum");
  });
});
