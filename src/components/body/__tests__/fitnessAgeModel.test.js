import { describe, it, expect } from "vitest";
import {
  restingHrAverage,
  latestWeight,
  activityDaysFrom,
  fitnessAgeInputs,
  fitnessAgeFor,
} from "@/components/body/fitnessAgeModel";
import { MIN_RESTING_HR_DAYS, PROVISIONAL_MIN_DAYS } from "@/utils/fitnessAge";
import { addDays } from "@/utils/date";

const TODAY = "2026-08-14";

/** A day window ending today, with a resting rate on every prior day. */
function window(days, { restingHr = 48, todayRestingHr = 67 } = {}) {
  const out = [];
  for (let i = days; i >= 1; i--) {
    out.push({ date: addDays(TODAY, -i), values: { restingHr, hrv: 110 } });
  }
  out.push({ date: TODAY, values: { restingHr: todayRestingHr, hrv: null } });
  return out;
}

const profile = { age: 32, sex: "male", heightCm: 183 };
const session = (minutes, hrAvg, i) => ({
  startMillis: Date.parse(TODAY) - i * 86_400_000,
  activeSeconds: minutes * 60,
  hrAvg,
});
const sessions = [45, 50, 40, 55, 47, 44, 52, 46, 49, 51, 43, 48].map((m, i) =>
  session(m, 130, i * 2)
);

describe("restingHrAverage", () => {
  it("leaves today out, because a day a few hours old is a waking reading", () => {
    // The real failure this guards, measured at 00:32: the date had rolled over
    // and carried 67, being the tenth percentile of half an hour of sitting up,
    // against a real average near 47. One beat is half a year here.
    const out = restingHrAverage(window(10, { restingHr: 48, todayRestingHr: 67 }), TODAY);
    expect(out.value).toBeCloseTo(48, 8);
    expect(out.days).toBe(10);
  });

  it("counts only the days that actually carry a reading", () => {
    const days = window(4);
    days[1].values.restingHr = null;
    days[2].values = {};
    expect(restingHrAverage(days, TODAY).days).toBe(2);
  });

  it("has nothing to say about an empty window", () => {
    expect(restingHrAverage([], TODAY)).toEqual({ value: null, days: 0 });
    expect(restingHrAverage(null, TODAY).days).toBe(0);
  });
});

describe("latestWeight", () => {
  const entries = [
    { date: "2026-05-11", weight: 71.25 },
    { date: "2026-08-12", weight: 71 },
    { date: "2026-07-24", weight: 70.7 },
    { date: "2026-08-13", sleep: 7 },
  ];

  it("takes the most recent weight and says how old it is", () => {
    const out = latestWeight(entries, TODAY);
    expect(out.weightKg).toBe(71);
    expect(out.on).toBe("2026-08-12");
    expect(out.weightDaysOld).toBe(2);
  });

  it("ignores entries with no weight rather than reading them as zero", () => {
    expect(latestWeight([{ date: "2026-08-13", sleep: 7 }], TODAY).weightKg).toBeNull();
  });

  it("never reaches forward past today", () => {
    const out = latestWeight([...entries, { date: "2026-09-01", weight: 99 }], TODAY);
    expect(out.weightKg).toBe(71);
  });

  it("returns a null staleness rather than zero when there is no weight", () => {
    // Zero would read as "weighed today" to computeFitnessAge, which is exactly
    // the confusion its own gate refuses to allow.
    expect(latestWeight([], TODAY).weightDaysOld).toBeNull();
  });
});

describe("activityDaysFrom", () => {
  it("counts from the first day with anything, not from the first session", () => {
    // Somebody who trained once a fortnight ago has a fortnight of evidence.
    expect(activityDaysFrom(window(13), TODAY)).toBe(14);
  });

  it("is zero on an empty archive", () => {
    expect(activityDaysFrom([], TODAY)).toBe(0);
    expect(activityDaysFrom([{ date: "2026-08-10", values: {} }], TODAY)).toBe(0);
  });
});

describe("fitnessAgeInputs", () => {
  const args = {
    profile,
    entries: [{ date: "2026-08-12", weight: 71 }],
    dayWindow: window(30),
    sessions,
    todayKey: TODAY,
  };

  it("assembles every field the model needs", () => {
    const inputs = fitnessAgeInputs(args);
    expect(inputs.age).toBe(32);
    expect(inputs.sex).toBe("male");
    expect(inputs.heightCm).toBe(183);
    expect(inputs.weightKg).toBe(71);
    expect(inputs.weightDaysOld).toBe(2);
    expect(inputs.restingHr).toBeCloseTo(48, 8);
    expect(inputs.restingHrDays).toBe(30);
    expect(inputs.paIndex).toBeGreaterThan(0);
  });

  it("never offers a waist, so the BMI form is chosen for a stated reason", () => {
    // The reference has no waist for women at all, and Atlas asks nobody for one.
    expect(fitnessAgeInputs(args).waistCm).toBeNull();
  });

  it("passes the real day count through rather than clamping it up to the gate", () => {
    // Clamping would buy a number by lying about how much history stood behind
    // it, which is the one thing this whole ticket refuses.
    const short = fitnessAgeInputs({ ...args, dayWindow: window(3) });
    expect(short.restingHrDays).toBe(3);
    expect(short.activityDays).toBe(4);
  });
});

describe("fitnessAgeFor", () => {
  const args = {
    profile,
    entries: [{ date: "2026-08-12", weight: 71 }],
    dayWindow: window(30),
    sessions,
    todayKey: TODAY,
  };

  it("gives a settled figure once there is enough history", () => {
    const out = fitnessAgeFor(args);
    expect(out.state).toBe("ready");
    expect(out.provisional).toBe(false);
    expect(out.fitnessAge).toBeGreaterThan(0);
  });

  it("gives a provisional figure on a short history rather than a blank month", () => {
    const out = fitnessAgeFor({ ...args, dayWindow: window(10) });
    expect(out.state).toBe("ready");
    expect(out.provisional).toBe(true);
    expect(out.settlesAfterDays).toBe(MIN_RESTING_HR_DAYS - 10);
  });

  it("says nothing at all below the floor Recovery uses", () => {
    const out = fitnessAgeFor({ ...args, dayWindow: window(PROVISIONAL_MIN_DAYS - 1) });
    expect(out.state).toBe("withheld");
    expect(out.reason).toBe("calibrating-resting-hr");
    expect(out.needed).toBe(PROVISIONAL_MIN_DAYS);
    // The card counts down to the floor it is actually waiting for, and can
    // still name the settled figure separately.
    expect(out.settledAt).toBe(MIN_RESTING_HR_DAYS);
  });

  it("withholds rather than guessing when the profile is incomplete", () => {
    expect(fitnessAgeFor({ ...args, profile: { ...profile, heightCm: null } }).state).toBe(
      "withheld"
    );
    expect(fitnessAgeFor({ ...args, profile: { ...profile, sex: null } }).reason).toBe("no-sex");
  });

  it("refuses a weight too old to describe the body it is about", () => {
    const out = fitnessAgeFor({ ...args, entries: [{ date: "2026-01-02", weight: 71 }] });
    expect(out.state).toBe("withheld");
    expect(out.reason).toBe("stale-weight");
  });

  it("keeps the inputs it used, so a card can show its working", () => {
    expect(fitnessAgeFor(args).inputsUsed.restingHr).toBeCloseTo(48, 8);
  });
});
