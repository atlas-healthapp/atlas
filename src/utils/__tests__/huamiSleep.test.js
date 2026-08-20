import { describe, it, expect } from "vitest";
import { decodeSleepSession, decodeNaps } from "@/utils/huamiSleep";

const CODE = { light: 4, deep: 5, awake: 7, rem: 8 };
const SEGMENT_START = 0x56;
const SEGMENT_BYTES = 5;
/** The filler the band writes between one sleep and the next. Not a stage. */
const CODE_NOT_ASLEEP = 0x80;
const STAGE_TOTAL_OFFSET = {
  rem: 0x24a,
  light: 0x24c,
  deep: 0x24e,
  awake: 0x250,
};

// Builds a record in the layout Task 2 verified: count at 0x54, tuples from
// 0x56, footer totals at 0x24a onward. `runs` are [stage, minutes] pairs laid
// end to end from startMin, matching the contiguity the real records show.
function buildRecord({
  startMin = 1382,
  runs = [],
  corruptFooter = false,
  extraJunk = 0,
  naps = [],
  napCount = null,
  junkNaps = 0,
  flag14 = 0,
  dayRuns = [],
  dayCount = null,
} = {}) {
  const bytes = new Uint8Array(594);
  const view = new DataView(bytes.buffer);
  view.setUint32(0x04, 1785200000, true);
  view.setUint8(0x15, 54);
  view.setUint8(0x16, 75);

  // The nap block: a count at 0x17, then up to ten 6-byte entries from 0x18.
  // `flag14` is the byte at 0x14, which is 1 on every record carrying a nap and
  // also on four that carry none - see the test that pins the count to 0x17.
  view.setUint8(0x14, flag14);
  naps.forEach(([start, end, minutes], i) => {
    const at = 0x18 + i * 6;
    view.setUint16(at, start, true);
    view.setUint16(at + 2, end, true);
    view.setUint16(at + 4, minutes, true);
  });
  for (let i = 0; i < junkNaps; i++) {
    const at = 0x18 + (naps.length + i) * 6;
    view.setUint16(at, 60000, true);
    view.setUint16(at + 2, 60600, true);
    view.setUint16(at + 4, 601, true);
  }
  view.setUint8(0x17, napCount ?? naps.length);

  // The second timeline block: 50 slots of its own from slot 50, counted at
  // 0x55, holding each nap's stages with 0x80 segments filling the awake gaps
  // between one sleep and the next. `dayRuns` are written as given -
  // [startMin, inclusive endMin, code] - because what this block is testing is
  // whether the decoder picks the right ones out of a real mixture.
  dayRuns.forEach(([start, end, code], i) => {
    const at = SEGMENT_START + (50 + i) * SEGMENT_BYTES;
    view.setUint16(at, start, true);
    view.setUint16(at + 2, end, true);
    view.setUint8(at + 4, code);
  });
  view.setUint8(0x55, dayCount ?? dayRuns.length);

  const totals = { rem: 0, light: 0, deep: 0, awake: 0 };
  let minute = startMin;
  let cursor = 0x56;
  for (const [stage, minutes] of runs) {
    view.setUint16(cursor, minute, true);
    view.setUint16(cursor + 2, minute + minutes - 1, true);
    view.setUint8(cursor + 4, CODE[stage]);
    totals[stage] += minutes;
    minute += minutes;
    cursor += 5;
  }
  view.setUint8(0x54, runs.length);
  view.setUint16(0x0a, startMin, true);
  // The real records end one minute past the last tuple's inclusive end.
  view.setUint16(0x0c, minute, true);

  // Trailing junk past the declared count, as seen on two real records.
  for (let i = 0; i < extraJunk; i++) {
    view.setUint16(cursor, minute, true);
    view.setUint16(cursor + 2, minute + 600, true);
    view.setUint8(cursor + 4, 0x80);
    cursor += 5;
  }

  for (const [stage, offset] of Object.entries(STAGE_TOTAL_OFFSET)) {
    view.setUint16(
      offset,
      corruptFooter ? totals[stage] + 1 : totals[stage],
      true
    );
  }
  return bytes;
}

