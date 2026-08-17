import { describe, it, expect } from "vitest";
import {
  currentStage,
  smartDecision,
  onsetAlarmTime,
  SMART_WINDOW_MINUTES,
  ONSET_COMMIT_HOUR,
} from "@/utils/smartAlarm";

const at = (iso) => new Date(iso).getTime();

/** A night that begins at 00:00 and runs through the stages given, in minutes. */
function session(runs, bed = "2026-08-11T00:00:00") {
  let minute = 0;
  const stageTimeline = runs.map(([stage, minutes]) => {
    const seg = { stage, startMinute: minute, minutes };
    minute += minutes;
    return seg;
  });
  return { bedTime: new Date(bed), stageTimeline };
}

describe("currentStage", () => {
  it("reports the stage covering the moment asked about", () => {
    const s = session([
      ["light", 60],
      ["deep", 60],
      ["rem", 60],
    ]);
    expect(currentStage(s, at("2026-08-11T00:30:00")).stage).toBe("light");
    expect(currentStage(s, at("2026-08-11T01:30:00")).stage).toBe("deep");
    expect(currentStage(s, at("2026-08-11T02:30:00")).stage).toBe("rem");
  });

  it("says how stale the reading is once the session stops covering now", () => {
    const s = session([["light", 60]]);
    const out = currentStage(s, at("2026-08-11T01:20:00"));
    expect(out.stage).toBe("light");
    expect(out.staleMinutes).toBeCloseTo(20, 0);
  });

  it("returns nothing usable rather than guessing", () => {
    expect(currentStage(null, at("2026-08-11T01:00:00"))).toBeNull();
    expect(currentStage({ bedTime: new Date() }, Date.now())).toBeNull();
    expect(currentStage(session([]), Date.now())).toBeNull();
  });

  it("takes a bedtime that has been through storage, which arrives as epoch ms", () => {
    // sleepStages is persisted as JSON, so a Date does not survive a reload.
    const s = session([["light", 60]]);
    const stored = { ...s, bedTime: s.bedTime.getTime() };
    expect(currentStage(stored, at("2026-08-11T00:30:00"))).toEqual(
      currentStage(s, at("2026-08-11T00:30:00"))
    );
  });

  it("refuses a bedtime in any other shape instead of computing on NaN", () => {
    // The failure this guards is silent and one-sided. Taken as-is, a string
    // bedtime makes every comparison below false and staleMinutes NaN, and
    // `NaN > maxStaleMinutes` is false - so the staleness check passes and a
    // reading hours out of date is treated as describing now.
    const s = session([["light", 60]]);
    for (const bad of ["2026-08-11T00:00:00", new Date("nonsense"), {}, NaN]) {
      expect(currentStage({ ...s, bedTime: bad }, at("2026-08-11T00:30:00"))).toBeNull();
    }
  });

  it("does not fire on a bedtime it could not read", () => {
    // The end of that path, through the decision the service actually asks for.
    const night = session([
      ["light", 400],
      ["deep", 40],
    ]);
    const out = smartDecision({
      session: { ...night, bedTime: "2026-08-11T00:00:00" },
      nowMillis: at("2026-08-11T06:50:00"),
      alarmMillis: at("2026-08-11T07:00:00"),
    });
    expect(out.fire).toBe(false);
    expect(out.reason).toBe("NO READING");
  });
});

