import { describe, it, expect } from "vitest";
import {
  OVERLAP_THRESHOLD,
  findOverlaps,
  overlapFraction,
  overlapMs,
  preferredOf,
  suppressedStarts,
} from "@/components/activity/sessionOverlap";

/**
 * Real band windows off the device on 2026-08-19, as `[startISO, minutes]`.
 *
 * Fixtures rather than invented spans because the whole question here is how far
 * apart two records of one event drift, and made-up timings would answer a
 * question nobody asked. Note the pair on 29 July: two records 20 minutes apart
 * on the same morning, which is exactly the case a "best overlap" rule has to get
 * right.
 */
const BAND = [
  ["2026-07-26T03:31", 182],
  ["2026-07-27T08:20", 75],
  ["2026-07-29T07:53", 79],
  ["2026-07-29T09:31", 47],
  ["2026-08-03T00:51", 34],
  ["2026-08-04T07:33", 178],
].map(([iso, mins]) => ({
  startMillis: Date.parse(`${iso}:00Z`),
  endMillis: Date.parse(`${iso}:00Z`) + mins * 60_000,
}));

/** A session Atlas timed, offset from a band record the way a real one would be. */
function manualOver(band, { startsLateMins = 0, minutes = null } = {}) {
  const start = band.startMillis + startsLateMins * 60_000;
  const length = minutes != null ? minutes * 60_000 : band.endMillis - band.startMillis;
  return { startMillis: start, endMillis: start + length };
}

describe("overlapMs", () => {
  it("is zero for spans that only touch", () => {
    const a = { startMillis: 0, endMillis: 100 };
    const b = { startMillis: 100, endMillis: 200 };
    expect(overlapMs(a, b)).toBe(0);
  });

  it("counts only the shared part", () => {
    const a = { startMillis: 0, endMillis: 100 };
    const b = { startMillis: 60, endMillis: 200 };
    expect(overlapMs(a, b)).toBe(40);
  });
});

describe("overlapFraction", () => {
  it("measures against the shorter session, not the longer", () => {
    // Ten minutes inside a three-hour record is the same event by any sensible
    // reading; measuring against the longer scores it 0.05 and calls them
    // unrelated.
    const band = BAND[0]; // 182 minutes
    const manual = manualOver(band, { startsLateMins: 30, minutes: 10 });
    expect(overlapFraction(manual, band)).toBe(1);
  });

  it("is symmetric", () => {
    const band = BAND[1];
    const manual = manualOver(band, { startsLateMins: 5 });
    expect(overlapFraction(manual, band)).toBeCloseTo(overlapFraction(band, manual), 10);
  });

  it("survives the drift a real pair actually has", () => {
    // The band decides you started some minutes after you pressed the button.
    const band = BAND[2]; // 79 minutes
    for (const late of [-8, -3, 2, 6, 11]) {
      const manual = manualOver(band, { startsLateMins: late });
      expect(overlapFraction(manual, band)).toBeGreaterThan(OVERLAP_THRESHOLD);
    }
  });

  it("refuses two sessions that merely share an afternoon", () => {
    // The real 29 July pair: 07:53 for 79 minutes, then 09:31 for 47. Different
    // events, and they must not be collapsed into one.
    expect(overlapFraction(BAND[2], BAND[3])).toBeLessThan(OVERLAP_THRESHOLD);
  });
});

describe("findOverlaps", () => {
  it("pairs a manual session with the band record it actually is", () => {
    const manual = manualOver(BAND[1], { startsLateMins: 4 });
    const pairs = findOverlaps([manual], BAND);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].band.startMillis).toBe(BAND[1].startMillis);
  });

  it("picks the best overlap when two band records both touch one session", () => {
    // A session spanning both of 29 July's records belongs to whichever it
    // shares most with, not to whichever was found first.
    const start = BAND[2].startMillis;
    const manual = { startMillis: start, endMillis: BAND[3].endMillis };
    const pairs = findOverlaps([manual], BAND);
    expect(pairs).toHaveLength(1);
    // 79 minutes shared against 47: the morning record wins.
    expect(pairs[0].band.startMillis).toBe(BAND[2].startMillis);
  });

  it("leaves a session the band never recorded alone", () => {
    // The 16 August walk: the case this whole feature exists for.
    const alone = { startMillis: Date.parse("2026-08-16T09:00:00Z"), endMillis: Date.parse("2026-08-16T09:45:00Z") };
    expect(findOverlaps([alone], BAND)).toEqual([]);
  });
});

describe("preferredOf and suppressedStarts", () => {
  const band = BAND[1];
  const manual = manualOver(band, { startsLateMins: 4 });
  const pairs = findOverlaps([manual], BAND);

  it("shows the band's record when nothing has been chosen", () => {
    // It has the calories, the heart-rate summary and its own active time.
    expect(preferredOf(pairs[0], null).startMillis).toBe(band.startMillis);
  });

  it("shows the manual one when that is what was picked", () => {
    expect(preferredOf(pairs[0], "manual").startMillis).toBe(manual.startMillis);
  });

  it("suppresses exactly one of the pair, so nothing is counted twice", () => {
    const dropDefault = suppressedStarts(pairs, () => null);
    expect([...dropDefault]).toEqual([manual.startMillis]);

    const dropChosen = suppressedStarts(pairs, () => "manual");
    expect([...dropChosen]).toEqual([band.startMillis]);
  });

  it("never suppresses both, which would lose the session entirely", () => {
    for (const choice of [null, "band", "manual"]) {
      const drop = suppressedStarts(pairs, () => choice);
      expect(drop.size).toBe(1);
    }
  });
});

// The guard that matters most for the totals: whatever the choice, exactly one of
// a pair survives a resolve. Two would double-count the session in the week chart
// and the month totals; none would lose it entirely.
describe("resolveSessions with an overlapping pair", () => {
  const band = BAND[1];
  const manual = manualOver(band, { startsLateMins: 4 });

  function fakeStore(choice) {
    return {
      manualSessions: [{ ...manual, manual: true, source: "manual" }],
      isHidden: () => false,
      annotationFor: () => null,
      membersOf: () => [],
      splitsOf: () => [],
      splitStatsFor: () => ({}),
      resolve: (w) => w,
      overlapChoiceFor: () => choice,
    };
  }

  it("keeps the band's record by default and drops the manual one", async () => {
    const { resolveSessions } = await import("@/components/activity/resolveSessions");
    const out = resolveSessions([band], fakeStore(null));
    expect(out).toHaveLength(1);
    expect(out[0].startMillis).toBe(band.startMillis);
  });

  it("keeps the manual one when that is what was chosen", async () => {
    const { resolveSessions } = await import("@/components/activity/resolveSessions");
    const out = resolveSessions([band], fakeStore("manual"));
    expect(out).toHaveLength(1);
    expect(out[0].startMillis).toBe(manual.startMillis);
  });

  it("never emits both, which is what would double the totals", async () => {
    const { resolveSessions } = await import("@/components/activity/resolveSessions");
    for (const choice of [null, "band", "manual"]) {
      expect(resolveSessions([band], fakeStore(choice))).toHaveLength(1);
    }
  });
});
