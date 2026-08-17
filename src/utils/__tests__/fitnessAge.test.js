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
  MAX_GAP_YEARS,
  maxGapYears,
  AGE_MIN,
  AGE_MAX,
  INPUT_REFERENCE,
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

  it("extends past the top anchor rather than falling off a cliff at it", () => {
    // This was the model's worst artifact and it was in the lookup, not in any
    // of the arithmetic above it: anything above the 20-29 mean of 54.4 returned
    // AGE_MIN outright, so 0.1 mL/kg/min bought five years. A real reading of
    // 54.5 reported 20 where it resolves to 24.8.
    const justOver = ageForVo2max(54.5, "male");
    expect(justOver.age).toBeGreaterThan(24);
    expect(justOver.age).toBeLessThan(25);
    expect(justOver.clamped).toBe(false);
    expect(justOver.extrapolated).toBe(true);

    // Along the published 25-to-35 slope, not an invented one.
    const perYear = (54.4 - 49.1) / 10;
    expect(ageForVo2max(54.4 + perYear, "male").age).toBeCloseTo(24, 5);
  });

  it("still stops at the youngest age the extension can honestly reach", () => {
    // The floor is not arbitrary. The reference is decade means anchored at
    // midpoints, so extending to 20 implies a mean near 57 for a twenty-year-old,
    // which is a real figure for this cohort. Below that aerobic capacity
    // plateaus rather than continuing to climb, so the trend stops describing
    // anybody and a very fit reading is reported as unresolvable instead.
    const elite = ageForVo2max(70, "male");
    expect(elite.age).toBe(AGE_MIN);
    expect(elite.clamped).toBe(true);
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

  // **These two encoded the wrong index and are corrected, not relaxed.**
  // Nes 2011 Table 4 publishes two indexes; Atlas was building Kurtze's (max 15)
  // while the coefficients were fitted on the paper's own New index (max 45).
  it("tops out at 45, the New index's own ceiling", () => {
    const many = Array.from({ length: 40 }, (_, i) => session(90, 190, i));
    const out = paIndexFrom(many, { days: 28, age: 34 });
    expect(out.value).toBeLessThanOrEqual(45);
    expect(out.value).toBeCloseTo(45, 5);
  });

  it("builds the New index from Table 4's own weights", () => {
    // Almost every day (3) x heavy breath and sweat (10) x 30-60 min (1.5) = 45,
    // read straight off the right-hand column of Table 4.
    const list = Array.from({ length: 20 }, (_, i) => session(45, 190, i));
    const out = paIndexFrom(list, { days: 28, age: 34 });
    expect(out.frequency).toBeCloseTo(3, 5);
    expect(out.duration).toBeCloseTo(1.5, 5);
    expect(out.intensity).toBeCloseTo(10, 5);
  });

  it("zeroes the whole index on easy sessions, however many there are", () => {
    // The New index scores "take it easy" as 0 and that zeroes the product. It is
    // the paper's own finding: VO2peak "was similar if subjects reported to
    // exercise at low intensity, independent of frequency and duration".
    const easy = Array.from({ length: 28 }, (_, i) => session(90, 100, i));
    const out = paIndexFrom(easy, { days: 28, age: 34 });
    expect(out.intensity).toBe(0);
    expect(out.value).toBe(0);
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
    // 20 is a perfectly ordinary New-index value now (the cohort mean is 10.5 on
    // a 0-45 scale), so the implausible figure has to be past 45.
    expect(computeFitnessAge({ ...ok, paIndex: 50 }).reason).toBe("no-activity");
    expect(computeFitnessAge({ ...ok, paIndex: 20 }).state).toBe("ready");
  });
});

