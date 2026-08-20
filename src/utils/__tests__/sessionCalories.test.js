import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONSTANT,
  MIN_FIT_SESSIONS,
  MIN_MINUTES,
  estimateSessionCalories,
  fitConstant,
  keytelPerMinute,
  metCalories,
  roundEstimate,
} from "@/utils/sessionCalories";

// The author's own figures, which is what the constant was measured against.
const PROFILE = { weightKg: 71, ageYears: 32, sex: "male" };

/**
 * Six real band sessions off the device on 2026-08-19, each `[minutes, kcal,
 * hrAvg]`. These are measurements, not fixtures: the whole design rests on
 * Keytel tracking these with one constant, so if that stops being true the tests
 * that assert it should fail rather than be quietly rewritten.
 */
const REAL = [
  [182, 1380, 121],
  [75, 594, 123],
  [79, 764, 138],
  [178, 1615, 132],
  [199, 1672, 126],
  [62, 567, 135],
];

const asSessions = (rows) =>
  rows.map(([minutes, caloriesKcal, hrAvg]) => ({
    activeSeconds: minutes * 60,
    caloriesKcal,
    hrAvg,
  }));

describe("keytelPerMinute", () => {
  it("reproduces the published male equation", () => {
    // (-55.0969 + 0.6309*132 + 0.1988*71 + 0.2017*32) / 4.184
    expect(keytelPerMinute({ ...PROFILE, hr: 132 })).toBeCloseTo(11.652, 2);
  });

  it("uses the women's coefficients for a woman", () => {
    const male = keytelPerMinute({ ...PROFILE, hr: 132 });
    const female = keytelPerMinute({ ...PROFILE, sex: "female", hr: 132 });
    expect(female).not.toBeCloseTo(male, 1);
    expect(female).toBeGreaterThan(0);
  });

  it("withholds rather than inventing a body when an input is missing", () => {
    expect(keytelPerMinute({ hr: 132, ageYears: 32, sex: "male" })).toBe(null);
    expect(keytelPerMinute({ ...PROFILE, hr: null })).toBe(null);
  });

  it("withholds where the equation goes negative rather than reporting a burn of zero", () => {
    // A resting rate is outside the range this was fitted on; the male form
    // turns negative there, which is the equation being misused, not a body.
    expect(keytelPerMinute({ ...PROFILE, hr: 40 })).toBe(null);
  });
});

describe("fitConstant", () => {
  it("recovers a constant close to the one measured on the real archive", () => {
    const { constant, provisional, from } = fitConstant(asSessions(REAL), PROFILE);
    expect(provisional).toBe(false);
    expect(from).toBe(REAL.length);
    // Measured across all 14 usable sessions the mean was 1.343.
    expect(constant).toBeGreaterThan(1.2);
    expect(constant).toBeLessThan(1.45);
  });

  it("scaling by it reproduces the band's own figures within a few percent", () => {
    const { constant } = fitConstant(asSessions(REAL), PROFILE);
    for (const [minutes, kcal, hrAvg] of REAL) {
      const est = (keytelPerMinute({ ...PROFILE, hr: hrAvg }) * minutes) / constant;
      expect(Math.abs(est - kcal) / kcal).toBeLessThan(0.1);
    }
  });

  it("falls back to the shipped default until there is enough to fit", () => {
    const few = asSessions(REAL.slice(0, MIN_FIT_SESSIONS - 1));
    const { constant, provisional } = fitConstant(few, PROFILE);
    expect(constant).toBe(DEFAULT_CONSTANT);
    expect(provisional).toBe(true);
  });

  it("ignores short sessions, which is where the band's own splitting is least settled", () => {
    // The two real outliers: 12 and 13 minutes, ratios 4.03 and 2.88.
    const withJunk = asSessions([...REAL, [12, 32, 126], [13, 48, 125]]);
    const clean = fitConstant(asSessions(REAL), PROFILE);
    expect(fitConstant(withJunk, PROFILE).constant).toBeCloseTo(clean.constant, 6);
  });

  it("averages each session's own ratio, so one long session cannot decide it", () => {
    const withMonster = asSessions([...REAL, [600, 9000, 130]]);
    const { constant } = fitConstant(withMonster, PROFILE);
    // A pooled ratio would be dragged hard toward the outlier; a mean of ratios
    // moves by roughly one seventh of the difference.
    expect(constant).toBeGreaterThan(1.0);
    expect(constant).toBeLessThan(1.45);
  });
});

