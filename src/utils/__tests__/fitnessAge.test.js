import { describe, it, expect } from "vitest";
import {
  referenceVo2max,
  ageForVo2max,
  predictedHrMax,
  bmiFrom,
  paIndexFrom,
  computeFitnessAge,
  compareBodyModels,
  fitnessAgeBreakdown,
  localSlope,
  HUNT_MODELS,
  REFERENCE_VO2MAX,
  MIN_RESTING_HR_DAYS,
  MIN_ACTIVITY_DAYS,
  MAX_WEIGHT_AGE_DAYS,
  AGE_MIN,
  AGE_MAX,
} from "@/utils/fitnessAge";

/**
 * A profile that clears every gate, so a test can vary one thing at a time.
 *
 * Deliberately carries no waist: this is what the app can actually assemble
 * after the 2026-08-12 constraint, and every test that does not say otherwise is
 * exercising the BMI form.
 */
const ok = {
  age: 34,
  sex: "male",
  heightCm: 178,
  weightKg: 76,
  weightDaysOld: 2,
  restingHr: 50,
  restingHrDays: 60,
  paIndex: 9,
  activityDays: 30,
};

// `hrAvg`, not `avgHr`. The field name is the point of one of the tests below.
const session = (minutes, hrAvg, i = 0) => ({
  startMillis: 1_700_000_000_000 + i * 86_400_000,
  activeSeconds: minutes * 60,
  hrAvg,
});

describe("referenceVo2max", () => {
  it("returns the published decade means at their midpoints", () => {
    expect(referenceVo2max(25, "male")).toBeCloseTo(54.4, 5);
    expect(referenceVo2max(55, "male")).toBeCloseTo(42.6, 5);
    expect(referenceVo2max(25, "female")).toBeCloseTo(43.0, 5);
  });

  it("interpolates between them rather than stepping at decade boundaries", () => {
    const at30 = referenceVo2max(30, "male");
    expect(at30).toBeGreaterThan(49.1);
    expect(at30).toBeLessThan(54.4);
    expect(at30).toBeCloseTo((54.4 + 49.1) / 2, 5);
  });

  it("goes flat past the ends of the reference data rather than extrapolating", () => {
    expect(referenceVo2max(20, "male")).toBeCloseTo(54.4, 5);
    expect(referenceVo2max(90, "male")).toBeCloseTo(35.3, 5);
  });

  it("has nothing to say for a sex with no reference table", () => {
    expect(referenceVo2max(34, null)).toBeNull();
  });

  it("falls monotonically with age for both sexes", () => {
    for (const sex of ["male", "female"]) {
      for (let age = AGE_MIN; age < AGE_MAX; age += 1) {
        expect(referenceVo2max(age + 1, sex)).toBeLessThanOrEqual(referenceVo2max(age, sex));
      }
    }
  });
});

describe("ageForVo2max", () => {
  it("round-trips the reference curve", () => {
    for (const [age] of REFERENCE_VO2MAX.male) {
      const vo2 = referenceVo2max(age, "male");
      expect(ageForVo2max(vo2, "male").age).toBeCloseTo(age, 5);
    }
  });

  it("clamps rather than extrapolating past a fitness the cohort never measured", () => {
    expect(ageForVo2max(80, "male")).toEqual({ age: AGE_MIN, clamped: true });
    expect(ageForVo2max(10, "male")).toEqual({ age: AGE_MAX, clamped: true });
  });

  it("says when it clamped, so the breakdown can stop claiming to add up", () => {
    expect(ageForVo2max(48, "male").clamped).toBe(false);
  });
});

describe("predictedHrMax", () => {
  it("is HUNT's own formula and not 220 minus age", () => {
    expect(predictedHrMax(34)).toBeCloseTo(211 - 0.64 * 34, 5);
    expect(predictedHrMax(34)).not.toBeCloseTo(220 - 34, 1);
  });
});

describe("bmiFrom", () => {
  it("is kg over metres squared", () => {
    expect(bmiFrom(76, 178)).toBeCloseTo(76 / 1.78 ** 2, 10);
  });

  it("has nothing to say without both fields", () => {
    expect(bmiFrom(76, null)).toBeNull();
    expect(bmiFrom(null, 178)).toBeNull();
    expect(bmiFrom(76, 0)).toBeNull();
  });
});

