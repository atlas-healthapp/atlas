import { describe, it, expect } from "vitest";
import { splitWorkout, applySplits } from "@/components/activity/splitSessions";

// The real record this ticket is about: Tuesday 4 August, 17:33:27 to 20:31:01,
// a gym session to about 20:07 and the walk home after it. hrMax 203 is the
// band's, and the day's 1,374 stored samples peak at 173.
const START = 1785828807000; // 17:33:27
const END = 1785839461000; // 20:31:01
const CUT = 1785838020000; // 20:07:00

const RECORD = {
  startMillis: START,
  endMillis: END,
  activeSeconds: 10654,
  caloriesKcal: 900,
  hrAvg: 132,
  hrMax: 203,
  hrMin: 60,
};

/** A sample every minute at `value`, across `[from, to)`. */
function samplesAt(from, to, value) {
  const out = [];
  for (let t = from; t < to; t += 60000) out.push({ t, v: value });
  return out;
}

describe("splitWorkout", () => {
  it("recomputes each half's heart rate from its own samples", () => {
    const hr = [...samplesAt(START, CUT, 140), ...samplesAt(CUT, END, 95)];
    const [gym, walk] = splitWorkout(RECORD, CUT, hr);

    expect(gym.hrAvg).toBe(140);
    expect(walk.hrAvg).toBe(95);
    expect(gym.hrRecomputed).toBe(true);
    expect(walk.hrRecomputed).toBe(true);
  });

  it("does not let the walk home inherit a peak it was nowhere near", () => {
    // The whole point. The band says 203 for the record; the samples say 173 in
    // the gym half and 101 on the way home.
    const hr = [
      ...samplesAt(START, CUT, 140),
      { t: START + 60000, v: 173 },
      ...samplesAt(CUT, END, 95),
      { t: CUT + 60000, v: 101 },
    ];
    const [gym, walk] = splitWorkout(RECORD, CUT, hr);

    expect(gym.hrMax).toBe(173);
    expect(walk.hrMax).toBe(101);
    // ...and the figure it disagrees with stays readable.
    expect(gym.bandHrMax).toBe(203);
  });

  it("keeps the band's own figures when there is nothing to recompute from", () => {
    const [gym, walk] = splitWorkout(RECORD, CUT, []);

    expect(gym.hrMax).toBe(203);
    expect(walk.hrMax).toBe(203);
    expect(gym.hrRecomputed).toBe(false);
    // Never a share of a heart rate: an average is not divisible by time.
    expect(walk.hrAvg).toBe(132);
  });

  it("apportions active seconds by span and says that it did", () => {
    const [gym, walk] = splitWorkout(RECORD, CUT, []);
    const span = END - START;

    expect(gym.activeSeconds).toBe(Math.round(10654 * ((CUT - START) / span)));
    expect(walk.activeSeconds).toBe(Math.round(10654 * ((END - CUT) / span)));
    expect(gym.activeSecondsApportioned).toBe(true);
    expect(gym.bandActiveSeconds).toBe(10654);
    // Within a second of the original, so nothing is invented or lost.
    expect(Math.abs(gym.activeSeconds + walk.activeSeconds - 10654)).toBeLessThanOrEqual(1);
  });

  it("gives the two halves the right boundaries", () => {
    const [gym, walk] = splitWorkout(RECORD, CUT, []);

    expect(gym.startMillis).toBe(START);
    expect(gym.endMillis).toBe(CUT);
    expect(walk.startMillis).toBe(CUT);
    expect(walk.endMillis).toBe(END);
  });

  it("puts a sample landing exactly on the cut in the second half only", () => {
    const hr = [{ t: CUT, v: 90 }];
    const [gym, walk] = splitWorkout(RECORD, CUT, hr);

    expect(gym.hrRecomputed).toBe(false);
    expect(walk.hrRecomputed).toBe(true);
    expect(walk.hrSampleCount).toBe(1);
  });

  it("refuses a cut at or outside either end", () => {
    expect(splitWorkout(RECORD, START, [])).toBeNull();
    expect(splitWorkout(RECORD, END, [])).toBeNull();
    expect(splitWorkout(RECORD, START - 1000, [])).toBeNull();
    expect(splitWorkout(RECORD, END + 1000, [])).toBeNull();
  });

  it("refuses nonsense rather than producing half a session", () => {
    expect(splitWorkout(null, CUT, [])).toBeNull();
    expect(splitWorkout(RECORD, undefined, [])).toBeNull();
    expect(splitWorkout(RECORD, NaN, [])).toBeNull();
  });

  it("drops a merge's claims, since the halves are not that merge", () => {
    const merged = { ...RECORD, merged: true, mergedCount: 2, mergedParts: [{}, {}] };
    const [gym] = splitWorkout(merged, CUT, []);

    expect(gym.merged).toBe(false);
    expect(gym.mergedParts).toBeUndefined();
  });

  it("carries the annotation join key of the part it came from", () => {
    const [gym, walk] = splitWorkout(RECORD, CUT, []);
    // Annotations join on startMillis, so each half can be typed separately.
    expect(gym.startMillis).not.toBe(walk.startMillis);
    expect(walk.splitOf).toBe(START);
    expect(walk.splitAt).toBe(CUT);
  });
});

describe("applySplits", () => {
  it("returns the record untouched when there are no cuts", () => {
    expect(applySplits(RECORD, [])).toEqual([RECORD]);
    expect(applySplits(RECORD, null)).toEqual([RECORD]);
  });

  it("makes three sessions from two cuts", () => {
    const second = START + 30 * 60000;
    const parts = applySplits(RECORD, [CUT, second]);

    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.startMillis)).toEqual([START, second, CUT]);
    expect(parts.at(-1).endMillis).toBe(END);
  });

  it("ignores a cut that falls outside the record", () => {
    const parts = applySplits(RECORD, [END + 60000]);
    expect(parts).toHaveLength(1);
  });

  it("is not confused by a duplicated or unsorted cut list", () => {
    const second = START + 30 * 60000;
    expect(applySplits(RECORD, [CUT, CUT, second, second])).toHaveLength(3);
    expect(applySplits(RECORD, [second, CUT])).toHaveLength(3);
  });

  it("leaves every part covering the original span end to end", () => {
    const parts = applySplits(RECORD, [CUT, START + 30 * 60000]);
    expect(parts[0].startMillis).toBe(START);
    expect(parts.at(-1).endMillis).toBe(END);
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].startMillis).toBe(parts[i - 1].endMillis);
    }
  });
});