describe("estimateSessionCalories", () => {
  const fitted = { constant: 1.343, provisional: false };

  it("scores a ten-minute session, which the first version wrongly refused", () => {
    // Keytel is a per-minute rate, so ten minutes of it is as sound as forty.
    const out = estimateSessionCalories({
      hrAvg: 132,
      hrSamples: 10,
      activeSeconds: 10 * 60,
      profile: PROFILE,
      ...fitted,
    });
    expect(out.source).toBe("hr");
    expect(out.kcal).toBeGreaterThan(0);
  });

  it("refuses a window too thin to believe the average, whatever its length", () => {
    // Two readings over half an hour is the strap being handled, not worn - the
    // same rule bucketSeries withholds a half hour under.
    const out = estimateSessionCalories({
      hrAvg: 161,
      hrSamples: 2,
      activeSeconds: 30 * 60,
      profile: PROFILE,
      ...fitted,
    });
    expect(out).toBe(null);
  });

  it("still falls through to MET when the window is thin, since MET never read one", () => {
    const out = estimateSessionCalories({
      hrAvg: 161,
      hrSamples: 2,
      activeSeconds: 30 * 60,
      profile: PROFILE,
      ...fitted,
      met: 7,
    });
    expect(out.source).toBe("met");
  });

  it("says nothing about a session too short to be a session", () => {
    expect(
      estimateSessionCalories({
        hrAvg: 130,
        activeSeconds: (MIN_MINUTES - 1) * 60,
        profile: PROFILE,
        ...fitted,
      })
    ).toBe(null);
  });

  it("prefers heart rate and says so", () => {
    const out = estimateSessionCalories({
      hrAvg: 132,
      activeSeconds: 42 * 60,
      profile: PROFILE,
      ...fitted,
      met: 7,
    });
    expect(out.source).toBe("hr");
    expect(out.estimated).toBe(true);
    // The real session: 42 minutes, hrAvg 132, band said 364.
    expect(Math.abs(out.kcal - 364) / 364).toBeLessThan(0.1);
  });

  it("falls back to MET when there is no heart rate to derive from", () => {
    const out = estimateSessionCalories({
      hrAvg: null,
      activeSeconds: 42 * 60,
      profile: PROFILE,
      ...fitted,
      met: 7,
    });
    expect(out.source).toBe("met");
    // A MET is a population average for a name, so it is provisional however
    // well the constant beside it was fitted.
    expect(out.provisional).toBe(true);
  });

  it("withholds rather than guessing when neither is available", () => {
    expect(
      estimateSessionCalories({
        hrAvg: null,
        activeSeconds: 42 * 60,
        profile: PROFILE,
        ...fitted,
        met: null,
      })
    ).toBe(null);
  });

  it("withholds the MET fallback when no weight is recorded", () => {
    // Body mass is the one input that would silently scale everything.
    expect(
      estimateSessionCalories({
        hrAvg: null,
        activeSeconds: 42 * 60,
        profile: { ageYears: 32, sex: "male" },
        ...fitted,
        met: 7,
      })
    ).toBe(null);
  });

  it("carries the provisional flag through, so a screen can qualify it", () => {
    const out = estimateSessionCalories({
      hrAvg: 132,
      activeSeconds: 42 * 60,
      profile: PROFILE,
      constant: DEFAULT_CONSTANT,
      provisional: true,
    });
    expect(out.provisional).toBe(true);
  });

  it("still gives a new user a figure rather than a blank", () => {
    // The standing rule: a provisional number with its caveat beats weeks of an
    // empty column, which teaches people the column is broken.
    const out = estimateSessionCalories({
      hrAvg: 132,
      activeSeconds: 42 * 60,
      profile: PROFILE,
      ...fitConstant([], PROFILE),
    });
    expect(out.kcal).toBeGreaterThan(0);
    expect(out.provisional).toBe(true);
  });
});

describe("roundEstimate", () => {
  it("rounds coarsely, because neither estimator earns a final digit", () => {
    expect(roundEstimate(364)).toBe(360);
    expect(roundEstimate(367)).toBe(370);
  });

  it("gets coarser above a thousand, where a percent is worth more than a digit", () => {
    expect(roundEstimate(1615)).toBe(1600);
    expect(roundEstimate(1672)).toBe(1650);
  });

  it("has nothing to say about a non-figure", () => {
    expect(roundEstimate(0)).toBe(null);
    expect(roundEstimate(null)).toBe(null);
  });
});

describe("metCalories", () => {
  it("is the standard form", () => {
    // 7 MET, 71 kg, 42 min
    expect(metCalories({ met: 7, weightKg: 71, minutes: 42 })).toBeCloseTo(365.2, 0);
  });

  it("withholds without a weight", () => {
    expect(metCalories({ met: 7, weightKg: null, minutes: 42 })).toBe(null);
  });
});