describe("paIndexFrom", () => {
  it("withholds an index on a window too short to describe a weekly habit", () => {
    const out = paIndexFrom([session(45, 150)], { days: 14, age: 34 });
    expect(out.state).toBe("calibrating");
    expect(out.needed).toBe(MIN_ACTIVITY_DAYS);
  });

  it("reads an empty window as an index of zero, not as missing data", () => {
    // A month with no sessions is a real answer about a habit. Treating it the
    // same as "not enough history" would hide the one reading that most needs
    // showing.
    const out = paIndexFrom([], { days: 28, age: 34 });
    expect(out.state).toBe("ready");
    expect(out.value).toBe(0);
  });

  it("reads heart rate off hrAvg, which is what a resolved session actually carries", () => {
    // The first pass read `avgHr`, a field that exists nowhere in this codebase,
    // so every real session would have come back with no heart rate and the
    // index would have withheld itself forever while the tests passed.
    const wrongField = [
      { startMillis: 1, activeSeconds: 2700, avgHr: 150 },
      { startMillis: 2, activeSeconds: 2700, avgHr: 150 },
    ];
    expect(paIndexFrom(wrongField, { days: 28, age: 34 }).state).toBe("no-intensity");
    expect(paIndexFrom([session(45, 150), session(45, 150, 1)], { days: 28, age: 34 }).state).toBe(
      "ready"
    );
  });

  it("withholds rather than assuming light exercise when no session has a heart rate", () => {
    const out = paIndexFrom([session(45, null), session(45, null, 1)], { days: 28, age: 34 });
    expect(out.state).toBe("no-intensity");
    expect(out.value).toBeUndefined();
  });

  it("tops out at 15, the index's own ceiling", () => {
    const many = Array.from({ length: 40 }, (_, i) => session(90, 190, i));
    const out = paIndexFrom(many, { days: 28, age: 34 });
    expect(out.value).toBeLessThanOrEqual(15);
    expect(out.value).toBeCloseTo(15, 5);
  });

  it("reproduces the published guideline anchor of 7.5", () => {
    // 2.5 sessions a week x an hour or more x hard = the coding's own 7.5, which
    // is what the literature calls meeting the guidelines.
    const list = Array.from({ length: 10 }, (_, i) => session(75, 190, i));
    const out = paIndexFrom(list, { days: 28, age: 34 });
    expect(out.frequency).toBeCloseTo(2.5, 5);
    expect(out.duration).toBeCloseTo(1, 5);
    expect(out.intensity).toBeCloseTo(3, 5);
    expect(out.value).toBeCloseTo(7.5, 5);
  });

  it("takes the median session length, so one long ride is not the typical one", () => {
    const list = [session(30, 150, 0), session(30, 150, 1), session(240, 150, 2)];
    expect(paIndexFrom(list, { days: 28, age: 34 }).medianMinutes).toBe(30);
  });

  it("weights intensity by how long each session lasted", () => {
    // Ten minutes of sprinting must not outvote two hours of steady work.
    const list = [session(120, 120, 0), session(10, 190, 1)];
    const out = paIndexFrom(list, { days: 28, age: 34 });
    expect(out.intensityShare).toBeCloseTo((120 * 120 + 190 * 10) / 130 / predictedHrMax(34), 5);
  });
});

describe("computeFitnessAge withholding", () => {
  it("refuses without a date of birth rather than assuming one", () => {
    expect(computeFitnessAge({ ...ok, age: null })).toMatchObject({
      state: "withheld",
      reason: "no-age",
    });
  });

  it("refuses without a sex, because the two equations are decades apart", () => {
    expect(computeFitnessAge({ ...ok, sex: null }).reason).toBe("no-sex");
    expect(computeFitnessAge({ ...ok, sex: "other" }).reason).toBe("no-sex");
  });

  it("refuses without anything to build a body-composition term on", () => {
    // The missing term carries the largest coefficient in the equation, so
    // dropping it would not be a weaker score, it would be a different
    // regression that nobody fitted.
    const out = computeFitnessAge({ ...ok, heightCm: null });
    expect(out.reason).toBe("no-body");
    expect(out.hasHeight).toBe(false);
    expect(out.hasWeight).toBe(true);
  });

  it("refuses a weight too old to describe the body being scored", () => {
    // Weight is the one hand-entered input, so it is the one that can stop
    // arriving without leaving a visible gap anywhere.
    expect(computeFitnessAge({ ...ok, weightDaysOld: MAX_WEIGHT_AGE_DAYS + 1 }).reason).toBe(
      "stale-weight"
    );
  });

  it("refuses when nobody said how old the weight is, rather than assuming it is fresh", () => {
    expect(computeFitnessAge({ ...ok, weightDaysOld: null }).reason).toBe("stale-weight");
  });

  it("does not ask about the weight at all when a waist was measured", () => {
    const out = computeFitnessAge({ ...ok, waistCm: 84, weightDaysOld: null });
    expect(out.state).toBe("ready");
    expect(out.form).toBe("waist");
  });

  it("refuses on a fortnight of resting heart rates", () => {
    expect(computeFitnessAge({ ...ok, restingHrDays: 14 })).toMatchObject({
      reason: "calibrating-resting-hr",
      needed: MIN_RESTING_HR_DAYS,
    });
  });

  it("refuses on too little session history", () => {
    expect(computeFitnessAge({ ...ok, activityDays: 10 })).toMatchObject({
      reason: "calibrating-activity",
      needed: MIN_ACTIVITY_DAYS,
    });
  });

  it("refuses an implausible reading rather than scoring it", () => {
    expect(computeFitnessAge({ ...ok, restingHr: 5 }).reason).toBe("no-resting-hr");
    expect(computeFitnessAge({ ...ok, weightKg: 400 }).reason).toBe("no-bmi");
    expect(computeFitnessAge({ ...ok, waistCm: 5 }).reason).toBe("no-waist");
    expect(computeFitnessAge({ ...ok, paIndex: 20 }).reason).toBe("no-activity");
  });
});

