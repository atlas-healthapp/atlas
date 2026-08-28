import { describe, it, expect } from "vitest";
import {
  MAX_ALARMS,
  emptyAlarm,
  clashingDays,
  daysTakenBy,
  validate,
  alarmDueOn,
  hardTime,
  nextDue,
  slotOf,
  migrateSingle,
  planSummary,
  serialisePlan,
  describeNext,
  ownerOfDays,
  describeDayRun,
} from "../alarmPlan";

/** Weekdays 07:00 smart, weekend 09:30 onset - the case this was built for. */
const WEEKDAY = {
  id: "a",
  hour: 7,
  minute: 0,
  days: [1, 2, 3, 4, 5],
  enabled: true,
  mode: "smart",
  onsetHours: 8,
  latestHour: null,
  latestMinute: null,
};
const WEEKEND = {
  id: "b",
  hour: 9,
  minute: 30,
  days: [0, 6],
  enabled: true,
  mode: "onset",
  onsetHours: 8,
  latestHour: 10,
  latestMinute: 15,
};

// 2026-08-24 is a Monday.
const MONDAY = new Date(2026, 7, 24, 6, 0, 0);
const SATURDAY = new Date(2026, 7, 29, 6, 0, 0);

describe("the one-alarm-per-day rule", () => {
  it("passes a weekday and weekend pair", () => {
    expect(clashingDays([WEEKDAY, WEEKEND])).toEqual([]);
    expect(validate([WEEKDAY, WEEKEND]).ok).toBe(true);
  });

  // The whole model rests on this: the smart window, the fired-once mark and
  // the re-arm debt are single values in the service, and they can only stay
  // that way while at most one alarm is due a night.
  it("refuses two alarms on one day and names it", () => {
    const greedy = { ...WEEKEND, id: "c", days: [5, 6] };
    expect(clashingDays([WEEKDAY, greedy])).toEqual([5]);
    const out = validate([WEEKDAY, greedy]);
    expect(out.ok).toBe(false);
    expect(out.errors[0]).toContain("FRI");
  });

  // A disabled alarm holds no days: switching one off must free its days up
  // rather than blocking a day nothing will ring on.
  it("ignores a switched-off alarm", () => {
    const off = { ...WEEKDAY, id: "c", enabled: false };
    expect(clashingDays([WEEKDAY, off])).toEqual([]);
  });

  it("can ignore the alarm being edited, so it does not clash with itself", () => {
    expect(clashingDays([WEEKDAY, WEEKEND], { ignoreId: "a" })).toEqual([]);
  });

  it("reports which days another alarm already owns", () => {
    expect([...daysTakenBy([WEEKDAY, WEEKEND], "b")].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("holds at most five", () => {
    const many = Array.from({ length: MAX_ALARMS + 1 }, (_, i) => ({
      ...emptyAlarm(`x${i}`),
      days: [],
      enabled: false,
    }));
    expect(validate(many).ok).toBe(false);
    expect(validate(many).errors[0]).toContain(String(MAX_ALARMS));
  });
});

describe("which alarm tonight belongs to", () => {
  it("picks the weekday one on a Monday", () => {
    expect(alarmDueOn([WEEKDAY, WEEKEND], MONDAY).id).toBe("a");
  });

  it("picks the weekend one on a Saturday", () => {
    expect(alarmDueOn([WEEKDAY, WEEKEND], SATURDAY).id).toBe("b");
  });

  it("answers nothing when no alarm covers that day", () => {
    expect(alarmDueOn([WEEKDAY], SATURDAY)).toBeNull();
  });

  // An empty day list is a one-off, which is how the band reads REPEAT_ONCE
  // and how the service already treats it.
  it("treats an empty day list as every day", () => {
    const oneOff = { ...WEEKDAY, id: "c", days: [] };
    expect(alarmDueOn([oneOff], SATURDAY).id).toBe("c");
  });
});

describe("hardTime", () => {
  it("gives a fixed or smart alarm its own time", () => {
    expect(hardTime(WEEKDAY)).toEqual({ hour: 7, minute: 0 });
  });

  // An onset alarm hands the band the LATEST time it may go off, because the
  // strap holds a backstop rather than the answer. Getting this wrong puts a
  // re-armed alarm at the wrong one of the two.
  it("gives an onset alarm its cap", () => {
    expect(hardTime(WEEKEND)).toEqual({ hour: 10, minute: 15 });
  });

  it("falls back to the set time when an onset alarm has no cap", () => {
    expect(hardTime({ ...WEEKEND, latestHour: null })).toEqual({ hour: 9, minute: 30 });
  });
});

describe("nextDue", () => {
  it("finds today's alarm when it has not passed", () => {
    const out = nextDue([WEEKDAY, WEEKEND], MONDAY);
    expect(out.alarm.id).toBe("a");
    expect(out.at.getDate()).toBe(24);
    expect(out.at.getHours()).toBe(7);
  });

  // Today's has already rung, so the answer is tomorrow's - not today's again.
  it("skips past an alarm that has already gone off", () => {
    const afterIt = new Date(2026, 7, 24, 8, 0, 0);
    const out = nextDue([WEEKDAY, WEEKEND], afterIt);
    expect(out.at.getDate()).toBe(25);
  });

  // Friday evening: the next alarm is Saturday's, and it uses the cap.
  it("crosses into the weekend alarm", () => {
    const fridayNight = new Date(2026, 7, 28, 22, 0, 0);
    const out = nextDue([WEEKDAY, WEEKEND], fridayNight);
    expect(out.alarm.id).toBe("b");
    expect(out.at.getHours()).toBe(10);
  });

  it("answers nothing when every alarm is off", () => {
    expect(nextDue([{ ...WEEKDAY, enabled: false }], MONDAY)).toBeNull();
    expect(nextDue([], MONDAY)).toBeNull();
  });
});

describe("slots", () => {
  // A slot is a physical thing on the band. Reordering the list would write
  // over alarms the user never touched.
  it("is the list position", () => {
    expect(slotOf([WEEKDAY, WEEKEND], "a")).toBe(0);
    expect(slotOf([WEEKDAY, WEEKEND], "b")).toBe(1);
  });

  it("answers null for an alarm that is not there", () => {
    expect(slotOf([WEEKDAY], "zzz")).toBeNull();
  });
});

describe("migrating the single alarm", () => {
  it("wraps the old record as the first of a list", () => {
    const old = { hour: 9, minute: 0, days: [1, 2, 3], enabled: true, mode: "smart" };
    const out = migrateSingle(old);
    expect(out).toHaveLength(1);
    expect(out[0].hour).toBe(9);
    expect(out[0].id).toBe("alarm-1");
    // Fields the old record never had come from the blank.
    expect(out[0].onsetHours).toBe(8);
  });

  it("turns no alarm into no alarms", () => {
    expect(migrateSingle(null)).toEqual([]);
  });
});

describe("describeNext", () => {
  it("counts down to today's alarm", () => {
    // Monday 06:00, alarm at 07:00.
    const out = describeNext([WEEKDAY, WEEKEND], MONDAY);
    expect(out.when).toBe("TODAY");
    expect(out.gap).toBe("1H");
    expect(out.text).toBe("TODAY · IN 1H");
  });

  // Minutes alone under the hour: "0H 45M" is a worse way of saying 45 minutes.
  it("drops the hours when there are none", () => {
    const out = describeNext([WEEKDAY], new Date(2026, 7, 24, 6, 15, 0));
    expect(out.gap).toBe("45M");
  });

  it("keeps both when both matter", () => {
    const out = describeNext([WEEKDAY], new Date(2026, 7, 23, 22, 40, 0));
    expect(out.gap).toBe("8H 20M");
    expect(out.when).toBe("TOMORROW");
  });

  // Friday night, and Saturday's alarm is the next one - which is TOMORROW,
  // not SAT. Naming the weekday for something a few hours away would be a
  // worse way of saying the same thing.
  it("still says tomorrow when tomorrow is a different alarm", () => {
    const out = describeNext([WEEKDAY, WEEKEND], new Date(2026, 7, 28, 22, 0, 0));
    expect(out.when).toBe("TOMORROW");
    expect(out.alarm.id).toBe("b");
  });

  it("names the weekday once it is further out than that", () => {
    // Saturday, weekday alarms only: the next is Monday, two days on.
    const out = describeNext([WEEKDAY], SATURDAY);
    expect(out.when).toBe("MON");
  });

  // Days once it is far enough that the minutes are noise.
  it("counts in days when it is that far away", () => {
    expect(describeNext([WEEKDAY], SATURDAY).gap).toBe("2D");
  });

  it("says nothing when nothing will ring", () => {
    expect(describeNext([{ ...WEEKDAY, enabled: false }], MONDAY)).toBeNull();
    expect(describeNext([], MONDAY)).toBeNull();
  });
});

describe("naming who owns a day", () => {
  it("hands back the alarm holding each day", () => {
    const owners = ownerOfDays([WEEKDAY, WEEKEND], "b");
    expect(owners.get(1).id).toBe("a");
    expect(owners.get(6)).toBeUndefined();
  });

  it("ignores the alarm being edited and anything switched off", () => {
    expect(ownerOfDays([WEEKDAY], "a").size).toBe(0);
    expect(ownerOfDays([{ ...WEEKDAY, enabled: false }], "b").size).toBe(0);
  });
});

describe("describeDayRun", () => {
  // Monday-first, because a week reads that way even though the numbers run
  // from Sunday.
  it("collapses a run of three or more", () => {
    expect(describeDayRun([1, 2, 3, 4, 5])).toBe("MON-FRI");
    expect(describeDayRun([1, 2, 3])).toBe("MON-WED");
  });

  // SUN-MON for a weekend would be worse than naming both.
  it("lists a pair rather than dashing it", () => {
    expect(describeDayRun([0, 6])).toBe("SAT SUN");
    expect(describeDayRun([3])).toBe("WED");
  });

  it("separates runs that are not contiguous", () => {
    expect(describeDayRun([1, 2, 3, 6])).toBe("MON-WED SAT");
  });

  it("says nothing for no days", () => {
    expect(describeDayRun([])).toBe("");
  });
});

describe("serialisePlan", () => {
  // The exact string AlarmPlanTest.java parses. If this shape changes, that
  // test's fixture changes with it or the two silently stop agreeing.
  it("writes the format the Java parser reads", () => {
    expect(serialisePlan([WEEKDAY, WEEKEND])).toBe(
      "7|0|1|smart|1,2,3,4,5|8.0|-1|0;9|30|1|onset|0,6|8.0|10|15"
    );
  });

  it("writes an empty day list for a one-off", () => {
    expect(serialisePlan([{ ...WEEKDAY, days: [] }])).toContain("|smart||8.0|");
  });

  it("writes a switched-off alarm as 0 without dropping it", () => {
    // Dropping it would shift every later alarm's slot, which on the band
    // means writing over an alarm nobody touched.
    const out = serialisePlan([{ ...WEEKDAY, enabled: false }, WEEKEND]);
    expect(out.split(";")).toHaveLength(2);
    expect(out.startsWith("7|0|0|")).toBe(true);
  });

  it("survives an empty plan", () => {
    expect(serialisePlan([])).toBe("");
    expect(serialisePlan(undefined)).toBe("");
  });
});

describe("planSummary", () => {
  it("lists the times in order", () => {
    expect(planSummary([WEEKEND, WEEKDAY])).toBe("07:00 · 10:15");
  });

  it("counts only the ones that are on", () => {
    expect(planSummary([WEEKDAY, { ...WEEKEND, enabled: false }])).toBe("07:00");
    expect(planSummary([{ ...WEEKDAY, enabled: false }])).toBe("NONE SET");
    expect(planSummary([])).toBe("NONE SET");
  });
});
