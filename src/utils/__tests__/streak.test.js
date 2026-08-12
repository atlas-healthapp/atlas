import { describe, it, expect } from "vitest";
import { currentStreak } from "@/utils/streak";

const TODAY = "2026-07-29";

// hitOn built from an explicit set of dates, so each test states exactly which
// days were met and nothing is inferred.
const hits = (...dates) => {
  const set = new Set(dates);
  return (d) => set.has(d);
};

describe("currentStreak", () => {
  it("counts back from today when today is already met", () => {
    expect(
      currentStreak(TODAY, hits("2026-07-29", "2026-07-28", "2026-07-27"))
    ).toBe(3);
  });

  it("treats today as pending, not as a miss", () => {
    // Nothing logged yet today. The run of three before it must survive, or
    // every streak in the app resets at midnight and rebuilds each evening.
    expect(
      currentStreak(TODAY, hits("2026-07-28", "2026-07-27", "2026-07-26"))
    ).toBe(3);
  });

  it("stops at the first missed day", () => {
    expect(
      currentStreak(
        TODAY,
        hits("2026-07-29", "2026-07-28", /* gap */ "2026-07-26", "2026-07-25")
      )
    ).toBe(2);
  });

  it("is zero when neither today nor yesterday was met", () => {
    expect(currentStreak(TODAY, hits("2026-07-27"))).toBe(0);
  });

  it("counts one when only today is met", () => {
    expect(currentStreak(TODAY, hits("2026-07-29"))).toBe(1);
  });

  it("crosses a month boundary", () => {
    expect(
      currentStreak("2026-08-01", hits("2026-08-01", "2026-07-31", "2026-07-30"))
    ).toBe(3);
  });

  it("stops at the lookback limit rather than walking forever", () => {
    expect(currentStreak(TODAY, () => true, { maxDays: 5 })).toBe(5);
  });
});