describe("smartDecision", () => {
  const alarm = at("2026-08-11T08:00:00");
  const night = session(
    [
      ["light", 400],
      ["deep", 40],
      ["light", 60],
    ],
    "2026-08-11T00:00:00"
  );

  it("does nothing before the window opens", () => {
    const out = smartDecision({
      session: night,
      nowMillis: at("2026-08-11T07:20:00"),
      alarmMillis: alarm,
    });
    expect(out.fire).toBe(false);
    expect(out.reason).toBe("BEFORE THE WINDOW");
  });

  it("fires on a light reading inside the window", () => {
    const out = smartDecision({
      session: night,
      nowMillis: at("2026-08-11T07:50:00"),
      alarmMillis: alarm,
    });
    expect(out.fire).toBe(true);
    expect(out.stage).toBe("light");
    expect(out.minutesToAlarm).toBe(10);
  });

  it("refuses to wake you out of deep sleep", () => {
    // 06:40 into the night is inside the deep run.
    const out = smartDecision({
      session: night,
      nowMillis: at("2026-08-11T06:50:00"),
      alarmMillis: at("2026-08-11T07:00:00"),
    });
    expect(out.fire).toBe(false);
    expect(out.reason).toBe("DEEP OR REM");
  });

  it("does nothing at all when the strap gave no session", () => {
    // About a quarter of overnight syncs come back empty. That is not "awake".
    const out = smartDecision({
      session: null,
      nowMillis: at("2026-08-11T07:50:00"),
      alarmMillis: alarm,
    });
    expect(out.fire).toBe(false);
    expect(out.reason).toBe("NO READING");
  });

  it("will not act on a stale reading", () => {
    const short = session([["light", 30]], "2026-08-11T00:00:00");
    const out = smartDecision({
      session: short,
      nowMillis: at("2026-08-11T07:50:00"),
      alarmMillis: alarm,
    });
    expect(out.fire).toBe(false);
    expect(out.reason).toBe("READING TOO OLD");
  });

  it("stands down once the set time has passed, so nothing buzzes twice", () => {
    // The strap holds the hard alarm itself; firing here as well would be two
    // wakes for one alarm.
    const out = smartDecision({
      session: night,
      nowMillis: at("2026-08-11T08:05:00"),
      alarmMillis: alarm,
    });
    expect(out.fire).toBe(false);
    expect(out.reason).toBe("ALARM TIME PASSED");
  });

  it("never fires earlier than the window allows", () => {
    for (let m = 0; m <= 60; m += 5) {
      const now = alarm - m * 60000;
      const out = smartDecision({ session: night, nowMillis: now, alarmMillis: alarm });
      if (out.fire) expect(m).toBeLessThanOrEqual(SMART_WINDOW_MINUTES);
    }
  });
});

describe("onsetAlarmTime", () => {
  const onset = at("2026-08-11T00:20:00");

  it("is the onset plus the hours asked for", () => {
    const out = onsetAlarmTime({ onsetMillis: onset, hours: 8, nowMillis: at("2026-08-11T03:00:00") });
    expect(new Date(out.millis).getHours()).toBe(8);
    expect(out.cappedByLatest).toBe(false);
  });

  it("never runs past the latest time you set", () => {
    // The whole reason that field exists: a late night must not push the alarm
    // past the time you have to be up.
    const latest = at("2026-08-11T07:30:00");
    const out = onsetAlarmTime({
      onsetMillis: at("2026-08-11T02:00:00"),
      hours: 8,
      latestMillis: latest,
      nowMillis: at("2026-08-11T03:00:00"),
    });
    expect(out.millis).toBe(latest);
    expect(out.cappedByLatest).toBe(true);
  });

  it("stays provisional until the band's onset has settled", () => {
    // Measured: onset moved 22:01 to 00:19 between 01:38 and 02:08, then by only
    // eleven minutes over the next seven hours.
    const early = onsetAlarmTime({ onsetMillis: onset, hours: 8, nowMillis: at("2026-08-11T01:00:00") });
    const later = onsetAlarmTime({ onsetMillis: onset, hours: 8, nowMillis: at("2026-08-11T03:00:00") });
    expect(early.committed).toBe(false);
    expect(later.committed).toBe(true);
    expect(ONSET_COMMIT_HOUR).toBe(2);
  });

  it("has nothing to say without an onset", () => {
    expect(onsetAlarmTime({ onsetMillis: null, hours: 8 })).toBeNull();
  });
});
