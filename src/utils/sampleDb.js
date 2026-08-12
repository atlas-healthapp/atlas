// Atlas's own sample storage. Deliberately source-agnostic: nothing in this
// file knows where samples came from, so swapping the current file-relay
// sync source for direct BLE later touches only the source adapter.
//
// localStorage is not an option here - 30 days of granular samples is roughly
// 3MB against a 5-10MB cap shared with everything else Atlas stores.

const DB_NAME = "atlas_samples";
const DB_VERSION = 2;
const SAMPLES = "samples";
const META = "meta";
const ROLLUPS = "rollups";
const WORKOUTS = "workouts";

let dbPromise = null;

export function openSampleDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SAMPLES)) {
        // Keyed on [metric, t] so re-importing an already-seen sample
        // overwrites rather than duplicating.
        db.createObjectStore(SAMPLES, { keyPath: ["metric", "t"] });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "id" });
      }
      // Daily rollups are frozen at sync time and kept forever. They cannot be
      // recomputed later because downsampling destroys the resolution a sum
      // needs.
      if (!db.objectStoreNames.contains(ROLLUPS)) {
        db.createObjectStore(ROLLUPS, { keyPath: "date" });
      }
      // Keyed on startMillis alone (not [startMillis, endMillis] like samples'
      // [metric, t]): two workouts starting at the same instant would be a real
      // data anomaly worth colliding on, not two legitimate entries.
      if (!db.objectStoreNames.contains(WORKOUTS)) {
        db.createObjectStore(WORKOUTS, { keyPath: "startMillis" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      // Clear the cache on failure only, so a later call retries the open
      // instead of replaying the same rejected promise for the rest of the
      // session. A successful open is left cached, since that promise is
      // the shared handle every other function in this file awaits.
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putSamples(samples) {
  if (!samples || samples.length === 0) return 0;
  const db = await openSampleDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SAMPLES, "readwrite");
    const store = transaction.objectStore(SAMPLES);
    for (const s of samples) store.put(s);
    transaction.oncomplete = () => resolve(samples.length);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getSamples(metric, fromMs, toMs) {
  // IDBKeyRange.bound throws DataError for an exclusive-upper range whose
  // bounds are equal or inverted (toMs <= fromMs), rather than just matching
  // nothing - guard it here so an empty/inverted window is a normal empty
  // result instead of an uncaught exception.
  if (toMs <= fromMs) return [];
  const db = await openSampleDb();
  const store = tx(db, SAMPLES, "readonly");
  // Upper bound is exclusive so callers can pass the next day's midnight.
  const range = IDBKeyRange.bound([metric, fromMs], [metric, toMs], false, true);
  return done(store.getAll(range));
}

export async function getWatermark(sourceId) {
  const db = await openSampleDb();
  const row = await done(tx(db, META, "readonly").get(`watermark:${sourceId}`));
  return row?.t ?? 0;
}

export async function setWatermark(sourceId, t) {
  const db = await openSampleDb();
  const store = tx(db, META, "readwrite");
  await done(store.put({ id: `watermark:${sourceId}`, t }));
}

/** Upserts by startMillis - a re-fetched workout overwrites rather than duplicates. */
export async function putWorkouts(workouts) {
  if (!workouts || workouts.length === 0) return 0;
  const db = await openSampleDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(WORKOUTS, "readwrite");
    const store = transaction.objectStore(WORKOUTS);
    for (const w of workouts) store.put(w);
    transaction.oncomplete = () => resolve(workouts.length);
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * Start time of the newest workout held, or 0 when there are none.
 *
 * The BLE fetch needs this as a cursor. Workouts are not fetched by window the
 * way samples are: the band returns the earliest session at or after the date
 * it is asked for, so asking for "the last 3 days" lands on a session already
 * stored and never advances past it.
 */
export async function newestWorkoutStart() {
  const db = await openSampleDb();
  const store = tx(db, WORKOUTS, "readonly");
  const cursor = await done(store.openCursor(null, "prev"));
  return cursor?.key ?? 0;
}

export async function getWorkouts(fromMs, toMs) {
  if (toMs <= fromMs) return [];
  const db = await openSampleDb();
  const store = tx(db, WORKOUTS, "readonly");
  const range = IDBKeyRange.bound(fromMs, toMs, false, true);
  return done(store.getAll(range));
}

/**
 * Scoped to just the workouts store, unlike clearAll(): a one-time migration
 * (see helio.js's timezone-fix cleanup) should not also throw away sleep,
 * steps and every other metric's history to fix one store.
 */
export async function clearWorkouts() {
  const db = await openSampleDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(WORKOUTS, "readwrite");
    transaction.objectStore(WORKOUTS).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function saveRollups(dateKey, values) {
  const db = await openSampleDb();
  const store = tx(db, ROLLUPS, "readwrite");
  await done(store.put({ date: dateKey, values }));
}

export async function loadRollups(dateKey) {
  const db = await openSampleDb();
  const row = await done(tx(db, ROLLUPS, "readonly").get(dateKey));
  return row?.values ?? null;
}

// Granular samples are kept at full resolution for a retention window, then
// collapsed to one averaged sample per bucket. At the default 15-minute bucket
// that is roughly a 16x reduction, which keeps the archive at a few MB a year
// instead of tens.
export async function downsampleOlderThan(metric, cutoffMs, bucketMs = 900000) {
  const old = await getSamples(metric, 0, cutoffMs);
  if (old.length === 0) return { removed: 0, written: 0 };

  const buckets = new Map();
  for (const s of old) {
    const key = Math.floor(s.t / bucketMs) * bucketMs;
    const bucket = buckets.get(key) ?? { total: 0, count: 0 };
    bucket.total += s.v;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const collapsed = [...buckets.entries()].map(([t, b]) => ({
    metric,
    t,
    v: Math.round((b.total / b.count) * 10) / 10,
  }));

  const db = await openSampleDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(SAMPLES, "readwrite");
    const store = transaction.objectStore(SAMPLES);
    for (const s of old) store.delete([metric, s.t]);
    for (const s of collapsed) store.put(s);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });

  return { removed: old.length, written: collapsed.length };
}

/**
 * Every record in the archive, for a backup.
 *
 * **This exists because the backup did not have it, and that was the single
 * most dangerous gap in the app.** `utils/backup.js` exported seven localStorage
 * keys and nothing at all from here, so the file the setup notes tell you to
 * take before a risky install contained none of the sample archive, none of the
 * frozen rollups and none of the workouts. Moving from a debug signing key to a
 * release one forces an uninstall, and an uninstall takes IndexedDB with it.
 *
 * Returned whole rather than windowed. A backup that quietly dropped anything
 * older than the retention window would be a backup you cannot restore from,
 * which is worse than no backup because you would not know.
 */
export async function exportArchive() {
  const db = await openSampleDb();
  const read = (name) => done(tx(db, name, "readonly").getAll());
  const [samples, meta, rollups, workouts] = await Promise.all([
    read(SAMPLES),
    read(META),
    read(ROLLUPS),
    read(WORKOUTS),
  ]);
  return { samples, meta, rollups, workouts };
}

/**
 * Put an exported archive back, replacing what is there.
 *
 * **Replace, not merge**, matching `applyBackup`'s own semantics: a restore is
 * "make this device look like that file", and merging two archives would leave
 * watermarks describing a history that never happened.
 *
 * Written in chunks because a year of samples is tens of thousands of records
 * and one transaction holding all of them is how a restore fails silently on a
 * phone rather than on a laptop.
 */
export async function importArchive(archive, { chunk = 2000 } = {}) {
  if (!archive || typeof archive !== "object") return { written: 0 };
  await clearAll();
  const db = await openSampleDb();

  let written = 0;
  for (const [name, rows] of [
    [SAMPLES, archive.samples],
    [META, archive.meta],
    [ROLLUPS, archive.rollups],
    [WORKOUTS, archive.workouts],
  ]) {
    const list = Array.isArray(rows) ? rows : [];
    for (let i = 0; i < list.length; i += chunk) {
      const slice = list.slice(i, i + chunk);
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(name, "readwrite");
        const store = transaction.objectStore(name);
        for (const row of slice) store.put(row);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      written += slice.length;
    }
  }
  return { written };
}

export async function clearAll() {
  const db = await openSampleDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([SAMPLES, META, ROLLUPS, WORKOUTS], "readwrite");
    transaction.objectStore(SAMPLES).clear();
    transaction.objectStore(META).clear();
    transaction.objectStore(ROLLUPS).clear();
    transaction.objectStore(WORKOUTS).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}
