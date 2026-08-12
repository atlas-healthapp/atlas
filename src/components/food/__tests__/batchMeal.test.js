import { describe, it, expect } from "vitest";
import {
  entryFromScan,
  entryMacros,
  entryAmount,
  entryDiffers,
  activeMacros,
  macrosMatch,
  mealTotals,
  mergeScan,
  quantityStep,
  steppedQuantity,
  libraryPayload,
  scannedUpdate,
  rowsToRewrite,
  ingredientsFor,
  canCreateMeal,
  scaleMacro,
} from "@/components/food/batchMeal";

// What utils/foodLookup hands back for a product with per-serving figures.
const TUNA = {
  name: "Sirena Tuna In Oil",
  protein: 24,
  kcal: 190,
  carbs: 0,
  fat: 11,
  fibre: 0,
  servingBasis: "serving",
  servingSize: "95 g",
  barcode: "9310175000004",
};

// And for one that only has per-100g figures.
const RICE = {
  name: "Sunrice Jasmine Rice",
  protein: 7,
  kcal: 355,
  carbs: 78,
  fat: 1,
  fibre: 1,
  servingBasis: "100g",
  servingSize: null,
  barcode: "9310175111115",
};

describe("entryFromScan", () => {
  it("takes a per-serving scan at one of whatever the pack calls a serving", () => {
    const entry = entryFromScan(TUNA);
    expect(entry.itemId).toBe(null);
    expect(entry.baseAmount).toBe(1);
    expect(entry.baseUnit).toBe("95 g");
    expect(entry.quantity).toBe(1);
    expect(entry.useScanned).toBe(true);
  });

  it("takes a per-100g scan as 100 g, since that is what the figures describe", () => {
    const entry = entryFromScan(RICE);
    expect(entry.baseAmount).toBe(100);
    expect(entry.baseUnit).toBe("g");
    expect(entry.quantity).toBe(100);
    expect(entryMacros(entry).protein).toBe(7);
  });

  it("keeps the library's own name, unit and base amount on a match", () => {
    const existing = {
      id: "tuna",
      name: "Tuna (tin)",
      baseAmount: 1,
      baseUnit: "tin",
      protein: 24,
      kcal: 190,
      carbs: 0,
      fat: 11,
      fibre: 0,
    };
    const entry = entryFromScan(TUNA, existing, existing);
    expect(entry.itemId).toBe("tuna");
    expect(entry.name).toBe("Tuna (tin)");
    expect(entry.baseUnit).toBe("tin");
    // A match defaults to what the library already says.
    expect(entry.useScanned).toBe(false);
  });

  it("never offers the scanned figures to a composite, which has none of its own", () => {
    const composite = {
      id: "bowl",
      name: "Tuna bowl",
      baseAmount: 1,
      baseUnit: "serving",
      ingredients: [{ itemId: "tuna", quantity: 1 }],
    };
    const entry = entryFromScan(TUNA, composite, { protein: 30, kcal: 400 });
    expect(entry.composite).toBe(true);
    expect(entryDiffers(entry)).toBe(false);
  });
});

describe("macrosMatch", () => {
  it("calls a rounding difference the same product", () => {
    expect(
      macrosMatch(
        { protein: 24.4, kcal: 189.6, carbs: 0, fat: 11, fibre: 0 },
        { protein: 24, kcal: 190, carbs: 0, fat: 11, fibre: 0 }
      )
    ).toBe(true);
  });

  it("calls a real difference a difference", () => {
    expect(macrosMatch({ protein: 24 }, { protein: 18 })).toBe(false);
  });

  it("treats a recorded macro against a missing one as a difference", () => {
    expect(macrosMatch({ fibre: 3 }, { fibre: null })).toBe(false);
    expect(macrosMatch({ fibre: null }, { fibre: null })).toBe(true);
  });
});

describe("a matched row that disagrees", () => {
  const existing = {
    id: "tuna",
    name: "Tuna (tin)",
    baseAmount: 1,
    baseUnit: "tin",
    protein: 18,
    kcal: 150,
    carbs: 0,
    fat: 6,
    fibre: 0,
  };

  it("says so, and uses the library until told otherwise", () => {
    const entry = entryFromScan(TUNA, existing, existing);
    expect(entryDiffers(entry)).toBe(true);
    expect(activeMacros(entry).protein).toBe(18);
  });

  it("switches to the scan on request, and only then would rewrite the item", () => {
    const entry = { ...entryFromScan(TUNA, existing, existing), useScanned: true };
    expect(activeMacros(entry).protein).toBe(24);
    expect(rowsToRewrite([entry])).toHaveLength(1);
    expect(scannedUpdate(entry)).toEqual({
      protein: 24,
      kcal: 190,
      carbs: 0,
      fat: 11,
      fibre: 0,
      barcode: TUNA.barcode,
    });
  });

  it("leaves the library alone by default", () => {
    expect(rowsToRewrite([entryFromScan(TUNA, existing, existing)])).toHaveLength(0);
  });
});

