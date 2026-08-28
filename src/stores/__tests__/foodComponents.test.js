import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useFoodStore } from "@/stores/food";

// Same shim as food.test.js: utils/storage.js reaches for a bare localStorage
// the node environment does not provide.
function installLocalStorageShim(seed = {}) {
  const data = new Map(Object.entries(seed));
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
  };
}

// The user's real case: a composite dinner where one ingredient was not eaten
// and two were doubled. Round numbers so a wrong scaling is obvious rather than
// arithmetically plausible.
const LIBRARY = [
  { id: "chicken", name: "Cooked chicken breast", baseAmount: 1, baseUnit: "serving", protein: 30, kcal: 160, fibre: 0 },
  { id: "rice", name: "Tilda rice", baseAmount: 1, baseUnit: "pouch", protein: 5, kcal: 200, fibre: 2 },
  { id: "cheese", name: "Cheddar", baseAmount: 1, baseUnit: "serving", protein: 7, kcal: 120, fibre: 0 },
  { id: "spinach", name: "Spinach", baseAmount: 1, baseUnit: "handful", protein: 1, kcal: 10, fibre: 2 },
  {
    id: "dinner",
    name: "Chicken, cheese and rice",
    baseAmount: 1,
    baseUnit: "serving",
    ingredients: [
      { itemId: "chicken", quantity: 1 },
      { itemId: "rice", quantity: 1 },
      { itemId: "cheese", quantity: 1 },
      { itemId: "spinach", quantity: 1 },
    ],
  },
];

// One confirmed dinner, snapshot already taken: 30 + 5 + 7 + 1 protein.
const DAY_PLANS = [
  {
    date: "2026-08-05",
    slots: [
      {
        time: "19:00",
        mealId: "dinner",
        mealType: "dinner",
        confirmed: true,
        quantity: 1,
        name: "Chicken, cheese and rice",
        protein: 43,
        kcal: 490,
        fibre: 4,
      },
    ],
    snacks: [],
  },
];

function freshStore() {
  installLocalStorageShim({
    atlas_food_library: JSON.stringify(LIBRARY),
    atlas_food_dayplans: JSON.stringify(DAY_PLANS),
  });
  setActivePinia(createPinia());
  return useFoodStore();
}

const slot = (food) => food.planForDate("2026-08-05").slots[0];

describe("per-instance components", () => {
  it("freezes the whole recipe onto the entry on the first edit", () => {
    const food = freshStore();
    expect(slot(food).components).toBeUndefined();

    food.removeComponent("2026-08-05", "slot", 0, 3);

    // The three that remain are frozen with their own names and macros, so the
    // entry no longer needs the library to describe itself.
    const components = slot(food).components;
    expect(components.map((c) => c.name)).toEqual([
      "Cooked chicken breast",
      "Tilda rice",
      "Cheddar",
    ]);
    expect(components[0].protein).toBe(30);
  });

  it("drops the removed ingredient from the entry's own totals", () => {
    const food = freshStore();
    food.removeComponent("2026-08-05", "slot", 0, 3);

    // 43 - 1 for the spinach, and the fibre it was carrying goes with it.
    expect(slot(food).protein).toBe(42);
    expect(slot(food).fibre).toBe(2);
    expect(food.proteinFor("2026-08-05")).toBe(42);
  });

  it("scales one ingredient without touching the others or the recipe", () => {
    const food = freshStore();
    food.setComponentQuantity("2026-08-05", "slot", 0, 0, 2);

    const components = slot(food).components;
    expect(components[0].quantity).toBe(2);
    expect(components[0].protein).toBe(60);
    expect(components[1].protein).toBe(5);
    // 60 + 5 + 7 + 1
    expect(slot(food).protein).toBe(73);
    // The library recipe is untouched: still four ingredients, quantity 1 each.
    expect(food.itemById("dinner").ingredients).toHaveLength(4);
    expect(food.itemById("dinner").ingredients[0].quantity).toBe(1);
  });

  it("keeps the entry's totals equal to the sum of its components", () => {
    const food = freshStore();
    food.removeComponent("2026-08-05", "slot", 0, 3);
    food.setComponentQuantity("2026-08-05", "slot", 0, 1, 2);

    const components = slot(food).components;
    for (const key of ["protein", "kcal", "fibre"]) {
      const sum = components.reduce((total, c) => total + (c[key] ?? 0), 0);
      expect(slot(food)[key]).toBe(Math.round(sum));
    }
  });

  it("scales against the parent's quantity, not the recipe's alone", () => {
    // Half a dinner containing one chicken breast is half a breast, and the
    // bug that reads as correct is freezing a whole one.
    installLocalStorageShim({
      atlas_food_library: JSON.stringify(LIBRARY),
      atlas_food_dayplans: JSON.stringify([
        {
          date: "2026-08-05",
          slots: [{ mealId: "dinner", confirmed: true, quantity: 0.5, protein: 22 }],
          snacks: [],
        },
      ]),
    });
    setActivePinia(createPinia());
    const food = useFoodStore();

    food.removeComponent("2026-08-05", "slot", 0, 3);
    expect(slot(food).components[0].quantity).toBe(0.5);
    expect(slot(food).components[0].protein).toBe(15);
  });

  it("refuses a quantity of zero, which is what REMOVE is for", () => {
    const food = freshStore();
    food.setComponentQuantity("2026-08-05", "slot", 0, 0, 0);
    expect(slot(food).components).toBeUndefined();
    expect(slot(food).protein).toBe(43);
  });

  it("leaves an emptied meal empty rather than reverting to the recipe", () => {
    const food = freshStore();
    for (let i = 3; i >= 0; i--) food.removeComponent("2026-08-05", "slot", 0, i);

    expect(slot(food).components).toEqual([]);
    expect(slot(food).protein).toBeNull();
    expect(food.proteinFor("2026-08-05")).toBe(0);
  });

  it("withholds a macro none of the components recorded", () => {
    // Not knowing the carbs is different from the meal having none, and every
    // item in this library has null carbs.
    const food = freshStore();
    food.removeComponent("2026-08-05", "slot", 0, 3);
    expect(slot(food).carbs).toBeNull();
  });

  it("does not let a library refresh overwrite a customised meal", () => {
    const food = freshStore();
    food.removeComponent("2026-08-05", "slot", 0, 3);
    const before = slot(food).protein;

    // The user edits the recipe later and opts into rewriting logged snapshots.
    food.updateLibraryItem("chicken", { protein: 50 });
    food.refreshSnapshotsForItem("dinner");

    // The corrected dinner is left alone; refreshing it would put the spinach
    // back and undo the correction without saying so.
    expect(slot(food).protein).toBe(before);
    expect(slot(food).components).toHaveLength(3);
  });

  it("does nothing on a flat item, which has nothing to take apart", () => {
    installLocalStorageShim({
      atlas_food_library: JSON.stringify(LIBRARY),
      atlas_food_dayplans: JSON.stringify([
        {
          date: "2026-08-05",
          slots: [{ mealId: "chicken", confirmed: true, quantity: 1, protein: 30 }],
          snacks: [],
        },
      ]),
    });
    setActivePinia(createPinia());
    const food = useFoodStore();

    food.removeComponent("2026-08-05", "slot", 0, 0);
    expect(slot(food).components).toBeUndefined();
    expect(slot(food).protein).toBe(30);
  });
});

