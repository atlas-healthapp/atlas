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
