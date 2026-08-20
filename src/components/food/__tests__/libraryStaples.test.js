import { describe, it, expect } from "vitest";
import { stapleIds } from "../libraryStaples";

/**
 * The rule, and the case that shaped it.
 *
 * Built from the shape of the real library: 6 composites, 11 items that are only
 * ever ingredients, and 9 that are both eaten and an ingredient. The 9 are why
 * this is not a fourth kind and not a flag - they need to be a staple and a meal
 * at once, and no exclusive field can say that.
 */
const lib = [
  { id: "breakfast", name: "Standard Breakfast", kind: "meal", ingredients: [
    { itemId: "bread", quantity: 2 },
    { itemId: "cheddar", quantity: 1 },
  ] },
  { id: "bread", name: "Hi-Fibre White Bread", kind: "meal" },
  { id: "cheddar", name: "Light Tasty Cheddar", kind: "meal" },
  { id: "capsicum", name: "Red Capsicum", kind: "meal", ingredients: [] },
  { id: "burrito", name: "Chicken Burrito Bowl", kind: "meal" },
];

// bread is eaten on its own as well as being in the breakfast; cheddar never is.
const logCounts = { bread: 12, burrito: 30, cheddar: 0, capsicum: 0, breakfast: 4 };
const logCountFor = (id) => logCounts[id] ?? 0;

describe("stapleIds", () => {
  it("calls an item a staple when it is used in something and never eaten alone", () => {
    expect(stapleIds(lib, logCountFor).has("cheddar")).toBe(true);
  });

  it("does NOT call something a staple just because it is an ingredient", () => {
    // The case that rules out a kind and a flag: bread is in the breakfast AND is
    // eaten on its own. Nine real items are like this.
    expect(stapleIds(lib, logCountFor).has("bread")).toBe(false);
  });

  it("leaves alone an item that is in nothing, however unused", () => {
    // Capsicum here is referenced by nobody. Never logged either, but "unused" is
    // not "a building block" - it is just an item you have not eaten yet, and
    // filing it under STAPLES would hide it from the list it belongs in.
    expect(stapleIds(lib, logCountFor).has("capsicum")).toBe(false);
  });

  it("does not call the composite itself a staple", () => {
    expect(stapleIds(lib, logCountFor).has("breakfast")).toBe(false);
  });

  it("stops calling something a staple once it has been eaten", () => {
    // Self-correcting, which is the whole argument for deriving it. No migration
    // and no field to go stale.
    const eaten = (id) => (id === "cheddar" ? 1 : logCountFor(id));
    expect(stapleIds(lib, eaten).has("cheddar")).toBe(false);
  });

  it("survives an empty or ingredient-less library", () => {
    expect(stapleIds([], logCountFor).size).toBe(0);
    expect(stapleIds(undefined, logCountFor).size).toBe(0);
    expect(stapleIds([{ id: "a", name: "A", kind: "snack" }], () => 0).size).toBe(0);
  });
});
