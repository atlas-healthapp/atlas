import { describe, it, expect } from "vitest";
import {
  formatAmount,
  macroChips,
  ingredientBreakdown,
  componentBreakdown,
  canEditComponents,
  recipeDrifted,
} from "@/components/food/rowDetail";

// A tiny stand-in for the store: an egg and rice, and a bowl made of both.
const EGG = { id: "egg", name: "Egg", baseAmount: 1, baseUnit: "egg", protein: 6, kcal: 70 };
const RICE = { id: "rice", name: "Rice", baseAmount: 100, baseUnit: "g", protein: 3, kcal: 130 };
const BOWL = {
  id: "bowl",
  name: "Bowl",
  baseAmount: 1,
  baseUnit: "serving",
  ingredients: [
    { itemId: "egg", quantity: 2 },
    { itemId: "rice", quantity: 150 },
  ],
};
const LIB = { egg: EGG, rice: RICE, bowl: BOWL };

const itemById = (id) => LIB[id] ?? null;

// The real store's scaleItem resolves a composite from its ingredients before
// scaling. A double that only reads item.protein returns null for every
// composite, which made recipeDrifted look correct while testing nothing.
const scaleItem = (item, quantity) => {
  const base = item.baseAmount || 1;
  const f = (quantity ?? base) / base;

  if (item.ingredients?.length) {
    const sums = { protein: 0, kcal: 0 };
    for (const ing of item.ingredients) {
      const child = itemById(ing.itemId);
      if (!child) continue;
      const s = scaleItem(child, ing.quantity);
      for (const k of ["protein", "kcal"]) if (s[k] != null) sums[k] += s[k];
    }
    return { protein: sums.protein * f, kcal: sums.kcal * f };
  }

  return {
    protein: item.protein != null ? item.protein * f : null,
    kcal: item.kcal != null ? item.kcal * f : null,
  };
};
const deps = { itemById, scaleItem };

describe("macroChips", () => {
  it("shows only what was recorded, and never a missing macro as zero", () => {
    const chips = macroChips({ protein: 46, kcal: 710, carbs: null });
    expect(chips.map((c) => c.label)).toEqual(["KCAL", "PROTEIN"]);
    expect(chips.map((c) => c.value)).toEqual(["710", "46G"]);
  });

  it("keeps a real zero", () => {
    expect(macroChips({ fibre: 0 }).map((c) => c.value)).toEqual(["0G"]);
  });

  it("survives no macros at all", () => {
    expect(macroChips(null)).toEqual([]);
    expect(macroChips({})).toEqual([]);
  });
});

describe("ingredientBreakdown", () => {
  it("scales each ingredient by its own quantity in the recipe", () => {
    const rows = ingredientBreakdown(BOWL, 1, deps);
    expect(rows.map((r) => r.name)).toEqual(["Egg", "Rice"]);
    expect(rows[0].amount).toBe("2 EGG");
    expect(rows[0].macro).toBe("140 · 12G");
  });

  // Two scalings compose, and the bug that reads as correct is applying only
  // one: half a serving of a recipe with two eggs is one egg, not two.
  it("scales again by how much of the parent was logged", () => {
    const half = ingredientBreakdown(BOWL, 0.5, deps);
    expect(half[0].amount).toBe("1 EGG");
    expect(half[0].macro).toBe("70 · 6G");

    const double = ingredientBreakdown(BOWL, 2, deps);
    expect(double[0].amount).toBe("4 EGG");
  });

  it("falls back to the item's own base when no quantity was logged", () => {
    expect(ingredientBreakdown(BOWL, null, deps)[0].amount).toBe("2 EGG");
  });

  it("says so when an ingredient has been deleted from the library", () => {
    const orphan = { ...BOWL, ingredients: [{ itemId: "gone", quantity: 1 }] };
    const rows = ingredientBreakdown(orphan, 1, deps);
    expect(rows[0].name).toBe("REMOVED FROM LIBRARY");
    expect(rows[0].amount).toBe("");
  });

  it("returns nothing for a flat item", () => {
    expect(ingredientBreakdown(EGG, 1, deps)).toEqual([]);
    expect(ingredientBreakdown(null, 1, deps)).toEqual([]);
  });
});

describe("recipeDrifted", () => {
  const loggedAs = (protein) => ({ quantity: 1, macros: { protein } });

  it("is false when the recipe still adds up to what was logged", () => {
    // 2 eggs at 6g + 150g rice at 3g/100g = 16.5g
    expect(recipeDrifted(BOWL, loggedAs(16.5), deps)).toBe(false);
  });

  it("tolerates the rounding the snapshot was taken with", () => {
    expect(recipeDrifted(BOWL, loggedAs(17), deps)).toBe(false);
    expect(recipeDrifted(BOWL, loggedAs(16), deps)).toBe(false);
  });

  it("is true once the recipe has really moved", () => {
    expect(recipeDrifted(BOWL, loggedAs(30), deps)).toBe(true);
  });

  it("is false for a flat item or a row with no protein recorded", () => {
    expect(recipeDrifted(EGG, loggedAs(6), deps)).toBe(false);
    expect(recipeDrifted(BOWL, { quantity: 1, macros: {} }, deps)).toBe(false);
  });

  it("stands down once the row has been customised", () => {
    // The row has stopped claiming to be the recipe, so a comparison against
    // one would fire forever and mean nothing.
    const customised = { quantity: 1, macros: { protein: 30 }, components: [] };
    expect(recipeDrifted(BOWL, customised, deps)).toBe(false);
  });
});

