import { describe, it, expect } from "vitest";
import { figuresOf, needsReachChoice, reachSaveLabel } from "../editReach";

const ITEM = {
  protein: 20,
  kcal: 300,
  carbs: 10,
  fat: 5,
  fibre: 2,
  baseAmount: 1,
  baseUnit: "serving",
  ingredients: [],
};

function ask(overrides = {}) {
  return needsReachChoice({
    isEdit: true,
    scanChoiceOpen: false,
    opened: figuresOf(ITEM),
    current: ITEM,
    uses: 3,
    ...overrides,
  });
}

describe("when the reach question is worth asking", () => {
  it("stays quiet when nothing moved", () => {
    expect(ask()).toBe(false);
  });

  it("asks when a macro moved", () => {
    expect(ask({ current: { ...ITEM, protein: 24 } })).toBe(true);
  });

  it("asks when the base amount moved, which rescales every logged day", () => {
    expect(ask({ current: { ...ITEM, baseAmount: 100 } })).toBe(true);
    expect(ask({ current: { ...ITEM, baseUnit: "g" } })).toBe(true);
  });

  it("asks when a composite's ingredients moved", () => {
    const composite = { ...ITEM, ingredients: [{ itemId: "egg", quantity: 2 }] };
    const changed = { ...ITEM, ingredients: [{ itemId: "egg", quantity: 3 }] };
    expect(
      needsReachChoice({
        isEdit: true,
        scanChoiceOpen: false,
        opened: figuresOf(composite),
        current: changed,
        uses: 1,
      })
    ).toBe(true);
  });

  // The gating the user asked for: vocabulary is not a figure. A portion says
  // what one base unit is and a name is a label, and neither moves a number on
  // a day already recorded.
  it("stays quiet for a name, portion or barcode edit", () => {
    const relabelled = {
      ...ITEM,
      name: "Nuttelex Original",
      portion: { amount: 2, unit: "slices" },
      barcode: "93restofit",
    };
    expect(ask({ current: relabelled })).toBe(false);
  });

  it("stays quiet when the item has never been logged", () => {
    expect(ask({ current: { ...ITEM, protein: 24 }, uses: 0 })).toBe(false);
  });

  it("stays quiet on a new item", () => {
    expect(ask({ current: { ...ITEM, protein: 24 }, isEdit: false })).toBe(false);
  });

  // The scan path has its own four-option panel asking the same thing. Two of
  // them on screen at once would be the app asking twice and reading one.
  it("stands down while the scan panel is asking", () => {
    expect(ask({ current: { ...ITEM, protein: 24 }, scanChoiceOpen: true })).toBe(
      false
    );
  });

  it("treats a missing figure and a zero as different", () => {
    expect(ask({ current: { ...ITEM, fibre: null } })).toBe(true);
    expect(ask({ current: { ...ITEM, fibre: 0 } })).toBe(true);
  });
});

describe("the save label", () => {
  it("names the rewrite it is about to do", () => {
    expect(reachSaveLabel({ asking: true, reach: "backdate", uses: 3 })).toBe(
      "SAVE AND FIX 3 DAYS"
    );
    expect(reachSaveLabel({ asking: true, reach: "backdate", uses: 1 })).toBe(
      "SAVE AND FIX 1 DAY"
    );
  });

  it("stays a plain SAVE when nothing is being rewritten", () => {
    expect(reachSaveLabel({ asking: true, reach: "forward", uses: 3 })).toBe("SAVE");
    expect(reachSaveLabel({ asking: false, reach: "backdate", uses: 3 })).toBe("SAVE");
    expect(reachSaveLabel({ asking: true, reach: "backdate", uses: 0 })).toBe("SAVE");
  });
});