describe("the gap cap", () => {
  const person = (age, bmi, rhr, pa) => ({
    age,
    sex: "male",
    heightCm: 180,
    weightKg: bmi * 1.8 * 1.8,
    weightDaysOld: 1,
    waistCm: null,
    restingHr: rhr,
    restingHrDays: 30,
    paIndex: pa,
    activityDays: 28,
  });

  it("never reports a gap wider than the model can support", () => {
    // SEE is 5.70 mL/kg/min and the curve falls 0.19-0.53 per year, so one
    // standard deviation is worth eleven to thirty years. Uncapped, these two
    // read 55 and 20.
    for (const p of [person(32, 29, 72, 0), person(32, 21.2, 50.3, 4.13)]) {
      const out = computeFitnessAge(p);
      expect(Math.abs(out.gap)).toBeLessThanOrEqual(MAX_GAP_YEARS + 1e-9);
    }
  });

  it("leaves an ordinary person alone, so the cap is not doing the work", () => {
    // The study-average man is inside the cap and must come out untouched, or
    // the cap would be hiding a calibration problem rather than bounding a
    // precision one.
    const out = computeFitnessAge(person(32, 26.6, 57.4, 10.5));
    expect(out.capped).toBe(false);
    expect(out.fitnessAge).toBeCloseTo(out.uncappedAge, 10);
    expect(out.gap).toBeLessThan(3);
  });

  it("says when it capped, and what the curve actually said", () => {
    const out = computeFitnessAge(person(32, 29, 72, 0));
    expect(out.capped).toBe(true);
    expect(out.uncappedAge).toBeGreaterThan(out.fitnessAge);
    expect(out.fitnessAge).toBeCloseTo(32 + MAX_GAP_YEARS, 10);
  });

  it("lets a young person read younger, bounded by the cap rather than by 20", () => {
    // AGE_MIN used to floor this, which made sense while the figure was read off
    // a curve that stopped at 20. Measured after the anchoring, that floor bit
    // before the cap did, so a fit twenty-year-old and an average one both
    // printed exactly 20 and the metric said nothing about the difference. The
    // cap already scales with age, so it is the only bound needed.
    const out = computeFitnessAge(person(24, 21, 48, 30));
    expect(out.fitnessAge).toBeCloseTo(24 - maxGapYears(24), 8);
    expect(out.fitnessAge).toBeLessThan(AGE_MIN);
    expect(out.capped).toBe(true);
  });

  it("does not touch the VO2max or the itemised terms", () => {
    // The cap is presentation only. Every term is computed from the uncapped
    // VO2max, so a capped headline must not silently rewrite the breakdown.
    const p = person(32, 29, 72, 0);
    const out = computeFitnessAge(p);
    expect(out.capped).toBe(true);
    const uncappedVo2 = computeFitnessAge({ ...p }).vo2max;
    expect(out.vo2max).toBeCloseTo(uncappedVo2, 10);
    const rows = fitnessAgeBreakdown(out);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(Number.isFinite(row.years)).toBe(true);
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
    // Read off the UNCAPPED figure. The cap saturates readily now that it is six
    // years rather than nine and a half, so two genuinely different people can
    // print the same number, and a test on the printed one would be asserting
    // the cap rather than the model.
    const raw = (o) => computeFitnessAge({ ...ok, ...o }).uncappedAge;
    const base = raw({});
    expect(raw({ restingHr: 60 })).toBeGreaterThan(base);
    expect(raw({ weightKg: 92 })).toBeGreaterThan(base);
    expect(raw({ paIndex: 12 })).toBeLessThan(base);
  });

  it("gives the reference person their own age back, which is what anchoring buys", () => {
    // The old reference was three different kinds of figure - a WHO BMI
    // threshold, an age-matched resting rate and a cohort activity mean - and it
    // described nobody, so it did not land on its own age and the gap it left
    // moved with age. The reference is now this cohort's average person, whose
    // fitness age is their chronological age by construction.
    const out = computeFitnessAge(ok);
    expect(out.referenceAge).toBe(ok.age);
    expect(out.referenceVo2max).toBeGreaterThan(0);
  });

  it("flags a figure that landed outside the ages the study contained", () => {
    const out = computeFitnessAge({ ...ok, restingHr: 32, weightKg: 62, paIndex: 15 });
    // Two different limits and the distinction is the point. `clamped` says the
    // honest answer fell outside 20-90, which nobody in the cohort was, so the
    // linear age term has run off the data. `capped` says the presentation limit
    // then bit. The uncapped figure is reported raw, negative if that is what the
    // model said, because rounding it into the reference range would disguise
    // how far out it went.
    expect(out.clamped).toBe(true);
    expect(out.uncappedAge).toBeLessThan(AGE_MIN);
    expect(out.capped).toBe(true);
    expect(out.fitnessAge).toBeCloseTo(ok.age - maxGapYears(ok.age), 10);
  });
});

