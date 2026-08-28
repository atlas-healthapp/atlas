import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useFoodStore, mealTypeFromTime } from "@/stores/food";

// The stores persist through utils/storage.js, which reaches for a bare
// localStorage that the node test environment does not provide.
function installLocalStorageShim(seed = {}) {
  const data = new Map(Object.entries(seed));
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
  };
}

// One item logged twice as a snack and once at breakfast, so a scoped count
// and an unscoped count give visibly different answers.
const DAY_PLANS = [
  {
    date: "2026-07-20",
    slots: [{ mealId: "yoghurt", mealType: "breakfast", confirmed: true }],
    snacks: [{ mealId: "yoghurt", mealType: "snack" }],
  },
  {
    date: "2026-07-21",
    slots: [],
    snacks: [{ mealId: "yoghurt", mealType: "snack" }],
  },
];

beforeEach(() => {
  installLocalStorageShim({
    atlas_food_dayplans: JSON.stringify(DAY_PLANS),
  });
  setActivePinia(createPinia());
});

describe("logCountForItem", () => {
  it("counts every log when no section is given", () => {
    const food = useFoodStore();
    expect(food.logCountForItem("yoghurt")).toBe(3);
  });

  it("counts only logs in the named section", () => {
    // This is what makes the picker's QUICK ACCESS rank by what actually gets
    // eaten in that section rather than by overall popularity.
    const food = useFoodStore();
    expect(food.logCountForItem("yoghurt", "snack")).toBe(2);
    expect(food.logCountForItem("yoghurt", "breakfast")).toBe(1);
  });

  it("returns zero for a section the item was never logged in", () => {
    const food = useFoodStore();
    expect(food.logCountForItem("yoghurt", "dinner")).toBe(0);
  });

  it("ignores unconfirmed slots, scoped or not", () => {
    installLocalStorageShim({
      atlas_food_dayplans: JSON.stringify([
        {
          date: "2026-07-22",
          slots: [{ mealId: "oats", mealType: "breakfast", confirmed: false }],
          snacks: [],
        },
      ]),
    });
    setActivePinia(createPinia());
    const food = useFoodStore();
    expect(food.logCountForItem("oats")).toBe(0);
    expect(food.logCountForItem("oats", "breakfast")).toBe(0);
  });
});

