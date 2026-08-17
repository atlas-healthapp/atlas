import { describe, it, expect } from "vitest";
import { commitSleepSessions, isDaytimeSleep } from "@/utils/sampleIngest";
import { today } from "@/utils/date";

// Minimal stand-in for the checkin store: commitSleepSessions only needs
// entryFor and logMetric, so building a real Pinia store here would test
// Pinia rather than the grouping rules. Must mirror the real store's mutation
// semantics: logMetric mutates the entry object in place (via Object.assign)
// rather than replacing it, so a reference captured before the write still
// points to the same live object after it. This keeps the ordering constraint
// load-bearing: if the comparison logic moved after logMetric, using a stale
// previous would break the real store but pass a shallow-copy fake.
function fakeCheckin() {
  const byDate = new Map();
  return {
    entryFor: (d) => byDate.get(d) ?? null,
    logMetric: (fields, date) => {
      let e = byDate.get(date);
      if (!e) {
        e = {};
        byDate.set(date, e);
      }
      Object.assign(e, fields);
    },
    _all: byDate,
  };
}

const session = (o = {}) => ({
  bedTime: new Date("2026-07-27T23:02:00"),
  wakeTime: new Date("2026-07-28T06:32:00"),
  totalSleepMinutes: 410,
  remMinutes: 75,
  lightMinutes: 240,
  deepMinutes: 95,
  wakeMinutes: 20,
  avgHr: 54,
  score: 75,
  ...o,
});

describe("commitSleepSessions stage totals", () => {
  it("stores the four stage totals alongside the hours", () => {
    const checkin = fakeCheckin();
    commitSleepSessions([session()], checkin);
    const entry = checkin.entryFor("2026-07-28");
    expect(entry.sleep).toBeCloseTo(410 / 60, 5);
    expect(entry.sleepStages).toEqual({
      rem: 75,
      light: 240,
      deep: 95,
      wake: 20,
      score: 75,
      bedTime: new Date("2026-07-27T23:02:00").getTime(),
      wakeTime: new Date("2026-07-28T06:32:00").getTime(),
      avgHr: 54,
    });
  });

  it("drops an implausible sleeping heart rate rather than storing the sentinel", () => {
    // The same byte carries the device's "no reading" value, and 255 bpm on a
    // chart of nightly heart rates would flatten every real night against it.
    const checkin = fakeCheckin();
    commitSleepSessions([session({ avgHr: 255 })], checkin);
    expect(checkin.entryFor("2026-07-28").sleepStages.avgHr).toBeNull();
  });

  it("stores bedtime and waketime as epoch milliseconds, not Dates", () => {
    const checkin = fakeCheckin();
    commitSleepSessions([session()], checkin);
    const { bedTime, wakeTime } = checkin.entryFor("2026-07-28").sleepStages;
    // These round-trip through localStorage JSON. A Date would come back a
    // string, and a string that sometimes parses is worse than a number.
    expect(typeof bedTime).toBe("number");
    expect(typeof wakeTime).toBe("number");
    expect(wakeTime).toBeGreaterThan(bedTime);
  });

  it("keeps the most complete revision's stages, not the last one seen", () => {
    const checkin = fakeCheckin();
    const partial = session({
      wakeTime: new Date("2026-07-28T04:00:00"),
      totalSleepMinutes: 290, remMinutes: 40, lightMinutes: 180, deepMinutes: 70, wakeMinutes: 10,
    });
    // Partial arrives second, exactly as a repeat fetch delivers it.
    commitSleepSessions([session(), partial], checkin);
    expect(checkin.entryFor("2026-07-28").sleepStages.rem).toBe(75);
  });

  it("reports the date as changed when only the stages differ", () => {
    const checkin = fakeCheckin();
    commitSleepSessions([session()], checkin);
    const changed = commitSleepSessions([session({ remMinutes: 90, lightMinutes: 225 })], checkin);
    expect(changed.has("2026-07-28")).toBe(true);
  });

  it("keeps the more complete revision's timeline", () => {
    const checkin = fakeCheckin();
    const full = session({ stageTimeline: [{ stage: "light", startMinute: 0, minutes: 240 }] });
    const partial = session({
      wakeTime: new Date("2026-07-28T04:00:00"),
      totalSleepMinutes: 290,
      stageTimeline: [{ stage: "light", startMinute: 0, minutes: 120 }],
    });
    commitSleepSessions([full, partial], checkin);
    expect(checkin.entryFor("2026-07-28").sleepStages.timeline[0].minutes).toBe(240);
  });

  it("preserves live reference semantics to catch ordering regressions", () => {
    // If the comparison logic moves after logMetric, previous becomes stale
    // on the real store but not on a shallow-copy fake. This test verifies
    // the fixture mutates in place so it would catch that regression.
    const checkin = fakeCheckin();
    commitSleepSessions([session()], checkin);
    const capturedRef = checkin.entryFor("2026-07-28");

    // logMetric mutates the object in place, so the captured reference is live
    checkin.logMetric({ sleep: 7, sleepStages: { rem: 50, light: 200, deep: 80, wake: 30, score: 60 } }, "2026-07-28");

    // The reference points to the same object and reflects the new values
    expect(capturedRef).toBe(checkin.entryFor("2026-07-28"));
    expect(capturedRef.sleep).toBe(7);
    expect(capturedRef.sleepStages.rem).toBe(50);
  });
});