describe("scaling and totals", () => {
  it("rounds where the store will round, so the preview cannot change on save", () => {
    // resolvedMacros rounds the item's own figure, scaleItem rounds the scaled
    // one: 7.4 -> 7, then 7 * 1.5 -> 11 (not 7.4 * 1.5 = 11.1 -> 11 by luck).
    expect(scaleMacro(7.4, 1.5, 1)).toBe(11);
    expect(scaleMacro(null, 3, 1)).toBe(null);
  });

  it("scales a 100 g base by grams", () => {
    const entry = { ...entryFromScan(RICE), quantity: 150 };
    expect(entryMacros(entry)).toEqual({
      protein: 11,
      kcal: 533,
      carbs: 117,
      fat: 2,
      fibre: 2,
    });
  });

  it("is the sum of its parts, which is the whole promise", () => {
    const tuna = entryFromScan(TUNA);
    const rice = { ...entryFromScan(RICE), quantity: 150 };
    const totals = mealTotals([tuna, rice]);
    expect(totals.protein).toBe(24 + 11);
    expect(totals.kcal).toBe(190 + 533);
  });

  it("keeps a macro nobody recorded as unknown rather than zero", () => {
    const noFibre = entryFromScan({ ...TUNA, fibre: null });
    expect(mealTotals([noFibre]).fibre).toBe(null);
    expect(mealTotals([noFibre]).protein).toBe(24);
  });

  it("is empty of everything when nothing has been scanned", () => {
    expect(mealTotals([])).toEqual({
      protein: null,
      kcal: null,
      carbs: null,
      fat: null,
      fibre: null,
    });
  });
});

describe("amounts and stepping", () => {
  it("prints a bare unit as a count and a unit carrying its own amount as a multiplier", () => {
    expect(entryAmount(entryFromScan(RICE))).toBe("100 G");
    // "95 g" already says how much one is, so a leading count would read "1 95 G".
    expect(entryAmount(entryFromScan(TUNA))).toBe("95 g".toUpperCase());
  });

  it("steps grams by ten and servings by a half", () => {
    expect(quantityStep(100)).toBe(10);
    expect(quantityStep(1)).toBe(0.5);
  });

  it("refuses a step that would reach nothing, since that is REMOVE's job", () => {
    const tuna = entryFromScan(TUNA);
    expect(steppedQuantity(tuna, 1)).toBe(1.5);
    expect(steppedQuantity({ ...tuna, quantity: 0.5 }, -1)).toBe(null);
    expect(steppedQuantity(entryFromScan(RICE), -1)).toBe(90);
  });
});

describe("mergeScan", () => {
  it("bumps the row a rescanned barcode is already on rather than adding a second", () => {
    const first = entryFromScan(TUNA);
    const merged = mergeScan([first], entryFromScan(TUNA));
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(2);
  });

  it("bumps by one base amount, so a 100 g row goes to 200 g", () => {
    const merged = mergeScan([entryFromScan(RICE)], entryFromScan(RICE));
    expect(merged[0].quantity).toBe(200);
  });

  it("leaves the row it did not touch alone, and keeps the order scanned", () => {
    const list = mergeScan(mergeScan([], entryFromScan(TUNA)), entryFromScan(RICE));
    expect(list.map((e) => e.baseUnit)).toEqual(["95 g", "g"]);
    const bumped = mergeScan(list, entryFromScan(TUNA));
    expect(bumped.map((e) => e.quantity)).toEqual([2, 100]);
  });
});

describe("what gets written", () => {
  it("turns an unmatched scan into a flat library item carrying its barcode", () => {
    const payload = libraryPayload(entryFromScan(RICE));
    expect(payload).toEqual({
      name: "Sunrice Jasmine Rice",
      kind: "meal",
      protein: 7,
      kcal: 355,
      carbs: 78,
      fat: 1,
      fibre: 1,
      baseAmount: 100,
      baseUnit: "g",
      portion: null,
      ingredients: null,
      barcode: RICE.barcode,
    });
  });

  it("lists the ingredients in the order they were scanned, at their own quantities", () => {
    const tuna = { ...entryFromScan(TUNA), itemId: "tuna" };
    const rice = { ...entryFromScan(RICE), quantity: 150 };
    expect(ingredientsFor([tuna, rice], { [rice.key]: "rice" })).toEqual([
      { itemId: "tuna", quantity: 1 },
      { itemId: "rice", quantity: 150 },
    ]);
  });

  it("drops a row that never got an id, rather than referencing nothing", () => {
    const orphan = entryFromScan(RICE);
    expect(ingredientsFor([orphan], {})).toEqual([]);
  });

  it("needs a name and something to put in it", () => {
    expect(canCreateMeal("", [entryFromScan(TUNA)])).toBe(false);
    expect(canCreateMeal("  ", [entryFromScan(TUNA)])).toBe(false);
    expect(canCreateMeal("Tuna bowl", [])).toBe(false);
    expect(canCreateMeal("Tuna bowl", [entryFromScan(TUNA)])).toBe(true);
  });
});
