import { describe, it, expect } from "vitest";
import {
  historyFor,
  recoveryFor,
  sleepScoreFor,
  recentSleepScore,
  bodyRows,
  VITALS,
} from "@/components/home/homeModel";
import { BODY_CARDS } from "@/components/body/bodyModel";

const TODAY = "2026-07-28";

/**
 * A day window ending today, with steady vitals on every prior day.
 *
 * The `{ date, values }` shape is not incidental: it is exactly what
 * dailyValuesForRange returns, and an earlier version of these tests used a
 * flat shape instead. Everything passed while Home read nothing at all,
 * because a missing metric and an undefined one are indistinguishable here.
 */
function window({
  nights = 8,
  hrv = 52,
  restingHr = 54,
  respRate = 14,
  stress = 30,
  spo2 = 97,
  skinTemp = 33,
  hr = 68,
  todayOverrides = {},
} = {}) {
  const days = [];
  for (let i = nights - 1; i >= 1; i--) {
    const d = new Date("2026-07-28T00:00:00");
    d.setDate(d.getDate() - i);
    days.push({
      date: d.toLocaleDateString("sv"),
      values: {
        // A little jitter, or the baseline has no spread and every deviation
        // becomes undefined.
        hrv: hrv + ((i % 3) - 1),
        restingHr: restingHr + ((i % 3) - 1),
        respRate: respRate + ((i % 3) - 1) * 0.4,
        stress: stress + ((i % 3) - 1) * 2,
        spo2: spo2 + ((i % 3) - 1) * 0.5,
        skinTemp: skinTemp + ((i % 3) - 1) * 0.2,
        hr: hr + ((i % 3) - 1),
      },
    });
  }
  days.push({
    date: TODAY,
    values: { hrv, restingHr, respRate, stress, spo2, skinTemp, hr, ...todayOverrides },
  });
  return days;
}

describe("historyFor", () => {
  it("excludes today, because a baseline containing today cannot measure deviation from it", () => {
    const dates = window({ nights: 8 }).map((d) => d.date);
    expect(dates).toContain(TODAY);
    const history = historyFor(window({ nights: 8 }), "hrv", TODAY);
    expect(history).toHaveLength(7);
  });

  it("runs oldest first, which is what the rolling window expects", () => {
    const days = [
      { date: "2026-07-26", values: { hrv: 3 } },
      { date: "2026-07-24", values: { hrv: 1 } },
      { date: "2026-07-25", values: { hrv: 2 } },
    ];
    expect(historyFor(days, "hrv", TODAY)).toEqual([1, 2, 3]);
  });

  it("keeps gaps as nulls rather than dropping the day silently", () => {
    const days = [
      { date: "2026-07-24", values: { hrv: 50 } },
      { date: "2026-07-25", values: {} },
      { date: "2026-07-26", values: { hrv: 52 } },
    ];
    expect(historyFor(days, "hrv", TODAY)).toEqual([50, null, 52]);
  });
});

describe("recoveryFor", () => {
  it("calibrates on a short history", () => {
    const result = recoveryFor({
      dayWindow: window({ nights: 4 }),
      entry: { sleep: 8 },
      todayKey: TODAY,
      sleepGoalHours: 8,
    });
    expect(result.state).toBe("calibrating");
  });

  it("scores once the window has filled", () => {
    const result = recoveryFor({
      dayWindow: window({ nights: 8 }),
      entry: { sleep: 8 },
      todayKey: TODAY,
      sleepGoalHours: 8,
    });
    expect(result.state).toBe("ready");
    expect(result.score).toBeGreaterThan(0);
  });

  it("shows the night before when today has begun but not been slept through", () => {
    // Just after midnight the date rolls over and carries a waking resting heart
    // rate and nothing else. Scored, that returned a real-looking number about a
    // night nobody had had. The fallback is one day only and it says which day
    // it is describing, or it would be lying about the date rather than the
    // score.
    const yesterday = "2026-07-27";
    const result = recoveryFor({
      // Ten, not eight: scoring yesterday needs seven nights BEFORE yesterday,
      // which is what a real thirty-day window always has and a tight fixture
      // does not.
      dayWindow: window({ nights: 10, todayOverrides: { hrv: null, restingHr: 67 } }),
      entry: null,
      entries: [{ date: yesterday, sleep: 7.5 }],
      todayKey: TODAY,
      sleepGoalHours: 8,
    });

    expect(result.state).toBe("ready");
    expect(result.forDate).toBe(yesterday);
    expect(result.fromPreviousNight).toBe(true);
  });

  it("does not step back to a day that cannot be scored either", () => {
    // Two days without a night is a strap in a drawer, not a night still to
    // come, and a score from the day before yesterday would be stale enough to
    // mislead. The honest answer is the one today already gave.
    const result = recoveryFor({
      dayWindow: window({ nights: 8, todayOverrides: { hrv: null, restingHr: 67 } }),
      entry: null,
      entries: [],
      todayKey: TODAY,
      sleepGoalHours: 8,
    });

    expect(result.state).toBe("awaiting-night");
    expect(result.forDate).toBe(TODAY);
  });

  it("names the date it scored even on an ordinary day", () => {
    // Every screen reads `forDate` rather than assuming today, so the fallback
    // cannot be the only path that carries one.
    const result = recoveryFor({
      dayWindow: window({ nights: 8 }),
      entry: { sleep: 8 },
      todayKey: TODAY,
      sleepGoalHours: 8,
    });
    expect(result.forDate).toBe(TODAY);
    expect(result.fromPreviousNight).toBeUndefined();
  });

  it("takes sleep from the checkin entry, not from the sample rollups", () => {
    const short = recoveryFor({
      dayWindow: window({ nights: 8 }),
      entry: { sleep: 4 },
      todayKey: TODAY,
      sleepGoalHours: 8,
    });
    const full = recoveryFor({
      dayWindow: window({ nights: 8 }),
      entry: { sleep: 8 },
      todayKey: TODAY,
      sleepGoalHours: 8,
    });
    expect(short.score).toBeLessThan(full.score);
  });
});

