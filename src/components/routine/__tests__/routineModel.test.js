import { describe, it, expect } from "vitest";
import {
  habitRows,
  routineBands,
  nextUp,
  routineStatus,
  routineTally,
  keptPerDay,
  STRIP_DAYS,
} from "@/components/routine/routineModel";

// 2026-07-30 is a Thursday (getDay 4).
const TODAY = "2026-07-30";
const DAILY = [0, 1, 2, 3, 4, 5, 6];

/** A stand-in for the store: only `habits` and `isDone`/`dueOn` are read. */
function store(habits, ticks = []) {
  const isDone = (habitId, date) =>
    ticks.some((t) => t.habitId === habitId && t.date === date);
  return {
    habits,
    isDone,
    dueOn: (date) => {
      const dow = new Date(date + "T12:00:00").getDay();
      return habits.filter((h) => !h.archived && h.days.includes(dow));
    },
  };
}

/** The user's own shape: nine daily habits spread across the four bands. */
function routine(ticks = []) {
  return store(
    [
      { id: "shower", name: "Morning shower", days: DAILY, band: "morning" },
      { id: "light", name: "Daylight before 9am", days: DAILY, band: "morning" },
      { id: "mob", name: "10 min mobility", days: DAILY, band: "morning" },
      { id: "steps", name: "8k steps", days: DAILY, band: "day" },
      { id: "pepsi", name: "No Pepsi Max after 6pm", days: DAILY, band: "evening" },
      { id: "minox", name: "Minoxidil + finasteride", days: DAILY, band: "evening" },
      { id: "read", name: "Read 20 min", days: DAILY, band: "night" },
      { id: "screens", name: "No screens after 11", days: DAILY, band: "night" },
      { id: "bed", name: "In bed by 11:30", days: DAILY, band: "night" },
    ],
    ticks
  );
}

function stateOn(row, date) {
  return row.dots.find((d) => d.date === date)?.state;
}

