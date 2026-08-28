import { describe, it, expect } from "vitest";
import { normaliseWorkouts, normaliseSamples } from "@/sources/helioBleSource";

describe("normaliseWorkouts", () => {
  const raw = (overrides = {}) => ({
    startMillis: 1000,
    endMillis: 2000,
    typeCode: 223,
    typeAutoDetected: true,
    activeSeconds: 60,
    caloriesKcal: 10,
    hrAvg: 120,
    hrMax: 160,
    hrMin: 90,
    distanceMeters: null,
    altitudeAvgMeters: null,
    ...overrides,
  });

  it("passes through a well-formed workout unchanged", () => {
    expect(normaliseWorkouts([raw()])).toEqual([raw()]);
  });

  it("drops a record with no start time", () => {
    expect(normaliseWorkouts([raw({ startMillis: null })])).toEqual([]);
  });

  it("drops a record whose end is not after its start", () => {
    expect(normaliseWorkouts([raw({ endMillis: 1000 })])).toEqual([]);
    expect(normaliseWorkouts([raw({ endMillis: 500 })])).toEqual([]);
  });

  it("coerces missing optional fields to null rather than leaving them undefined", () => {
    const [got] = normaliseWorkouts([{ startMillis: 1000, endMillis: 2000 }]);
    expect(got.typeCode).toBeNull();
    expect(got.activeSeconds).toBeNull();
    expect(got.caloriesKcal).toBeNull();
    expect(got.hrAvg).toBeNull();
    expect(got.distanceMeters).toBeNull();
    expect(got.altitudeAvgMeters).toBeNull();
    expect(got.typeAutoDetected).toBe(false);
  });

  it("ignores null/undefined entries in the input array", () => {
    expect(normaliseWorkouts([null, undefined, raw()])).toEqual([raw()]);
  });

  it("returns an empty array for no input", () => {
    expect(normaliseWorkouts(undefined)).toEqual([]);
    expect(normaliseWorkouts([])).toEqual([]);
  });
});

describe("normaliseSamples", () => {
  const hrv = (t, v = 90) => ({ metric: "hrv", t, v });
  const now = Date.now();

  it("keeps an ordinary reading", () => {
    expect(normaliseSamples([hrv(now - 3600_000)])).toHaveLength(1);
  });

  it("drops a reading dated before this app could have taken it", () => {
    // Real: the archive held 155 hrv samples dated 1973 to 2106, with ordinary
    // values, which froze 75 rollup rows for dates that do not exist. One in
    // eight hundred, so nothing on screen was visibly wrong - and permanent,
    // because putSamples is keyed on [metric, t] and a wrong timestamp writes a
    // new row rather than correcting one.
    expect(normaliseSamples([hrv(Date.parse("1973-03-11T00:00:00Z"))])).toEqual([]);
    expect(normaliseSamples([hrv(Date.parse("2106-02-07T00:00:00Z"))])).toEqual([]);
  });

  it("allows a day of clock skew between the phone and the band", () => {
    // The two do not agree to the second, and a reading an hour "in the future"
    // is a clock difference rather than a bad decode.
    expect(normaliseSamples([hrv(now + 3600_000)])).toHaveLength(1);
    expect(normaliseSamples([hrv(now + 48 * 3600_000)])).toEqual([]);
  });

  it("judges the junk by its date, not by its value", () => {
    // Measured on the real archive: the 155 bad samples carry ordinary-looking
    // values, and on real dates HRV runs to a maximum of 200 with nothing at or
    // above 250. So there is no value threshold to be had here, and inventing
    // one would throw away readings to catch a fault that the timestamp already
    // identifies exactly.
    expect(normaliseSamples([hrv(now - 60_000, 200)])).toHaveLength(1);
    expect(normaliseSamples([hrv(Date.parse("2105-09-08T00:00:00Z"), 255)])).toEqual([]);
  });

  it("survives rubbish", () => {
    expect(normaliseSamples([null, {}, { metric: "hrv", t: NaN, v: 90 }])).toEqual([]);
    expect(normaliseSamples(undefined)).toEqual([]);
  });
});

// The band re-sends its whole window on every fetch, so a night of background
// syncs leaves the cache holding the same readings many times over. They used to
// be written one by one and overwrite each other in IndexedDB.
describe("normaliseSamples deduplication", () => {
  const t = Date.parse("2026-08-27T09:00:00Z");

  it("writes one row for a reading that arrived twice", () => {
    const out = normaliseSamples([
      { metric: "hr", t, v: 62 },
      { metric: "hr", t, v: 62 },
      { metric: "hr", t, v: 62 },
    ]);
    expect(out).toEqual([{ metric: "hr", t, v: 62 }]);
  });

  it("keeps the same reading on two different metrics", () => {
    // The key is the pair, not the timestamp: a heart rate and a stress reading
    // taken in the same second are two different facts.
    const out = normaliseSamples([
      { metric: "hr", t, v: 62 },
      { metric: "stress", t, v: 30 },
    ]);
    expect(out).toHaveLength(2);
  });

  it("keeps readings a minute apart", () => {
    const out = normaliseSamples([
      { metric: "hr", t, v: 62 },
      { metric: "hr", t: t + 60000, v: 64 },
    ]);
    expect(out).toHaveLength(2);
  });

  // The property that makes this safe to do at all. putSamples wrote every
  // duplicate in order and let the last one stand, so keeping the last is the
  // one choice that cannot change what ends up stored.
  it("keeps the last value when a duplicated key disagrees with itself", () => {
    const out = normaliseSamples([
      { metric: "hr", t, v: 62 },
      { metric: "hr", t, v: 71 },
    ]);
    expect(out).toEqual([{ metric: "hr", t, v: 71 }]);
  });

  it("drops a duplicate that would not have survived the filters anyway", () => {
    const out = normaliseSamples([
      { metric: "hr", t, v: 62 },
      { metric: "hr", t, v: 0 },
    ]);
    expect(out).toEqual([{ metric: "hr", t, v: 62 }]);
  });
});