describe("log-time extras", () => {
  // Something added to one logged meal on one day. The library is untouched,
  // which is the whole point of "just today".
  function setup() {
    setActivePinia(createPinia());
    const food = useFoodStore();
    const mealId = food.addLibraryItem({
      name: "Breakfast",
      kind: "meal",
      protein: 30,
      fibre: 8,
      baseAmount: 1,
      baseUnit: "serving",
    });
    const eggId = food.addLibraryItem({
      name: "Egg",
      kind: "snack",
      protein: 6,
      fibre: 0,
      baseAmount: 1,
      baseUnit: "egg",
    });
    return { food, mealId, eggId };
  }

  it("adds to the day total without touching the meal's own snapshot", () => {
    const { food, mealId, eggId } = setup();
    food.addSnack("2026-07-29", mealId, 1, "breakfast");
    expect(food.proteinFor("2026-07-29")).toBe(30);

    food.addExtra("2026-07-29", "snack", 0, eggId, 1);
    expect(food.proteinFor("2026-07-29")).toBe(36);

    // The parent's stored figure still says what the library said, which is
    // what the recipe-drift check compares against.
    const plan = food.planFor("2026-07-29");
    expect(plan.snacks[0].protein).toBe(30);
    expect(plan.snacks[0].extras).toHaveLength(1);
  });

  it("leaves the library item alone", () => {
    const { food, mealId, eggId } = setup();
    food.addSnack("2026-07-29", mealId, 1, "breakfast");
    food.addExtra("2026-07-29", "snack", 0, eggId, 1);
    expect(food.itemById(mealId).protein).toBe(30);
    expect(food.itemById(mealId).ingredients).toBeNull();
  });

  it("snapshots the extra, so editing the library later cannot rewrite it", () => {
    const { food, mealId, eggId } = setup();
    food.addSnack("2026-07-29", mealId, 1, "breakfast");
    food.addExtra("2026-07-29", "snack", 0, eggId, 1);

    food.updateLibraryItem(eggId, { name: "Egg", kind: "snack", protein: 99 });
    expect(food.proteinFor("2026-07-29")).toBe(36);
  });

  it("scales an extra by its quantity", () => {
    const { food, mealId, eggId } = setup();
    food.addSnack("2026-07-29", mealId, 1, "breakfast");
    food.addExtra("2026-07-29", "snack", 0, eggId, 3);
    expect(food.proteinFor("2026-07-29")).toBe(48);
  });

  it("removes an extra again, and drops the field when the last one goes", () => {
    const { food, mealId, eggId } = setup();
    food.addSnack("2026-07-29", mealId, 1, "breakfast");
    food.addExtra("2026-07-29", "snack", 0, eggId, 1);
    food.removeExtra("2026-07-29", "snack", 0, 0);
    expect(food.proteinFor("2026-07-29")).toBe(30);
    expect(food.planFor("2026-07-29").snacks[0].extras).toBeUndefined();
  });

  it("counts fibre from extras too", () => {
    const { food, mealId } = setup();
    const oats = food.addLibraryItem({ name: "Oats", kind: "snack", protein: 0, fibre: 5 });
    food.addSnack("2026-07-29", mealId, 1, "breakfast");
    food.addExtra("2026-07-29", "snack", 0, oats, 1);
    expect(food.fibreFor("2026-07-29")).toBe(13);
  });

  // Every plan logged before this existed has no extras field at all.
  it("treats a plan with no extras as having none, with no migration", () => {
    const { food, mealId } = setup();
    food.addSnack("2026-07-29", mealId, 1, "breakfast");
    delete food.planFor("2026-07-29").snacks[0].extras;
    expect(food.proteinFor("2026-07-29")).toBe(30);
    expect(food.fibreFor("2026-07-29")).toBe(8);
  });

  it("ignores an add against a row or item that is not there", () => {
    const { food, mealId, eggId } = setup();
    food.addSnack("2026-07-29", mealId, 1, "breakfast");
    expect(() => food.addExtra("2026-07-29", "snack", 9, eggId, 1)).not.toThrow();
    expect(() => food.addExtra("2026-07-29", "snack", 0, "nope", 1)).not.toThrow();
    expect(() => food.addExtra("2026-01-01", "snack", 0, eggId, 1)).not.toThrow();
    expect(food.proteinFor("2026-07-29")).toBe(30);
  });
});

// Kind says where an item MAY be used; mealType says which section this log
// landed in. Conflating the two is what sent Nuttelex, filed as a snack
// because that is the only kind that fits a spread, into SNACKS every time it
// was added to breakfast - the section the user had explicitly chosen.
describe("the section a log lands in", () => {
  beforeEach(() => {
    installLocalStorageShim();
    setActivePinia(createPinia());
  });

  function withSpread() {
    const food = useFoodStore();
    const id = food.addLibraryItem({
      name: "Nuttelex",
      kind: "snack",
      protein: 0,
      kcal: 60,
      baseAmount: 10,
      baseUnit: "g",
    });
    return { food, id };
  }

  it("keeps a snack-kind item in the section it was added to", () => {
    const { food, id } = withSpread();
    food.addSnack("2026-08-22", id, 1, "breakfast");
    expect(food.planFor("2026-08-22").snacks[0].mealType).toBe("breakfast");
  });

  it("still honours an explicit snack section", () => {
    const { food, id } = withSpread();
    food.addSnack("2026-08-22", id, 1, "snack");
    expect(food.planFor("2026-08-22").snacks[0].mealType).toBe("snack");
  });

  it("falls back to the clock when no section is named", () => {
    const { food, id } = withSpread();
    food.addSnack("2026-08-22", id, 1, undefined);
    const expected = mealTypeFromTime(new Date().toTimeString().slice(0, 5));
    expect(food.planFor("2026-08-22").snacks[0].mealType).toBe(expected);
  });
});
