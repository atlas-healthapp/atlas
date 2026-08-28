import { describe, it, expect } from "vitest";
import { weekStrip, stripNote, STRIP_DAYS } from "../weekStrip";

const VALUES = {
  "2026-08-20": 5,
  "2026-08-21": 5,
  "2026-08-24": 5,
  // 22, 23, 25, 26 are the real gaps in the archive's creatine log.
};

describe("weekStrip", () => {
  it("returns seven days ending today, oldest first", () => {
    const strip = weekStrip(VALUES, "2026-08-26");
    expect(strip).toHaveLength(STRIP_DAYS);
    expect(strip[0].date).toBe("2026-08-20");
    expect(strip.at(-1).date).toBe("2026-08-26");
  });

  it("keeps the days with no reading rather than dropping them", () => {
    // An empty dot is the whole point: it is what says which day was missed.
    const strip = weekStrip(VALUES, "2026-08-26");
    expect(strip.filter((d) => !d.logged).map((d) => d.date)).toEqual([
      "2026-08-22",
      "2026-08-23",
      "2026-08-25",
      "2026-08-26",
    ]);
  });

  it("marks today, and only today", () => {
    const strip = weekStrip(VALUES, "2026-08-26");
    expect(strip.filter((d) => d.isToday)).toHaveLength(1);
    expect(strip.at(-1).isToday).toBe(true);
  });

  it("reads a bare date as local, not UTC", () => {
    // `new Date("2026-08-26")` is midnight UTC, which is the 25th anywhere west
    // of Greenwich - so the letters would all be one day out.
    expect(weekStrip({}, "2026-08-26").at(-1).letter).toBe("W");
    expect(weekStrip({}, "2026-08-23").at(-1).letter).toBe("S");
  });

  it("treats a zero as logged, because zero is a reading", () => {
    const strip = weekStrip({ "2026-08-26": 0 }, "2026-08-26");
    expect(strip.at(-1).logged).toBe(true);
    expect(strip.at(-1).value).toBe(0);
  });

  it("has nothing to say without a date", () => {
    expect(weekStrip(VALUES, null)).toEqual([]);
  });
});

describe("stripNote", () => {
  it("counts the missed days and says nothing when there are none", () => {
    expect(stripNote(weekStrip(VALUES, "2026-08-26"))).toBe("3 DAYS NOT LOGGED");
    const full = Object.fromEntries(
      weekStrip({}, "2026-08-26").map((d) => [d.date, 5])
    );
    expect(stripNote(weekStrip(full, "2026-08-26"))).toBe("");
  });

  it("never counts today, which is not missed until it is over", () => {
    // The same reasoning streak.js uses: an unfinished day is pending, not failed.
    const strip = weekStrip({ "2026-08-25": 5 }, "2026-08-26");
    const missedDates = strip.filter((d) => !d.logged).map((d) => d.date);
    expect(missedDates).toContain("2026-08-26");
    expect(stripNote(strip)).toBe("5 DAYS NOT LOGGED");
  });

  it("uses the singular for one", () => {
    const values = Object.fromEntries(
      weekStrip({}, "2026-08-26").map((d) => [d.date, 5])
    );
    delete values["2026-08-22"];
    expect(stripNote(weekStrip(values, "2026-08-26"))).toBe("1 DAY NOT LOGGED");
  });
});
