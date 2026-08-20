import { describe, it, expect } from "vitest";
import { sleepScores, sleepScoreBars, sleepBandColor } from "@/components/sleep/scoreHistory";

/** A night good enough to score, built so a run of them is scoreable. */
const night = (date, hours) => ({
  date,
  sleep: hours,
  sleepStages: {
    rem: Math.round(hours * 60 * 0.2),
    light: Math.round(hours * 60 * 0.6),
    deep: Math.round(hours * 60 * 0.2),
    wake: 6,
    bedTime: new Date(`${date}T00:30:00`).getTime() - 24 * 3600 * 1000,
    wakeTime: new Date(`${date}T00:30:00`).getTime() - 24 * 3600 * 1000 + hours * 3600 * 1000,
  },
});

const run = (dates, hours = 8) => dates.map((d) => night(d, hours));

describe("sleepScores", () => {
  it("scores each night as it stood on that night", () => {
    const entries = run(["2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"]);
    const entryFor = (d) => entries.find((e) => e.date === d) ?? null;
    const scores = sleepScores({ entries, entryFor, endKey: "2026-08-15", nights: 4 });

    expect(scores.map((s) => s.date)).toEqual([
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
    ]);
    // Regularity needs three nights, so the first is scored on fewer terms than
    // the last. What matters here is that a night is judged by the week BEFORE
    // it rather than by one that had not happened yet, which is what stops a bar
    // changing height every time the page is opened.
    expect(scores.at(-1).score).toBeGreaterThan(0);
  });

  it("leaves a night with no entry unscored rather than at zero", () => {
    const entries = run(["2026-08-14", "2026-08-15"]);
    const entryFor = (d) => entries.find((e) => e.date === d) ?? null;
    const scores = sleepScores({ entries, entryFor, endKey: "2026-08-15", nights: 4 });
    expect(scores[0]).toMatchObject({ date: "2026-08-12", score: null });
  });
});

describe("sleepScoreBars", () => {
  const scores = [
    { date: "2026-08-12", score: 90, label: "GREAT" },
    { date: "2026-08-13", score: 75, label: "GOOD" },
    { date: "2026-08-14", score: 55, label: "FAIR" },
    { date: "2026-08-15", score: 40, label: "POOR" },
  ];

  it("draws every bar against a fixed 0-100 axis", () => {
    // Never scaled to the window's own range: a score already is a position
    // between fixed thresholds, so rescaling would move the bands relative to
    // the bars and a GREAT night in a bad fortnight would draw like a FAIR one
    // in a good fortnight.
    const { bars } = sleepScoreBars(scores, { height: 100 });
    expect(bars.map((b) => Math.round(b.height))).toEqual([90, 75, 55, 40]);
  });

  it("colours a bar by the band it fell in", () => {
    const { bars } = sleepScoreBars(scores);
    expect(bars.map((b) => b.color)).toEqual([
      "var(--rec-great)",
      "var(--rec-good)",
      "var(--rec-okay)",
      "var(--rec-low)",
    ]);
  });

  it("trims the unscoreable opening but keeps a gap in the middle", () => {
    const { bars, from } = sleepScoreBars([
      { date: "2026-08-10", score: null, label: null },
      { date: "2026-08-11", score: null, label: null },
      { date: "2026-08-12", score: 80, label: "GOOD" },
      { date: "2026-08-13", score: null, label: null },
      { date: "2026-08-14", score: 70, label: "GOOD" },
    ]);
    expect(from).toBe("2026-08-12");
    expect(bars).toHaveLength(3);
    // The strap was off that night. That is worth seeing, so the column stays
    // and draws nothing.
    expect(bars[1]).toMatchObject({ date: "2026-08-13", height: 0, empty: true });
  });

  it("averages only the nights it could score", () => {
    const { average, scored } = sleepScoreBars([
      { date: "2026-08-13", score: 80, label: "GOOD" },
      { date: "2026-08-14", score: null, label: null },
      { date: "2026-08-15", score: 60, label: "FAIR" },
    ]);
    expect(average).toBe(70);
    expect(scored).toBe(2);
  });

  it("says nothing scored rather than drawing a flat row", () => {
    // `trimLeadingBlanks` keeps a window with nothing in it at all, exactly as
    // it does for RecoveryPage's chart, so the bars come back at zero height.
    // `scored` is what the card hides itself on: an empty chart with an axis is
    // a section claiming to have something to say.
    const empty = sleepScoreBars([{ date: "2026-08-15", score: null, label: null }]);
    expect(empty.scored).toBe(0);
    expect(empty.average).toBeNull();
    expect(empty.bars.every((b) => b.empty)).toBe(true);
  });
});

describe("sleepBandColor", () => {
  it("falls back rather than throwing on a label it does not know", () => {
    expect(sleepBandColor("EXCELLENT")).toBe("var(--dim)");
    expect(sleepBandColor(null)).toBe("var(--dim)");
  });
});