// Every case here is a real base unit out of the user's own library, because
// the shipped bug was invisible against tidy invented ones.
describe("formatAmount", () => {
  it("counts a bare unit", () => {
    expect(formatAmount(50, "g")).toBe("50 G");
    expect(formatAmount(1, "serving")).toBe("1 SERVING");
    expect(formatAmount(2, "slice")).toBe("2 SLICE");
  });

  it("does not count a unit that already carries its own amount", () => {
    // This is the bug: "1 portion (25 g)" printed as "1 1 PORTION (25 G)".
    expect(formatAmount(1, "1 portion (25 g)")).toBe("1 PORTION (25 G)");
    expect(formatAmount(1, "125 g")).toBe("125 G");
    expect(formatAmount(1, "1 Cup (200 g)")).toBe("1 CUP (200 G)");
  });

  it("multiplies such a unit rather than counting it", () => {
    expect(formatAmount(2, "125 g")).toBe("×2 · 125 G");
    expect(formatAmount(0.3, "60 g")).toBe("×0.3 · 60 G");
    expect(formatAmount(0.75, "1 Cup (200 g)")).toBe("×0.75 · 1 CUP (200 G)");
  });

  it("falls back to a serving when an item has no unit", () => {
    expect(formatAmount(1, null)).toBe("1 SERVING");
  });

  it("does not print floating point noise", () => {
    expect(formatAmount(0.1 + 0.2, "g")).toBe("0.3 G");
  });

  it("multiplies a portion out rather than restating it", () => {
    // The whole point: a serving of eggs is two, so one and a half servings is
    // three. Printing "(2 EGGS)" beside 1.5 servings would be worse than
    // printing nothing at all.
    const eggs = { amount: 2, unit: "eggs" };
    expect(formatAmount(1, "serving", eggs)).toBe("1 SERVING (2 EGGS)");
    expect(formatAmount(1.5, "serving", eggs)).toBe("1.5 SERVING (3 EGGS)");
    expect(formatAmount(0.5, "serving", eggs)).toBe("0.5 SERVING (1 EGGS)");
  });

  it("multiplies a weight portion the same way", () => {
    const cheese = { amount: 25, unit: "g" };
    expect(formatAmount(2, "serving", cheese)).toBe("2 SERVING (50 G)");
  });

  it("says nothing extra when an item has no portion", () => {
    expect(formatAmount(1, "serving", null)).toBe("1 SERVING");
  });
});

describe("componentBreakdown", () => {
  const COMPONENTS = [
    { itemId: "egg", name: "Egg", unit: "egg", quantity: 2, protein: 12, kcal: 140 },
    { itemId: "rice", name: "Rice", unit: "g", quantity: 150, protein: 4.5, kcal: 195 },
  ];

  it("reads the entry alone and never the library", () => {
    // No deps argument at all: that is the point of freezing them.
    const rows = componentBreakdown(COMPONENTS);
    expect(rows.map((r) => r.name)).toEqual(["Egg", "Rice"]);
    expect(rows[0].amount).toBe("2 EGG");
    expect(rows[1].amount).toBe("150 G");
  });

  it("carries the index the editor needs to address a row", () => {
    expect(componentBreakdown(COMPONENTS).map((r) => r.index)).toEqual([0, 1]);
  });

  it("prints only the macros a component recorded", () => {
    expect(componentBreakdown([{ itemId: "x", name: "X", quantity: 1 }])[0].macro).toBe("");
  });

  it("is empty for a row that has never been edited", () => {
    expect(componentBreakdown(undefined)).toEqual([]);
  });

  it("takes a portion from the library when the entry was frozen without one", () => {
    // The real case: components frozen before portions existed carry null, and
    // without this the row is stuck reading "1.5 SERVING" forever.
    const frozen = [{ itemId: "egg", name: "Eggs", unit: "serving", quantity: 1.5 }];
    const library = { itemById: () => ({ portion: { amount: 2, unit: "eggs" } }) };
    expect(componentBreakdown(frozen, library)[0].amount).toBe("1.5 SERVING (3 EGGS)");
  });

  it("prefers the entry's own portion over the library's", () => {
    // A portion recorded at freeze time is part of the record; only a missing
    // one falls back.
    const frozen = [
      { itemId: "egg", name: "Eggs", unit: "serving", quantity: 1, portion: { amount: 3, unit: "eggs" } },
    ];
    const library = { itemById: () => ({ portion: { amount: 2, unit: "eggs" } }) };
    expect(componentBreakdown(frozen, library)[0].amount).toBe("1 SERVING (3 EGGS)");
  });

  it("says nothing extra when the item is gone from the library too", () => {
    const frozen = [{ itemId: "egg", name: "Eggs", unit: "serving", quantity: 1.5 }];
    const library = { itemById: () => null };
    expect(componentBreakdown(frozen, library)[0].amount).toBe("1.5 SERVING");
  });
});

describe("canEditComponents", () => {
  it("allows a composite", () => {
    expect(canEditComponents(BOWL, { quantity: 1 })).toBe(true);
  });

  it("refuses a flat item, which has nothing to take apart", () => {
    expect(canEditComponents(EGG, { quantity: 1 })).toBe(false);
  });

  it("allows a customised row even when the library no longer has the item", () => {
    // The row describes itself by then, so the library's opinion is irrelevant.
    expect(canEditComponents(null, { components: [] })).toBe(true);
  });
});
