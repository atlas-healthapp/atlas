import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";

// `commitWorkouts` had no test at all, and on 2026-08-27 it gained a call to
// `publishWorkoutFloor` that was never imported. That is a ReferenceError, not a
// quiet no-op, and the `.catch()` on the call site cannot catch it because the
// throw happens before there is a promise to catch on.
//
// It stayed hidden because the function returns early unless workouts actually
// arrive, and the workout cursor only ever moved forward, so a routine sync
// usually brought none. Widening the deep fetch to ask a month back is what
// finally delivered a batch, and then it broke every sync: the throw skips the
// lines that record `lastSyncAt` and clear DEEP_FETCH_KEY, so the deep fetch
// stays owed, the next sync asks deep again, gets workouts again, and throws
// again. Reported from the phone as reading 70k samples, saving, then failing.
//
// The lesson this file exists for is smaller than the bug: a fire-and-forget
// call still has to be reachable, and nothing here had ever called it.

const publishWorkoutFloor = vi.fn(async () => true);
vi.mock("@/utils/nativeSummary", () => ({
  publishWorkoutFloor: (...args) => publishWorkoutFloor(...args),
}));

const { commitWorkouts } = await import("@/utils/sampleIngest");

const at = (iso) => new Date(iso).getTime();
const workout = (start, end) => ({ startMillis: at(start), endMillis: at(end) });

describe("commitWorkouts", () => {
  beforeEach(() => {
    publishWorkoutFloor.mockClear();
  });

  it("stores a batch and reports the dates it touched", async () => {
    const dates = await commitWorkouts([
      workout("2026-08-27T18:50:00", "2026-08-27T20:49:00"),
      workout("2026-08-28T09:10:00", "2026-08-28T09:40:00"),
    ]);
    expect([...dates].sort()).toEqual(["2026-08-27", "2026-08-28"]);
  });

  it("publishes the newest start as the announce floor", async () => {
    // The whole point of the call: the background service watermarks what it has
    // announced and cannot see the app's own fetches, so without this a session
    // pulled in by hand is announced half an hour later as news.
    const newest = at("2026-08-28T09:10:00");
    await commitWorkouts([
      workout("2026-08-27T18:50:00", "2026-08-27T20:49:00"),
      workout("2026-08-28T09:10:00", "2026-08-28T09:40:00"),
    ]);
    expect(publishWorkoutFloor).toHaveBeenCalledWith(newest);
  });

  it("does not throw when there is nothing to commit", async () => {
    await expect(commitWorkouts([])).resolves.toEqual(new Set());
    await expect(commitWorkouts(null)).resolves.toEqual(new Set());
    expect(publishWorkoutFloor).not.toHaveBeenCalled();
  });

  // The shape of the outage, stated directly. A sync that cannot finish
  // committing workouts never records itself as done, so it repeats forever.
  it("resolves rather than throwing, so the sync after it can record itself", async () => {
    await expect(
      commitWorkouts([workout("2026-08-28T09:10:00", "2026-08-28T09:40:00")])
    ).resolves.toBeInstanceOf(Set);
  });

  it("survives the floor write failing, which is fire and forget", async () => {
    // A failed native write costs one stale notification. It must never take the
    // sync down with it, which is what the call site's `.catch()` is for.
    publishWorkoutFloor.mockRejectedValueOnce(new Error("no native bridge"));
    await expect(
      commitWorkouts([workout("2026-08-28T09:10:00", "2026-08-28T09:40:00")])
    ).resolves.toBeInstanceOf(Set);
  });
});