describe("sleepScoreFor", () => {
  /** A night that both starts and ends on sensible clock times for `date`. */
  const night = (date, bedHour = 23) => {
    const wake = new Date(`${date}T07:00:00`).getTime();
    const bed = new Date(`${date}T00:00:00`).getTime() - (24 - bedHour) * 3600 * 1000;
    return {
      date,
      sleep: (wake - bed) / 3600000,
      sleepStages: {
        bedTime: bed,
        wakeTime: wake,
        deep: 70,
        light: 300,
        rem: 90,
        wake: 20,
        timeline: [{ stage: "light", startMinute: 0, minutes: 480 }],
      },
    };
  };

  const entries = ["2026-07-24", "2026-07-25", "2026-07-26", "2026-07-27", TODAY].map((d) =>
    night(d)
  );

  it("returns null for a night with nothing recorded", () => {
    expect(sleepScoreFor({ entries, entry: {}, todayKey: TODAY })).toBeNull();
    expect(sleepScoreFor({ entries, entry: null, todayKey: TODAY })).toBeNull();
  });

  it("scores a night once there are enough nights behind it", () => {
    const score = sleepScoreFor({ entries, entry: entries.at(-1), todayKey: TODAY });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("never scores a past night using nights that came after it", () => {
    // Regularity compares each night with the one before. Letting later nights in
    // would mean a day's score changed every time a newer night arrived, so a
    // number you looked at yesterday would not be the same number today.
    const earlier = "2026-07-25";
    const withFuture = sleepScoreFor({ entries, entry: night(earlier), todayKey: earlier });
    const trimmed = sleepScoreFor({
      entries: entries.filter((e) => e.date <= earlier),
      entry: night(earlier),
      todayKey: earlier,
    });
    expect(withFuture).toBe(trimmed);
  });

  it("feeds Recovery's sleep term, so the two cannot disagree", () => {
    const result = recoveryFor({
      dayWindow: window({ nights: 8 }),
      entry: entries.at(-1),
      todayKey: TODAY,
      sleepGoalHours: 8,
      entries,
    });
    const score = sleepScoreFor({ entries, entry: entries.at(-1), todayKey: TODAY });
    expect(result.terms.sleep).toBeCloseTo(score / 100, 5);
  });
});

describe("bodyRows", () => {
  const entry = { sleep: 7.5, sleepStages: { deep: 95, light: 240, rem: 75, awake: 20 } };

  it("always leads with sleep", () => {
    const rows = bodyRows({ dayWindow: window(), entry, todayKey: TODAY });
    expect(rows[0].kind).toBe("sleep");
    expect(rows[0].stages).toEqual(entry.sleepStages);
  });

  // Stress always takes a row: it is the only vital that moves during the day
  // rather than settling overnight, so collapsing it meant it disappeared on
  // exactly the ordinary days you would check it on.
  const ALWAYS = VITALS.filter((v) => v.alwaysShown).length;

  // The whole point of the trim: an ordinary day should not list every vital.
  it("collapses in-range vitals into one line, without naming them", () => {
    const rows = bodyRows({ dayWindow: window(), entry, todayKey: TODAY });
    const normal = rows.find((r) => r.kind === "allNormal");
    expect(rows.filter((r) => r.kind === "baseline")).toHaveLength(ALWAYS);
    // Not "ALL", because stress is on screen with a row of its own and this
    // line no longer speaks for every vital.
    expect(normal.text).toBe(`${VITALS.length - ALWAYS} NORMAL`);
    // Naming each one ran past the end of the row once type sizes went up, and
    // the label already says VITALS.
    expect(normal.text).not.toMatch(/HRV|REST HR|RESP RATE|SPO2|SKIN TEMP/);
  });

  it("gives a vital its own row when it falls outside its usual range", () => {
    const rows = bodyRows({
      dayWindow: window({ todayOverrides: { hrv: 20 } }),
      entry,
      todayKey: TODAY,
    });
    const hrvRow = rows.find((r) => r.key === "hrv");
    expect(hrvRow.kind).toBe("baseline");
    expect(hrvRow.value).toBe(20);
    expect(hrvRow.low).toBeLessThan(hrvRow.high);

    // The others stay counted rather than vanishing. Returning early here meant
    // one unusual vital took the rest off the screen, and a missing row is
    // indistinguishable from a metric that was never measured.
    const normal = rows.find((r) => r.kind === "allNormal");
    expect(normal.text).toBe(`${VITALS.length - 1 - ALWAYS} NORMAL`);
  });

  it("surfaces several vitals at once when several are out", () => {
    const rows = bodyRows({
      dayWindow: window({ todayOverrides: { hrv: 20, restingHr: 90 } }),
      entry,
      todayKey: TODAY,
    });
    expect(rows.filter((r) => r.kind === "baseline")).toHaveLength(2 + ALWAYS);
  });

  // Before the window fills there is no usual range, so claiming "all normal"
  // would be asserting something unknown.
  it("shows bare values instead of a normality claim while calibrating", () => {
    const rows = bodyRows({ dayWindow: window({ nights: 3 }), entry, todayKey: TODAY });
    expect(rows.some((r) => r.kind === "allNormal")).toBe(false);
    expect(rows.filter((r) => r.kind === "plain")).toHaveLength(VITALS.length);
  });

  it("says so once when nothing has been recorded today", () => {
    const days = window();
    days[days.length - 1] = { date: TODAY, values: {} };
    const rows = bodyRows({ dayWindow: days, entry, todayKey: TODAY });
    expect(rows).toHaveLength(2);
    expect(rows[1].kind).toBe("empty");
  });

  it("keeps the sleep row even with no wearable data at all", () => {
    const rows = bodyRows({ dayWindow: [], entry, todayKey: TODAY });
    expect(rows[0].kind).toBe("sleep");
    expect(rows[0].hours).toBe(7.5);
  });
});


describe("Home and BODY agree about vitals", () => {
  it("lists them in the same order as the BODY tab", () => {
    const bodyVitals = BODY_CARDS.find((c) => c.key === "vitals").metrics.filter(
      (m) => m !== "sleep"
    );
    expect(VITALS.map((v) => v.key)).toEqual(bodyVitals);
  });
});

describe("recentSleepScore", () => {
  const night = (date, sleep) => ({
    date,
    sleep,
    sleepStages: { deep: 90, light: 250, rem: 80, wake: 15, score: 75 },
  });

  it("averages the week rather than reporting last night", () => {
    // A condition score should not swing 25 points on one bad night.
    const week = [
      night("2026-08-04", 8),
      night("2026-08-05", 8),
      night("2026-08-06", 8),
      night("2026-08-07", 8),
      night("2026-08-08", 8),
      night("2026-08-09", 8),
      night("2026-08-10", 3),
    ];
    const out = recentSleepScore({ entries: week, todayKey: "2026-08-10" });
    const lastNight = sleepScoreFor({
      entries: week,
      entry: week.at(-1),
      todayKey: "2026-08-10",
    });
    expect(out.nights).toBe(7);
    expect(out.score).toBeGreaterThan(lastNight);
  });

  it("skips nights with nothing recorded rather than counting them as zero", () => {
    const sparse = [night("2026-08-08", 8), night("2026-08-10", 8)];
    const out = recentSleepScore({ entries: sparse, todayKey: "2026-08-10" });
    expect(out.nights).toBe(2);
    expect(out.score).toBeGreaterThan(0);
  });

  it("withholds itself entirely when there is nothing to average", () => {
    expect(recentSleepScore({ entries: [], todayKey: "2026-08-10" })).toBeNull();
  });
});
