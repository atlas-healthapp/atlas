import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  putSamples,
  getSamples,
  getWatermark,
  setWatermark,
  saveRollups,
  loadRollups,
  putWorkouts,
  getWorkouts,
  clearWorkouts,
  newestWorkoutStart,
  clearAll,
  downsampleOlderThan,
} from "@/utils/sampleDb";

beforeEach(async () => {
  await clearAll();
});

describe("putSamples / getSamples", () => {
  it("round-trips samples in ascending timestamp order", async () => {
    await putSamples([
      { metric: "stress", t: 3000, v: 30 },
      { metric: "stress", t: 1000, v: 10 },
      { metric: "stress", t: 2000, v: 20 },
    ]);
    const got = await getSamples("stress", 0, 9999);
    expect(got.map((s) => s.t)).toEqual([1000, 2000, 3000]);
    expect(got.map((s) => s.v)).toEqual([10, 20, 30]);
  });

  it("keeps metrics separate", async () => {
    await putSamples([
      { metric: "stress", t: 1000, v: 10 },
      { metric: "spo2", t: 1000, v: 97 },
    ]);
    const stress = await getSamples("stress", 0, 9999);
    expect(stress).toHaveLength(1);
    expect(stress[0].v).toBe(10);
  });

  it("treats the range as from-inclusive and to-exclusive", async () => {
    await putSamples([
      { metric: "hr", t: 1000, v: 50 },
      { metric: "hr", t: 2000, v: 60 },
      { metric: "hr", t: 3000, v: 70 },
    ]);
    const got = await getSamples("hr", 1000, 3000);
    expect(got.map((s) => s.t)).toEqual([1000, 2000]);
  });

  it("is idempotent - re-importing the same sample does not duplicate it", async () => {
    await putSamples([{ metric: "hr", t: 1000, v: 50 }]);
    await putSamples([{ metric: "hr", t: 1000, v: 50 }]);
    const got = await getSamples("hr", 0, 9999);
    expect(got).toHaveLength(1);
  });

  it("returns the number written", async () => {
    const n = await putSamples([
      { metric: "hr", t: 1000, v: 50 },
      { metric: "hr", t: 2000, v: 60 },
    ]);
    expect(n).toBe(2);
  });

  it("returns an empty array for a metric with no data", async () => {
    expect(await getSamples("pai", 0, 9999)).toEqual([]);
  });

  it("returns an empty array for an equal from/to range instead of throwing", async () => {
    await putSamples([{ metric: "hr", t: 1000, v: 50 }]);
    // IDBKeyRange.bound throws DataError when the lower and upper bounds are
    // equal and the upper bound is exclusive - fromMs === toMs hits exactly
    // that case.
    expect(await getSamples("hr", 1000, 1000)).toEqual([]);
  });

  it("returns an empty array for an inverted range instead of throwing", async () => {
    await putSamples([{ metric: "hr", t: 1000, v: 50 }]);
    expect(await getSamples("hr", 2000, 1000)).toEqual([]);
  });
});

describe("watermarks", () => {
  it("returns 0 when never set", async () => {
    expect(await getWatermark("gadgetbridge")).toBe(0);
  });

  it("round-trips a value", async () => {
    await setWatermark("gadgetbridge", 1784943061000);
    expect(await getWatermark("gadgetbridge")).toBe(1784943061000);
  });

  it("keeps sources independent", async () => {
    await setWatermark("gadgetbridge", 111);
    await setWatermark("ble", 222);
    expect(await getWatermark("gadgetbridge")).toBe(111);
    expect(await getWatermark("ble")).toBe(222);
  });
});

describe("rollup persistence", () => {
  it("returns null for a date never written", async () => {
    expect(await loadRollups("2026-07-24")).toBeNull();
  });

  it("round-trips a day's rollups", async () => {
    await saveRollups("2026-07-24", { steps: 5704, restingHr: 47 });
    expect(await loadRollups("2026-07-24")).toEqual({
      steps: 5704,
      restingHr: 47,
    });
  });

  it("overwrites on re-save rather than merging", async () => {
    await saveRollups("2026-07-24", { steps: 100, stress: 30 });
    await saveRollups("2026-07-24", { steps: 200 });
    expect(await loadRollups("2026-07-24")).toEqual({ steps: 200 });
  });

  it("keeps dates independent", async () => {
    await saveRollups("2026-07-24", { steps: 100 });
    await saveRollups("2026-07-25", { steps: 200 });
    expect((await loadRollups("2026-07-24")).steps).toBe(100);
    expect((await loadRollups("2026-07-25")).steps).toBe(200);
  });
});

