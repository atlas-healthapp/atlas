import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import {
  putSamples,
  saveRollups,
  putWorkouts,
  setWatermark,
  getSamples,
  loadRollups,
  getWatermark,
  getWorkouts,
  exportArchive,
  importArchive,
  clearAll,
} from "@/utils/sampleDb";

/**
 * The archive half of a backup, which did not exist until 2026-08-12: the export
 * held seven localStorage keys and touched IndexedDB not at all, so the file the
 * setup notes tell you to take before a risky install contained none of the
 * readings, none of the frozen rollups and none of the workouts.
 *
 * These run against `fake-indexeddb` like everything else here, so they prove
 * the shape and not the Android WebView. A real round trip still has to be
 * checked on the phone with `device-eval`.
 */
describe("archive backup", () => {
  beforeEach(async () => {
    await clearAll();
  });

  it("carries samples, rollups, workouts and watermarks", async () => {
    await putSamples([
      { metric: "hr", t: 1000, v: 60 },
      { metric: "hr", t: 2000, v: 62 },
      { metric: "hrv", t: 1000, v: 90 },
    ]);
    await saveRollups("2026-08-01", { hr: 61 });
    await putWorkouts([{ startMillis: 500, endMillis: 900, activeSeconds: 400 }]);
    await setWatermark("helio:hr", 2000);

    const out = await exportArchive();
    expect(out.samples).toHaveLength(3);
    expect(out.rollups).toHaveLength(1);
    expect(out.workouts).toHaveLength(1);
    expect(out.meta.length).toBeGreaterThan(0);
  });

  it("puts an exported archive back exactly as it was", async () => {
    await putSamples([
      { metric: "hr", t: 1000, v: 60 },
      { metric: "steps", t: 1000, v: 400 },
    ]);
    await saveRollups("2026-08-01", { steps: 400 });
    await putWorkouts([{ startMillis: 500, endMillis: 900, activeSeconds: 400 }]);
    await setWatermark("helio:hr", 1000);

    const backup = await exportArchive();
    await clearAll();
    expect(await getSamples("hr", 0, 9999)).toHaveLength(0);

    await importArchive(backup);
    expect(await getSamples("hr", 0, 9999)).toHaveLength(1);
    expect(await getSamples("steps", 0, 9999)).toHaveLength(1);
    expect(await loadRollups("2026-08-01")).toEqual({ steps: 400 });
    expect(await getWatermark("helio:hr")).toBe(1000);
    expect(await getWorkouts(0, 9999)).toHaveLength(1);
  });

  // Replace, not merge, matching applyBackup's own semantics. Merging two
  // archives would leave watermarks describing a history that never happened.
  it("replaces what is there rather than merging into it", async () => {
    await putSamples([{ metric: "hr", t: 1000, v: 60 }]);
    const backup = await exportArchive();

    await putSamples([{ metric: "hr", t: 5000, v: 99 }]);
    expect(await getSamples("hr", 0, 9999)).toHaveLength(2);

    await importArchive(backup);
    const after = await getSamples("hr", 0, 9999);
    expect(after).toHaveLength(1);
    expect(after[0].t).toBe(1000);
  });

  it("writes in chunks without losing any of them", async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      metric: "hr",
      t: 1000 + i,
      v: 60,
    }));
    await putSamples(many);
    const backup = await exportArchive();
    await clearAll();

    await importArchive(backup, { chunk: 40 });
    expect(await getSamples("hr", 0, 99999)).toHaveLength(250);
  });

  // A v1 file has no archive section at all, and restoring one must leave the
  // readings alone rather than wiping them.
  it("does nothing at all when handed no archive", async () => {
    await putSamples([{ metric: "hr", t: 1000, v: 60 }]);
    await importArchive(null);
    expect(await getSamples("hr", 0, 9999)).toHaveLength(1);
  });
});