describe("decodeSleepSession stage timeline", () => {
  it("decodes segments as runs relative to bedtime", () => {
    const bytes = buildRecord({
      startMin: 1382,
      runs: [
        ["awake", 8],
        ["light", 34],
        ["deep", 42],
      ],
    });
    expect(decodeSleepSession(bytes).stageTimeline).toEqual([
      { stage: "awake", startMinute: 0, minutes: 8 },
      { stage: "light", startMinute: 8, minutes: 34 },
      { stage: "deep", startMinute: 42, minutes: 42 },
    ]);
  });

  it("stops at the declared count and ignores trailing junk", () => {
    const bytes = buildRecord({
      runs: [
        ["light", 30],
        ["deep", 20],
      ],
      extraJunk: 3,
    });
    const timeline = decodeSleepSession(bytes).stageTimeline;
    expect(timeline).toHaveLength(2);
    expect(timeline.some((r) => r.minutes > 600)).toBe(false);
  });

  // Changed 2026-08-10, on measured evidence and the user's explicit call. The
  // band handed over a real night whose segments were a few minutes out from its
  // own totals, and discarding them left the page with no hypnogram and no clock
  // axis while Zepp drew both: "I would rather have the zones in even if they're
  // slightly not accurate, it feels very bad to not show them."
  it("keeps the segments even when they disagree with the footer totals", () => {
    const bytes = buildRecord({
      runs: [
        ["light", 30],
        ["rem", 15],
      ],
      corruptFooter: true,
    });
    const decoded = decodeSleepSession(bytes);
    expect(decoded.stageTimeline).toHaveLength(2);
    // The footer totals stay the authority for anything counting minutes: they
    // are independently stored, and they are what the band scored the night on.
    expect(decoded.lightMinutes).toBe(31);
  });

  it("returns a null timeline for an unrecognised stage code", () => {
    const bytes = buildRecord({ runs: [["light", 30]] });
    new DataView(bytes.buffer).setUint8(0x56 + 4, 99);
    expect(decodeSleepSession(bytes).stageTimeline).toBeNull();
  });

  it("returns a null timeline when the count is zero", () => {
    // A record built with no runs has zero total sleep minutes, which trips
    // decodeSleepSession's own pre-existing guard and returns null for the
    // whole session before the stage timeline is even considered. That guard
    // is correct and out of scope here: to isolate the segment-count-zero
    // path this actually targets, start from a record with a real sleep
    // total and zero out just the count byte afterward.
    const bytes = buildRecord({ runs: [["light", 30]] });
    new DataView(bytes.buffer).setUint8(0x54, 0);
    expect(decodeSleepSession(bytes).stageTimeline).toBeNull();
  });

  it("still returns null for a record too short to trust", () => {
    expect(decodeSleepSession(new Uint8Array(100))).toBeNull();
  });
});

// Verified against 28 real records pulled off the band on 2026-08-18, twelve of
// which carry a nap. Two of those twelve were independently displayed by Zepp
// while this was being read, which is what settles the inclusive end minute.
const DAY_BASE = 1785200000 - 24 * 3600;
const atMinute = (m) => new Date((DAY_BASE + m * 60) * 1000);

