import { load, persist } from "@/utils/storage";
import { today } from "@/utils/date";
import { exportArchive, importArchive } from "@/utils/sampleDb";

// Canonical backup: one JSON file holding every localStorage key the app owns
// and the whole IndexedDB archive. JSON (not xlsx) is deliberate: lossless
// round-trip with no sheet-mapping layer; see docs/atlas-design.md.
const FORMAT = "atlas-backup";
// **Version 2 (2026-08-12): the v1 file was not a backup.** It held seven keys
// out of the twenty-five the app writes, and touched IndexedDB not at all. What
// it silently lost: `atlas_sessions`, which is every session annotation, every
// duration and start correction, every split and every manual session, all
// hand-entered and none of it reconstructible from the band; the trips; the
// profile; the session types; the strap's pairing key, which cannot be
// recovered without the vendor's app at all; and the entire sample archive,
// rollups and workouts.
//
// That mattered more than it looked. `docs/machine-setup.md` tells you to take
// this export before a risky install, and moving from a debug signing key to a
// release one forces an uninstall, which deletes IndexedDB. The backup would
// have been taken, trusted, and found hollow afterwards.
//
// A v1 file still restores: every key it holds is still a key, and the reader
// only requires the sections it actually finds.
const VERSION = 2;

// key in the backup's data object -> localStorage key.
//
// **Only what a human put there or the app cannot rebuild.** Deliberately
// absent: `atlas_helio_battery`, `atlas_helio_last_sync`, `atlas_summary_native`
// and the connection flags, all of which are caches refilled by the next sync;
// the one-shot migration flags, which describe repairs already done to data that
// is in here anyway; and `atlas_session_types_seeded`, which would suppress the
// seeding a restored-onto-empty device still needs.
const KEYS = {
  checkins: "atlas_checkins",
  habits: "atlas_habits",
  habitTicks: "atlas_habit_ticks",
  foodLibrary: "atlas_food_library",
  foodSchedule: "atlas_food_schedule",
  foodDayplans: "atlas_food_dayplans",
  theme: "atlas_theme",
  // All of these were missing from v1.
  profile: "atlas_profile",
  sessions: "atlas_sessions",
  sessionTypes: "atlas_session_types",
  trips: "atlas_trips",
  alarm: "atlas_helio_alarm",
  showAllVitals: "atlas_show_all_vitals",
  // **The only value in Atlas that cannot be recovered from the device or the
  // band.** It is issued by the vendor during account binding and there is no
  // way to read it back off the strap, so an uninstall without it in hand means
  // going through the extraction again. It being here does mean the export file
  // holds a secret, which is why the export button says so.
  helioAuthKey: "atlas_helio_authkey",
};

async function buildBackup() {
  // null for never-written keys (e.g. theme before first change) - applyBackup
  // skips nulls, so a round-trip reproduces localStorage exactly
  const data = {};
  for (const [name, key] of Object.entries(KEYS)) {
    data[name] = load(key, null);
  }
  let archive = null;
  try {
    archive = await exportArchive();
  } catch (e) {
    // A localStorage-only backup is still worth having, but it must not claim
    // to be more than it is. The caller reports this rather than writing a file
    // that looks complete.
    console.warn("archive export failed:", e);
  }
  return { format: FORMAT, version: VERSION, exportedAt: today(), data, archive };
}

// Returns null if valid, otherwise a human-readable reason the file was
// rejected. Shape checks are deliberately structural (arrays are arrays,
// schedule has its 7 weekday arrays) rather than per-field - a backup this
// app wrote will always pass; the goal is catching wrong/corrupt files.
function validateBackup(obj) {
  if (!obj || typeof obj !== "object") return "Not a JSON object";
  if (obj.format !== FORMAT) return "Not an Atlas backup file";
  if (obj.version > VERSION)
    return `Backup version ${obj.version} is newer than this app understands`;
  if (!obj.data || typeof obj.data !== "object") return "Missing data section";
  const d = obj.data;
  for (const name of ["checkins", "habits", "habitTicks", "foodLibrary", "foodDayplans"]) {
    if (d[name] != null && !Array.isArray(d[name]))
      return `Section "${name}" is not a list`;
  }
  if (d.foodSchedule != null) {
    if (typeof d.foodSchedule !== "object") return "Schedule section malformed";
    for (let wd = 0; wd < 7; wd++) {
      if (d.foodSchedule[wd] != null && !Array.isArray(d.foodSchedule[wd]))
        return `Schedule weekday ${wd} is not a list`;
    }
  }
  return null;
}

