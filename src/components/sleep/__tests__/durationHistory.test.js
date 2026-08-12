import { describe, it, expect } from "vitest";
import { stackedDurationBars } from "@/components/sleep/durationHistory";

const night = (date, deep, light, rem) => ({
  date,
  sleep: (deep + light + rem) / 60,
  sleepStages: { deep, light, rem, wake: 20 },
});

describe("stackedDurationBars", () => {
  const entries = [night("2026-07-20", 70, 300, 90), night("2026-07-21", 90, 330, 110)];

  it("stacks deep at the bottom, so the chart agrees with the hypnogram", () => {
    const { bars } = stackedDurationBars(entries, 8, { width: 280, height: 100 });
    expect(bars[0].segments[0].stage).toBe("deep");
    // Deep sits lowest, i.e. has the largest y.
    const y = Object.fromEntries(bars[0].segments.map((s) => [s.stage, s.y]));
    expect(y.deep).toBeGreaterThan(y.light);
    expect(y.light).toBeGreaterThan(y.rem);
  });

  it("scales to whichever is larger, the longest night or the goal", () => {
    const short = [night("2026-07-20", 40, 150, 50)];
    const { goalY, max } = stackedDurationBars(short, 8, { width: 280, height: 100 });
    expect(max).toBeGreaterThanOrEqual(8);
    // The goal line has to land on the chart, not off the top of it.
    expect(goalY).toBeGreaterThanOrEqual(0);
    expect(goalY).toBeLessThanOrEqual(100);
  });

  it("draws no bar at all for a night with no reading", () => {
    // A zero-height stub reads as a night of no sleep, which is a different fact
    // from a night that was not recorded.
    const withGap = [night("2026-07-20", 70, 300, 90), { date: "2026-07-21" }];
    const { bars } = stackedDurationBars(withGap, 8, { width: 280, height: 100 });
    expect(bars.map((b) => b.date)).toEqual(["2026-07-20"]);
  });

  it("keeps a missing night's slot, so the axis stays a calendar", () => {
    const withGap = [
      night("2026-07-20", 70, 300, 90),
      { date: "2026-07-21" },
      night("2026-07-22", 60, 300, 80),
    ];
    const { bars } = stackedDurationBars(withGap, 8, { width: 300, height: 100 });
    // Three slots of 100px, and the surviving second bar belongs in the third of
    // them: closing the gap up would slide every later night a day earlier.
    expect(bars).toHaveLength(2);
    expect(bars[1].x).toBeGreaterThanOrEqual(200);
    expect(bars[1].x).toBeLessThan(203);
  });

  it("still draws a night that has totals but no stage split", () => {
    // Withholding the bar because the stages are missing would lose the
    // duration, which is the fact the chart is about.
    const plain = [{ date: "2026-07-20", sleep: 7.5 }];
    const { bars } = stackedDurationBars(plain, 8, { width: 280, height: 100 });
    expect(bars).toHaveLength(1);
    expect(bars[0].segments).toHaveLength(1);
    expect(bars[0].total).toBeCloseTo(7.5, 3);
  });
});
