import { describe, it, expect } from "vitest";
import { napColumns, NAP_AXIS_START_HOUR, NAP_AXIS_END_HOUR } from "@/components/sleep/napChart";

const at = (day, h, m = 0) => new Date(2026, 7, day, h, m, 0, 0).getTime();
const nap = (day, h, m, minutes) => ({
  bedTime: at(day, h, m),
  wakeTime: at(day, h, m) + minutes * 60000,
  minutes,
});

describe("napColumns", () => {
  it("places a nap by the hour it started", () => {
    // Half way down the axis is half way through the day it covers: 09:00 to
    // midnight is 15 hours, so 16:30 is the midpoint.
    const { columns } = napColumns([{ date: "2026-08-16", naps: [nap(16, 16, 30, 30)] }], {
      height: 100,
    });
    expect(columns[0].marks[0].y).toBeCloseTo(50, 5);
  });

  it("draws a longer nap taller", () => {
    const { columns } = napColumns(
      [
        { date: "2026-08-16", naps: [nap(16, 17, 34, 118)] },
        { date: "2026-08-17", naps: [nap(17, 15, 29, 47)] },
      ],
      { height: 100 }
    );
    expect(columns[0].marks[0].height).toBeGreaterThan(columns[1].marks[0].height);
  });

  it("gives the shortest nap a mark rather than a hairline", () => {
    // The real archive has a 16-minute nap. Proportionally that is 1.8% of the
    // axis, which on a 66px chart is a line nobody can see.
    const { columns } = napColumns([{ date: "2026-08-04", naps: [nap(4, 20, 55, 16)] }], {
      height: 66,
    });
    expect(columns[0].marks[0].height).toBeGreaterThanOrEqual(3);
  });

  it("keeps the days with no nap, because the gaps are the pattern", () => {
    const { columns, napDays } = napColumns([
      { date: "2026-08-14", naps: [nap(14, 17, 48, 31)] },
      { date: "2026-08-15", naps: [] },
      { date: "2026-08-16", naps: [nap(16, 17, 34, 118)] },
    ]);
    expect(columns).toHaveLength(3);
    expect(columns[1].marks).toEqual([]);
    expect(napDays).toBe(2);
  });

  it("draws two naps on one day in the order they happened", () => {
    // 2026-08-05 is the real case: 14:49 and again at 21:53.
    const { columns, naps } = napColumns([
      { date: "2026-08-05", naps: [nap(5, 21, 53, 41), nap(5, 14, 49, 23)] },
    ]);
    expect(columns[0].marks.map((m) => m.minutes)).toEqual([23, 41]);
    expect(naps).toBe(2);
  });

  it("covers exactly the window a nap can occupy", () => {
    // The axis is not a choice about layout: `isDaytimeSleep` accepts a bed hour
    // at or after 09:00 on the same calendar day at both ends, so these bounds
    // are the definition. If they ever disagree, a real nap falls off the chart.
    expect(NAP_AXIS_START_HOUR).toBe(9);
    expect(NAP_AXIS_END_HOUR).toBe(24);

    const { columns } = napColumns([{ date: "2026-08-22", naps: [nap(22, 9, 0, 30)] }], {
      height: 100,
    });
    expect(columns[0].marks[0].y).toBe(0);
  });

  it("survives a day with nothing on it", () => {
    expect(napColumns([]).columns).toEqual([]);
    expect(napColumns(undefined).naps).toBe(0);
    expect(napColumns([{ date: "2026-08-16", naps: [{}, null] }]).columns[0].marks).toEqual([]);
  });
});
