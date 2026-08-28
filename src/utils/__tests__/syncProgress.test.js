import { describe, it, expect } from "vitest";
import { progressLabel } from "../syncProgress";

describe("progressLabel", () => {
  it("says how far through, not how many", () => {
    // The case it was written for: six digits against six digits read as a
    // machine struggling.
    expect(progressLabel("SAVING", 10234, 190450)).toBe("SAVING · 5%");
    expect(progressLabel("UPDATING", 95000, 190000)).toBe("UPDATING · 50%");
  });

  it("reaches both ends", () => {
    expect(progressLabel("SAVING", 0, 1000)).toBe("SAVING · 0%");
    expect(progressLabel("SAVING", 1000, 1000)).toBe("SAVING · 100%");
  });

  // A total that shifts mid-run - a second batch arriving - must not print 104%.
  it("never goes past a hundred", () => {
    expect(progressLabel("SAVING", 1200, 1000)).toBe("SAVING · 100%");
    expect(progressLabel("SAVING", -5, 1000)).toBe("SAVING · 0%");
  });

  // Saying 0% or 100% without a denominator would both be claims nobody has.
  it("falls back to the bare word when there is no honest fraction", () => {
    expect(progressLabel("SAVING", 10, 0)).toBe("SAVING");
    expect(progressLabel("SAVING", 10, undefined)).toBe("SAVING");
    expect(progressLabel("SAVING", undefined, 100)).toBe("SAVING");
    expect(progressLabel("SAVING", 10, NaN)).toBe("SAVING");
  });
});
