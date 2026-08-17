import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  putSamples,
  clearAll,
  saveRollups,
  downsampleOlderThan,
} from "@/utils/sampleDb";
import { rollupsForDate, dailyValuesFor, localDayBounds, dailyValuesForRange } from "@/utils/dailyRollup";

// The suite runs in node, where there is no localStorage. `load` is guarded so
// production code degrades to "no night known", but the resting-HR scoping is
// about what happens when a night IS known, so the tests need a real one.
const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
  clear: () => backing.clear(),
};

// Local midnight for the date under test, so the tests are timezone-independent.
const DATE = "2026-07-24";
function atLocalHour(hour, minute = 0) {
  const d = new Date(`${DATE}T00:00:00`);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

beforeEach(async () => {
  await clearAll();
});

describe("rollupsForDate", () => {
  it("sums steps across the day", async () => {
    await putSamples([
      { metric: "steps", t: atLocalHour(9), v: 100 },
      { metric: "steps", t: atLocalHour(13), v: 250 },
      { metric: "steps", t: atLocalHour(18), v: 50 },
    ]);
    const r = await rollupsForDate(DATE);
    expect(r.steps).toBe(400);
  });

  it("averages stress and spo2", async () => {
    await putSamples([
      { metric: "stress", t: atLocalHour(9), v: 20 },
      { metric: "stress", t: atLocalHour(15), v: 40 },
      { metric: "spo2", t: atLocalHour(9), v: 97 },
      { metric: "spo2", t: atLocalHour(15), v: 99 },
    ]);
    const r = await rollupsForDate(DATE);
    expect(r.stress).toBe(30);
    expect(r.spo2).toBe(98);
  });

  it("takes the latest PAI reading of the day", async () => {
    await putSamples([
      { metric: "pai", t: atLocalHour(8), v: 42.9 },
      { metric: "pai", t: atLocalHour(20), v: 83.4 },
    ]);
    const r = await rollupsForDate(DATE);
    expect(r.pai).toBeCloseTo(83.4, 5);
  });

  it("prefers the device's resting HR over the computed fallback", async () => {
    await putSamples([
      { metric: "restingHr", t: atLocalHour(5), v: 47 },
      { metric: "hr", t: atLocalHour(3), v: 90 },
      { metric: "hr", t: atLocalHour(4), v: 95 },
    ]);
    const r = await rollupsForDate(DATE);
    expect(r.restingHr).toBe(47);
  });

  it("falls back to the 10th percentile of the day's heart rates", async () => {
    // 40..140 bpm, all physiologically plausible so isValidHr filters none.
    // p10 of 101 evenly spaced values lands exactly on the 11th, 50.
    const samples = Array.from({ length: 101 }, (_, i) => ({
      metric: "hr",
      t: atLocalHour(0, i),
      v: i + 40,
    }));
    await putSamples(samples);
    const r = await rollupsForDate(DATE);
    expect(r.restingHr).toBe(50);
  });

  // Was "does not expose raw hr as a rollup of its own", which pinned hr as
  // restingHr's fallback source and nothing else. Heart rate got a page and a
  // BODY row on 2026-08-06, so it needs a daily figure for the row to show.
  it("rolls raw hr up as the day's mean, alongside restingHr", async () => {
    await putSamples([
      { metric: "hr", t: atLocalHour(9), v: 60 },
      { metric: "hr", t: atLocalHour(10), v: 80 },
    ]);
    const r = await rollupsForDate(DATE);

    expect(r.hr).toBe(70);
    // The two are different questions about the same samples and both survive.
    expect(r.restingHr).not.toBeUndefined();
  });

  it("returns null for metrics with no samples that day", async () => {
    const r = await rollupsForDate(DATE);
    expect(r.steps).toBeNull();
    expect(r.stress).toBeNull();
    expect(r.restingHr).toBeNull();
  });

  it("excludes samples from adjacent days", async () => {
    const dayBefore = new Date(`${DATE}T00:00:00`).getTime() - 1;
    const dayAfter = new Date(`${DATE}T00:00:00`).getTime() + 24 * 3600 * 1000;
    await putSamples([
      { metric: "steps", t: dayBefore, v: 999 },
      { metric: "steps", t: atLocalHour(12), v: 100 },
      { metric: "steps", t: dayAfter, v: 888 },
    ]);
    const r = await rollupsForDate(DATE);
    expect(r.steps).toBe(100);
  });
});

describe("localDayBounds", () => {
  it("tiles exactly across a full year, including both Sydney DST transitions", () => {
    // Timezone-agnostic invariant: each day's end must equal the next day's
    // start, with no overlap (double counts a boundary sample into both
    // days) and no gap (drops a boundary sample from both days). A fixed
    // start + 24h offset breaks this exactly twice a year wherever the host
    // timezone observes daylight saving - 2026-04-05 and 2026-10-04 for
    // Australia/Sydney, both inside this range.
    const dateKeys = [];
    let cursor = Date.UTC(2026, 0, 1);
    const rangeEnd = Date.UTC(2027, 0, 1);
    while (cursor < rangeEnd) {
      const d = new Date(cursor);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
        d.getUTCDate()
      ).padStart(2, "0")}`;
      dateKeys.push(key);
      cursor += 24 * 60 * 60 * 1000;
    }

    for (let i = 0; i < dateKeys.length - 1; i++) {
      const today = localDayBounds(dateKeys[i]);
      const tomorrow = localDayBounds(dateKeys[i + 1]);
      expect(today.end).toBe(tomorrow.start);
    }
  });
});

describe("dailyValuesFor", () => {
  it("computes from samples when no rollup was frozen", async () => {
    await putSamples([{ metric: "steps", t: atLocalHour(12), v: 100 }]);
    const r = await dailyValuesFor(DATE);
    expect(r.steps).toBe(100);
  });

  it("prefers the frozen rollup over recomputing", async () => {
    await putSamples([{ metric: "steps", t: atLocalHour(12), v: 100 }]);
    await saveRollups(DATE, { steps: 5704 });
    const r = await dailyValuesFor(DATE);
    expect(r.steps).toBe(5704);
  });

  // The failure this prevents: a sync at 00:05 freezes today at almost no
  // steps, and every screen then insists on that number for the rest of the
  // day because the frozen record wins.
  it("recomputes today rather than trusting a rollup frozen earlier in the day", async () => {
    const todayKey = new Date().toLocaleDateString("sv");
    const noon = new Date(`${todayKey}T12:00:00`).getTime();
    await putSamples([{ metric: "steps", t: noon, v: 7400 }]);
    await saveRollups(todayKey, { steps: 23 });

    const r = await dailyValuesFor(todayKey);

    expect(r.steps).toBe(7400);
  });

  it("fills in keys missing from an older frozen record instead of returning them as undefined", async () => {
    // Simulates a rollup frozen before a metric (e.g. hrv) existed in
    // BODY_METRICS: the stored record simply never had that key.
    await saveRollups(DATE, { steps: 5704 });
    const r = await dailyValuesFor(DATE);
    expect(r.steps).toBe(5704);
    expect(r.hrv).toBeNull();
    expect(r.spo2).toBeNull();
    expect(r.restingHr).toBeNull();
    expect("hrv" in r).toBe(true);
  });

  it("survives downsampling, which would otherwise corrupt a summed metric", async () => {
    // Two step samples in one bucket: the true daily total is 300.
    await putSamples([
      { metric: "steps", t: atLocalHour(12), v: 100 },
      { metric: "steps", t: atLocalHour(12, 5), v: 200 },
    ]);
    await saveRollups(DATE, await rollupsForDate(DATE));

    // Age the day out of the retention window: samples collapse to one
    // averaged value of 150, so recomputing would now report 150, not 300.
    await downsampleOlderThan("steps", Date.now());
    expect((await rollupsForDate(DATE)).steps).toBe(150);
    expect((await dailyValuesFor(DATE)).steps).toBe(300);
  });
});

describe("dailyValuesForRange", () => {
  it("returns one entry per day, ascending, both ends inclusive", async () => {
    const got = await dailyValuesForRange("2026-07-20", "2026-07-23");
    expect(got.map((d) => d.date)).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
    ]);
  });

  it("returns a single entry when both ends are the same day", async () => {
    const got = await dailyValuesForRange("2026-07-20", "2026-07-20");
    expect(got.map((d) => d.date)).toEqual(["2026-07-20"]);
  });

  it("returns an empty array when the range is inverted", async () => {
    expect(await dailyValuesForRange("2026-07-23", "2026-07-20")).toEqual([]);
  });

  it("gives every day a full value set, nulls included, so callers never see undefined", async () => {
    const got = await dailyValuesForRange("2026-07-20", "2026-07-21");
    for (const day of got) {
      expect(day.values).toHaveProperty("steps");
      expect(day.values).toHaveProperty("restingHr");
      expect(day.values.steps).toBeNull();
    }
  });

  it("carries real stored values through for the days that have them", async () => {
    await putSamples([
      { metric: "stress", t: new Date("2026-07-21T09:00:00").getTime(), v: 30 },
    ]);
    const got = await dailyValuesForRange("2026-07-20", "2026-07-21");
    expect(got[0].values.stress).toBeNull();
    expect(got[1].values.stress).toBe(30);
  });

  it("spans a month boundary without skipping or repeating a day", async () => {
    const got = await dailyValuesForRange("2026-07-30", "2026-08-02");
    expect(got.map((d) => d.date)).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
  });
});

describe("resting heart rate is scoped to the night", () => {
  const DATE = "2026-08-14";
  const bed = new Date(`2026-08-13T23:10:00`).getTime();
  const wake = new Date(`${DATE}T07:05:00`).getTime();
  const at = (iso) => new Date(iso).getTime();

  beforeEach(() => {
    localStorage.setItem(
      "atlas_checkins",
      JSON.stringify([{ date: DATE, sleepStages: { bedTime: bed, wakeTime: wake } }])
    );
  });

  afterEach(() => localStorage.removeItem("atlas_checkins"));

  it("ignores a resting reading taken after you woke", async () => {
    // The real shape, read off the phone on 2026-08-14: the band emitted three
    // resting samples during the night and another at 09:26, forty minutes after
    // waking. Taking the latest of the calendar day meant Recovery scored 57 at
    // 09:17 and 52 at 09:28 with nothing new about the night in between.
    await putSamples([
      { metric: "restingHr", t: at(`${DATE}T04:46:00`), v: 57 },
      { metric: "restingHr", t: at(`${DATE}T05:36:00`), v: 53 },
      { metric: "restingHr", t: at(`${DATE}T09:26:00`), v: 52 },
    ]);

    const out = await rollupsForDate(DATE);
    expect(out.restingHr).toBe(53);
  });

  it("takes a reading from before midnight, because a night starts the day before", async () => {
    await putSamples([{ metric: "restingHr", t: at("2026-08-13T23:40:00"), v: 49 }]);
    const out = await rollupsForDate(DATE);
    expect(out.restingHr).toBe(49);
  });

  it("falls back to the whole day when the night is not known", async () => {
    // Nights before 2026-08-04 carry no bedtime, and today has none until you
    // have slept. Withholding the figure there would blank a metric that used to
    // have one.
    localStorage.removeItem("atlas_checkins");
    await putSamples([{ metric: "restingHr", t: at(`${DATE}T09:26:00`), v: 52 }]);
    const out = await rollupsForDate(DATE);
    expect(out.restingHr).toBe(52);
  });

  it("scopes the heart-rate fallback to the night as well", async () => {
    // With no device resting sample the figure is the tenth percentile of raw
    // heart rate, and letting waking readings into that is how a date half an
    // hour old returned 67 against a real nightly figure near 47.
    await putSamples([
      ...Array.from({ length: 20 }, (_, i) => ({
        metric: "hr",
        t: at(`${DATE}T0${1 + (i % 5)}:${10 + i}:00`),
        v: 48,
      })),
      { metric: "hr", t: at(`${DATE}T10:00:00`), v: 95 },
      { metric: "hr", t: at(`${DATE}T11:00:00`), v: 98 },
    ]);
    const out = await rollupsForDate(DATE);
    expect(out.restingHr).toBeLessThan(60);
  });
});
