// Decodes the binary DATA blob stored in Gadgetbridge's HUAMI_SLEEP_SESSION_SAMPLE
// table, verified byte-for-byte against Gadgetbridge's own
// HuamiSleepSessionSampleProvider.java against real data from the user's
// Amazfit Helio Strap. Sleep-start/end minutes are anchored to the midnight
// BEFORE the stored `timestampMidnight` field (i.e. `timestampMidnight - 24h`),
// not `timestampMidnight` itself - source confirmed, not a guess.

const OFFSETS = {
  sessionTimestamp: 0x00,
  midnightTimestamp: 0x04,
  sleepStartMin: 0x0a,
  sleepEndMin: 0x0c,
  avgHr: 0x15,
  score: 0x16,
  totalRemMin: 0x24a,
  totalLightMin: 0x24c,
  totalDeepMin: 0x24e,
  totalWakeMin: 0x250,
};
const MIN_BLOB_LENGTH = 0x252;

// The stage timeline, verified against four real nights on 2026-07-28 (see
// "The spike" in docs/superpowers/specs/2026-07-28-home-redesign-design.md).
// A count byte at 0x54, then that many 5-byte tuples from 0x56: start minute,
// inclusive end minute, stage code. Minutes are absolute, in the same domain
// as sleepStartMin.
const SEGMENT_COUNT_OFFSET = 0x54;
const SEGMENT_START_OFFSET = 0x56;
const SEGMENT_BYTES = 5;
const STAGE_CODES = { 4: "light", 5: "deep", 7: "awake", 8: "rem" };

// Only four nights were ever sampled, so an unobserved fifth code is possible
// and the trailing bytes past the declared count are known to parse as
// plausible-looking garbage. Rather than trust the decode, it is checked
// against the footer totals at 0x24a-0x250, which are stored independently by
// the device. Any disagreement means the layout assumption has broken, and a
// wrong sleep timeline is worse than none: return null and let the caller
// fall back to the totals.
function decodeStageTimeline(bytes, view, sleepStartMin, footerTotals) {
  const count = view.getUint8(SEGMENT_COUNT_OFFSET);
  if (count === 0) return null;

  const end = SEGMENT_START_OFFSET + count * SEGMENT_BYTES;
  if (end > bytes.length) return null;

  const runs = [];
  const summed = { rem: 0, light: 0, deep: 0, awake: 0 };
  for (let i = 0; i < count; i++) {
    const at = SEGMENT_START_OFFSET + i * SEGMENT_BYTES;
    const startMin = view.getUint16(at, true);
    const endMin = view.getUint16(at + 2, true);
    const stage = STAGE_CODES[view.getUint8(at + 4)];
    if (!stage || endMin < startMin) return null;
    const minutes = endMin - startMin + 1;
    summed[stage] += minutes;
    runs.push({ stage, startMinute: startMin - sleepStartMin, minutes });
  }

  // The segments are returned even when they do not add up to the footer totals.
  //
  // They used to be discarded outright on any disagreement, and the cost of that
  // was measured on 2026-08-10: the band handed over a revision of the night
  // whose segments were a few minutes out, so Atlas drew no hypnogram and no
  // clock axis at all while Zepp drew both. The user's call, and the right one -
  // "I would rather have the zones in even if they're slightly not accurate, it
  // feels very bad to not show them."
  //
  // What is still rejected above is corruption rather than disagreement: no
  // segments, a segment running past the end of the blob, an unknown stage code,
  // or one that ends before it starts. Those produce nonsense rather than an
  // approximation.
  //
  // The totals remain the authority for anything that counts minutes, because
  // they are what the band scored the night on. `stageMinutes()` already
  // reconciles the two, which is why the sheet can draw these segments and still
  // report the stored totals without contradicting itself.
  return runs;
}

// bytes: Uint8Array. Returns null for blobs too short/malformed to trust
// (e.g. a still-forming session synced before the device finished computing
// it - seen in practice as an all-zero/garbage row in real exports).
export function decodeSleepSession(bytes) {
  if (!bytes || bytes.length < MIN_BLOB_LENGTH) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const midnightTs = view.getUint32(OFFSETS.midnightTimestamp, true);
  const sleepStartMin = view.getUint16(OFFSETS.sleepStartMin, true);
  const sleepEndMin = view.getUint16(OFFSETS.sleepEndMin, true);
  const remMin = view.getUint16(OFFSETS.totalRemMin, true);
  const lightMin = view.getUint16(OFFSETS.totalLightMin, true);
  const deepMin = view.getUint16(OFFSETS.totalDeepMin, true);
  const wakeMin = view.getUint16(OFFSETS.totalWakeMin, true);
  const totalSleepMin = remMin + lightMin + deepMin;

  if (totalSleepMin === 0 || sleepEndMin <= sleepStartMin) return null;

  const dayBase = midnightTs - 24 * 3600;
  const bedTime = new Date((dayBase + sleepStartMin * 60) * 1000);
  const wakeTime = new Date((dayBase + sleepEndMin * 60) * 1000);

  const stageTimeline = decodeStageTimeline(bytes, view, sleepStartMin, {
    rem: remMin,
    light: lightMin,
    deep: deepMin,
    wake: wakeMin,
  });

  return {
    bedTime,
    wakeTime,
    totalSleepMinutes: totalSleepMin,
    remMinutes: remMin,
    lightMinutes: lightMin,
    deepMinutes: deepMin,
    wakeMinutes: wakeMin,
    avgHr: view.getUint8(OFFSETS.avgHr),
    score: view.getUint8(OFFSETS.score),
    stageTimeline,
  };
}

// Exact hours, to the minute. This used to snap to the nearest quarter hour, a
// convention inherited from when sleep was typed in by hand as a rough estimate.
// The device reports to the minute, so rounding only introduced error: a real
// 8h23m session displayed as 8H30, seven minutes adrift from what Zepp showed.
// Already-stored values keep their old rounded figure until the next sync
// overwrites that date.
export function sleepMinutesToHours(totalMinutes) {
  return totalMinutes / 60;
}
