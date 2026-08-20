import { describe, it, expect, vi, afterEach } from "vitest";
import { lookupBarcode } from "@/utils/foodLookup";

/**
 * What a scan hands to the form.
 *
 * **The macros have to arrive at the resolution the store keeps them at.**
 * `resolvedMacros` rounds every macro to a whole number on every read, and its
 * own comment says why: grams and kcal are never usefully fractional. So a scan
 * that seeds the form with `4.7250000000000005` is showing a number that will not
 * survive being saved, which is the same defect `batchMeal.js` guards against
 * where it notes that a preview must round in the same places the store will.
 *
 * Reported from a real scan of tinned baked beans, whose Open Food Facts entry
 * carries per-serving figures computed from a per-100g basis and therefore lands
 * covered in floating point tails.
 */
function offResponse(nutriments, extra = {}) {
  return {
    ok: true,
    json: async () => ({
      status: 1,
      product: {
        product_name: "Baked Beans",
        brands: "Heinz",
        nutriments,
        ...extra,
      },
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lookupBarcode", () => {
  it("rounds the tails off a per-serving product", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        offResponse({
          "energy-kcal_serving": 155.40000000000003,
          proteins_serving: 4.7250000000000005,
          carbohydrates_serving: 24.299999999999997,
          fat_serving: 0.6300000000000001,
          fiber_serving: 6.1499999999999995,
        })
      )
    );

    const item = await lookupBarcode("5000157024671");
    expect(item.kcal).toBe(155);
    expect(item.protein).toBe(5);
    expect(item.carbs).toBe(24);
    expect(item.fat).toBe(1);
    expect(item.fibre).toBe(6);
  });

  it("rounds a per-100g product too, and says which basis it used", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        offResponse({
          "energy-kcal_100g": 81.7,
          proteins_100g: 4.9,
        })
      )
    );

    const item = await lookupBarcode("1");
    expect(item.kcal).toBe(82);
    expect(item.servingBasis).toBe("100g");
  });

  it("keeps a missing macro missing rather than rounding it to zero", async () => {
    // Null is not the same claim as zero: "unmeasured" must stay blank so the
    // form asks, rather than asserting the product contains none of it. Fibre is
    // the documented exception and defaults to 0.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => offResponse({ "energy-kcal_100g": 100, proteins_100g: null }))
    );

    const item = await lookupBarcode("2");
    expect(item.protein).toBeNull();
    expect(item.carbs).toBeNull();
    expect(item.fibre).toBe(0);
  });

  it("coerces the numeric-looking strings OFF returns for legacy products", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => offResponse({ "energy-kcal_100g": "155.4", proteins_100g: "4.72" }))
    );

    const item = await lookupBarcode("3");
    expect(item.kcal).toBe(155);
    expect(item.protein).toBe(5);
  });

  it("returns null rather than throwing when the product is unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: 0 }) })));
    expect(await lookupBarcode("4")).toBeNull();
  });
});
