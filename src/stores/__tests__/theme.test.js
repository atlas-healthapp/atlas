import { describe, it, expect } from "vitest";
import { THEMES, DEFAULT_THEME, resolveTheme } from "@/stores/theme";

describe("resolveTheme", () => {
  it("passes through every theme the app actually defines", () => {
    for (const theme of THEMES) {
      expect(resolveTheme(theme.id)).toBe(theme.id);
    }
  });

  // The reason this function exists. A phone that was on Synth when it was
  // removed would otherwise set a data-theme nothing styles.
  it("falls back to the default for a removed theme", () => {
    expect(resolveTheme("synth")).toBe(DEFAULT_THEME);
  });

  it("falls back for a missing or malformed stored value", () => {
    expect(resolveTheme(null)).toBe(DEFAULT_THEME);
    expect(resolveTheme(undefined)).toBe(DEFAULT_THEME);
    expect(resolveTheme("")).toBe(DEFAULT_THEME);
    expect(resolveTheme(42)).toBe(DEFAULT_THEME);
  });

  it("no longer offers Synth", () => {
    expect(THEMES.map((t) => t.id)).not.toContain("synth");
  });
});