describe("compareBodyModels", () => {
  /**
   * A 34-year-old man, 50 bpm resting, as active as the study's own average.
   *
   * 10.5 rather than the 7.5 this fixture used to carry: that was a guideline
   * threshold on the Kurtze scale, and on the New index the same number describes
   * someone well below average instead. Nothing about the comparison depends on
   * which is used - the point is the two body-composition forms - but a fixture
   * quietly describing the wrong scale is how the index bug survived as long as
   * it did.
   */
  const man = { ...ok, paIndex: 10.5, heightCm: 180 };

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
    // Measured at 15.0. Wide, and honestly so: this is the uncapped model, where
    // one BMI unit is nearly three years, and it is the cost the no-waist
    // constraint puts on anyone carrying muscle.
    expect(muscular.yearsDelta).toBeLessThan(18);
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
      // **Against the uncapped figure, and a page showing both has to say so.**
      // The rows are the model's own itemisation and they sum to what it
      // actually said; the cap is applied afterwards to what gets printed. On a
      // capped card the rows will not add to the headline, and pretending
      // otherwise would mean scaling the itemisation to fit, which is the kind
      // of quiet fudge this whole ticket exists to refuse.
      expect(total).toBeCloseTo(out.uncappedAge - out.referenceAge, 8);
    }
  });

  it("adds up for an unfit profile too, where the gap runs the other way", () => {
    const out = computeFitnessAge({ ...ok, restingHr: 74, weightKg: 100, paIndex: 1 });
    const rows = fitnessAgeBreakdown(out);
    const total = rows.reduce((sum, r) => sum + r.years, 0);
    expect(total).toBeCloseTo(out.uncappedAge - out.referenceAge, 8);
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

/**
 * The check the wrong-activity-index bug got past, and the reason it existed.
 *
 * Every other test here asserts a relationship (more activity reads younger) or
 * an endpoint (the curve round-trips at its own anchors), and the index bug broke
 * neither: it fed a 0-15 quantity into a coefficient fitted on a 0-45 one, which
 * moves every figure by the same few years and leaves every relationship intact.
 * What catches that is only ever the middle - feed the published cohort back into
 * the model and check it reproduces the published answer.
 *
 * **Men only, deliberately.** Nes 2011 Table 1 reports its means by sex and only
 * the male row was ever written down in this repo. Running a male cohort's BMI
 * and resting rate through the female equation would be inventing a woman, which
 * is the exact error the withdrawn "twelve-year bias" claim was made of.
 */
describe("calibration against the published cohort", () => {
  /** Nes 2011 Table 1, men: the sample the coefficients were fitted on. */
  const COHORT = { age: 48.9, bmi: 26.6, waist: 94.7, restingHr: 57.4, vo2peak: 44.4 };

  const solveForPa = (coef, body) =>
    (COHORT.vo2peak -
      coef.intercept -
      coef.age * COHORT.age -
      coef.body * body -
      coef.restingHr * COHORT.restingHr) /
    coef.pa;

  it("recovers the reference activity index from both published male models", () => {
    // The paper never prints the cohort's mean New-index value - Table 1's 3.27
    // is the superseded Kurtze index - so it is solved for instead. Two
    // independently sourced equations landing on the same latent quantity is what
    // makes 10.5 a measurement rather than a guess, and it is also the only
    // corroboration the BMI coefficients have, since they appear in no paper.
    //
    // Half a point of tolerance, because the published mean VO2peak is quoted as
    // both 44.3 and 44.4 in different places and that alone moves the answer by
    // ~0.4. Anything wider than this and the two models are not describing the
    // same cohort.
    const waist = solveForPa(HUNT_MODELS.waist.male, COHORT.waist);
    const bmi = solveForPa(HUNT_MODELS.bmi.male, COHORT.bmi);

    expect(Math.abs(waist - bmi)).toBeLessThan(0.5);
    expect(waist).toBeCloseTo(INPUT_REFERENCE.pa.value, 0);
    expect(bmi).toBeCloseTo(INPUT_REFERENCE.pa.value, 0);
  });

  it("reproduces the cohort's measured VO2peak when fed that reference", () => {
    // The same statement in the other direction, and the one that fails loudly if
    // the index scale is ever swapped back: at a Kurtze-scale 3.27 both models
    // come out ~1.7 mL/kg/min low, which the reference curve turns into years.
    for (const [key, body] of [
      ["waist", COHORT.waist],
      ["bmi", COHORT.bmi],
    ]) {
      const coef = HUNT_MODELS[key].male;
      const predicted =
        coef.intercept +
        coef.age * COHORT.age +
        coef.body * body +
        coef.restingHr * COHORT.restingHr +
        coef.pa * INPUT_REFERENCE.pa.value;
      expect(predicted).toBeCloseTo(COHORT.vo2peak, 0);
    }
  });

  /** The cohort's average man, aged up and down. Every input held at its mean. */
  const averageMan = (age) => ({
    age,
    sex: "male",
    heightCm: 180,
    weightKg: COHORT.bmi * 1.8 ** 2,
    weightDaysOld: 1,
    restingHr: COHORT.restingHr,
    restingHrDays: MIN_RESTING_HR_DAYS,
    paIndex: INPUT_REFERENCE.pa.value,
    activityDays: MIN_ACTIVITY_DAYS,
  });

  it("gives an average man roughly his own age, which is the whole claim", () => {
    // Roughly, not exactly. Two papers on two samples cannot agree perfectly, and
    // the residual here is about 1 mL/kg/min - HUNT calls the average 48.9-year-old
    // man 44.3 where Loe's curve calls him ~45.4. That gap is the cohort mismatch
    // the ticket says belongs on the page, not a bug to be offset away.
    for (const age of [32, 49, 60]) {
      const out = computeFitnessAge(averageMan(age));
      expect(out.state).toBe("ready");
      expect(out.capped).toBe(false);
      expect(Math.abs(out.gap)).toBeLessThan(5);
    }
  });

  it("gives the average man his own age at every age, with no drift", () => {
    // **This is what anchoring to the equation bought, and it was measured
    // before and after.** Read off Loe's decade curve, the same average man read
    // between 0.2 years young and 5.4 years old depending only on his age: that
    // curve is published as decade means, so its slope swings from -0.53 to
    // -0.19 to -0.46 while the equation falls linearly at -0.327, and inverting
    // a nearly flat segment amplifies the residual between the two papers. At 40
    // it put him +4.7 before anything about him was considered, which a six-year
    // cap leaves no room to distinguish from a sedentary man.
    //
    // Anchored on the cohort's own average, the drift is not merely smaller, it
    // is zero by construction, and that is the property worth pinning.
    for (let age = 22; age <= 70; age++) {
      expect(computeFitnessAge(averageMan(age)).uncappedAge).toBeCloseTo(age, 8);
    }
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