// A pull at 08:35 briefly announced an hour of sleep before correcting itself,
// because a truncated fetch delivered a fragment of the night before the night.
// A wrong number on screen long enough to be believed is worse than no number.
describe("commitSleepSessions partial nights", () => {
  it("ignores a fragment too short to be a night", () => {
    const checkin = fakeCheckin();
    const fragment = session({
      bedTime: new Date("2026-07-28T00:10:00"),
      wakeTime: new Date("2026-07-28T01:10:00"),
      totalSleepMinutes: 60,
    });

    commitSleepSessions([fragment], checkin);

    expect(checkin.entryFor("2026-07-28")).toBeNull();
  });

  it("does not let a later fragment shorten a night already recorded", () => {
    const checkin = fakeCheckin();
    commitSleepSessions([session()], checkin);

    const shorter = session({ totalSleepMinutes: 120 });
    commitSleepSessions([shorter], checkin);

    expect(checkin.entryFor("2026-07-28").sleep).toBeCloseTo(410 / 60, 5);
  });

  it("still accepts the real night when it arrives after the fragment", () => {
    const checkin = fakeCheckin();
    const fragment = session({
      bedTime: new Date("2026-07-28T00:10:00"),
      wakeTime: new Date("2026-07-28T01:10:00"),
      totalSleepMinutes: 60,
    });

    commitSleepSessions([fragment], checkin);
    commitSleepSessions([session()], checkin);

    expect(checkin.entryFor("2026-07-28").sleep).toBeCloseTo(410 / 60, 5);
  });

  it("lets a longer revision of the same night through", () => {
    const checkin = fakeCheckin();
    commitSleepSessions([session()], checkin);

    commitSleepSessions([session({ totalSleepMinutes: 470 })], checkin);

    expect(checkin.entryFor("2026-07-28").sleep).toBeCloseTo(470 / 60, 5);
  });

  it("prefers the longest session on a wake date over the earliest bedtime", () => {
    // The band refines sleep onset between revisions, so a fragment can carry a
    // bedtime a minute earlier than the finished night's. Sorting by bedtime
    // handed the date to the fragment with the real night sitting beside it.
    const checkin = fakeCheckin();
    const fragment = session({
      bedTime: new Date("2026-07-27T23:01:00"),
      wakeTime: new Date("2026-07-28T02:41:00"),
      totalSleepMinutes: 180,
    });

    commitSleepSessions([fragment, session()], checkin);

    expect(checkin.entryFor("2026-07-28").sleep).toBeCloseTo(410 / 60, 5);
  });
});

describe("naps", () => {
  const nap = (o = {}) =>
    session({
      bedTime: new Date("2026-07-28T14:00:00"),
      wakeTime: new Date("2026-07-28T16:10:00"),
      totalSleepMinutes: 125,
      score: 70,
      ...o,
    });

  it("never stores an afternoon sleep as that day's night", () => {
    // The bug: the 90-minute floor cannot catch a two-hour nap, and on a day the
    // band recorded no night there is nothing for it to lose to, so it was
    // committed as the night with its hours, stages and score.
    const checkin = fakeCheckin();
    commitSleepSessions([nap()], checkin);
    expect(checkin.entryFor("2026-07-28")).toBeNull();
  });

  it("does not let a long nap out-rank a genuinely bad night", () => {
    // Longest-wins picks the winner, so a three-hour nap beat a two-hour night
    // before naps were dropped ahead of the comparison rather than after it.
    const checkin = fakeCheckin();
    const badNight = session({
      bedTime: new Date("2026-07-28T02:40:00"),
      wakeTime: new Date("2026-07-28T04:55:00"),
      totalSleepMinutes: 130,
    });

    commitSleepSessions([nap({ totalSleepMinutes: 190 }), badNight], checkin);

    expect(checkin.entryFor("2026-07-28").sleep).toBeCloseTo(130 / 60, 5);
  });

  it("leaves a real night alone however late it ends", () => {
    // The rule is about where the whole sleep sits, not how late the wake is.
    // Somebody going to bed at 03:00 and sleeping until 11:30 is a night: it
    // spans midnight, so it can never be inside one daytime.
    const checkin = fakeCheckin();
    commitSleepSessions(
      [
        session({
          bedTime: new Date("2026-07-27T23:40:00"),
          wakeTime: new Date("2026-07-28T11:30:00"),
          totalSleepMinutes: 600,
        }),
      ],
      checkin
    );
    expect(checkin.entryFor("2026-07-28").sleep).toBeCloseTo(10, 5);
  });

  it("draws the line at the hours, not at the duration", () => {
    expect(isDaytimeSleep(nap())).toBe(true);
    // Starts before 09:00, so it is the tail of a night rather than a nap.
    expect(
      isDaytimeSleep({
        bedTime: new Date("2026-07-28T08:30:00"),
        wakeTime: new Date("2026-07-28T10:00:00"),
      })
    ).toBe(false);
    // Runs past 19:00, which is an early bedtime rather than a nap.
    expect(
      isDaytimeSleep({
        bedTime: new Date("2026-07-28T18:00:00"),
        wakeTime: new Date("2026-07-28T20:30:00"),
      })
    ).toBe(false);
    // Anything that is not a pair of Dates is not something to judge.
    expect(isDaytimeSleep(null)).toBe(false);
    expect(isDaytimeSleep({ bedTime: 1, wakeTime: 2 })).toBe(false);
  });
});

