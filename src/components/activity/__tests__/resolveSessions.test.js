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

/**
 * The band's own detection, turned up.
 *
 * Measured on the real archive 2026-08-27, a day after the strap's detection
 * sensitivity moved to Medium: 33 workouts, of which two ran 3 and 4 minutes and
 * both were auto detected. The next shortest are 6 and 9 minutes and both look
 * like real short walks, which is what puts the line at five rather than ten.
 */
describe("detection noise", () => {
  const short = (over = {}) => ({
    startMillis: START,
    endMillis: START + 180000,
    activeSeconds: 180,
    typeAutoDetected: true,
    ...over,
  });

  it("drops a three-minute record the band detected on its own", () => {
    expect(resolveSessions([short()], fakeStore())).toHaveLength(0);
  });

  it("keeps one that reaches the floor", () => {
    const ok = short({ activeSeconds: 5 * 60 });
    expect(resolveSessions([ok], fakeStore())).toHaveLength(1);
  });

  it("keeps the six and nine minute ones from the real archive", () => {
    const six = short({ activeSeconds: 6 * 60 });
    const nine = short({ startMillis: START + 1, activeSeconds: 9 * 60 });
    expect(resolveSessions([six, nine], fakeStore())).toHaveLength(2);
  });

  // Every one of these is the user having said something about the record, and
  // a record you have spoken about is one you want.
  it("never drops one you have named, noted, retimed or corrected", () => {
    const cases = [
      { typeId: "climb" },
      { note: "warm up" },
      { activeSecondsOverride: 200 },
      { startOverride: START - 60000 },
    ];
    for (const annotation of cases) {
      const store = fakeStore({ annotations: { [START]: annotation } });
      expect(resolveSessions([short()], store)).toHaveLength(1);
    }
  });

  it("ignores an empty note, which is what the store writes for no note", () => {
    const store = fakeStore({ annotations: { [START]: { note: "   " } } });
    expect(resolveSessions([short()], store)).toHaveLength(0);
  });

  // A session you or Atlas created is never the band guessing, however short.
  it("never drops a manual session", () => {
    const manual = { startMillis: START, activeSeconds: 120, manual: true };
    expect(resolveSessions([], fakeStore({ manualSessions: [manual] }))).toHaveLength(1);
  });

  it("keeps a record the band did not auto-detect", () => {
    expect(resolveSessions([short({ typeAutoDetected: false })], fakeStore())).toHaveLength(1);
  });

  // No duration is not evidence of being short.
  it("keeps one with no duration recorded at all", () => {
    expect(resolveSessions([short({ activeSeconds: null })], fakeStore())).toHaveLength(1);
  });
});

/**
 * A cut record's calories, divided by what each part actually was.
 *
 * applySplits shares them by the clock, which is wrong when the halves were
 * different activities: the case the splitter was built for is a climb followed
 * by the walk home, and by time alone the walk takes far more than it earned.
 */
describe("calories across a split", () => {
  const typed = (names) =>
    fakeStore({
      splits: { [START]: [CUT] },
      annotations: Object.fromEntries(
        Object.entries(names).map(([t, name]) => [t, { typeId: name }])
      ),
    });

  /** The store looks a type name up by id; here the id IS the name. */
  const withTypeNames = (names) => ({
    ...typed(names),
    typeNameFor: (w) => names[w.startMillis] ?? null,
  });

  const RECORD_WITH_KCAL = { ...RECORD, caloriesKcal: 600 };

  it("gives the harder half more than its share of the clock", () => {
    const store = withTypeNames({ [START]: "Running", [CUT]: "Walking" });
    const parts = resolveSessions([RECORD_WITH_KCAL], store);
    expect(parts).toHaveLength(2);

    const first = parts.find((p) => p.startMillis === START);
    const second = parts.find((p) => p.startMillis === CUT);
    const firstShare = first.caloriesKcal / (first.caloriesKcal + second.caloriesKcal);
    const firstTime = first.activeSeconds / (first.activeSeconds + second.activeSeconds);
    expect(firstShare).toBeGreaterThan(firstTime);
  });

  // The band measured the whole and only its division changes.
  it("keeps the total the band measured", () => {
    const store = withTypeNames({ [START]: "Running", [CUT]: "Walking" });
    const parts = resolveSessions([RECORD_WITH_KCAL], store);
    const total = parts.reduce((sum, p) => sum + p.caloriesKcal, 0);
    expect(Math.abs(total - 600)).toBeLessThanOrEqual(1);
  });

  // A boulder day: hiking 6.0 against climbing 5.8 is the same per minute, so
  // the clock is the right divider and nothing should move.
  it("stands down when the two activities cost the same", () => {
    const store = withTypeNames({ [START]: "Indoor Climbing", [CUT]: "Hiking" });
    const parts = resolveSessions([RECORD_WITH_KCAL], store);
    expect(parts.every((p) => p.caloriesByActivity !== true)).toBe(true);
  });

  it("stands down when a part has not been typed", () => {
    const store = withTypeNames({ [START]: "Running" });
    const parts = resolveSessions([RECORD_WITH_KCAL], store);
    expect(parts.every((p) => p.caloriesByActivity !== true)).toBe(true);
  });

  it("stands down for a type Atlas does not recognise", () => {
    const store = withTypeNames({ [START]: "Running", [CUT]: "Boot and Scoot" });
    const parts = resolveSessions([RECORD_WITH_KCAL], store);
    expect(parts.every((p) => p.caloriesByActivity !== true)).toBe(true);
  });
});
