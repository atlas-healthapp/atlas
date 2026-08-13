import { describe, it, expect } from "vitest";
import { restingHrForAge, nextRestingHrTarget } from "@/utils/ageNorms";

describe("restingHrForAge", () => {
  it("withholds itself with no age, so nothing invents an absolute comparison", () => {
    expect(restingHrForAge(52, null)).toBeNull();
    expect(restingHrForAge(52, undefined)).toBeNull();
  });

  it("withholds itself with no reading", () => {
    expect(restingHrForAge(null, 34)).toBeNull();
    expect(restingHrForAge(0, 34)).toBeNull();
  });

  it("calls a low forties resting rate athlete territory at any adult age", () => {
    for (const age of [24, 34, 44, 54, 64, 74]) {
      const out = restingHrForAge(44, age, "male");
      expect(out.label).toBe("ATHLETE");
      expect(out.value).toBe(1);
    }
  });

  it("puts a high resting rate at the bottom without zeroing it", () => {
    const out = restingHrForAge(95, 34, "male");
    expect(out.label).toBe("POOR");
    // Floored rather than zeroed: a poor reading is still a reading.
    expect(out.value).toBeGreaterThan(0);
    expect(out.value).toBeLessThan(0.2);
  });

  it("scores better as the rate falls, with no flat steps", () => {
    const scores = [78, 74, 70, 66, 62, 58].map((bpm) => restingHrForAge(bpm, 34, "male").value);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
  });

  // **The three tests below are the ones whose absence hid a real bug for weeks.**
  // Everything above asserts a relationship (rises, ordered, between) or a value
  // at one of the two extremes, and both extremes are served by early returns
  // that never reach the ladder walk. So a walk that labelled every reading from
  // 55 to 81 BELOW AVERAGE, and scored them up to 3.7 on a 0..1 scale, passed all
  // of it: the broken output was still monotonic, and the male/female pair still
  // held because both went through the same wrong branch.
  //
  // The lesson generalises past this file - see `markGeometry`, `recovery` and
  // `sleepScore`, which are all shaped the same way. Assert an absolute value in
  // the MIDDLE, and assert the documented bounds.
  it("names the right category across the whole range, not just at the ends", () => {
    // A 32-year-old man: athlete <=54, excellent <=61, good <=65,
    // above average <=69, average <=74, below average <=81.
    const label = (bpm) => restingHrForAge(bpm, 32, "male").label;
    expect(label(50)).toBe("ATHLETE");
    expect(label(54)).toBe("ATHLETE");
    expect(label(55)).toBe("EXCELLENT");
    expect(label(61)).toBe("EXCELLENT");
    expect(label(62)).toBe("GOOD");
    expect(label(65)).toBe("GOOD");
    expect(label(66)).toBe("ABOVE AVERAGE");
    expect(label(69)).toBe("ABOVE AVERAGE");
    expect(label(70)).toBe("AVERAGE");
    expect(label(74)).toBe("AVERAGE");
    expect(label(75)).toBe("BELOW AVERAGE");
    expect(label(81)).toBe("BELOW AVERAGE");
    expect(label(82)).toBe("POOR");
  });

  it("never scores outside 0..1, at any rate or any age", () => {
    for (const age of [20, 32, 44, 56, 68, 80]) {
      for (const sex of ["male", "female"]) {
        for (let bpm = 30; bpm <= 120; bpm++) {
          const out = restingHrForAge(bpm, age, sex);
          expect(out.value).toBeGreaterThan(0);
          expect(out.value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("falls monotonically across every boundary, not just within a band", () => {
    // Monotonicity alone did not catch the bug, but combined with the label and
    // bound assertions above it now pins the shape: no step backwards where two
    // categories meet.
    let previous = Infinity;
    for (let bpm = 40; bpm <= 100; bpm++) {
      const score = restingHrForAge(bpm, 32, "male").value;
      expect(score).toBeLessThanOrEqual(previous);
      previous = score;
    }
  });

  it("scores a woman's reading against a woman's norms", () => {
    // Female resting rates run a few beats above male ones, so the same figure
    // should score better against the female table.
    const male = restingHrForAge(64, 34, "male").value;
    const female = restingHrForAge(64, 34, "female").value;
    expect(female).toBeGreaterThan(male);
  });

  it("flags itself as approximate when sex is unknown", () => {
    expect(restingHrForAge(64, 34).approximate).toBe(true);
    expect(restingHrForAge(64, 34, "male").approximate).toBe(false);
  });

  it("lands between the two tables when sex is unknown", () => {
    const blended = restingHrForAge(64, 34).value;
    const male = restingHrForAge(64, 34, "male").value;
    const female = restingHrForAge(64, 34, "female").value;
    expect(blended).toBeGreaterThan(male);
    expect(blended).toBeLessThan(female);
  });

  it("rejects an implausible age rather than extrapolating", () => {
    expect(restingHrForAge(60, 4)).toBeNull();
    expect(restingHrForAge(60, 130)).toBeNull();
  });
});

describe("nextRestingHrTarget", () => {
  it("names a whole number of beats", () => {
    const target = nextRestingHrTarget(72, 34, "male");
    expect(Number.isInteger(target.reading)).toBe(true);
    expect(target.reading).toBeLessThan(72);
  });

  it("has nothing to suggest to someone already in the top category", () => {
    expect(nextRestingHrTarget(44, 34, "male")).toBeNull();
  });
});