describe("computeFitnessAge form selection", () => {
  it("uses BMI when that is all there is, which is the shipping case", () => {
    const out = computeFitnessAge(ok);
    expect(out.state).toBe("ready");
    expect(out.form).toBe("bmi");
    expect(out.bmi).toBeCloseTo(bmiFrom(76, 178), 10);
  });

  it("prefers the waist when one was measured, because BMI cannot see muscle", () => {
    expect(computeFitnessAge({ ...ok, waistCm: 84 }).form).toBe("waist");
  });

  it("runs for a woman on both forms, which the waist-only version could not", () => {
    for (const form of [{}, { waistCm: 74 }]) {
      const out = computeFitnessAge({ ...ok, sex: "female", ...form });
      expect(out.state).toBe("ready");
      expect(out.vo2max).toBeGreaterThan(0);
    }
  });
});

describe("computeFitnessAge arithmetic", () => {
  it("applies the published BMI coefficients exactly", () => {
    const c = HUNT_MODELS.bmi.male;
    const bmi = bmiFrom(76, 178);
    const expected = c.intercept + c.age * 34 + c.pa * 9 + c.body * bmi + c.restingHr * 50;
    expect(computeFitnessAge(ok).vo2max).toBeCloseTo(expected, 10);
  });

  it("applies the published waist coefficients exactly", () => {
    const c = HUNT_MODELS.waist.male;
    const expected = c.intercept + c.age * 34 + c.pa * 9 + c.body * 84 + c.restingHr * 50;
    expect(computeFitnessAge({ ...ok, waistCm: 84 }).vo2max).toBeCloseTo(expected, 10);
  });

  it("reads a fit person as younger than their years", () => {
    const out = computeFitnessAge(ok);
    expect(out.state).toBe("ready");
    expect(out.gap).toBeLessThan(0);
    expect(out.fitnessAge).toBeLessThan(out.chronologicalAge);
  });

  it("reads an unfit person as older than their years", () => {
    const out = computeFitnessAge({ ...ok, restingHr: 78, weightKg: 104, paIndex: 0.5 });
    expect(out.state).toBe("ready");
    expect(out.gap).toBeGreaterThan(0);
  });

  it("moves the right way for each input on its own", () => {
    const base = computeFitnessAge(ok).fitnessAge;
    expect(computeFitnessAge({ ...ok, restingHr: 60 }).fitnessAge).toBeGreaterThan(base);
    expect(computeFitnessAge({ ...ok, weightKg: 92 }).fitnessAge).toBeGreaterThan(base);
    expect(computeFitnessAge({ ...ok, paIndex: 12 }).fitnessAge).toBeLessThan(base);
  });

  it("reports the reference person's own reading rather than assuming it is your age", () => {
    // Where the published thresholds do not land on the Loe curve, that gap is
    // the cohort mismatch the whole ticket is about. It is reported, not hidden.
    const out = computeFitnessAge(ok);
    expect(out.referenceAge).toBeGreaterThan(0);
    expect(out.referenceVo2max).toBeGreaterThan(0);
  });

  it("flags a figure that had to be clamped at the end of the reference data", () => {
    const out = computeFitnessAge({ ...ok, restingHr: 32, weightKg: 62, paIndex: 15 });
    expect(out.clamped).toBe(true);
    expect(out.fitnessAge).toBe(AGE_MIN);
  });
});

