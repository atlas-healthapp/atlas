import { describe, it, expect } from "vitest";
import {
  BANDS,
  BAND_IDS,
  DEFAULT_BAND,
  bandForHour,
  bandOf,
  bandIndex,
  bandLabel,
} from "@/utils/bands";

describe("bands", () => {
  it("runs in the order a day does", () => {
    expect(BAND_IDS).toEqual(["morning", "day", "evening", "night"]);
    expect(BANDS.map((b) => b.endHour)).toEqual([12, 17, 21, 24]);
  });

  it("puts each hour in the band that contains it", () => {
    expect(bandForHour(0)).toBe("morning");
    expect(bandForHour(11)).toBe("morning");
    expect(bandForHour(12)).toBe("day");
    expect(bandForHour(16)).toBe("day");
    expect(bandForHour(17)).toBe("evening");
    expect(bandForHour(20)).toBe("evening");
    expect(bandForHour(21)).toBe("night");
    expect(bandForHour(23)).toBe("night");
  });

  it("never returns nothing for a nonsense hour", () => {
    expect(bandForHour(99)).toBe("night");
    expect(bandForHour(undefined)).toBe("morning");
  });

  // A habit stored before bands existed has none, and DAY is the band that
  // makes no claim about early or late.
  it("falls back to DAY for a habit with no band or an unknown one", () => {
    expect(DEFAULT_BAND).toBe("day");
    expect(bandOf({})).toBe("day");
    expect(bandOf(undefined)).toBe("day");
    expect(bandOf({ band: "afternoon" })).toBe("day");
    expect(bandOf({ band: "night" })).toBe("night");
  });

  it("orders by position in the day, unknown bands included", () => {
    expect(bandIndex("morning")).toBe(0);
    expect(bandIndex("night")).toBe(3);
    expect(bandIndex("afternoon")).toBe(bandIndex("day"));
  });

  it("labels every band and nothing else", () => {
    expect(bandLabel("evening")).toBe("EVENING");
    expect(bandLabel("afternoon")).toBe("");
  });
});
