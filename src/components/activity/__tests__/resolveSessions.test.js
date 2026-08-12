import { describe, it, expect } from "vitest";
import { resolveSessions } from "@/components/activity/resolveSessions";

const START = 1785828807000; // Tue 4 Aug 17:33:27
const END = 1785839461000; // 20:31:01
const CUT = 1785838020000; // 20:07:00

const RECORD = {
  startMillis: START,
  endMillis: END,
  activeSeconds: 10654,
  hrAvg: 132,
  hrMax: 203,
};

/**
 * The sessions store's read surface, as a plain object. The real one needs
 * Pinia; everything used here is a lookup, which is exactly why the store is
 * passed in rather than imported.
 */
function fakeStore({
  splits = {},
  splitStats = {},
  hidden = [],
  annotations = {},
  manualSessions = [],
  members = {},
} = {}) {
  return {
    isHidden: (w) => hidden.includes(w.startMillis),
    annotationFor: (t) => annotations[t] ?? null,
    membersOf: (t) => members[t] ?? [],
    manualSessions,
    splitsOf: (t) => splits[t] ?? [],
    splitStatsFor: (t) => splitStats[t] ?? {},
    resolve: (w) => {
      const override = annotations[w?.startMillis]?.activeSecondsOverride;
      return override == null ? w : { ...w, activeSeconds: override, edited: true };
    },
  };
}

/** A session the band never recorded, shaped the way the store emits them. */
const MANUAL_START = 1785700000000;
const MANUAL = {
  startMillis: MANUAL_START,
  endMillis: MANUAL_START + 3600000,
  activeSeconds: 3600,
  manual: true,
  source: "manual",
  hrAvg: null,
  hrMax: null,
};

describe("resolveSessions with splits", () => {
  it("leaves an uncut record as one session", () => {
    const out = resolveSessions([RECORD], fakeStore());
    expect(out).toHaveLength(1);
    expect(out[0].startMillis).toBe(START);
  });

  it("expands a cut record into two sessions", () => {
    const out = resolveSessions([RECORD], fakeStore({ splits: { [START]: [CUT] } }));

    expect(out).toHaveLength(2);
    // Newest first, the order every list of these is read in.
    expect(out.map((s) => s.startMillis)).toEqual([CUT, START]);
    expect(out[1].endMillis).toBe(CUT);
    expect(out[0].endMillis).toBe(END);
  });

  it("uses the aggregates measured when the cut was made", () => {
    const out = resolveSessions(
      [RECORD],
      fakeStore({
        splits: { [START]: [CUT] },
        splitStats: {
          [START]: {
            [START]: { hrAvg: 138, hrMax: 173, hrMin: 71, samples: 154 },
            [CUT]: { hrAvg: 96, hrMax: 101, hrMin: 78, samples: 24 },
          },
        },
      })
    );

    const [walk, gym] = out;
    expect(gym.hrMax).toBe(173);
    expect(walk.hrMax).toBe(101);
    expect(walk.hrRecomputed).toBe(true);
    // The band's disputed figure stays readable on both.
    expect(gym.bandHrMax).toBe(203);
  });

  it("falls back to the band's figures for a cut stored before stats existed", () => {
    const out = resolveSessions([RECORD], fakeStore({ splits: { [START]: [CUT] } }));
    expect(out[0].hrMax).toBe(203);
    expect(out[0].hrRecomputed).toBe(false);
  });

  it("applies a duration correction to the half it was made on, not both", () => {
    const out = resolveSessions(
      [RECORD],
      fakeStore({
        splits: { [START]: [CUT] },
        annotations: { [CUT]: { activeSecondsOverride: 600 } },
      })
    );

    const [walk, gym] = out;
    expect(walk.activeSeconds).toBe(600);
    expect(walk.edited).toBe(true);
    expect(gym.edited).toBeUndefined();
  });

  it("drops a hidden record before cutting it, rather than after", () => {
    const out = resolveSessions(
      [RECORD],
      fakeStore({ splits: { [START]: [CUT] }, hidden: [START] })
    );
    expect(out).toEqual([]);
  });

  it("keeps the parts contiguous and inside the original span", () => {
    const second = START + 20 * 60000;
    const out = resolveSessions([RECORD], fakeStore({ splits: { [START]: [CUT, second] } }));

    const chron = [...out].sort((a, b) => a.startMillis - b.startMillis);
    expect(chron).toHaveLength(3);
    expect(chron[0].startMillis).toBe(START);
    expect(chron.at(-1).endMillis).toBe(END);
    for (let i = 1; i < chron.length; i++) {
      expect(chron[i].startMillis).toBe(chron[i - 1].endMillis);
    }
  });

  it("emits manual sessions, which no device record would ever produce", () => {
    // The whole reason manual sessions could not ship earlier: resolveSessions
    // walks the band's workouts, so one stored here was invisible.
    const out = resolveSessions([], fakeStore({ manualSessions: [MANUAL] }));

    expect(out).toHaveLength(1);
    expect(out[0].manual).toBe(true);
    expect(out[0].activeSeconds).toBe(3600);
  });

  it("puts a manual session in date order beside the band's own", () => {
    const out = resolveSessions([RECORD], fakeStore({ manualSessions: [MANUAL] }));

    expect(out).toHaveLength(2);
    // Newest first, and the band record is the later of the two.
    expect(out[0].startMillis).toBe(START);
    expect(out[1].startMillis).toBe(MANUAL_START);
  });

  it("lets a manual session be deleted like any other", () => {
    const out = resolveSessions(
      [],
      fakeStore({ manualSessions: [MANUAL], hidden: [MANUAL_START] })
    );
    expect(out).toEqual([]);
  });

  it("applies a duration correction to a manual session", () => {
    const out = resolveSessions(
      [],
      fakeStore({
        manualSessions: [MANUAL],
        annotations: { [MANUAL_START]: { activeSecondsOverride: 1800 } },
      })
    );
    expect(out[0].activeSeconds).toBe(1800);
  });

  it("does not lose a manual session folded into a band record", () => {
    // Without manual sessions in the lookup this dropped out of both lists: it
    // was skipped as a merge member and never found among the device records.
    const out = resolveSessions(
      [RECORD],
      fakeStore({
        manualSessions: [MANUAL],
        annotations: { [MANUAL_START]: { mergedInto: START } },
        members: { [START]: [MANUAL_START] },
      })
    );

    expect(out).toHaveLength(1);
    expect(out[0].merged).toBe(true);
    // Its time is inside the merged session rather than gone.
    expect(out[0].activeSeconds).toBe(RECORD.activeSeconds + MANUAL.activeSeconds);
  });

  it("can cut a manual session in two, like a band record", () => {
    const at = MANUAL_START + 1800000;
    const out = resolveSessions(
      [],
      fakeStore({ manualSessions: [MANUAL], splits: { [MANUAL_START]: [at] } })
    );

    expect(out).toHaveLength(2);
    expect(out.map((s) => s.startMillis).sort()).toEqual([MANUAL_START, at]);
  });

  it("works against a store with no manual sessions at all", () => {
    const out = resolveSessions([RECORD], fakeStore());
    expect(out).toHaveLength(1);
  });

  it("works against a store with no split support at all", () => {
    // Guards the optional calls: an older caller passing a store without these
    // should get the previous behaviour rather than a TypeError.
    const bare = {
      isHidden: () => false,
      annotationFor: () => null,
      membersOf: () => [],
      resolve: (w) => w,
    };
    expect(resolveSessions([RECORD], bare)).toHaveLength(1);
  });
});
