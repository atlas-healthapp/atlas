import { describe, it, expect } from "vitest";
import {
  PRESETS,
  SYSTEMS,
  formatWeight,
  formatHeight,
  formatDistance,
  formatTemperature,
  weightToKg,
  heightToCm,
  cmToFeetInches,
} from "@/utils/unitConvert";

describe("unit presets", () => {
  it("only names systems that exist", () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      for (const [dim, system] of Object.entries(preset)) {
        expect(SYSTEMS[dim], `${name}.${dim}`).toContain(system);
      }
    }
  });

  // The reason there are three presets and not two. Nothing about a
  // metric/imperial binary can express this, and it is a large share of anyone
  // likely to download the app.
  it("gives the UK stones and miles but keeps Celsius", () => {
    expect(PRESETS.uk.weight).toBe("st");
    expect(PRESETS.uk.distance).toBe("mi");
    expect(PRESETS.uk.temperature).toBe("c");
  });
});

describe("formatWeight", () => {
  it("prints kilograms unchanged, since that is what is stored", () => {
    expect(formatWeight(82.4, "kg")).toBe("82.4 KG");
  });

  it("converts to pounds", () => {
    expect(formatWeight(82.4, "lb")).toBe("181.7 LB");
  });

  it("splits stones and pounds", () => {
    // 82.4kg is 181.7lb, which rounds to 182lb = 13st 0lb.
    expect(formatWeight(82.4, "st")).toBe("13ST 0LB");
    expect(formatWeight(80, "st")).toBe("12ST 8LB");
  });

  // An exact stone printed bare reads as a rounding rather than a measurement.
  it("always prints the pounds, even at zero", () => {
    expect(formatWeight(82.4, "st")).toMatch(/0LB$/);
  });

  it("returns null rather than a string for a missing reading", () => {
    expect(formatWeight(null, "kg")).toBe(null);
    expect(formatWeight(NaN, "kg")).toBe(null);
  });
});

describe("formatHeight", () => {
  it("converts centimetres to feet and inches", () => {
    expect(formatHeight(178, "ftin")).toBe(`5'10"`);
    expect(formatHeight(180, "ftin")).toBe(`5'11"`);
  });

  // 5'12" is not a height. The carry is the only real trap in this file.
  it("carries twelve inches into a foot", () => {
    // 182.9cm rounds to 72 inches exactly.
    expect(formatHeight(182.9, "ftin")).toBe(`6'0"`);
  });

  it("prints centimetres whole", () => {
    expect(formatHeight(178.4, "cm")).toBe("178 CM");
  });
});

describe("formatDistance", () => {
  it("takes metres and prints kilometres or miles", () => {
    expect(formatDistance(5000, "km")).toBe("5.00 KM");
    expect(formatDistance(5000, "mi")).toBe("3.11 MI");
  });
});

describe("formatTemperature", () => {
  it("converts Celsius to Fahrenheit", () => {
    expect(formatTemperature(33.4, "c")).toBe("33.4°C");
    expect(formatTemperature(0, "f")).toBe("32.0°F");
    expect(formatTemperature(33.4, "f")).toBe("92.1°F");
  });
});

describe("back to storage", () => {
  // The round trip is what protects the archive: a value typed in pounds,
  // stored as kilograms and shown again in pounds has to come back the same, or
  // switching units twice would walk every reading.
  it("round-trips a weight through pounds", () => {
    const kg = weightToKg(181.7, "lb");
    expect(formatWeight(kg, "lb")).toBe("181.7 LB");
  });

  it("round-trips a weight through stones", () => {
    const kg = weightToKg(13 * 14 + 0, "lb");
    expect(formatWeight(kg, "st")).toBe("13ST 0LB");
  });

  it("takes feet and inches as the two fields they are typed in", () => {
    expect(heightToCm(5, 10, "ftin")).toBe(178);
    expect(heightToCm(6, 0, "ftin")).toBe(183);
  });

  it("treats an empty height as nothing rather than as zero", () => {
    expect(heightToCm(0, 0, "ftin")).toBe(null);
    expect(heightToCm("", "", "ftin")).toBe(null);
  });

  it("splits centimetres back for the editor", () => {
    expect(cmToFeetInches(178)).toEqual({ feet: 5, inches: 10 });
    expect(cmToFeetInches(null)).toEqual({ feet: null, inches: null });
  });
});
