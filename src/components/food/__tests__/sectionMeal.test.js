import { describe, it, expect } from "vitest";
import {
  isUsable,
  candidates,
  ingredientsFrom,
  canSave,
  offerFor,
  suggestedName,
  removalOrder,
  canTidy,
} from "../sectionMeal";

const BEANS = { key: "snack-0", kind: "snack", index: 0, mealId: "beans", quantity: 2, name: "Baked Beans" };
const BREAD = { key: "snack-1", kind: "snack", index: 1, mealId: "bread", quantity: 2, name: "White Bread" };
const EGGS = { key: "snack-2", kind: "snack", index: 2, mealId: "eggs", quantity: 2, name: "Eggs" };
/** Quick add: carries its own macros and has nothing in the library to point at. */
const ADHOC = { key: "snack-3", kind: "snack", index: 3, mealId: undefined, quantity: 1, name: "Chicken Sandwich" };

describe("which rows can become ingredients", () => {
  it("takes a row that came from the library", () => {
    expect(isUsable(BEANS)).toBe(true);
  });

  // A composite stores {itemId, quantity} and resolves its macros live. A quick
  // add has no item to reference, and inventing one is the library pollution
  // addAdHoc exists to avoid.
  it("refuses a quick-added row", () => {
    expect(isUsable(ADHOC)).toBe(false);
  });

  it("explains itself rather than dropping the row", () => {
    const out = candidates([BEANS, ADHOC]);
    expect(out).toHaveLength(2);
    expect(out[0].usable).toBe(true);
    expect(out[0].why).toBeNull();
    expect(out[1].usable).toBe(false);
    expect(out[1].why).toBe("NOT IN THE LIBRARY");
  });

  // Found by running it: a seeded day had a confirmed breakfast SLOT beside
  // three snacks, and the first version removed the three and silently left the
  // slot. Slots belong to the retired weekly template and no store call removes
  // one, so a tidy that included them could only ever half-work.
  it("refuses a slot from the retired weekly template", () => {
    const SLOT = { key: "slot-0", kind: "slot", index: 0, mealId: "oats", quantity: 1, logged: true };
    expect(isUsable(SLOT)).toBe(false);
    expect(candidates([SLOT])[0].why).toBe("FROM AN OLD MEAL PLAN");
    expect(ingredientsFrom([SLOT])).toEqual([]);
    expect(removalOrder([SLOT])).toEqual([]);
  });
});

describe("the ingredient list", () => {
  it("keeps the order they were eaten in", () => {
    expect(ingredientsFrom([BEANS, BREAD, EGGS])).toEqual([
      { itemId: "beans", quantity: 2 },
      { itemId: "bread", quantity: 2 },
      { itemId: "eggs", quantity: 2 },
    ]);
  });

  it("leaves out what it cannot reference", () => {
    expect(ingredientsFrom([BEANS, ADHOC, EGGS]).map((i) => i.itemId)).toEqual([
      "beans",
      "eggs",
    ]);
  });

  // An extra was part of what was eaten. Leaving it out makes the saved meal
  // quietly smaller than the day it came from.
  it("folds an extra in as an ingredient of its own", () => {
    const withEgg = { ...BEANS, extras: [{ itemId: "eggs", quantity: 1, name: "Egg" }] };
    expect(ingredientsFrom([withEgg])).toEqual([
      { itemId: "beans", quantity: 2 },
      { itemId: "eggs", quantity: 1 },
    ]);
  });

  it("ignores an extra with nothing to point at", () => {
    const withJunk = { ...BEANS, extras: [{ name: "a splash of oil", quantity: 1 }] };
    expect(ingredientsFrom([withJunk])).toEqual([{ itemId: "beans", quantity: 2 }]);
  });

  it("defaults a missing quantity rather than writing undefined into a recipe", () => {
    expect(ingredientsFrom([{ kind: "snack", mealId: "beans" }])).toEqual([
      { itemId: "beans", quantity: 1 },
    ]);
  });
});

describe("when saving is allowed", () => {
  it("needs a name and at least two ingredients", () => {
    expect(canSave("Beans on Toast", [BEANS, BREAD])).toBe(true);
    expect(canSave("   ", [BEANS, BREAD])).toBe(false);
    expect(canSave("", [BEANS, BREAD])).toBe(false);
  });

  // One row can already be logged in a tap. Saving it as a meal makes a second
  // name for the same food.
  it("refuses a single row", () => {
    expect(canSave("Beans", [BEANS])).toBe(false);
    expect(offerFor([BEANS])).toBe(false);
  });

  it("counts a row plus its extra as two", () => {
    const withEgg = { ...BEANS, extras: [{ itemId: "eggs", quantity: 1 }] };
    expect(offerFor([withEgg])).toBe(true);
  });

  // The header control and the save button must agree, or the sheet opens on a
  // section it then refuses to save.
  it("offers exactly when it would save", () => {
    for (const rows of [[], [BEANS], [BEANS, ADHOC], [BEANS, BREAD]]) {
      expect(offerFor(rows)).toBe(canSave("A name", rows));
    }
  });
});

describe("the suggested name", () => {
  it("names the section and the day", () => {
    expect(suggestedName("LUNCH", "2026-08-24")).toMatch(/^Lunch, /);
  });

  it("falls back to the section alone without a date", () => {
    expect(suggestedName("DINNER", null)).toBe("Dinner");
    expect(suggestedName("DINNER", "not-a-date")).toBe("Dinner");
  });
});

describe("removalOrder", () => {
  // Removing by index ascending shifts every later index by one, which deletes
  // the wrong rows: the classic result is the first and third of three going
  // and the second surviving.
  it("removes from the end so earlier indexes stay valid", () => {
    expect(removalOrder([BEANS, BREAD, EGGS])).toEqual([
      { kind: "snack", index: 2 },
      { kind: "snack", index: 1 },
      { kind: "snack", index: 0 },
    ]);
  });

  it("leaves a row it could not use in place", () => {
    expect(removalOrder([BEANS, ADHOC])).toEqual([{ kind: "snack", index: 0 }]);
  });
});

describe("canTidy", () => {
  // The guard against the bug above: everything saved must also be removable,
  // or the tidy deletes some rows and leaves others with nothing said.
  it("agrees with what can be saved", () => {
    expect(canTidy([BEANS, BREAD])).toBe(true);
    expect(canTidy([BEANS, ADHOC])).toBe(true);
    expect(canTidy([])).toBe(false);
    expect(canTidy([ADHOC])).toBe(false);
  });
});