// Full replace, not merge - this is restore-from-backup semantics. Reloads
// the page afterwards so every Pinia store rehydrates from the new state.
//
// **The archive goes back before the reload and is awaited.** It is tens of
// thousands of records written in chunks, and reloading over the top of it would
// leave a half-restored archive with watermarks from the file, which is the one
// state nothing downstream can detect: the next sync would fetch from the
// watermark and never notice the gap underneath it.
export async function applyBackup(obj) {
  for (const [name, key] of Object.entries(KEYS)) {
    if (obj.data[name] != null) persist(key, obj.data[name]);
  }
  // Absent from a v1 file, and from a v2 whose archive read failed. Restoring
  // the keys alone is still the right thing to do in both cases.
  if (obj.archive) await importArchive(obj.archive);
  location.reload();
}

/**
 * Says whether the archive made it in, because a backup that quietly holds only
 * the localStorage half looks identical to a complete one and is the kind of
 * thing you only discover when you need it.
 */
function archiveNote(backup, ok) {
  if (!backup.archive) return `${ok} · WITHOUT THE ARCHIVE`;
  const n = backup.archive.samples?.length ?? 0;
  return `${ok} · ${n.toLocaleString("en-AU")} READINGS`;
}

// Export: Capacitor Filesystem to Downloads on native Android (same runtime
// detection as road-to-v10's excel.js), browser blob download in dev.
export async function exportBackup() {
  const backup = await buildBackup();
  // Not pretty-printed any more. A year of samples runs to tens of megabytes and
  // two-space indentation on every record was most of it, on a file nothing
  // reads by eye.
  const json = JSON.stringify(backup);
  // Includes a time-of-day suffix (not just the date) so exporting twice in
  // one day never collides with an existing file - Android's scoped storage
  // can reject a write to an already-existing filename outright rather than
  // just overwriting it, which surfaced as a confusing failure previously.
  const timeSuffix = new Date()
    .toTimeString()
    .slice(0, 8)
    .replace(/:/g, "");
  const filename = `atlas-backup-${today()}-${timeSuffix}.json`;

  try {
    const cap = window.Capacitor;
    if (
      cap &&
      cap.isNativePlatform &&
      cap.isNativePlatform() &&
      cap.Plugins?.Filesystem
    ) {
      await cap.Plugins.Filesystem.writeFile({
        path: "Download/" + filename,
        data: json,
        directory: "EXTERNAL_STORAGE",
        encoding: "utf8",
        recursive: true,
      });
      return { ok: true, msg: archiveNote(backup, "SAVED TO DOWNLOADS") };
    }
  } catch (e) {
    // Surface the actual error text - "SEE CONSOLE" is useless on a real
    // device with no devtools attached.
    const reason = e?.message || e?.errorMessage || String(e);
    console.warn("Capacitor FS export failed:", e);
    return { ok: false, msg: `EXPORT FAILED: ${reason}` };
  }

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 1000);
  return { ok: true, msg: archiveNote(backup, "EXPORTED") };
}

// Import: read a picked File (the <input type=file> picker opens Android's
// system file picker inside the Capacitor WebView, so one path serves both
// platforms), validate, and return the parsed backup. Caller confirms with
// the user before calling applyBackup.
export function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      let obj;
      try {
        obj = JSON.parse(e.target.result);
      } catch {
        reject("File is not valid JSON");
        return;
      }
      const problem = validateBackup(obj);
      if (problem) reject(problem);
      else resolve(obj);
    };
    reader.onerror = () => reject("Could not read file");
    reader.readAsText(file);
  });
}