describe("decodeNaps", () => {
  it("decodes the daytime sleep the band files against a night", () => {
    // The real block from the night ending 2026-08-16: 2494 -> 2611, 118
    // minutes. Zepp showed that nap as 17:34 to 19:32, and 2611 is 19:31, so
    // the end minute is inclusive and the wake time is one minute past it.
    // The night's own end minute is exclusive - the asymmetry is the band's.
    const bytes = buildRecord({
      runs: [["light", 300]],
      naps: [[2494, 2611, 118]],
      flag14: 1,
    });
    expect(decodeNaps(bytes)).toEqual([
      { bedTime: atMinute(2494), wakeTime: atMinute(2612), minutes: 118, stageTimeline: null },
    ]);
  });

  it("counts the naps at 0x17 rather than the flag at 0x14", () => {
    // 0x14 is 1 on every record carrying a nap, which is exactly why it cannot
    // be trusted: it is also 1 on four records whose nap block is empty.
    const none = buildRecord({ runs: [["light", 300]], flag14: 1 });
    expect(decodeNaps(none)).toEqual([]);

    // The two naps of 2026-08-05, the one record that told the two bytes apart.
    const two = buildRecord({
      runs: [["light", 300]],
      flag14: 1,
      naps: [
        [2209, 2231, 23],
        [2633, 2673, 41],
      ],
    });
    expect(decodeNaps(two).map((n) => n.minutes)).toEqual([23, 41]);
  });

  it("keeps the naps of a record whose night is empty", () => {
    // Not hypothetical, and the reason naps are read off the raw blob rather
    // than off the decoded night: a day whose only sleep was a nap arrives as a
    // record with no night at all - zero totals, a 0 -> 65535 span - which
    // decodeSleepSession rejects. Reading naps off the night would lose exactly
    // the days that have nothing else on them.
    const bytes = buildRecord({ naps: [[1325, 1378, 54]] });
    expect(decodeSleepSession(bytes)).toBeNull();
    expect(decodeNaps(bytes)).toEqual([
      { bedTime: atMinute(1325), wakeTime: atMinute(1379), minutes: 54, stageTimeline: null },
    ]);
  });

  it("ignores entries past the declared count", () => {
    const bytes = buildRecord({
      runs: [["light", 300]],
      naps: [[2209, 2231, 23]],
      junkNaps: 3,
    });
    expect(decodeNaps(bytes)).toHaveLength(1);
  });

  it("never reads past the ten slots into the stage segments", () => {
    // 0x18 plus ten 6-byte entries is exactly 0x54, where the segment count
    // begins. An over-large count must not be believed or the hypnogram
    // decodes as naps.
    const naps = Array.from({ length: 10 }, (_, i) => [2000 + i * 10, 2005 + i * 10, 6]);
    const bytes = buildRecord({ runs: [["light", 300]], naps, napCount: 255 });
    expect(decodeNaps(bytes)).toHaveLength(10);
  });

  it("drops an entry that ends before it starts", () => {
    const bytes = buildRecord({ runs: [["light", 300]], naps: [[2231, 2209, 23]] });
    expect(decodeNaps(bytes)).toEqual([]);
  });

  it("returns nothing for a record too short to trust", () => {
    expect(decodeNaps(new Uint8Array(100))).toEqual([]);
  });

  describe("stages", () => {
    // The real 2026-08-16 nap, whose five segments sum to the 118 minutes the
    // band declares for it: 12 + 41 + 12 + 30 + 23. The gap segment before it
    // runs from the night's end to the nap's start and is code 0x80.
    const REAL = {
      runs: [["light", 300]],
      naps: [[2494, 2611, 118]],
      flag14: 1,
      dayRuns: [
        [2055, 2493, CODE_NOT_ASLEEP],
        [2494, 2505, CODE.light],
        [2506, 2546, CODE.deep],
        [2547, 2558, CODE.light],
        [2559, 2588, CODE.rem],
        [2589, 2611, CODE.light],
      ],
    };

    it("attaches the nap's own stages, timed from the nap's start", () => {
      expect(decodeNaps(buildRecord(REAL))[0].stageTimeline).toEqual([
        { stage: "light", startMinute: 0, minutes: 12 },
        { stage: "deep", startMinute: 12, minutes: 41 },
        { stage: "light", startMinute: 53, minutes: 12 },
        { stage: "rem", startMinute: 65, minutes: 30 },
        { stage: "light", startMinute: 95, minutes: 23 },
      ]);
    });

    it("leaves out the gap filler, which is not a stage", () => {
      // 0x80 spans the hours between one sleep and the next. Mapping it to a
      // stage would draw being awake and about as sleep.
      const stages = decodeNaps(buildRecord(REAL))[0].stageTimeline;
      expect(stages.reduce((sum, s) => sum + s.minutes, 0)).toBe(118);
    });

    it("gives each nap only its own stages", () => {
      const stages = decodeNaps(
        buildRecord({
          runs: [["light", 300]],
          naps: [
            [2329, 2351, 23],
            [2753, 2793, 41],
          ],
          dayRuns: [
            [1954, 2328, CODE_NOT_ASLEEP],
            [2329, 2351, CODE.light],
            [2352, 2752, CODE_NOT_ASLEEP],
            [2753, 2793, CODE.light],
          ],
        })
      ).map((n) => n.stageTimeline);
      expect(stages[0]).toEqual([{ stage: "light", startMinute: 0, minutes: 23 }]);
      expect(stages[1]).toEqual([{ stage: "light", startMinute: 0, minutes: 41 }]);
    });

    it("never reads the night's own segments as a nap's", () => {
      // The two blocks share one array: the night counts from slot 0 and this
      // one from slot 50. A nap that happened to overlap the night's minutes
      // must still take its stages from its own block.
      const bytes = buildRecord({
        runs: [["deep", 300]],
        naps: [[1382, 1400, 19]],
        dayRuns: [[1382, 1400, CODE.light]],
      });
      expect(decodeNaps(bytes)[0].stageTimeline).toEqual([
        { stage: "light", startMinute: 0, minutes: 19 },
      ]);
    });

    it("leaves the stages off when the band sent none", () => {
      const bytes = buildRecord({ runs: [["light", 300]], naps: [[2494, 2611, 118]] });
      expect(decodeNaps(bytes)[0].stageTimeline).toBeNull();
    });

    it("stops at the declared count rather than reading the whole block", () => {
      const bytes = buildRecord({ ...REAL, dayCount: 2 });
      expect(decodeNaps(bytes)[0].stageTimeline).toEqual([
        { stage: "light", startMinute: 0, minutes: 12 },
      ]);
    });
  });
});
