import { describe, it, expect } from "vitest";
import { normaliseWorkouts } from "@/sources/helioBleSource";

describe("normaliseWorkouts", () => {
  const raw = (overrides = {}) => ({
    startMillis: 1000,
    endMillis: 2000,
    typeCode: 223,
    typeAutoDetected: true,
    activeSeconds: 60,
    caloriesKcal: 10,
    hrAvg: 120,
    hrMax: 160,
    hrMin: 90,
    distanceMeters: null,
    altitudeAvgMeters: null,
    ...overrides,
  });

  it("passes through a well-formed workout unchanged", () => {
    expect(normaliseWorkouts([raw()])).toEqual([raw()]);
  });

  it("drops a record with no start time", () => {
    expect(normaliseWorkouts([raw({ startMillis: null })])).toEqual([]);
  });

  it("drops a record whose end is not after its start", () => {
    expect(normaliseWorkouts([raw({ endMillis: 1000 })])).toEqual([]);
    expect(normaliseWorkouts([raw({ endMillis: 500 })])).toEqual([]);
  });

  it("coerces missing optional fields to null rather than leaving them undefined", () => {
    const [got] = normaliseWorkouts([{ startMillis: 1000, endMillis: 2000 }]);
    expect(got.typeCode).toBeNull();
    expect(got.activeSeconds).toBeNull();
    expect(got.caloriesKcal).toBeNull();
    expect(got.hrAvg).toBeNull();
    expect(got.distanceMeters).toBeNull();
    expect(got.altitudeAvgMeters).toBeNull();
    expect(got.typeAutoDetected).toBe(false);
  });

  it("ignores null/undefined entries in the input array", () => {
    expect(normaliseWorkouts([null, undefined, raw()])).toEqual([raw()]);
  });

  it("returns an empty array for no input", () => {
    expect(normaliseWorkouts(undefined)).toEqual([]);
    expect(normaliseWorkouts([])).toEqual([]);
  });
});
