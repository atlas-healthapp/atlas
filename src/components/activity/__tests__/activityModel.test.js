import { describe, it, expect } from "vitest";
import {
  activeMinutes,
  weekColumns,
  columnHeights,
  monthTotals,
  monthStart,
  sessionsSince,
  fmtMinutes,
  fmtDuration,
} from "../activityModel";

// Local midnight, so these agree with dateKeyOf's own toLocaleDateString
// regardless of the machine's zone.
function at(dateKey, hour = 12) {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setHours(hour);
  return d.getTime();
}

const session = (dateKey, minutes, hour = 12) => ({
  startMillis: at(dateKey, hour),
  activeSeconds: minutes * 60,
});

describe("activeMinutes", () => {
  it("uses the band's active time, not the elapsed span", () => {
    expect(activeMinutes({ activeSeconds: 4744 })).toBeCloseTo(79.07, 2);
  });

  // Guessing from start and end would count a session you paused for lunch as
  // if you had not.
  it("contributes nothing when no active time was reported", () => {
    expect(activeMinutes({ startMillis: 0, endMillis: 9e6 })).toBe(0);
    expect(activeMinutes(null)).toBe(0);
  });
});

describe("weekColumns", () => {
  const todayKey = "2026-07-30";

  it("always returns seven days ending today, oldest first", () => {
    const cols = weekColumns([], todayKey);
    expect(cols).toHaveLength(7);
    expect(cols[0].date).toBe("2026-07-24");
    expect(cols[6].date).toBe(todayKey);
    expect(cols[6].isToday).toBe(true);
  });

  it("sums several sessions on one day into that day's column", () => {
    const cols = weekColumns(
      [session("2026-07-29", 45, 9), session("2026-07-29", 30, 18)],
      todayKey
    );
    expect(cols.find((c) => c.date === "2026-07-29").minutes).toBe(75);
  });

  it("leaves a rest day at zero rather than skipping it", () => {
    const cols = weekColumns([session("2026-07-30", 60)], todayKey);
    expect(cols.filter((c) => c.minutes === 0)).toHaveLength(6);
  });

  it("ignores sessions older than the week", () => {
    const cols = weekColumns([session("2026-07-01", 200)], todayKey);
    expect(cols.every((c) => c.minutes === 0)).toBe(true);
  });
});

describe("columnHeights", () => {
  // There is no target for active minutes. Scaling to a fixed ceiling would
  // make every honest week look like a failure.
  it("scales to the week's own busiest day", () => {
    const heights = columnHeights([{ minutes: 30 }, { minutes: 60 }, { minutes: 0 }]);
    expect(heights).toEqual([0.5, 1, 0]);
  });

  it("returns zeroes for a week with nothing in it instead of dividing by nothing", () => {
    expect(columnHeights([{ minutes: 0 }, { minutes: 0 }])).toEqual([0, 0]);
    expect(columnHeights([])).toEqual([]);
    expect(columnHeights(null)).toEqual([]);
  });
});

describe("monthTotals", () => {
  const sessions = [
    session("2026-07-05", 60),
    session("2026-07-20", 90),
    session("2026-06-28", 120),
  ];

  it("counts only this month", () => {
    const { total } = monthTotals(sessions, "2026-07-01");
    expect(total).toBe(150);
  });

  it("groups by type once a resolver knows the names", () => {
    const { rows } = monthTotals(sessions, "2026-07-01", (s) =>
      s.startMillis === at("2026-07-05", 12) ? "Indoor Climbing" : "Gym"
    );
    expect(rows.map((r) => [r.name, r.minutes])).toEqual([
      ["Gym", 90],
      ["Indoor Climbing", 60],
    ]);
  });

  // Unnamed time sitting visibly outside the named totals is the whole reason
  // to name anything, so it is never hidden and never leads.
  it("puts unnamed last however big it is", () => {
    const { rows } = monthTotals(sessions, "2026-07-01", (s) =>
      s.startMillis === at("2026-07-05", 12) ? "Gym" : null
    );
    expect(rows.map((r) => r.unnamed)).toEqual([false, true]);
    expect(rows[1].minutes).toBe(90);
  });

  it("scales the bars against the longest row", () => {
    const { rows } = monthTotals(sessions, "2026-07-01", () => null);
    expect(rows[0].fraction).toBe(1);
  });

  it("is empty rather than zero-filled when the month has nothing", () => {
    expect(monthTotals([], "2026-07-01")).toEqual({ total: 0, rows: [] });
  });
});

describe("monthStart / sessionsSince", () => {
  it("finds the first of the month a date falls in", () => {
    expect(monthStart("2026-07-30")).toBe("2026-07-01");
    expect(monthStart("2026-01-01")).toBe("2026-01-01");
  });

  it("returns sessions newest first", () => {
    const got = sessionsSince(
      [session("2026-07-10", 10), session("2026-07-28", 10), session("2026-06-01", 10)],
      "2026-07-01"
    );
    expect(got).toHaveLength(2);
    expect(got[0].startMillis).toBeGreaterThan(got[1].startMillis);
  });
});

describe("formatting", () => {
  it("drops the minutes when a total lands on the hour", () => {
    expect(fmtMinutes(120)).toBe("2h");
    expect(fmtMinutes(150)).toBe("2h 30m");
    expect(fmtMinutes(45)).toBe("45m");
  });

  it("writes a session as hours and padded minutes", () => {
    expect(fmtDuration(4744)).toBe("1:19");
    expect(fmtDuration(376)).toBe("6m");
    expect(fmtDuration(null)).toBe("--");
  });
});
