import { describe, it, expect } from "vitest";
import { collectNaps } from "@/utils/sampleIngest";

/**
 * Naps, kept without ever reaching the sleep score.
 *
 * The rule these protect is the one the NEXT ticket rests on: every term in
 * `sleepScore.js` is defined over a night, so nap minutes must never join a
 * night's total. Here that is structural - naps land in their own field - and
 * these tests pin the collection, not the arithmetic.
 */
const at = (day, h, m = 0) => new Date(2026, 7, day, h, m, 0, 0);

const session = (bed, wake, minutes, extra = {}) => ({
  bedTime: bed,
  wakeTime: wake,
  totalSleepMinutes: minutes,
  ...extra,
});

describe("collectNaps", () => {
  it("keeps an afternoon sleep, filed under the day it happened", () => {
    const naps = collectNaps([session(at(18, 14, 20), at(18, 15, 5), 45)]);
    expect([...naps.keys()]).toEqual(["2026-08-18"]);
    expect(naps.get("2026-08-18")).toEqual([
      { bedTime: at(18, 14, 20).getTime(), wakeTime: at(18, 15, 5).getTime(), minutes: 45, stageTimeline: null },
    ]);
  });

  it("ignores a night, which is what everything else here is about", () => {
    // Spans midnight, so it fails the daytime test at both ends.
    expect(collectNaps([session(at(17, 23, 38), at(18, 7, 10), 452)]).size).toBe(0);
  });

  it("keeps the longest telling when the band revises one nap", () => {
    // Same bedtime is the same sleep. The band refines a session as it goes, and
    // adding the revisions together would invent an afternoon in bed.
    const naps = collectNaps([
      session(at(18, 14, 20), at(18, 14, 50), 30),
      session(at(18, 14, 20), at(18, 15, 5), 45),
    ]);
    expect(naps.get("2026-08-18")).toHaveLength(1);
    expect(naps.get("2026-08-18")[0].minutes).toBe(45);
  });

  it("keeps two genuinely separate naps on one day, in order", () => {
    const naps = collectNaps([
      session(at(18, 15, 40), at(18, 16, 20), 40),
      session(at(18, 10, 0), at(18, 10, 35), 35),
    ]);
    expect(naps.get("2026-08-18").map((n) => n.minutes)).toEqual([35, 40]);
  });

  it("has no floor, because a nap has nothing to be mistaken for", () => {
    // NIGHT_FLOOR_MINUTES exists to stop a truncated fetch reading as a night.
    // A second threshold here would only decide which of the band's own sleeps
    // to disbelieve.
    expect(collectNaps([session(at(18, 13, 0), at(18, 13, 20), 20)]).size).toBe(1);
  });

  it("survives rubbish without throwing", () => {
    expect(collectNaps([null, undefined, {}]).size).toBe(0);
    expect(collectNaps(undefined).size).toBe(0);
    expect(collectNaps([], [null, {}, { bedTime: at(18, 14, 0) }]).size).toBe(0);
  });

  // Where naps have actually come from since 2026-08-18: the band files them in
  // a block inside the night record rather than as sessions of their own, so
  // they arrive already decoded by `decodeNaps` and never pass the daytime test.
  describe("from the band's own nap block", () => {
    const nap = (bed, wake, minutes) => ({ bedTime: bed, wakeTime: wake, minutes });

    it("keeps them, filed under the day they happened", () => {
      const naps = collectNaps([], [nap(at(16, 17, 34), at(16, 19, 32), 118)]);
      expect(naps.get("2026-08-16")).toEqual([
        { bedTime: at(16, 17, 34).getTime(), wakeTime: at(16, 19, 32).getTime(), minutes: 118, stageTimeline: null },
      ]);
    });

    it("keeps an evening doze, which is a nap and not the start of a night", () => {
      // Four of the twelve real naps begin after 20:00. Nothing about 21:53
      // makes it a night, and the night it belongs to is on the same record.
      const naps = collectNaps([], [nap(at(5, 21, 53), at(5, 22, 34), 41)]);
      expect(naps.get("2026-08-05")).toHaveLength(1);
    });

    // The band's block is raw: it files anything that is not the main night,
    // including the twenty minutes you spent falling asleep. Zepp reads the same
    // block and does not show those, so even the vendor filters it.
    describe("next to a night, which is not a nap", () => {
      const night = (bed, wake) => ({ bedTime: bed, wakeTime: wake });

      it("drops a doze that the night follows within the hour", () => {
        // The real case, 2026-08-19: asleep 00:01 to 00:25, then the night
        // proper began 00:53. A 28 minute gap. That is one going to bed, not a
        // nap and then a night.
        const naps = collectNaps(
          [],
          [nap(at(19, 0, 1), at(19, 0, 25), 24)],
          [night(at(19, 0, 53), at(19, 9, 4))]
        );
        expect(naps.size).toBe(0);
      });

      it("drops an evening doze an hour before bed", () => {
        // 2026-08-05: 21:53 to 22:34, in bed at 23:28. 54 minutes.
        const naps = collectNaps(
          [],
          [nap(at(5, 21, 53), at(5, 22, 34), 41)],
          [night(at(5, 23, 28), at(6, 8, 43))]
        );
        expect(naps.size).toBe(0);
      });

      it("keeps one that stands clear of the night", () => {
        // 2026-07-22: 22:05 to 22:59 with bed at 00:37, which is 98 minutes.
        // The nearest real nap to the threshold, and it stays a nap.
        const naps = collectNaps(
          [],
          [nap(at(22, 22, 5), at(22, 22, 59), 54)],
          [night(at(23, 0, 37), at(23, 9, 15))]
        );
        expect(naps.get("2026-08-22")).toHaveLength(1);
      });

      it("drops a doze in the hour after waking", () => {
        // The same rule at the other end: going back to sleep at 09:20 after
        // waking at 09:04 is the tail of that night, not a morning nap.
        const naps = collectNaps(
          [],
          [nap(at(19, 9, 20), at(19, 9, 44), 24)],
          [night(at(19, 0, 53), at(19, 9, 4))]
        );
        expect(naps.size).toBe(0);
      });

      it("keeps an afternoon nap on a day with a night at both ends", () => {
        const naps = collectNaps(
          [],
          [nap(at(16, 17, 34), at(16, 19, 32), 118)],
          [night(at(16, 1, 7), at(16, 10, 15)), night(at(17, 1, 38), at(17, 11, 44))]
        );
        expect(naps.get("2026-08-16")).toHaveLength(1);
      });

      it("keeps a nap when no night is known either side of it", () => {
        // The 22 July case: a day whose only sleep was the nap, so there is no
        // night to measure against. Withholding it would lose the only sleep
        // that day had.
        expect(collectNaps([], [nap(at(22, 22, 5), at(22, 22, 59), 54)], []).size).toBe(1);
      });
    });

    it("does not double-count a nap that also arrives as a daytime session", () => {
      // Same bedtime is the same sleep whichever way it reached here, so the
      // two sources dedupe against each other and the fuller telling wins.
      const naps = collectNaps(
        [session(at(18, 14, 20), at(18, 14, 50), 30)],
        [nap(at(18, 14, 20), at(18, 15, 5), 45)]
      );
      expect(naps.get("2026-08-18")).toHaveLength(1);
      expect(naps.get("2026-08-18")[0].minutes).toBe(45);
    });
  });
});