// The 90-minute floor cannot catch a fragment that is hours long. On 2026-08-06
// a sync shortly after waking committed three hours for a night that was nine.
// The band scores a session when it finalises it, so an unscored one is still
// being written.
describe("commitSleepSessions unfinished nights", () => {
  const wakeToday = new Date(`${today()}T07:30:00`);
  const morning = (o = {}) =>
    session({
      bedTime: new Date(wakeToday.getTime() - 8 * 60 * 60 * 1000),
      wakeTime: wakeToday,
      ...o,
    });

  it("holds this morning's night until the band has scored it", () => {
    const checkin = fakeCheckin();

    commitSleepSessions([morning({ score: 0, totalSleepMinutes: 180 })], checkin);

    expect(checkin.entryFor(today())).toBeNull();
  });

  it("commits this morning's night once it carries a score", () => {
    const checkin = fakeCheckin();

    commitSleepSessions([morning({ score: 76 })], checkin);

    expect(checkin.entryFor(today()).sleep).toBeCloseTo(410 / 60, 5);
  });

  it("still commits an unscored night for an earlier date", () => {
    // An older date is settled by definition, and a historic night that came
    // back unscored should not be locked out of the archive over it.
    const checkin = fakeCheckin();

    commitSleepSessions([session({ score: 0 })], checkin);

    expect(checkin.entryFor("2026-07-28").sleep).toBeCloseTo(410 / 60, 5);
  });
});

describe("a later revision must not lose the stage detail", () => {
  // Measured on 2026-08-10: the band offered the night with 49 segments and a
  // score of 73, then a later revision scoring 72 whose segments did not add up
  // to its own totals, so the decoder discarded them. The hours had not shrunk,
  // so the empty timeline overwrote the good one and the night lost its
  // hypnogram entirely.
  const wakeAt = (iso) => new Date(iso);

  function session({ minutes = 540, score = 73, timeline = null }) {
    return {
      bedTime: wakeAt("2026-08-10T00:09:00"),
      wakeTime: wakeAt("2026-08-10T09:27:00"),
      totalSleepMinutes: minutes,
      remMinutes: 150,
      lightMinutes: 335,
      deepMinutes: 33,
      wakeMinutes: 22,
      avgHr: 55,
      score,
      stageTimeline: timeline,
    };
  }

  function fakeCheckin() {
    const rows = [];
    return {
      rows,
      entryFor: (date) => rows.find((r) => r.date === date) ?? null,
      logMetric(fields, date) {
        const found = rows.find((r) => r.date === date);
        if (found) Object.assign(found, fields);
        else rows.push({ date, ...fields });
      },
    };
  }

  it("keeps a stored timeline when the new telling has none", () => {
    const checkin = fakeCheckin();
    const good = [{ stage: "light", startMinute: 0, minutes: 540 }];
    commitSleepSessions([session({ timeline: good })], checkin);
    expect(checkin.rows[0].sleepStages.timeline).toHaveLength(1);

    // Same night, same length, no usable stage detail.
    commitSleepSessions([session({ score: 72, timeline: null })], checkin);
    expect(checkin.rows[0].sleepStages.timeline).toHaveLength(1);
    // And the totals still describe the telling the timeline came from.
    expect(checkin.rows[0].sleepStages.score).toBe(73);
  });

  it("still accepts a night with no timeline when nothing is stored yet", () => {
    const checkin = fakeCheckin();
    commitSleepSessions([session({ timeline: null })], checkin);
    expect(checkin.rows).toHaveLength(1);
    expect(checkin.rows[0].sleep).toBeGreaterThan(0);
  });

  it("takes a better timeline over a stored one", () => {
    const checkin = fakeCheckin();
    commitSleepSessions([session({ timeline: [{ stage: "light", startMinute: 0, minutes: 540 }] })], checkin);
    const richer = [
      { stage: "light", startMinute: 0, minutes: 200 },
      { stage: "deep", startMinute: 200, minutes: 140 },
      { stage: "rem", startMinute: 340, minutes: 200 },
    ];
    commitSleepSessions([session({ score: 74, timeline: richer })], checkin);
    expect(checkin.rows[0].sleepStages.timeline).toHaveLength(3);
    expect(checkin.rows[0].sleepStages.score).toBe(74);
  });
});