describe("compareBodyModels", () => {
  /** A 34-year-old man, 50 bpm resting, meeting the activity guidelines. */
  const man = { ...ok, paIndex: 7.5, heightCm: 180 };

  it("has nothing to compare unless both readings exist", () => {
    expect(compareBodyModels(man)).toBeNull();
  });

  it("puts a number on what dropping the waist costs, rather than asserting it is free", () => {
    // Same 84 cm waist, two body weights. At a BMI the waist agrees with, the two
    // forms land within a couple of years of each other; carry three BMI units of
    // muscle on the same waist and the BMI form reads you years older, because
    // BMI cannot tell muscle from fat and that is the whole cost.
    const lean = compareBodyModels({ ...man, waistCm: 84, weightKg: 78 });
    const muscular = compareBodyModels({ ...man, waistCm: 84, weightKg: 88 });

    expect(lean.bmi.bmi).toBeCloseTo(78 / 1.8 ** 2, 3);
    expect(muscular.bmi.bmi).toBeCloseTo(88 / 1.8 ** 2, 3);

    // Both read older on BMI, and the heavier one much more so.
    expect(lean.yearsDelta).toBeGreaterThan(0);
    expect(muscular.yearsDelta).toBeGreaterThan(lean.yearsDelta + 3);
    expect(muscular.yearsDelta).toBeLessThan(12);
  });

  it("prices one BMI unit against one centimetre of waist", () => {
    // The two coefficients are what the whole trade-off comes down to: 0.933
    // mL/kg/min per BMI unit against 0.369 per cm.
    expect(HUNT_MODELS.bmi.male.body / HUNT_MODELS.waist.male.body).toBeCloseTo(2.528, 2);
  });
});

describe("fitnessAgeBreakdown", () => {
  it("returns nothing for a figure that was withheld", () => {
    expect(fitnessAgeBreakdown(computeFitnessAge({ ...ok, age: null }))).toEqual([]);
    expect(fitnessAgeBreakdown(null)).toEqual([]);
  });

  it("itemises every input with its reading and the reference it was judged against", () => {
    const rows = fitnessAgeBreakdown(computeFitnessAge(ok));
    expect(rows.map((r) => r.key).sort()).toEqual(["body", "pa", "restingHr"]);
    for (const row of rows) {
      expect(row.reading).toBeTypeOf("number");
      expect(row.referenceValue).toBeTypeOf("number");
      expect(row.referenceLabel).toBeTruthy();
      expect(row.years).toBeTypeOf("number");
    }
  });

  it("names the body row after the form that actually ran", () => {
    expect(fitnessAgeBreakdown(computeFitnessAge(ok)).find((r) => r.key === "body").label).toBe(
      "BMI"
    );
    expect(
      fitnessAgeBreakdown(computeFitnessAge({ ...ok, waistCm: 84 })).find((r) => r.key === "body")
        .label
    ).toBe("WAIST");
  });

  it("adds up exactly, which is the whole reason for this model", () => {
    // recoveryBreakdown's rows sum to the score. These sum to the distance
    // between your fitness age and the reference person's, with no residual to
    // hide, because the equation is linear and one shared slope converts it.
    for (const profile of [ok, { ...ok, waistCm: 84 }, { ...ok, sex: "female" }]) {
      const out = computeFitnessAge(profile);
      const rows = fitnessAgeBreakdown(out);
      const total = rows.reduce((sum, r) => sum + r.years, 0);
      expect(total).toBeCloseTo(out.fitnessAge - out.referenceAge, 8);
    }
  });

  it("adds up for an unfit profile too, where the gap runs the other way", () => {
    const out = computeFitnessAge({ ...ok, restingHr: 74, weightKg: 100, paIndex: 1 });
    const rows = fitnessAgeBreakdown(out);
    const total = rows.reduce((sum, r) => sum + r.years, 0);
    expect(total).toBeCloseTo(out.fitnessAge - out.referenceAge, 8);
  });

  it("scores an input sitting on its reference at zero years", () => {
    const out = computeFitnessAge(ok);
    const ref = out.reference.body.value;
    // The reference BMI, expressed as the weight that produces it at this height.
    const same = computeFitnessAge({ ...ok, weightKg: ref * 1.78 ** 2 });
    expect(fitnessAgeBreakdown(same).find((r) => r.key === "body").years).toBeCloseTo(0, 8);
  });

  it("orders by how much each input actually moved the figure", () => {
    const rows = fitnessAgeBreakdown(computeFitnessAge(ok));
    for (let i = 1; i < rows.length; i++) {
      expect(Math.abs(rows[i - 1].years)).toBeGreaterThanOrEqual(Math.abs(rows[i].years));
    }
  });

  it("does not mark the resting-heart-rate row approximate, since a sex is required", () => {
    const rhr = fitnessAgeBreakdown(computeFitnessAge(ok)).find((r) => r.key === "restingHr");
    expect(rhr.approximate).toBe(false);
  });
});

describe("localSlope", () => {
  it("is negative, because the reference curve falls with age", () => {
    expect(localSlope(40, "male")).toBeLessThan(0);
  });

  it("has nothing to say where the curve is flat past its ends", () => {
    expect(localSlope(AGE_MAX, "male")).toBeNull();
  });
});