describe("habitRows", () => {
  it("gives every active habit a full window of days", () => {
    const rows = habitRows(store([{ id: "a", name: "Stretch", days: DAILY }]), TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].dots).toHaveLength(STRIP_DAYS);
    expect(rows[0].dots.at(-1).date).toBe(TODAY);
    expect(rows[0].dots[0].date).toBe("2026-07-01");
  });

  it("leaves archived habits out", () => {
    const rows = habitRows(
      store([
        { id: "a", name: "Stretch", days: DAILY },
        { id: "b", name: "Read", days: DAILY, archived: true },
      ]),
      TODAY
    );
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("marks a ticked day as a hit and a past untaken one as a miss", () => {
    const rows = habitRows(
      store(
        [{ id: "a", name: "Stretch", days: DAILY }],
        [{ habitId: "a", date: "2026-07-29" }]
      ),
      TODAY
    );
    expect(stateOn(rows[0], "2026-07-29")).toBe("hit");
    expect(stateOn(rows[0], "2026-07-28")).toBe("miss");
  });

  // The whole reason for a separate state: at 8am an untaken habit has not been
  // failed, and drawing it the same as a missed day makes every morning look bad.
  it("leaves today pending rather than counting it as missed", () => {
    const rows = habitRows(store([{ id: "a", name: "Stretch", days: DAILY }]), TODAY);
    expect(stateOn(rows[0], TODAY)).toBe("due");
    expect(rows[0].doneToday).toBe(false);
  });

  it("does not count a day the habit was not due", () => {
    // Mondays only (getDay 1). 2026-07-27 is a Monday.
    const rows = habitRows(store([{ id: "a", name: "Gym", days: [1] }]), TODAY);
    expect(stateOn(rows[0], "2026-07-27")).toBe("miss");
    expect(stateOn(rows[0], "2026-07-28")).toBe("off");
    expect(rows[0].dueToday).toBe(false);
  });

  // Without this a habit added this morning shows 29 days of failure it never
  // had the chance to miss.
  it("does not blame a habit for days before it existed", () => {
    const rows = habitRows(
      store([{ id: "a", name: "Stretch", days: DAILY, created: "2026-07-28" }]),
      TODAY
    );
    expect(stateOn(rows[0], "2026-07-27")).toBe("off");
    expect(stateOn(rows[0], "2026-07-28")).toBe("miss");
  });

  it("orders by band, then by the order they were added", () => {
    const rows = habitRows(
      store([
        { id: "bed", name: "In bed", days: DAILY, band: "night" },
        { id: "shower", name: "Shower", days: DAILY, band: "morning" },
        { id: "pepsi", name: "No Pepsi", days: DAILY, band: "evening" },
        { id: "light", name: "Daylight", days: DAILY, band: "morning" },
      ]),
      TODAY
    );
    expect(rows.map((r) => r.id)).toEqual(["shower", "light", "pepsi", "bed"]);
  });

  // A habit stored before bands existed must still land somewhere renderable.
  it("puts a habit with no band, or an unknown one, in DAY", () => {
    const rows = habitRows(
      store([
        { id: "none", name: "Old habit", days: DAILY },
        { id: "junk", name: "Odd habit", days: DAILY, band: "afternoon" },
      ]),
      TODAY
    );
    expect(rows.map((r) => r.band)).toEqual(["day", "day"]);
  });

  it("does not reorder as habits are ticked", () => {
    const before = habitRows(routine(), TODAY).map((r) => r.id);
    const after = habitRows(routine([{ habitId: "shower", date: TODAY }]), TODAY).map(
      (r) => r.id
    );
    expect(after).toEqual(before);
  });

  it("survives a store with no habits at all", () => {
    expect(habitRows(store([]), TODAY)).toEqual([]);
  });
});

describe("routineBands", () => {
  it("returns all four bands with their rows and tallies", () => {
    const bands = routineBands(routine([{ habitId: "shower", date: TODAY }]), TODAY);
    expect(bands.map((b) => b.id)).toEqual(["morning", "day", "evening", "night"]);
    expect(bands.map((b) => b.rows.length)).toEqual([3, 1, 2, 3]);
    expect(bands[0]).toMatchObject({ done: 1, due: 3 });
    expect(bands[3]).toMatchObject({ done: 0, due: 3 });
  });

  // A band that vanished when it emptied would take the reading with it: a flat
  // EVENING bar at 4pm is exactly the thing worth seeing.
  it("keeps an empty band rather than dropping it", () => {
    const bands = routineBands(
      store([{ id: "a", name: "Shower", days: DAILY, band: "morning" }]),
      TODAY
    );
    expect(bands).toHaveLength(4);
    expect(bands[1]).toMatchObject({ id: "day", rows: [], due: 0, done: 0 });
  });

  it("counts only what is due today in a band's tally", () => {
    // 2026-07-30 is a Thursday, so the Monday habit is not due.
    const bands = routineBands(
      store([
        { id: "mon", name: "Gym", days: [1], band: "day" },
        { id: "daily", name: "Steps", days: DAILY, band: "day" },
      ]),
      TODAY
    );
    expect(bands[1]).toMatchObject({ due: 1, done: 0 });
    expect(bands[1].rows).toHaveLength(2);
  });
});

describe("routineStatus", () => {
  it("is the first unticked habit of the day when the day has just started", () => {
    expect(routineStatus(routine(), TODAY, "morning").next.id).toBe("shower");
  });

  it("moves on as each one is ticked", () => {
    const ticks = [
      { habitId: "shower", date: TODAY },
      { habitId: "light", date: TODAY },
    ];
    expect(routineStatus(routine(ticks), TODAY, "morning").next.id).toBe("mob");
  });

  // The bug this replaced: skip the shower and the card still asked for it at
  // four in the afternoon.
  it("skips past a missed band once the clock has left it", () => {
    const status = routineStatus(routine(), TODAY, "evening");
    expect(status.next.id).toBe("pepsi");
  });

  it("counts what was left behind rather than listing it", () => {
    // Morning and day untouched, so four habits are already behind by evening.
    const status = routineStatus(routine(), TODAY, "evening");
    expect(status.missed).toBe(4);
  });

  it("does not count the habits already done as missed", () => {
    const ticks = [
      { habitId: "shower", date: TODAY },
      { habitId: "light", date: TODAY },
      { habitId: "mob", date: TODAY },
    ];
    expect(routineStatus(routine(ticks), TODAY, "evening").missed).toBe(1);
  });

  // A card claiming the routine is done while something sits unticked would be
  // lying, so the fallback pulls a missed habit up instead - the most recent
  // one, since at ten at night the evening pill is doable and the morning
  // shower is not.
  it("falls back to what was missed when nothing is left in this band or later", () => {
    const ticks = [
      { habitId: "shower", date: TODAY },
      { habitId: "mob", date: TODAY },
      { habitId: "steps", date: TODAY },
      { habitId: "pepsi", date: TODAY },
      { habitId: "minox", date: TODAY },
      { habitId: "read", date: TODAY },
      { habitId: "screens", date: TODAY },
      { habitId: "bed", date: TODAY },
    ];
    const status = routineStatus(routine(ticks), TODAY, "night");
    expect(status.next.id).toBe("light");
    expect(status.missed).toBe(0);
    // The one it fell back to is not also reported as left behind.
    expect(status.missed).toBe(0);
    expect(status.allDone).toBe(false);
  });

  // The distinction the fallback exists for: two things open in bands already
  // gone, and the later one is the one still worth offering.
  it("falls back to the most recent missed habit, not the earliest", () => {
    const ticks = [
      { habitId: "light", date: TODAY },
      { habitId: "mob", date: TODAY },
      { habitId: "steps", date: TODAY },
      { habitId: "minox", date: TODAY },
      { habitId: "read", date: TODAY },
      { habitId: "screens", date: TODAY },
      { habitId: "bed", date: TODAY },
    ];
    // Left open: the morning shower, and no-Pepsi-Max in the evening.
    const status = routineStatus(routine(ticks), TODAY, "night");
    expect(status.next.id).toBe("pepsi");
    expect(status.missed).toBe(1);
  });

  it("is done only when everything due today is ticked", () => {
    const ticks = routine().habits.map((h) => ({ habitId: h.id, date: TODAY }));
    const status = routineStatus(routine(ticks), TODAY, "evening");
    expect(status.next).toBeNull();
    expect(status.missed).toBe(0);
    expect(status.allDone).toBe(true);
  });

  it("skips habits that are not due today", () => {
    const s = store([
      { id: "mon", name: "Gym", days: [1], band: "morning" },
      { id: "daily", name: "Shower", days: DAILY, band: "morning" },
    ]);
    expect(routineStatus(s, TODAY, "morning").next.id).toBe("daily");
  });

  it("is done when nothing is due at all", () => {
    const s = store([{ id: "mon", name: "Gym", days: [1] }]);
    expect(routineStatus(s, TODAY, "morning")).toMatchObject({
      next: null,
      missed: 0,
      allDone: true,
    });
  });
});

describe("nextUp", () => {
  it("is routineStatus's next, for callers that want only that", () => {
    const next = nextUp(routine(), TODAY);
    expect(next.id).toBe(routineStatus(routine(), TODAY).next.id);
  });
});

describe("keptPerDay", () => {
  it("returns a day per day in the window, oldest first", () => {
    const { days } = keptPerDay(routine(), TODAY);
    expect(days).toHaveLength(STRIP_DAYS);
    expect(days[0].date).toBe("2026-07-01");
    expect(days.at(-1)).toMatchObject({ date: TODAY, isToday: true });
  });

  it("scores a day by what was due that day", () => {
    const ticks = [
      { habitId: "shower", date: "2026-07-29" },
      { habitId: "light", date: "2026-07-29" },
      { habitId: "mob", date: "2026-07-29" },
    ];
    const day = keptPerDay(routine(ticks), TODAY).days.find(
      (d) => d.date === "2026-07-29"
    );
    expect(day).toMatchObject({ due: 9, done: 3 });
    expect(day.pct).toBeCloseTo(3 / 9);
  });

  // Adding a tenth habit today must not make last week look worse than it was.
  it("counts only habits that existed and were due", () => {
    const s = store([
      { id: "old", name: "Shower", days: DAILY, band: "morning" },
      { id: "new", name: "Journal", days: DAILY, band: "night", created: TODAY },
      { id: "mon", name: "Gym", days: [1], band: "day" },
    ]);
    const days = keptPerDay(s, TODAY).days;
    // 2026-07-29 is a Tuesday: the new habit did not exist, the Monday one was
    // not due, so only the shower counts.
    expect(days.find((d) => d.date === "2026-07-29")).toMatchObject({ due: 1 });
    expect(days.find((d) => d.date === TODAY)).toMatchObject({ due: 2 });
  });

  it("leaves today out of the kept average, since the day is not over", () => {
    // Every past day fully kept, today untouched.
    const ticks = [];
    for (let i = 1; i < STRIP_DAYS; i++) {
      const d = new Date("2026-07-30T12:00:00");
      d.setDate(d.getDate() - i);
      ticks.push({ habitId: "a", date: d.toLocaleDateString("sv") });
    }
    const s = store([{ id: "a", name: "Shower", days: DAILY }], ticks);
    expect(keptPerDay(s, TODAY).kept).toBe(100);
  });

  it("has no rate at all when nothing has ever been due", () => {
    expect(keptPerDay(store([]), TODAY).kept).toBeNull();
  });
});

describe("routineTally", () => {
  it("counts only what is due today", () => {
    const habits = [
      { id: "all", name: "Stretch", days: DAILY },
      { id: "thu", name: "Read", days: [4] },
      { id: "mon", name: "Gym", days: [1] },
    ];
    expect(
      routineTally(store(habits, [{ habitId: "all", date: TODAY }]), TODAY)
    ).toEqual({ due: 2, done: 1 });
  });

  it("is zero over zero when nothing is due", () => {
    expect(routineTally(store([{ id: "mon", name: "Gym", days: [1] }]), TODAY)).toEqual(
      { due: 0, done: 0 }
    );
  });
});
