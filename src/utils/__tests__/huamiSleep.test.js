import { describe, it, expect } from "vitest";
import { decodeSleepSession } from "@/utils/huamiSleep";

const CODE = { light: 4, deep: 5, awake: 7, rem: 8 };
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
} = {}) {
  const bytes = new Uint8Array(594);
  const view = new DataView(bytes.buffer);
  view.setUint32(0x04, 1785200000, true);
  view.setUint8(0x15, 54);
  view.setUint8(0x16, 75);

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