describe("putWorkouts / getWorkouts", () => {
  const workout = (startMillis, overrides = {}) => ({
    startMillis,
    endMillis: startMillis + 3600000,
    typeCode: 223,
    typeAutoDetected: true,
    activeSeconds: 3600,
    caloriesKcal: 400,
    hrAvg: 120,
    hrMax: 160,
    hrMin: 90,
    distanceMeters: null,
    altitudeAvgMeters: null,
    ...overrides,
  });

  it("round-trips workouts in ascending start-time order", async () => {
    await putWorkouts([workout(3000), workout(1000), workout(2000)]);
    const got = await getWorkouts(0, 9999);
    expect(got.map((w) => w.startMillis)).toEqual([1000, 2000, 3000]);
  });

  it("is idempotent - re-fetching the same workout overwrites rather than duplicates", async () => {
    await putWorkouts([workout(1000, { caloriesKcal: 400 })]);
    await putWorkouts([workout(1000, { caloriesKcal: 450 })]);
    const got = await getWorkouts(0, 9999);
    expect(got).toHaveLength(1);
    expect(got[0].caloriesKcal).toBe(450);
  });

  it("treats the range as from-inclusive and to-exclusive, matching getSamples", async () => {
    await putWorkouts([workout(1000), workout(2000), workout(3000)]);
    const got = await getWorkouts(1000, 3000);
    expect(got.map((w) => w.startMillis)).toEqual([1000, 2000]);
  });

  it("preserves null optional fields", async () => {
    await putWorkouts([workout(1000, { distanceMeters: null, altitudeAvgMeters: null })]);
    const [got] = await getWorkouts(0, 9999);
    expect(got.distanceMeters).toBeNull();
    expect(got.altitudeAvgMeters).toBeNull();
  });

  it("returns an empty array for an equal from/to range instead of throwing", async () => {
    await putWorkouts([workout(1000)]);
    expect(await getWorkouts(1000, 1000)).toEqual([]);
  });

  it("newestWorkoutStart returns the latest start time, not the last inserted", async () => {
    await putWorkouts([workout(3000), workout(1000), workout(2000)]);
    expect(await newestWorkoutStart()).toBe(3000);
  });

  it("newestWorkoutStart is 0 with nothing stored, so the fetch falls back to a day window", async () => {
    expect(await newestWorkoutStart()).toBe(0);
  });

  it("clearWorkouts empties the store without touching samples", async () => {
    await putWorkouts([workout(1000), workout(2000)]);
    await putSamples([{ metric: "hr", t: 1000, v: 50 }]);

    await clearWorkouts();

    expect(await getWorkouts(0, 9999)).toEqual([]);
    expect(await getSamples("hr", 0, 9999)).toHaveLength(1);
  });
});

describe("openSampleDb error recovery", () => {
  it("retries indexedDB.open after a failed open instead of caching the rejection", async () => {
    // A fresh module instance gets its own unset module-level dbPromise cache,
    // so the forced first-call failure below actually exercises the open path
    // rather than returning an already-cached db from an earlier test.
    vi.resetModules();
    const mod = await import("@/utils/sampleDb");

    const realOpen = indexedDB.open.bind(indexedDB);
    const openSpy = vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
      const fakeReq = {};
      queueMicrotask(() => {
        fakeReq.error = new Error("forced failure");
        fakeReq.onerror?.();
      });
      return fakeReq;
    });

    await expect(mod.openSampleDb()).rejects.toThrow("forced failure");
    expect(openSpy).toHaveBeenCalledTimes(1);

    // Let the second call through to the real implementation. If the cache
    // wasn't cleared on failure, this would never reach indexedDB.open again
    // and the call count below would still read 1.
    openSpy.mockImplementation((...args) => realOpen(...args));
    const db = await mod.openSampleDb();
    expect(db).toBeTruthy();
    expect(openSpy).toHaveBeenCalledTimes(2);

    openSpy.mockRestore();
  });
});

describe("downsampleOlderThan", () => {
  const BUCKET = 900000; // 15 minutes

  it("averages old samples into one per bucket", async () => {
    // three samples inside a single 15-minute bucket starting at 0
    await putSamples([
      { metric: "stress", t: 0, v: 10 },
      { metric: "stress", t: 60000, v: 20 },
      { metric: "stress", t: 120000, v: 30 },
    ]);
    const res = await downsampleOlderThan("stress", BUCKET, BUCKET);
    expect(res.removed).toBe(3);
    expect(res.written).toBe(1);

    const got = await getSamples("stress", 0, BUCKET * 2);
    expect(got).toHaveLength(1);
    expect(got[0].t).toBe(0);
    expect(got[0].v).toBe(20);
  });

  it("separates samples into distinct buckets", async () => {
    await putSamples([
      { metric: "stress", t: 0, v: 10 },
      { metric: "stress", t: BUCKET + 1000, v: 40 },
    ]);
    await downsampleOlderThan("stress", BUCKET * 5, BUCKET);
    const got = await getSamples("stress", 0, BUCKET * 5);
    expect(got.map((s) => s.t)).toEqual([0, BUCKET]);
    expect(got.map((s) => s.v)).toEqual([10, 40]);
  });

  it("leaves samples newer than the cutoff untouched", async () => {
    await putSamples([
      { metric: "stress", t: 0, v: 10 },
      { metric: "stress", t: 60000, v: 20 },
      { metric: "stress", t: BUCKET * 10, v: 99 },
    ]);
    await downsampleOlderThan("stress", BUCKET, BUCKET);
    const recent = await getSamples("stress", BUCKET * 10, BUCKET * 11);
    expect(recent).toHaveLength(1);
    expect(recent[0].v).toBe(99);
  });

  it("is a no-op when nothing is older than the cutoff", async () => {
    await putSamples([{ metric: "stress", t: BUCKET * 10, v: 50 }]);
    const res = await downsampleOlderThan("stress", BUCKET, BUCKET);
    expect(res).toEqual({ removed: 0, written: 0 });
  });

  it("is idempotent - running twice does not change already-bucketed data", async () => {
    await putSamples([
      { metric: "stress", t: 0, v: 10 },
      { metric: "stress", t: 60000, v: 20 },
    ]);
    await downsampleOlderThan("stress", BUCKET, BUCKET);
    const first = await getSamples("stress", 0, BUCKET);
    await downsampleOlderThan("stress", BUCKET, BUCKET);
    const second = await getSamples("stress", 0, BUCKET);
    expect(second).toEqual(first);
  });
});
