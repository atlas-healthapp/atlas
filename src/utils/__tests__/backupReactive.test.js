import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, isReactive, isProxy } from "vue";

/**
 * **The one bug in Atlas that the test suite is structurally unable to see.**
 *
 * `SettingsPage` held the parsed backup in a plain `ref`, which makes it deeply
 * reactive, so every row inside `archive.samples` came out of it as a Vue Proxy.
 * IndexedDB stores values with the structured clone algorithm, and structured
 * clone refuses a Proxy: `store.put(row)` threw "Failed to execute 'put' on
 * 'IDBObjectStore': ... could not be cloned" and the restore died on the first
 * chunk of the first store.
 *
 * Every test here uses `fake-indexeddb`, which does not implement structured
 * clone, so a proxy goes straight through it and a round-trip test passes. That
 * is exactly what happened: the archive restore shipped on 2026-08-12, passed
 * its tests, and had never once worked on a real phone when it was first
 * genuinely needed on 2026-08-13.
 *
 * So this does not test the write. It tests the property the write depends on:
 * whatever `applyBackup` hands to storage must not be reactive. That is
 * checkable in node, and it fails without the `toRaw` in `applyBackup`.
 */

const importArchive = vi.fn(async () => ({ written: 0 }));
const persist = vi.fn();

vi.mock("@/utils/sampleDb", () => ({
  importArchive: (...args) => importArchive(...args),
  exportArchive: async () => ({ samples: [], meta: [], rollups: [], workouts: [] }),
}));
vi.mock("@/utils/storage", () => ({
  persist: (...args) => persist(...args),
  load: () => null,
}));

const { applyBackup } = await import("@/utils/backup");

function makeBackup() {
  return {
    format: "atlas-backup",
    version: 2,
    exportedAt: "2026-08-13",
    data: {
      checkins: [{ date: "2026-08-13", weight: 80 }],
      goals: { protein: { enabled: true, value: 160 } },
    },
    archive: {
      samples: [{ metric: "hr", t: 1000, v: 60 }],
      meta: [{ id: "watermark:helio:hr", t: 1000 }],
      rollups: [{ date: "2026-08-13", values: { hr: 60 } }],
      workouts: [{ startMillis: 1, endMillis: 2 }],
    },
  };
}

describe("applyBackup unwraps reactivity before storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // applyBackup ends with location.reload(), which jsdom-less node has not
    // got. Stubbed so the function can run to completion.
    globalThis.location = { reload: () => {} };
  });

  it("hands importArchive a raw archive when the caller held a deep ref", async () => {
    // Exactly what SettingsPage used to do: assign the parsed file to a ref.
    const pending = ref(makeBackup());
    expect(isReactive(pending.value)).toBe(true);
    expect(isProxy(pending.value.archive.samples[0])).toBe(true);

    await applyBackup(pending.value);

    const passed = importArchive.mock.calls[0][0];
    expect(isProxy(passed)).toBe(false);
    expect(isProxy(passed.samples)).toBe(false);
    // The rows themselves are what `store.put` receives, and they are what the
    // real WebView rejected.
    for (const row of passed.samples) expect(isProxy(row)).toBe(false);
    for (const row of passed.rollups) {
      expect(isProxy(row)).toBe(false);
      expect(isProxy(row.values)).toBe(false);
    }
    for (const row of passed.workouts) expect(isProxy(row)).toBe(false);
    for (const row of passed.meta) expect(isProxy(row)).toBe(false);
  });

  it("hands persist raw values too", async () => {
    const pending = ref(makeBackup());
    await applyBackup(pending.value);

    expect(persist).toHaveBeenCalled();
    for (const [, value] of persist.mock.calls) {
      expect(isProxy(value)).toBe(false);
    }
  });

  it("still restores an ordinary non-reactive object", async () => {
    await applyBackup(makeBackup());
    expect(importArchive).toHaveBeenCalledTimes(1);
    expect(importArchive.mock.calls[0][0].samples).toHaveLength(1);
  });

  it("does not call importArchive for a v1 file with no archive", async () => {
    const v1 = makeBackup();
    delete v1.archive;
    await applyBackup(v1);
    expect(importArchive).not.toHaveBeenCalled();
    // The keys still go back, which is the whole point of accepting a v1 file.
    expect(persist).toHaveBeenCalled();
  });
});
