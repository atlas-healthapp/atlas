import { describe, it, expect } from "vitest";
import { stressByDay, stressHistoryColumns, HISTORY_DAYS } from "../stressHistory";

/** Readings every 5 minutes at one value, starting at 09:00 local on `date`. */
function run(date, value, count, startHour = 9) {
  const base = new Date(`${date}T00:00:00`);
  base.setHours(startHour, 0, 0, 0);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ metric: "stress", t: base.getTime() + i * 5 * 60_000, v: value });
  }
  return out;
}

describe("stressByDay", () => {
  it("keeps a slot for a day with no readings", () => {
    const dates = ["2026-08-01", "2026-08-02", "2026-08-03"];
    const days = stressByDay(run("2026-08-02", 20, 13), dates);
    expect(days.map((d) => d.date)).toEqual(dates);
    expect(days[0].measured).toBe(0);
    expect(days[1].measured).toBeGreaterThan(0);
    expect(days[2].measured).toBe(0);
  });

  it("puts each reading on its own local day", () => {
    const dates = ["2026-08-01", "2026-08-02"];
    const samples = [...run("2026-08-01", 20, 13), ...run("2026-08-02", 70, 13)];
    const days = stressByDay(samples, dates);
    expect(days[0].totals.calm).toBeGreaterThan(0);
    expect(days[0].totals.moderate).toBe(0);
    expect(days[1].totals.moderate).toBeGreaterThan(0);
    expect(days[1].totals.calm).toBe(0);
  });

  it("ignores a sample outside the run of days asked for", () => {
    const days = stressByDay(run("2026-07-01", 20, 13), ["2026-08-01"]);
    expect(days[0].measured).toBe(0);
  });
});

describe("stressHistoryColumns", () => {
  const day = (date, totals, measured) => ({ date, totals, measured });

  it("scales to the busiest day, so a short-wear day looks short", () => {
    const { columns, peakMinutes } = stressHistoryColumns(
      [day("a", { calm: 60 }, 60), day("b", { calm: 240 }, 240)],
      { height: 40 }
    );
    expect(peakMinutes).toBe(240);
    const a = columns[0].segments[0];
    const b = columns[1].segments[0];
    expect(b.height).toBeCloseTo(40, 5);
    expect(a.height).toBeCloseTo(10, 5);
  });

  it("never normalises a day to full height", () => {
    // The trap: a four-hour day and a twelve-hour day both spent entirely calm
    // must not draw the same column.
    const { columns } = stressHistoryColumns(
      [day("a", { calm: 240 }, 240), day("b", { calm: 720 }, 720)],
      { height: 40 }
    );
    expect(columns[0].segments[0].height).toBeLessThan(columns[1].segments[0].height);
  });

  it("stacks calm at the bottom and high at the top", () => {
    const { columns } = stressHistoryColumns(
      [day("a", { calm: 100, mild: 50, high: 25 }, 175)],
      { height: 40 }
    );
    const keys = columns[0].segments.map((s) => s.key);
    expect(keys).toEqual(["calm", "mild", "high"]);
    // y decreases as the stack grows upward, and the stack sits on the floor.
    const [calm, mild, high] = columns[0].segments;
    expect(calm.y + calm.height).toBeCloseTo(40, 5);
    expect(mild.y + mild.height).toBeCloseTo(calm.y, 5);
    expect(high.y + high.height).toBeCloseTo(mild.y, 5);
  });

  it("draws no segment for a zone with no minutes", () => {
    const { columns } = stressHistoryColumns([day("a", { calm: 100, mild: 0 }, 100)]);
    expect(columns[0].segments).toHaveLength(1);
  });

  it("marks a day with nothing measured as empty and draws nothing", () => {
    const { columns, measuredDays } = stressHistoryColumns([
      day("a", { calm: 100 }, 100),
      day("b", {}, 0),
    ]);
    expect(columns[1].empty).toBe(true);
    expect(columns[1].segments).toHaveLength(0);
    expect(measuredDays).toBe(1);
  });

  it("keeps every column inside the coordinate space and evenly pitched", () => {
    const days = Array.from({ length: HISTORY_DAYS }, (_, i) =>
      day(`d${i}`, { calm: 100 + i }, 100 + i)
    );
    const { columns } = stressHistoryColumns(days);
    expect(columns).toHaveLength(HISTORY_DAYS);
    expect(columns[0].x).toBeGreaterThanOrEqual(0);
    expect(columns.at(-1).x + columns.at(-1).width).toBeLessThanOrEqual(100);
    const pitch = columns[1].x - columns[0].x;
    for (let i = 2; i < columns.length; i++) {
      expect(columns[i].x - columns[i - 1].x).toBeCloseTo(pitch, 5);
    }
  });

  it("survives an empty window", () => {
    expect(stressHistoryColumns([])).toMatchObject({
      columns: [],
      peakMinutes: 0,
      measuredDays: 0,
    });
  });

  it("drops the unmeasured run at the start but keeps a gap in the middle", () => {
    const days = [
      day("d0", {}, 0),
      day("d1", {}, 0),
      day("d2", { calm: 100 }, 100),
      day("d3", {}, 0),
      day("d4", { calm: 80 }, 80),
    ];
    const { columns, from } = stressHistoryColumns(days);
    expect(columns).toHaveLength(3);
    expect(columns[0].date).toBe("d2");
    expect(columns[1].empty).toBe(true);
    expect(from).toBe("d2");
  });
});
