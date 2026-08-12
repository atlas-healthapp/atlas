import { describe, it, expect, vi, afterEach } from "vitest";
import {
  workoutDateTimeLabel,
  workoutDurationLabel,
  workoutStatsLabel,
} from "../workouts";

describe("workoutDateTimeLabel", () => {
  afterEach(() => vi.useRealTimers());

  it("labels a workout from today as TODAY", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T20:00:00"));
    const startMillis = new Date("2026-07-28T18:12:00").getTime();
    expect(workoutDateTimeLabel(startMillis)).toMatch(/^TODAY, /);
  });

  it("labels a workout from an earlier day with the weekday and date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T20:00:00"));
    const startMillis = new Date("2026-07-26T09:47:00").getTime();
    const label = workoutDateTimeLabel(startMillis);
    expect(label).not.toMatch(/^TODAY/);
    expect(label).toContain("26");
  });
});

describe("workoutDurationLabel", () => {
  it("formats whole and partial hours", () => {
    expect(workoutDurationLabel(3600)).toBe("1h");
    expect(workoutDurationLabel(4529)).toBe("1h 15m");
  });

  it("returns a placeholder for a missing duration", () => {
    expect(workoutDurationLabel(null)).toBe("—");
  });
});

describe("workoutStatsLabel", () => {
  it("joins the fields that are present", () => {
    expect(
      workoutStatsLabel({ caloriesKcal: 594, hrAvg: 123, distanceMeters: null })
    ).toBe("594 KCAL · 123 AVG HR");
  });

  it("includes distance when present, converted to km", () => {
    expect(
      workoutStatsLabel({ caloriesKcal: 300, hrAvg: 130, distanceMeters: 5230 })
    ).toBe("300 KCAL · 130 AVG HR · 5.23 KM");
  });

  it("returns an empty string when nothing is known", () => {
    expect(
      workoutStatsLabel({ caloriesKcal: null, hrAvg: null, distanceMeters: null })
    ).toBe("");
  });
});
