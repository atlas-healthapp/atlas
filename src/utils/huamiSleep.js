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

// The nap block, found on 2026-08-18 by dumping the bytes nothing reads rather
// than by looking for another endpoint. Gadgetbridge's own provider does not
// decode this region either, which is why three rounds of work concluded the
// band does not expose naps at all: it does, inside the night record.
//
// A count byte at 0x17, then up to ten 6-byte entries from 0x18: start minute,
// **inclusive** end minute, minutes. 0x18 plus ten entries lands exactly on
// 0x54, where the stage segments begin, which is what makes ten the cap rather
// than a guess - a larger count would decode the hypnogram as naps.
//
// Two things are load-bearing and both are measured, over 28 real records:
//
// - **The end minute is inclusive**, unlike the night's own `sleepEndMin`. The
//   band reported 2494 -> 2611 with 118 minutes while Zepp displayed that same
//   nap as 17:34 to 19:32; 2611 is 19:31. The third field equalled
//   `end - start + 1` on all twelve naps seen, so it is the duration and the
//   band's own figure is the one stored.
// - **The count is at 0x17, not the flag at 0x14.** 0x14 is 1 on every record
//   carrying a nap, which is what makes it tempting, and also 1 on four records
//   whose nap block is empty. One record carried two naps and 0x17 was 2.
const NAP_COUNT_OFFSET = 0x17;
const NAP_START_OFFSET = 0x18;
const NAP_ENTRY_BYTES = 6;
const NAP_SLOTS = (SEGMENT_COUNT_OFFSET - NAP_START_OFFSET) / NAP_ENTRY_BYTES;

// **The segment array is two blocks of fifty, not one of a hundred**, which is
// the thing that hid the nap stages: the night counts from slot 0 at 0x54, and
// a second timeline counts from slot 50 at 0x55. What lives past the night's
// count was written off as "plausible-looking garbage" once; it is this.
//
// The second block is the rest of the day around the night, so it carries each
// nap's own stages with **0x80 segments filling the gaps** between one sleep and
// the next (a real one ran 2129 -> 2731, exactly from the night's end to the
// nap's start). 0x80 is therefore not a stage and is dropped: drawing it would
// colour an afternoon at work as sleep.
//
// Checkable, and checked: on all eleven nap-carrying records the segments inside
// a nap sum to exactly the minutes the nap block declares for it. The night's
// own count reached 50 on one record and never exceeded it, which is what makes
// fifty the block size rather than a guess.
const DAY_SEGMENT_COUNT_OFFSET = 0x55;
const SEGMENTS_PER_BLOCK = 50;
const DAY_SEGMENT_START_OFFSET = SEGMENT_START_OFFSET + SEGMENTS_PER_BLOCK * SEGMENT_BYTES;
const STAGE_NOT_ASLEEP = 0x80;

/** The second block's segments, raw, in absolute minutes. */
function dayTimeline(bytes, view) {
  const count = Math.min(view.getUint8(DAY_SEGMENT_COUNT_OFFSET), SEGMENTS_PER_BLOCK);
  const runs = [];
  for (let i = 0; i < count; i++) {
    const at = DAY_SEGMENT_START_OFFSET + i * SEGMENT_BYTES;
    if (at + SEGMENT_BYTES > bytes.length) break;
    const startMin = view.getUint16(at, true);
    const endMin = view.getUint16(at + 2, true);
    const code = view.getUint8(at + 4);
    if (code === STAGE_NOT_ASLEEP || endMin < startMin) continue;
    const stage = STAGE_CODES[code];
    if (!stage) continue;
    runs.push({ stage, startMin, endMin });
  }
  return runs;
}

/**
 * The daytime sleeps recorded against one raw record.
 *
 * Deliberately separate from `decodeSleepSession` rather than a field on it: a
 * day whose only sleep was a nap arrives as a record with no night at all (zero
 * totals, a 0 -> 65535 span) which that function rightly rejects, so naps hung
 * off the decoded night would be lost on exactly the days that have nothing
 * else on them. Seen on the real 22 July record.
 *
 * Returns [] rather than null: a record with no naps and a record too short to
 * read both mean "no daytime sleep here", and there is nothing a caller could
 * usefully do differently about the second.
 */
export function decodeNaps(bytes) {
  if (!bytes || bytes.length < MIN_BLOB_LENGTH) return [];

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const midnightTs = view.getUint32(OFFSETS.midnightTimestamp, true);
  if (!midnightTs) return [];
  const dayBase = midnightTs - 24 * 3600;

  const count = Math.min(view.getUint8(NAP_COUNT_OFFSET), NAP_SLOTS);
  const timeline = dayTimeline(bytes, view);
  const naps = [];
  for (let i = 0; i < count; i++) {
    const at = NAP_START_OFFSET + i * NAP_ENTRY_BYTES;
    const startMin = view.getUint16(at, true);
    const endMin = view.getUint16(at + 2, true);
    const minutes = view.getUint16(at + 4, true);
    // Nonsense rather than disagreement, the same line decodeStageTimeline
    // draws: an entry that ends before it starts, or claims no minutes, or runs
    // longer than a day, is not a nap told slightly differently.
    if (endMin < startMin || minutes <= 0 || minutes > 24 * 60) continue;
    // Its own stages: the ones inside its own window, timed from its own start,
    // in the same shape the night's timeline uses so one component can draw
    // either. A nap the band gave no stages for keeps null rather than an empty
    // list, which is the distinction `decodeStageTimeline` already draws
    // between "none sent" and "none happened".
    const stages = timeline
      .filter((run) => run.startMin >= startMin && run.endMin <= endMin)
      .map((run) => ({
        stage: run.stage,
        startMinute: run.startMin - startMin,
        minutes: run.endMin - run.startMin + 1,
      }));
    naps.push({
      bedTime: new Date((dayBase + startMin * 60) * 1000),
      wakeTime: new Date((dayBase + (endMin + 1) * 60) * 1000),
      minutes,
      stageTimeline: stages.length ? stages : null,
    });
  }
  return naps;
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
