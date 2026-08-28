import { describe, it, expect } from "vitest";
import {
  percentile,
  workingHeartRate,
  sessionWorkingHr,
  MIN_SAMPLES,
  WORKING_PERCENTILE,
} from "@/utils/sessionIntensity";

describe("percentile", () => {
  it("interpolates between neighbours rather than snapping to a rank", () => {
    // p75 of 1..5 sits at index 3 exactly, so this also pins the indexing.
    expect(percentile([1, 2, 3, 4, 5], 0.75)).toBe(4);
    expect(percentile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25, 5);
  });

  it("does not care what order it is given", () => {
    expect(percentile([5, 1, 4, 2, 3], 0.75)).toBe(4);
  });

  it("ignores non-numbers rather than letting them sort", () => {
    expect(percentile([1, null, 2, undefined, 3, NaN, 4, 5], 0.75)).toBe(4);
  });

  it("has an answer for one reading and none for none", () => {
    expect(percentile([62], 0.75)).toBe(62);
    expect(percentile([], 0.75)).toBeNull();
    expect(percentile(null, 0.75)).toBeNull();
  });
});

describe("workingHeartRate", () => {
  it("withholds rather than guessing under the sample floor", () => {
    expect(workingHeartRate([120, 130, 140, 150])).toBeNull();
    expect(workingHeartRate([120, 130, 140, 150, 160])).not.toBeNull();
  });

  it("drops the rests instead of averaging them in, which is the whole point", () => {
    // A climb: worked hard, belayed between. The mean is dragged into "light"
    // territory while the working part is plainly vigorous.
    const session = [
      ...Array(30).fill(150),
      ...Array(30).fill(90),
      ...Array(30).fill(155),
      ...Array(30).fill(88),
    ];
    const mean = session.reduce((a, b) => a + b, 0) / session.length;
    expect(Math.round(mean)).toBe(121);
    expect(workingHeartRate(session)).toBeGreaterThan(148);
  });

  it("lands near the mean on a steady session, so nothing already right moves much", () => {
    const steady = Array.from({ length: 60 }, (_, i) => 148 + (i % 5));
    const mean = steady.reduce((a, b) => a + b, 0) / steady.length;
    expect(workingHeartRate(steady) - mean).toBeLessThan(2);
  });

  it("is not the maximum, so one bad reading cannot define a session", () => {
    // The archive really does hold a workout claiming 203 against a same-day
    // sample peak of 173. A percentile has to shrug that off.
    const withSpike = [...Array(60).fill(140), 203];
    expect(workingHeartRate(withSpike)).toBeLessThan(150);
  });

  it("ignores zeroes, which is how the band reports no reading", () => {
    expect(workingHeartRate([0, 0, 0, 0, 0, 0])).toBeNull();
  });
});

describe("sessionWorkingHr", () => {
  it("prefers the samples and says so", () => {
    const out = sessionWorkingHr({ hrAvg: 100 }, Array(20).fill(150));
    expect(out.source).toBe("samples");
    expect(out.hr).toBe(150);
  });

  it("falls back to the band's average when the samples are gone", () => {
    // Downsampling past 90 days leaves nothing to take a percentile of.
    const out = sessionWorkingHr({ hrAvg: 132 }, []);
    expect(out).toEqual({ hr: 132, source: "average" });
  });

  it("reports nothing rather than zero when there is neither", () => {
    expect(sessionWorkingHr({}, []).hr).toBeNull();
    expect(sessionWorkingHr({ hrAvg: 0 }, []).source).toBe("none");
  });
});

describe("the constants are the ones the reasoning is written against", () => {
  it("takes the working share at the 75th percentile", () => {
    expect(WORKING_PERCENTILE).toBe(0.75);
  });

  it("keeps the same five-sample floor sessionCalories uses", () => {
    expect(MIN_SAMPLES).toBe(5);
  });
});
