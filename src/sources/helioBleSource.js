// The only module that knows what the native BLE plugin emits. Everything above
// this layer deals in source-agnostic {metric, t, v} samples, exactly as with
// sources/gadgetbridgeSource.js, so the two are interchangeable to the store,
// storage and rollup layers.
//
// Deliberately thin. The protocol knowledge (endpoints, record layouts,
// timestamp rules) lives in the native plugin, because that is where the bytes
// are; this file's whole job is to turn the plugin's output into the shape the
// rest of the app already consumes, and to apply the same plausibility rules
// every other source applies.

import { isMeaningful } from "@/utils/bodyMetrics";
import { decodeSleepSession, decodeNaps } from "@/utils/huamiSleep";

export const SOURCE_ID = "helio-ble";

/**
 * Filter and normalise the raw samples the plugin emits.
 *
 * The plugin already range-checks nothing: it reports what the band said. Every
 * physiological guard is applied here through the shared isMeaningful, so the
 * BLE path and the Gadgetbridge path cannot disagree about what counts as a
 * real reading.
 */
/**
 * The window a reading's timestamp has to fall in to be believed.
 *
 * **Found in the real archive on 2026-08-19: 155 samples dated between 1973 and
 * 2106, every one of them `hrv`, carrying ordinary-looking values.** They are
 * one in eight hundred, so nothing on a screen was visibly wrong - a date that
 * does not exist is simply never read back - but they were stored, frozen into
 * 75 rollup rows for dates like 2105-09-08, and they travel in every backup.
 *
 * The cause is in the HRV record decode rather than here: those records are six
 * bytes with a four-byte timestamp, and some of them plainly are not that. This
 * is the boundary guard, not the fix. It is worth having either way, because a
 * value can be range-checked by `isMeaningful` and a timestamp could not be:
 * `putSamples` is keyed on `[metric, t]`, so a wrong timestamp writes a new row
 * rather than correcting one, and it is permanent.
 *
 * The bounds are deliberately loose. The floor is well before this app existed,
 * so nothing real can fall under it; the ceiling allows a day of clock skew
 * between phone and band rather than pretending they agree to the second.
 */
export const EARLIEST_PLAUSIBLE = Date.parse("2020-01-01T00:00:00Z");
export const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * **The same reading arriving twice is collapsed before it is written.**
 *
 * The band re-sends its whole window on every fetch rather than only what is
 * new, so a night of background syncs leaves the native cache holding heavily
 * overlapping copies of the same readings - one file per run, each covering most
 * of what the last one covered. The drain then handed every row of every file to
 * `putSamples`, which is keyed on `[metric, t]`: the duplicates overwrote each
 * other and the archive came out correct, at the cost of one IndexedDB write per
 * duplicate. That is what the morning's `UPDATING · N%` was mostly spending its
 * time on, and why the figure ran to six digits against an archive of 159k.
 *
 * **Provably not a behaviour change.** The last occurrence of a key wins here,
 * which is what `putSamples` already did by writing them in order and letting
 * the last put stand. So the stored result is identical row for row; only the
 * number of writes changes. Order of the output does not matter downstream -
 * the puts are keyed, the watermark is a max, and the touched dates are a set.
 *
 * This sits in `normaliseSamples` rather than in the drain because both paths
 * come through here, and the sync path has the same overlap in miniature: a
 * fetch that asks for the last N days re-collects everything it collected an
 * hour ago.
 */
export function normaliseSamples(raw) {
  // Keyed rather than a list scanned for matches: the input runs to six figures
  // and anything quadratic in it would cost more than the writes it saves.
  const kept = new Map();
  const ceiling = Date.now() + FUTURE_TOLERANCE_MS;
  for (const sample of raw ?? []) {
    if (!sample || typeof sample.t !== "number" || !Number.isFinite(sample.t)) continue;
    if (sample.t < EARLIEST_PLAUSIBLE || sample.t > ceiling) continue;
    const v = typeof sample.v === "number" ? sample.v : Number(sample.v);
    if (!Number.isFinite(v)) continue;
    if (!isMeaningful(sample.metric, v)) continue;
    kept.set(`${sample.metric}|${sample.t}`, { metric: sample.metric, t: sample.t, v });
  }
  return [...kept.values()];
}

/** base64 (how the plugin ships bytes across the bridge) to a Uint8Array. */
export function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Decode the raw 594-byte sleep blobs. Reuses the same decoder the Gadgetbridge
 * path uses rather than reimplementing those byte offsets, which is both less
 * code and the reason the two paths agreed when compared on real nights.
 */
export function decodeSleepBlobs(blobs) {
  return (blobs ?? []).map((b64) => decodeSleepSession(base64ToBytes(b64))).filter(Boolean);
}

/**
 * The naps carried by those same records, read separately because a nap can
 * outlive its record's night: a day whose only sleep was an afternoon one
 * arrives with an empty night that `decodeSleepBlobs` rightly drops, and the
 * nap would go with it. Flat rather than grouped - `collectNaps` does the
 * grouping, and it has to, since two sources can offer the same nap.
 */
export function decodeNapBlobs(blobs) {
  return (blobs ?? []).flatMap((b64) => decodeNaps(base64ToBytes(b64)));
}

/**
 * Unlike sleep, workouts arrive already decoded (the protobuf reader lives
 * natively - see HuamiProtobuf.java - since there is no JS-side equivalent to
 * defer to the way huamiSleep.js exists for sleep). This is basic shape
 * validation, not a physiological plausibility filter: a missing optional
 * field (no distance on an indoor session) is normal and stays null, only a
 * genuinely malformed record - no timestamps, an end before its own start -
 * gets dropped.
 */
export function normaliseWorkouts(raw) {
  const out = [];
  for (const w of raw ?? []) {
    if (!w || typeof w.startMillis !== "number" || typeof w.endMillis !== "number") continue;
    if (w.endMillis <= w.startMillis) continue;
    out.push({
      startMillis: w.startMillis,
      endMillis: w.endMillis,
      typeCode: typeof w.typeCode === "number" ? w.typeCode : null,
      typeAutoDetected: !!w.typeAutoDetected,
      activeSeconds: typeof w.activeSeconds === "number" ? w.activeSeconds : null,
      caloriesKcal: typeof w.caloriesKcal === "number" ? w.caloriesKcal : null,
      hrAvg: typeof w.hrAvg === "number" ? w.hrAvg : null,
      hrMax: typeof w.hrMax === "number" ? w.hrMax : null,
      hrMin: typeof w.hrMin === "number" ? w.hrMin : null,
      distanceMeters: typeof w.distanceMeters === "number" ? w.distanceMeters : null,
      altitudeAvgMeters: typeof w.altitudeAvgMeters === "number" ? w.altitudeAvgMeters : null,
    });
  }
  return out;
}
