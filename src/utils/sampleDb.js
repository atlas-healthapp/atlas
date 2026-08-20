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

/**
 * How many samples go in one transaction. Small enough that the gap between
 * batches lands within a frame, large enough that the per-transaction overhead
 * stays negligible against the puts themselves.
 */
const PUT_CHUNK = 2000;

/**
 * Hand the thread back long enough for the browser to paint.
 *
 * An awaited IndexedDB transaction already yields, but only to the task queue,
 * and a run of back-to-back transactions can starve rendering for as long as it
 * lasts. A timeout is a fresh task the compositor can get in front of.
 */
function yieldToPaint() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * **Chunked, and the chunking is not an optimisation.**
 *
 * This was one transaction wrapping a single tight loop over every sample. A
 * first connect hands it tens of thousands of readings, and that loop is
 * synchronous main-thread work: the WebView stops painting and
 * requestAnimationFrame stops firing for the whole of it. That is what froze
 * Home's boot mid-sequence (the dials had arrived, the cards had not, and the
 * clock driving them is a rAF loop) and what made a first connect look hung
 * after it said SAVING.
 *
 * **A partial write is already safe, which is what licenses the split.** Samples
 * are keyed [metric, t], so replaying one is an overwrite rather than a
 * duplicate, and `ingestSamples` only advances the watermark once the rollups
 * behind them are frozen. An interrupted run is therefore re-imported by the
 * next sync, not lost.
 *
 * @param onProgress optional, called with (done, total) after each batch.
 */
export async function putSamples(samples, onProgress) {
  if (!samples || samples.length === 0) return 0;
  const db = await openSampleDb();
  for (let start = 0; start < samples.length; start += PUT_CHUNK) {
    const batch = samples.slice(start, start + PUT_CHUNK);
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(SAMPLES, "readwrite");
      const store = transaction.objectStore(SAMPLES);
      for (const s of batch) store.put(s);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    onProgress?.(start + batch.length, samples.length);
    await yieldToPaint();
  }
  return samples.length;
}

/**
 * Delete samples and frozen rollups whose timestamps cannot be real.
 *
 * **Written as a migration every install runs, not as a repair of one phone.**
 * The archive that turned this up held 155 of them out of 123,666, all `hrv`,
 * dated between 1973 and 2106, which had frozen 75 rollup rows for dates like
 * 2105-09-08. Anybody who has synced this app before the ingest guard landed has
 * some, in whatever number their own strap produced, and none of them can ever
 * be read back: a date that does not exist is never asked for.
 *
 * What it removes is defined by the same window the ingest guard uses, so the
 * two cannot disagree about what counts as junk. Nothing inside that window is
 * touched however odd it looks: a reading being surprising is not evidence it is
 * wrong, and this is the one operation here that cannot be undone.
 *
 * Returns what it removed, so the caller can record it rather than delete
 * silently.
 */
export async function purgeImplausible(fromMs, toMs) {
  const db = await openSampleDb();

  const samples = await done(tx(db, SAMPLES, "readonly").getAll());
  const doomed = samples.filter((s) => !(s.t >= fromMs && s.t <= toMs));
  if (doomed.length) {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(SAMPLES, "readwrite");
      const store = transaction.objectStore(SAMPLES);
      for (const s of doomed) store.delete([s.metric, s.t]);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // A rollup is keyed by date rather than by timestamp, so it is judged by the
  // day it claims to describe.
  const from = new Date(fromMs).toLocaleDateString("sv");
  const to = new Date(toMs).toLocaleDateString("sv");
  const rollups = await done(tx(db, ROLLUPS, "readonly").getAll());
  const badDates = rollups.filter((r) => r.date < from || r.date > to).map((r) => r.date);
  if (badDates.length) {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(ROLLUPS, "readwrite");
      const store = transaction.objectStore(ROLLUPS);
      for (const date of badDates) store.delete(date);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  return { samples: doomed.length, rollups: badDates.length };
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
    // `exact` records whether a sample already sits on the bucket boundary,
    // which together with a count of one is the signature of an earlier run's
    // own output. Tracked while bucketing rather than derived after, since the
    // originals are not kept per bucket.
    const bucket = buckets.get(key) ?? { total: 0, count: 0, exact: new Set() };
    bucket.total += s.v;
    bucket.count += 1;
    if (s.t === key) bucket.exact.add(key);
    buckets.set(key, bucket);
  }

  // **Only the buckets that are not already collapsed.** A bucket holding one
  // sample sitting exactly on its own boundary is the output of a previous run,
  // and rewriting it produces byte-identical data. This ran over every sample
  // older than the window on *every* sync, thirty minutes apart, deleting and
  // re-putting the entire back catalogue to arrive where it started - which is
  // both halves of the deferred perf ticket's second sentence. In the steady
  // state the only dirty buckets are the ones belonging to the day that has just
  // aged out, so this now writes a few dozen rows instead of the whole archive.
  const dirty = [...buckets.entries()].filter(
    ([t, b]) => b.count > 1 || !b.exact.has(t)
  );
  if (dirty.length === 0) return { removed: 0, written: 0 };

  const dirtyKeys = new Set(dirty.map(([t]) => t));
  const stale = old.filter((s) => dirtyKeys.has(Math.floor(s.t / bucketMs) * bucketMs));
  const collapsed = dirty.map(([t, b]) => ({
    metric,
    t,
    v: Math.round((b.total / b.count) * 10) / 10,
  }));

  const db = await openSampleDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(SAMPLES, "readwrite");
    const store = transaction.objectStore(SAMPLES);
    for (const s of stale) store.delete([metric, s.t]);
    for (const s of collapsed) store.put(s);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });

  return { removed: stale.length, written: collapsed.length };
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
 * How many readings the archive holds.
 *
 * **`count()` rather than `getAll().length`**, which is the whole reason this can
 * sit on a settings row: IndexedDB counts a store without materialising it, while
 * `exportArchive` above reads every row and is measured in tens of megabytes on
 * this phone. One is a number, the other is a stall.
 *
 * Exists so the backup row can say what it is about to hand you. A row that can
 * lose 97,000 readings and says nothing invites the tap that loses them.
 */
export async function countSamples() {
  const db = await openSampleDb();
  return done(tx(db, SAMPLES, "readonly").count());
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
