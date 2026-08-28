import { describe, it, expect } from "vitest";
import { ACTIVITY_MET, metForTypeName, metFractions } from "../activityMet";
import { SUGGESTED_TYPES } from "@/stores/sessions";
import { metCalories } from "../sessionCalories";

describe("metForTypeName", () => {
  // The suggested list is the key this hangs off, and its own comment says so.
  // A name offered in the picker that has no MET is a gap, not a decision.
  it("covers every name Atlas suggests", () => {
    const missing = SUGGESTED_TYPES.filter((name) => metForTypeName(name) == null);
    expect(missing).toEqual([]);
  });

  it("matches regardless of case and spacing", () => {
    expect(metForTypeName("indoor climbing")).toBe(5.8);
    expect(metForTypeName("  Indoor   Climbing ")).toBe(5.8);
  });

  // Null rather than a default, always: a generic figure standing in for an
  // activity nobody described is the precise-looking wrong number this exists to
  // avoid, and the band's own figure is a better answer than a guess.
  it("has nothing to say about a name it does not know", () => {
    expect(metForTypeName("Boot and Scoot")).toBeNull();
    expect(metForTypeName("")).toBeNull();
    expect(metForTypeName(null)).toBeNull();
    expect(metForTypeName(42)).toBeNull();
  });

  // Deliberately no fuzzy matching: turning "Bouldering" into "Indoor Climbing"
  // would be inventing an activity, and missing only costs the band's figure.
  it("does not guess at a near miss", () => {
    expect(metForTypeName("Bouldering")).toBeNull();
    expect(metForTypeName("Climbing")).toBeNull();
  });

  it("gives both kinds of climbing the same figure", () => {
    expect(metForTypeName("Outdoor Climbing")).toBe(metForTypeName("Indoor Climbing"));
  });

  // **Checked against this user's own strap.** A 130-minute climb at 120 bpm
  // came back from the band at 877 kcal for 71 kg. The Compendium's 7.5
  // ("ascending rock, high difficulty") would put the estimate 40% over that;
  // 5.8 ("low-to-moderate difficulty") lands within a tenth of it.
  it("puts climbing where the band's own measurement puts it", () => {
    const estimated = metCalories({ met: ACTIVITY_MET["indoor climbing"], weightKg: 71, minutes: 130 });
    expect(Math.abs(estimated - 877) / 877).toBeLessThan(0.1);

    const tooHigh = metCalories({ met: 7.5, weightKg: 71, minutes: 130 });
    expect(tooHigh / 877).toBeGreaterThan(1.25);
  });
});

describe("metFractions", () => {
  const part = (seconds, met) => ({ seconds, met });

  it("gives the harder activity more than its share of the clock", () => {
    // Equal halves, running against walking: time alone would say 0.5.
    const [first] = metFractions([part(1800, 9.8), part(1800, 3.5)]);
    expect(first).toBeGreaterThan(0.5);
    expect(first).toBeCloseTo(9.8 / (9.8 + 3.5), 5);
  });

  it("still weighs the clock, not only the activity", () => {
    // Ten minutes running against fifty walking: harder per minute, and still
    // cannot claim the bulk of an hour.
    const [first] = metFractions([part(600, 9.8), part(3000, 3.5)]);
    expect(first).toBeLessThan(0.5);
  });

  // The band measured the total and the parts have to keep summing to it.
  it("always sums to one, however many parts", () => {
    const three = metFractions([part(600, 9.8), part(1200, 3.5), part(900, 6.0)]);
    expect(three).toHaveLength(3);
    expect(three.reduce((s, f) => s + f, 0)).toBeCloseTo(1, 10);
  });

  // Time is the right answer when the parts cost about the same per minute.
  // **The boulder day is the case that set the floor**: hiking 6.0 against
  // climbing 5.8 is not equal, and moving a measured total around on a 3.4% gap
  // between two population averages is precision the Compendium cannot carry.
  it("stands down when the ratio has nothing to add", () => {
    expect(metFractions([part(600, 5.8), part(600, 6.0)])).toBeNull();
    expect(metFractions([part(600, 5.8), part(600, 5.8)])).toBeNull();
    expect(metFractions([part(600, 5.8), part(600, null)])).toBeNull();
    expect(metFractions([part(600, null), part(600, null)])).toBeNull();
    expect(metFractions([part(600, 5.8)])).toBeNull();
    expect(metFractions([])).toBeNull();
  });

  it("still acts when the activities genuinely differ", () => {
    expect(metFractions([part(600, 9.8), part(600, 3.5)])).not.toBeNull();
    expect(metFractions([part(600, 5.0), part(600, 3.5)])).not.toBeNull();
  });

  it("refuses a part with no length", () => {
    expect(metFractions([part(0, 9.8), part(600, 3.5)])).toBeNull();
    expect(metFractions([part(600, 9.8), part(-1, 3.5)])).toBeNull();
  });
});
