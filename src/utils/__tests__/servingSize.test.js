import { describe, it, expect } from "vitest";
import { parseServingSize, baseUnitForScan } from "@/utils/servingSize";

/**
 * Every string in the first block is real: taken from the 23 distinct "base
 * units" a live Atlas library accumulated, each one an Open Food Facts
 * `serving_size` that had been assigned straight to `baseUnit`.
 */
describe("parseServingSize", () => {
  it("reads the shapes a real library actually collected", () => {
    expect(parseServingSize("1 portion (13 g)")).toEqual({ amount: 13, unit: "g" });
    expect(parseServingSize("11 chips (27 g)")).toEqual({ amount: 27, unit: "g" });
    expect(parseServingSize("2 pieces (66 g)")).toEqual({ amount: 66, unit: "g" });
    expect(parseServingSize("1 Cup (200 g)")).toEqual({ amount: 200, unit: "g" });
    expect(parseServingSize("1 serving size (45 g)")).toEqual({ amount: 45, unit: "g" });
    expect(parseServingSize("1 portion (250 ml)")).toEqual({ amount: 250, unit: "ml" });
    expect(parseServingSize("60.0g")).toEqual({ amount: 60, unit: "g" });
    expect(parseServingSize("375ml")).toEqual({ amount: 375, unit: "ml" });
    expect(parseServingSize("25g")).toEqual({ amount: 25, unit: "g" });
    expect(parseServingSize("50 g")).toEqual({ amount: 50, unit: "g" });
  });

  it("prefers the bracketed weight over the count in front of it", () => {
    // "11 chips" cannot scale a macro; 27 g can. Taking the leading number would
    // make one chip weigh a gram and every figure eleven times too small.
    expect(parseServingSize("11 chips (27 g)")).toEqual({ amount: 27, unit: "g" });
  });

  it("refuses what it cannot read rather than guessing", () => {
    // A wrong portion silently multiplies every macro shown for that item; a
    // missing one just shows less.
    for (const bad of ["1 serving", "a handful", "", "  ", null, undefined, 70, "2 pieces", "(a lot)"]) {
      expect(parseServingSize(bad)).toBeNull();
    }
  });

  it("refuses a unit it does not know, rather than inventing one", () => {
    expect(parseServingSize("1 portion (2 biscuits)")).toBeNull();
    expect(parseServingSize("3 scoops")).toBeNull();
  });

  it("refuses a nonsense amount", () => {
    expect(parseServingSize("0 g")).toBeNull();
    expect(parseServingSize("-5 g")).toBeNull();
  });

  it("tolerates the spellings and commas contributors use", () => {
    expect(parseServingSize("60 grams")).toEqual({ amount: 60, unit: "g" });
    expect(parseServingSize("1,5 g")).toEqual({ amount: 1.5, unit: "g" });
    expect(parseServingSize("100 G")).toEqual({ amount: 100, unit: "g" });
  });
});

describe("baseUnitForScan", () => {
  it("counts grams for per-100g data and servings otherwise", () => {
    expect(baseUnitForScan("100g")).toBe("g");
    expect(baseUnitForScan("serving")).toBe("serving");
    expect(baseUnitForScan(undefined)).toBe("serving");
  });
});
