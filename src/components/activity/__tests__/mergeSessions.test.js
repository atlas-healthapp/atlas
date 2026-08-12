import { describe, it, expect } from "vitest";
import { mergeWorkouts } from "../mergeSessions";

const START = new Date("2026-07-27T18:20:00").getTime();

// A climb the band split: seventy minutes, a twenty-minute gap while it decided
// you had stopped, then ten more minutes.
const first = {
  startMillis: START,
  endMillis: START + 70 * 60_000,
  activeSeconds: 70 * 60,
  caloriesKcal: 600,
  hrAvg: 138,
  hrMax: 171,
  hrMin: 92,
  distanceMeters: null,
  altitudeAvgMeters: null,
  typeAutoDetected: true,
};
const second = {
  startMillis: START + 90 * 60_000,
  endMillis: START + 100 * 60_000,
  activeSeconds: 10 * 60,
  caloriesKcal: 70,
  hrAvg: 96,
  hrMax: 180,
  hrMin: 80,
  distanceMeters: null,
  altitudeAvgMeters: null,
  typeAutoDetected: true,
};

describe("mergeWorkouts", () => {
  // The gap is the band deciding you had stopped. It was not climbing, and
  // measuring the span instead would inflate every merged session by however
  // long the band was wrong for.
  it("sums the active time rather than measuring the span", () => {
    const merged = mergeWorkouts([first, second]);
    expect(merged.activeSeconds).toBe(80 * 60);
    expect(merged.endMillis - merged.startMillis).toBe(100 * 60_000);
  });

  // A plain mean of 138 and 96 is 117, which neither half recorded and the
  // session never averaged.
  it("weights average heart rate by each part's active time", () => {
    expect(mergeWorkouts([first, second]).hrAvg).toBe(133);
  });

  it("takes the peak from whichever part it happened in", () => {
    const merged = mergeWorkouts([first, second]);
    expect(merged.hrMax).toBe(180);
    expect(merged.hrMin).toBe(80);
  });

  it("sums calories", () => {
    expect(mergeWorkouts([first, second]).caloriesKcal).toBe(670);
  });

  it("starts at the earliest part however they were passed in", () => {
    expect(mergeWorkouts([second, first]).startMillis).toBe(START);
  });

  // A zero would read as a measurement. An indoor session has no distance.
  it("leaves an unreported field null rather than zero", () => {
    const merged = mergeWorkouts([first, second]);
    expect(merged.distanceMeters).toBe(null);
    expect(merged.altitudeAvgMeters).toBe(null);
  });

  it("keeps the parts, so a merge that changed the duration can be checked", () => {
    const merged = mergeWorkouts([first, second]);
    expect(merged.merged).toBe(true);
    expect(merged.mergedCount).toBe(2);
    expect(merged.mergedParts.map((p) => p.startMillis)).toEqual([
      first.startMillis,
      second.startMillis,
    ]);
  });

  it("passes a single record straight through", () => {
    expect(mergeWorkouts([first])).toBe(first);
    expect(mergeWorkouts([])).toBe(null);
    expect(mergeWorkouts(null)).toBe(null);
  });

  it("falls back to a plain mean only when no part reports a duration", () => {
    const a = { startMillis: START, hrAvg: 100, activeSeconds: null };
    const b = { startMillis: START + 1000, hrAvg: 140, activeSeconds: null };
    expect(mergeWorkouts([a, b]).hrAvg).toBe(120);
  });

  it("ignores a part with no heart rate instead of counting it as zero", () => {
    const silent = { ...second, hrAvg: null };
    expect(mergeWorkouts([first, silent]).hrAvg).toBe(138);
  });
});
