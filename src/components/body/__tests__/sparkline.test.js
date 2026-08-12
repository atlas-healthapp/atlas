import { describe, it, expect } from "vitest";
import { sparklinePoints } from "@/components/body/sparkline";

describe("sparklinePoints", () => {
  it("spreads points across the full width and inverts y so high values sit high", () => {
    const pts = sparklinePoints([0, 10], 100, 20).split(" ");
    expect(pts[0]).toBe("0,20");
    expect(pts[1]).toBe("100,0");
  });

  it("returns an empty string when there is nothing to draw", () => {
    expect(sparklinePoints([], 100, 20)).toBe("");
    expect(sparklinePoints([null, null], 100, 20)).toBe("");
  });

  it("returns an empty string for a single point, which is not a line", () => {
    expect(sparklinePoints([5, null, null], 100, 20)).toBe("");
  });

  it("skips missing days rather than drawing them as zero", () => {
    // A gap is a day the strap recorded nothing. Plotting it at zero would
    // invent a reading and drag the line down.
    const pts = sparklinePoints([10, null, 20], 100, 20).split(" ");
    expect(pts).toHaveLength(2);
    expect(pts[0]).toBe("0,20");
    expect(pts[1]).toBe("100,0");
  });

  it("draws a flat line through the middle when every value is identical", () => {
    // A zero-range series would divide by zero if handled naively.
    const pts = sparklinePoints([50, 50, 50], 100, 20).split(" ");
    expect(pts).toEqual(["0,10", "50,10", "100,10"]);
  });

  it("treats a real zero as a plottable value, not a gap", () => {
    const pts = sparklinePoints([0, 5], 100, 20).split(" ");
    expect(pts).toHaveLength(2);
  });

  it("keeps x positions anchored to the original index when the gap is leading", () => {
    expect(sparklinePoints([null, null, 10, 20], 100, 20)).toBe("67,20 100,0");
  });
});
