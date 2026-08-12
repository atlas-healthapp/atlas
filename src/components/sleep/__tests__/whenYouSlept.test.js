import { describe, it, expect } from "vitest";
import { regularityColumns } from "@/components/sleep/whenYouSlept";

const at = (iso) => new Date(iso).getTime();
// 2026-07-20 is a Monday, so the two nights below are Monday and Tuesday.
const nights = [
  { date: "2026-07-20", bedMs: at("2026-07-19T22:40:00"), wakeMs: at("2026-07-20T08:20:00") },
  { date: "2026-07-21", bedMs: at("2026-07-20T23:40:00"), wakeMs: at("2026-07-21T08:20:00") },
];

describe("regularityColumns", () => {
  it("puts the clock on the vertical axis, with the evening at the bottom", () => {
    // 960 minutes over 960px, so a minute is a pixel. The night runs 22:40 to
    // 08:20, i.e. axis minutes 100 to 680, and the bar's top is its wake time.
    const { columns } = regularityColumns(nights, { height: 960 });
    expect(columns[0].y).toBeCloseTo(960 - 680, 1);
    expect(columns[0].h).toBeCloseTo(580, 1);
  });

  it("makes a bar rise out of the bedtime it started from", () => {
    // A later bedtime starts higher up the page, because up is later in the
    // night. The bottom of the bar is the bedtime, and that is what moves.
    const { columns } = regularityColumns(nights, { height: 960 });
    const bottomOf = (c) => c.y + c.h;
    expect(bottomOf(columns[1])).toBeLessThan(bottomOf(columns[0]));
  });

  it("gives each night its own column across the width", () => {
    const { columns } = regularityColumns(nights, { width: 200, barWidth: 12 });
    // Two slots of 100px, so the bars centre on 50 and 150.
    expect(columns[0].labelX).toBeCloseTo(50, 1);
    expect(columns[1].labelX).toBeCloseTo(150, 1);
    expect(columns[0].x).toBeCloseTo(44, 1);
    expect(columns[0].w).toBe(12);
  });

  it("labels each column with the weekday's initial", () => {
    const { columns } = regularityColumns(nights, {});
    expect(columns.map((c) => c.letter)).toEqual(["M", "T"]);
  });

  it("marks tonight's column so it can be picked out from the week", () => {
    const { columns } = regularityColumns(nights, { todayKey: "2026-07-21" });
    expect(columns.map((c) => c.today)).toEqual([false, true]);
  });

  it("shades the usual window as a horizontal band across every column", () => {
    const { band } = regularityColumns(nights, { height: 960 });
    expect(band.y).toBeGreaterThan(0);
    expect(band.h).toBeGreaterThan(0);
    expect(band.bedLabel).toMatch(/^\d{2}:\d{2}$/);
  });

  it("carries each column's times for a tap, without printing them", () => {
    // Fourteen small numbers competing with the shape they sit on is what Zepp
    // does. The shape is the finding; a specific time is a detail wanted for one
    // night, so it lives on the tap.
    const { columns } = regularityColumns(nights, {});
    expect(columns[0].bedLabel).toBe("22:40");
    expect(columns[0].wakeLabel).toBe("08:20");
  });

  it("anchors the axis on midnight and marks it", () => {
    // Four-hourly stepped 21:00, 01:00, 05:00, which reads as an axis that
    // jumps backwards: the numbers fall from 21 to 1 with nothing saying a day
    // boundary was crossed.
    const { gridlines } = regularityColumns(nights, { height: 960 });
    // 21:00 is the bottom of the axis now, so it is the first one generated and
    // sits at the full height.
    expect(gridlines[0].label).toBe("21:00");
    expect(gridlines[0].y).toBe(960);
    expect(gridlines.map((g) => g.label)).toContain("00:00");
    expect(gridlines.filter((g) => g.midnight)).toHaveLength(1);
    expect(gridlines.find((g) => g.midnight).y).toBe(960 - 180);
  });

  it("closes the axis off at the far end without labelling it", () => {
    const { gridlines } = regularityColumns(nights, { height: 960 });
    expect(gridlines.at(-1).y).toBe(0);
    expect(gridlines.at(-1).label).toBeNull();
  });

  it("clamps a night that starts before the axis rather than dropping it", () => {
    const early = [
      { date: "2026-07-22", bedMs: at("2026-07-21T20:10:00"), wakeMs: at("2026-07-22T06:00:00") },
    ];
    const { columns } = regularityColumns(early, { height: 960 });
    // Clamped to 21:00, which is the bottom of the axis.
    expect(columns[0].y + columns[0].h).toBe(960);
    expect(columns[0].h).toBeGreaterThan(0);
  });

  it("has nothing to draw for no nights", () => {
    const empty = regularityColumns([], {});
    expect(empty.columns).toEqual([]);
    expect(empty.band).toBeNull();
  });
});
