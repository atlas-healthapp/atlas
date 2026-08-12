import { describe, it, expect } from "vitest";
import { recoveryBars, recoveryScores, WINDOW_DAYS, HISTORY_DAYS } from "../recoveryHistory";

const scores = (list) => list.map((score, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, score }));

describe("recoveryBars", () => {
  it("scales against a fixed 0-100 axis, not the window's own range", () => {
    // Two windows with different spreads must draw the same score at the same
    // height, or a GREAT day in a bad month looks like an OKAY one in a good.
    const flat = recoveryBars(scores([60, 61, 62]), { height: 50 });
    const wide = recoveryBars(scores([10, 61, 95]), { height: 50 });
    expect(flat.bars[1].height).toBeCloseTo(wide.bars[1].height, 5);
    expect(flat.bars[1].height).toBeCloseTo(30.5, 5);
  });

  it("draws nothing for a day with no score", () => {
    const { bars } = recoveryBars(scores([70, null, 80]));
    expect(bars[1].empty).toBe(true);
    expect(bars[1].height).toBe(0);
    expect(bars[1].color).toBe("var(--dim)");
  });

  it("keeps an unscored day's slot so the run stays a calendar", () => {
    const { bars } = recoveryBars(scores([70, null, 80]));
    expect(bars[1].x).toBeGreaterThan(bars[0].x);
    expect(bars[2].x).toBeGreaterThan(bars[1].x);
    expect(bars[1].width).toBe(bars[0].width);
  });

  it("colours each bar by its band", () => {
    // One score per band: LOW under 40, NORMAL from 40, GOOD from 60, GREAT from 80.
    const { bars } = recoveryBars(scores([30, 45, 65, 85]));
    expect(bars.map((b) => b.color)).toEqual([
      "var(--rec-low)",
      "var(--rec-okay)",
      "var(--rec-good)",
      "var(--rec-great)",
    ]);
  });

  it("averages only the days that were scored", () => {
    const { average, scored } = recoveryBars(scores([60, null, 80]));
    expect(average).toBe(70);
    expect(scored).toBe(2);
  });

  it("has no average before anything is scored", () => {
    const { average, scored } = recoveryBars(scores([null, null]));
    expect(average).toBe(null);
    expect(scored).toBe(0);
  });

  it("survives an empty window", () => {
    expect(recoveryBars([])).toMatchObject({ bars: [], average: null, scored: 0 });
  });

  // Each day is scored against the seven nights before it, so on a phone whose
  // archive starts recently the chart opened with a blank fortnight that was a
  // fact about the fetch rather than about the days.
  it("drops the unscoreable run at the start", () => {
    const { bars, from } = recoveryBars(scores([null, null, 40, 60]));
    expect(bars).toHaveLength(2);
    expect(bars[0].score).toBe(40);
    expect(from).toBe(bars[0].date);
  });

  it("keeps a gap in the middle, which is a week the band was off", () => {
    const { bars } = recoveryBars(scores([40, null, null, 60]));
    expect(bars).toHaveLength(4);
    expect(bars[1].empty).toBe(true);
  });

  it("keeps the whole window when nothing has been scored at all", () => {
    // Or the empty state describes one day rather than the period asked about.
    expect(recoveryBars(scores([null, null, null])).bars).toHaveLength(3);
  });

  it("bars stay inside the coordinate space", () => {
    const { bars } = recoveryBars(scores([0, 50, 100]), { height: 46 });
    for (const b of bars) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(100);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeCloseTo(46, 5);
    }
  });
});

describe("recoveryScores", () => {
  /** A day window shaped the way dailyValuesForRange returns one. */
  function windowEnding(endKey, days, values) {
    const out = [];
    const d = new Date(`${endKey}T00:00:00`);
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(d);
      day.setDate(day.getDate() - i);
      out.push({ date: day.toLocaleDateString("sv"), values: { ...values } });
    }
    return out;
  }

  it("scores every day in the run, oldest first", () => {
    const dayWindow = windowEnding("2026-08-05", WINDOW_DAYS, { hrv: 46, restingHr: 54 });
    const out = recoveryScores({
      dayWindow,
      entryFor: () => ({ sleep: 7.5 }),
      endKey: "2026-08-05",
      sleepGoalHours: 8,
      days: 5,
    });
    expect(out).toHaveLength(5);
    expect(out[0].date).toBe("2026-08-01");
    expect(out.at(-1).date).toBe("2026-08-05");
  });

  it("withholds a score for a day with no baseline behind it", () => {
    // Three days of window, so the earliest day has nothing before it at all.
    const dayWindow = windowEnding("2026-08-05", 3, { hrv: 46, restingHr: 54 });
    const out = recoveryScores({
      dayWindow,
      entryFor: () => ({ sleep: 7.5 }),
      endKey: "2026-08-05",
      sleepGoalHours: 8,
      days: 3,
    });
    expect(out[0].score).toBe(null);
    expect(out[0].label).toBe(null);
  });

  it("reaches further back than it draws, so the first day charted has a baseline", () => {
    expect(WINDOW_DAYS).toBeGreaterThan(HISTORY_DAYS);
  });
});
