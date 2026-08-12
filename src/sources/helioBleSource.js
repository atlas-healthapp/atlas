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
import { decodeSleepSession } from "@/utils/huamiSleep";

export const SOURCE_ID = "helio-ble";

/**
 * Filter and normalise the raw samples the plugin emits.
 *
 * The plugin already range-checks nothing: it reports what the band said. Every
 * physiological guard is applied here through the shared isMeaningful, so the
 * BLE path and the Gadgetbridge path cannot disagree about what counts as a
 * real reading.
 */
export function normaliseSamples(raw) {
  const out = [];
  for (const sample of raw ?? []) {
    if (!sample || typeof sample.t !== "number") continue;
    const v = typeof sample.v === "number" ? sample.v : Number(sample.v);
    if (!Number.isFinite(v)) continue;
    if (!isMeaningful(sample.metric, v)) continue;
    out.push({ metric: sample.metric, t: sample.t, v });
  }
  return out;
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
