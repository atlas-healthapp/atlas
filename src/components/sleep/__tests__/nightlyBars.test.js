import { describe, it, expect } from "vitest";
import { rangeBars } from "@/components/sleep/nightlyBars";

describe("rangeBars", () => {
  it("scales between the series' own low and high, not from zero", () => {
    // From zero these three would differ by 11% of the height and read as flat.
    const { bars, lo, hi } = rangeBars([49, 52, 55], { width: 300, height: 100 });
    expect(lo).toBe(49);
    expect(hi).toBe(55);
    expect(bars[2].h).toBe(100);
    expect(bars[2].h - bars[0].h).toBeGreaterThan(50);
  });

  it("keeps the lowest night visible as a bar rather than as nothing", () => {
    const { bars } = rangeBars([49, 55], { width: 300, height: 100 });
    expect(bars[0].h).toBeGreaterThan(8);
  });

  it("draws a flat series at full height rather than dividing by zero", () => {
    const { bars } = rangeBars([52, 52, 52], { width: 300, height: 100 });
    expect(bars.every((b) => b.h === 100)).toBe(true);
  });

  it("draws no bar for a night with no reading, and keeps its slot", () => {
    const { bars } = rangeBars([49, null, 55], { width: 300, height: 100 });
    expect(bars.map((b) => b.i)).toEqual([0, 2]);
    expect(bars[1].x).toBeGreaterThanOrEqual(200);
  });

  it("has nothing to draw when nothing was recorded", () => {
    const { bars, lo } = rangeBars([null, null], {});
    expect(bars).toEqual([]);
    expect(lo).toBeNull();
  });
});