/**
 * Changing how much of a logged meal you ate.
 *
 * The gap this closed: `addSnack` took a quantity when you logged and nothing
 * could change it afterwards, so one serving becoming two meant deleting the row
 * and adding it again. Ingredients inside a meal were editable; how much of the
 * meal was not, which is the more common correction by a long way.
 *
 * The rule under every case: a logged entry carries a SNAPSHOT so history
 * survives the library being edited, so this scales what is stored and never
 * re-reads the library.
 */
describe("setEntryQuantity", () => {
  let food;

  beforeEach(() => {
    installLocalStorageShim();
    setActivePinia(createPinia());
    food = useFoodStore();
    for (const item of LIBRARY) food.addLibraryItem({ ...item, kind: item.kind ?? "meal" });
  });

  const entry = () => food.planForDate("2026-08-27").snacks[0];

  it("doubles a serving without touching the library", () => {
    food.addSnack("2026-08-27", "chicken", 1, "lunch");
    const before = entry().protein;
    food.setEntryQuantity("2026-08-27", "snack", 0, 2);
    expect(entry().quantity).toBe(2);
    expect(entry().protein).toBe(before * 2);
    expect(food.itemById("chicken").protein).toBe(30);
  });

  it("halves one just as readily", () => {
    food.addSnack("2026-08-27", "chicken", 2, "lunch");
    const before = entry().protein;
    food.setEntryQuantity("2026-08-27", "snack", 0, 1);
    expect(entry().protein).toBe(Math.round(before / 2));
  });

  // **The reason it scales the snapshot rather than re-reading it.** An entry is
  // a record of what you ate, and a recipe edited afterwards must not rewrite it.
  it("does not pick up a library edit made after logging", () => {
    food.addSnack("2026-08-27", "chicken", 1, "lunch");
    const before = entry().protein;
    food.updateLibraryItem("chicken", { protein: 999 });
    food.setEntryQuantity("2026-08-27", "snack", 0, 2);
    expect(entry().protein).toBe(before * 2);
  });

  it("refuses zero, which is what REMOVE is for", () => {
    food.addSnack("2026-08-27", "chicken", 1, "lunch");
    const before = entry().protein;
    food.setEntryQuantity("2026-08-27", "snack", 0, 0);
    expect(entry().quantity).toBe(1);
    expect(entry().protein).toBe(before);
  });

  // Extras sit beside the parent on purpose: separate things added to one meal
  // on one day, not part of the portion. Doubling the meal does not double the
  // egg you put on it.
  it("never scales an extra with the parent", () => {
    food.addSnack("2026-08-27", "chicken", 1, "lunch");
    food.addExtra("2026-08-27", "snack", 0, "cheese", 1);
    const extraBefore = entry().extras[0].protein;
    food.setEntryQuantity("2026-08-27", "snack", 0, 2);
    expect(entry().extras[0].protein).toBe(extraBefore);
  });

  // A frozen recipe is the truth for that entry, so both halves have to move
  // together or the list stops adding up to its own header.
  it("scales a frozen recipe's components and its totals together", () => {
    food.addSnack("2026-08-27", "dinner", 1, "dinner");
    food.setComponentQuantity("2026-08-27", "snack", 0, 0, 2);
    const componentsBefore = entry().components.map((c) => c.protein);
    const totalBefore = entry().protein;

    food.setEntryQuantity("2026-08-27", "snack", 0, 2);

    entry().components.forEach((c, i) => {
      expect(c.protein).toBeCloseTo(componentsBefore[i] * 2, 5);
    });
    expect(entry().protein).toBe(totalBefore * 2);
    const summed = entry().components.reduce((sum, c) => sum + (c.protein ?? 0), 0);
    expect(entry().protein).toBe(Math.round(summed));
  });
});
