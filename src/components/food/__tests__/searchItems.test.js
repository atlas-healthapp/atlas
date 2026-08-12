import { describe, it, expect } from "vitest";
import { matchesQuery, searchItems } from "@/components/food/searchItems";

const lib = [
  { id: "1", name: "Woolworths spinach salad" },
  { id: "2", name: "Salad" },
  { id: "3", name: "Chicken burrito bowl" },
  { id: "4", name: "Chicken and rice" },
  { id: "5", name: "Overnight oats" },
];
const names = (r) => r.map((i) => i.name);

describe("matchesQuery", () => {
  // The whole reason the box exists: the A-Z list already covers the case
  // where you remember the first word.
  it("matches a word anywhere in the name, not just the start", () => {
    expect(matchesQuery("Woolworths spinach salad", "spinach")).toBe(true);
    expect(matchesQuery("Woolworths spinach salad", "woolworths")).toBe(true);
    expect(matchesQuery("Woolworths spinach salad", "salad")).toBe(true);
  });

  it("ignores case", () => {
    expect(matchesQuery("Woolworths spinach salad", "WOOL")).toBe(true);
  });

  // "chicken rice" should narrow, not widen.
  it("requires every term, in any order", () => {
    expect(matchesQuery("Chicken and rice", "chicken rice")).toBe(true);
    expect(matchesQuery("Chicken and rice", "rice chicken")).toBe(true);
    expect(matchesQuery("Chicken burrito bowl", "chicken rice")).toBe(false);
  });

  it("matches everything on an empty query", () => {
    expect(matchesQuery("anything", "")).toBe(true);
    expect(matchesQuery("anything", "   ")).toBe(true);
    expect(matchesQuery("anything", null)).toBe(true);
  });

  it("survives a missing name", () => {
    expect(matchesQuery(null, "x")).toBe(false);
    expect(matchesQuery(undefined, "")).toBe(true);
  });
});

describe("searchItems", () => {
  it("returns the whole list unranked when there is no query", () => {
    expect(searchItems(lib, "")).toHaveLength(lib.length);
  });

  // What you typed the start of is usually what you meant.
  it("puts an exact prefix first, then a word match, then the rest", () => {
    expect(names(searchItems(lib, "sal"))).toEqual([
      "Salad",
      "Woolworths spinach salad",
    ]);
  });

  it("still finds the item when the query is a later word", () => {
    expect(names(searchItems(lib, "spinach"))).toEqual(["Woolworths spinach salad"]);
  });

  it("sorts alphabetically within a rank", () => {
    expect(names(searchItems(lib, "chicken"))).toEqual([
      "Chicken and rice",
      "Chicken burrito bowl",
    ]);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchItems(lib, "zzzz")).toEqual([]);
  });

  // A name with regex punctuation must not blow up the word-boundary test.
  it("does not treat the query as a regex", () => {
    const odd = [{ id: "x", name: "Yoghurt (2% fat)" }];
    expect(() => searchItems(odd, "(2%")).not.toThrow();
    expect(searchItems(odd, "(2%")).toHaveLength(1);
  });

  it("survives an empty library", () => {
    expect(searchItems([], "salad")).toEqual([]);
    expect(searchItems(null, "salad")).toEqual([]);
  });
});
