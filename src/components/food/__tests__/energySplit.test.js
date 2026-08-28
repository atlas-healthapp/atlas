import { describe, it, expect } from "vitest";
import { energySplit, ENERGY_PARTS } from "../energySplit";

const pct = (out, key) => out.parts.find((p) => p.key === key).pct;

describe("energySplit", () => {
  it("splits energy at 4/4/9 per gram", () => {
    // 25g protein (100 kcal), 25g carbs (100), 100/9 g fat (100) - thirds.
    const out = energySplit({ kcal: 300, protein: 25, carbs: 25, fat: 100 / 9 });
    expect(pct(out, "protein")).toBe(33);
    expect(pct(out, "carbs")).toBe(33);
    expect(pct(out, "fat")).toBe(33);
  });

  it("reports the grams rounded and the kcal as given", () => {
    const out = energySplit({ kcal: 536.4, protein: 32.2, carbs: 54.4, fat: 21.5 });
    expect(out.kcal).toBe(536);
    expect(out.parts.map((p) => p.grams)).toEqual([32, 54, 22]);
  });

  // The rule that matters: an item logged with protein only is missing figures,
  // not a food made entirely of protein. Showing 100% would be a claim nothing
  // supports.
  it("withholds the split when carbs and fat are both absent", () => {
    const out = energySplit({ kcal: 200, protein: 30 });
    expect(out.split).toBe(false);
    expect(out.parts.every((p) => p.pct === 0)).toBe(true);
  });

  it("splits as soon as either carbs or fat is present", () => {
    expect(energySplit({ kcal: 200, protein: 30, carbs: 10 }).split).toBe(true);
    expect(energySplit({ kcal: 200, protein: 30, fat: 5 }).split).toBe(true);
  });

  it("shows a dash rather than a zero when nothing is logged", () => {
    const out = energySplit({});
    expect(out.kcalText).toBe("—");
    expect(out.kcal).toBe(0);
  });

  it("thousand-separates a big day", () => {
    expect(energySplit({ kcal: 2450 }).kcalText).toBe("2,450");
  });

  it("survives being handed nothing", () => {
    expect(() => energySplit(undefined)).not.toThrow();
    expect(energySplit(undefined).split).toBe(false);
  });

  it("keeps the three parts in a fixed order", () => {
    expect(ENERGY_PARTS.map((p) => p.key)).toEqual(["protein", "carbs", "fat"]);
  });
});
