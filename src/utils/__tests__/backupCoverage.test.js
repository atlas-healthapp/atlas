import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { fileURLToPath, URL } from "node:url";
import { join } from "path";

/**
 * **Does the backup carry everything the app writes?**
 *
 * Read on its own, `KEYS` in `backup.js` looks complete: it is a tidy list with
 * a comment explaining what is deliberately left out. It was not complete. A
 * census of the real phone on 2026-08-13, taken while planning the package
 * migration, found `atlas_goals` on the device and absent from the list - the
 * eight daily targets, chosen by hand, silently dropped by a restore. Both it
 * and `atlas_home_layout` shipped on 2026-08-12, the same day as the backup
 * rewrite, and both were missed by the same reading.
 *
 * So this does not read the list. It reads **the source**, finds every
 * `atlas_*` key any file writes, and requires each one to be a deliberate
 * decision: either carried by the backup, or named below with a reason. Adding
 * a new key now fails this test until somebody chooses.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const BACKUP = fileURLToPath(new URL("../backup.js", import.meta.url));

/**
 * Keys a restore must NOT carry, each with the reason it is safe to lose.
 *
 * The rule is narrow: a key is excludable when the next sync or launch rebuilds
 * it correctly from data the backup does carry. A migration flag gating a
 * *destructive* repair fails that test and is not in here - see
 * `workoutTzFixed` in backup.js.
 */
const DELIBERATELY_EXCLUDED = {
  atlas_helio_connected: "refilled by reconnecting; the auth key is carried",
  atlas_helio_last_sync: "cache, refilled by the next sync",
  atlas_helio_battery: "cache, refilled by the next sync",
  atlas_summary_native: "a mirror of state that is carried",
  atlas_gadgetbridge_connected: "dead key, the relay was retired 2026-08-12",
  atlas_session_types_seeded: "dead key, seeding was replaced by suggestions",
  atlas_helio_deep_fetch_version: "re-asking deep is slow, never wrong",
  atlas_hr_rollup_backfill_2026_08_06: "additive repair, safe to re-run",
  atlas_theme_native: "written natively for the launch screen, mirrors atlas_theme",
  atlas_tour_seen: "a tour replaying once is not data loss",
  atlas_settings_intro_seen: "as above, for the settings explainer",
};

/**
 * Not a localStorage key at all: it is the IndexedDB database name, and the
 * archive inside it is carried wholesale by `exportArchive`. Filtered in the
 * scan rather than excused in the list above, which is about keys.
 */
const NOT_A_KEY = new Set(["atlas_samples"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__" || entry === "dev") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(js|vue)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("backup coverage", () => {
  const carried = new Set();
  for (const match of readFileSync(BACKUP, "utf8").matchAll(/"(atlas_[a-z0-9_]+)"/g)) {
    carried.add(match[1]);
  }

  const found = new Map();
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/["'`](atlas_[a-z0-9_]+)["'`]/g)) {
      if (NOT_A_KEY.has(match[1])) continue;
      if (!found.has(match[1])) found.set(match[1], []);
      found.get(match[1]).push(file.slice(SRC.length));
    }
  }

  it("finds the keys at all, so a broken scan cannot pass by finding nothing", () => {
    expect(found.size).toBeGreaterThan(10);
    expect(found.has("atlas_checkins")).toBe(true);
  });

  it("carries every key that is not deliberately excluded", () => {
    const orphans = [...found.keys()]
      .filter((key) => !carried.has(key))
      .filter((key) => !(key in DELIBERATELY_EXCLUDED))
      .map((key) => `${key} (written by ${found.get(key)[0]})`);

    // Named in the failure rather than just counted: the point of this test is
    // to tell whoever added a key what they have to decide about it.
    expect(orphans).toEqual([]);
  });

  it("has no stale exclusions for keys nothing writes any more", () => {
    // A reason left behind for a key that no longer exists is a reason nobody
    // will re-read, and it makes the list above look more considered than it is.
    // The dead keys are listed on purpose and say so: they are still on real
    // phones, so a census of a device will keep turning them up even though the
    // source no longer mentions them.
    const stale = Object.keys(DELIBERATELY_EXCLUDED).filter(
      (key) => !found.has(key) && !DELIBERATELY_EXCLUDED[key].startsWith("dead key")
    );
    expect(stale).toEqual([]);
  });

  it("carries the destructive migration flag, and only that one", () => {
    // `migrateWorkoutTimezoneFix` calls clearWorkouts(). Without its flag in the
    // file, a restore puts the workouts back and the first launch after
    // reconnecting deletes every one of them, orphaning the session annotations
    // joined to them on startMillis - which are hand-entered and cannot be
    // refetched from the band.
    expect(carried.has("atlas_helio_workout_tz_fixed_2026_07_28")).toBe(true);
  });
});
