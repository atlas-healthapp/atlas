import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FAMILY_VARS,
  METRIC_FAMILY,
  familyOf,
  familyColor,
  familyInkColor,
} from "@/utils/families";
import { BODY_METRICS } from "@/utils/bodyMetrics";

const css = readFileSync(resolve(process.cwd(), "src/style.css"), "utf8");

/** Pull one custom property's value out of a given selector block. */
function tokenIn(selector, name) {
  const block = css.slice(css.indexOf(selector));
  const body = block.slice(block.indexOf("{"), block.indexOf("}"));
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(body);
  return match ? match[1] : null;
}

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
// Obsidian declares its background as #000, so shorthand has to expand or
// every ratio against it comes out NaN and the assertions pass vacuously.
function expand(hex) {
  const h = hex.replace("#", "");
  return h.length === 3
    ? h
        .split("")
        .map((c) => c + c)
        .join("")
    : h;
}

function luminance(hex) {
  const h = expand(hex);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return (
    0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
  );
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Brettel-style LMS simulation, the standard approximation.
function simulate(hex, kind) {
  const h = expand(hex);
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16)) * 255);
  const L = 17.8824 * r + 43.5161 * g + 4.11935 * b;
  const M = 3.45565 * r + 27.1554 * g + 3.86714 * b;
  const S = 0.0299566 * r + 0.184309 * g + 1.46709 * b;
  let l2, m2, s2;
  if (kind === "deuteranopia") [l2, m2, s2] = [L, 0.494207 * L + 1.24827 * S, S];
  else if (kind === "protanopia") [l2, m2, s2] = [2.02344 * M - 2.52581 * S, M, S];
  else [l2, m2, s2] = [L, M, -0.395913 * L + 0.801109 * M];
  return [
    0.0809444479 * l2 - 0.130504409 * m2 + 0.116721066 * s2,
    -0.0102485335 * l2 + 0.0540193266 * m2 - 0.113614708 * s2,
    -0.000365296938 * l2 - 0.00412161469 * m2 + 0.693511405 * s2,
  ];
}
function separation(a, b, kind) {
  const [x, y] = [simulate(a, kind), simulate(b, kind)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

const FAMILY_NAMES = ["body", "intake", "activity", "recovery"];
const DARK_GROUNDS = { sentinel: "#04080f", ember: "#0c0803" };
const LIGHT_GROUNDS = { paper: "#f0e7d3", mission: "#eef2f7" };

describe("family assignment", () => {
  it("gives every wearable metric a family", () => {
    for (const metric of Object.keys(BODY_METRICS)) {
      // `hr` is raw heart rate, stored only so restingHr has a fallback
      // source. It never renders, so it needs no family.
      if (metric === "hr") continue;
      expect(familyOf(metric), `${metric} has no family`).not.toBeNull();
    }
  });

  it("keeps water with the things you consumed, not with sleep", () => {
    expect(familyOf("water")).toBe("intake");
    expect(familyOf("sleep")).toBe("body");
  });

  it("leaves an unclassified metric looking unremarkable rather than inventing a family", () => {
    expect(familyOf("nonsense")).toBeNull();
    expect(familyColor("nonsense")).toBe("var(--dim)");
  });

  it("gives recovery a separate token for label text", () => {
    expect(familyColor("recovery")).toBe("var(--fam-recovery)");
    expect(familyInkColor("recovery")).toBe("var(--fam-recovery-ink)");
    // Every other family uses one token for both roles.
    expect(familyInkColor("protein")).toBe(familyColor("protein"));
  });

  it("maps every family in METRIC_FAMILY to a declared token", () => {
    for (const family of new Set(Object.values(METRIC_FAMILY))) {
      expect(FAMILY_VARS[family], `${family} has no CSS var`).toBeTruthy();
    }
  });
});

// These read the real stylesheet rather than a copy, so the palette cannot
// drift away from what was measured without a test going red.
describe("family palette, as declared in style.css", () => {
  const darkTokens = Object.fromEntries(
    FAMILY_NAMES.map((f) => [f, tokenIn(":root {", `--fam-${f}`)])
  );
  const lightTokens = Object.fromEntries(
    FAMILY_NAMES.map((f) => [f, tokenIn('[data-theme="paper"],', `--fam-${f}`)])
  );

  it("declares all four families for both grounds", () => {
    for (const f of FAMILY_NAMES) {
      expect(darkTokens[f], `dark --fam-${f} missing`).toBeTruthy();
      expect(lightTokens[f], `light --fam-${f} missing`).toBeTruthy();
    }
  });

  it("clears 3:1 against every theme background, the floor for a gauge stroke", () => {
    for (const [theme, bg] of Object.entries(DARK_GROUNDS)) {
      for (const f of FAMILY_NAMES) {
        expect(contrast(darkTokens[f], bg), `${f} on ${theme}`).toBeGreaterThanOrEqual(3);
      }
    }
    for (const [theme, bg] of Object.entries(LIGHT_GROUNDS)) {
      for (const f of FAMILY_NAMES) {
        expect(contrast(lightTokens[f], bg), `${f} on ${theme}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("clears 4.5:1 for label text, which is why recovery has its own ink token", () => {
    const ink = tokenIn('[data-theme="paper"],', "--fam-recovery-ink");
    for (const [theme, bg] of Object.entries(LIGHT_GROUNDS)) {
      expect(contrast(ink, bg), `recovery ink on ${theme}`).toBeGreaterThanOrEqual(4.5);
      // The stroke token is the one that legitimately falls short, and this
      // records why the split exists rather than assuming someone remembers.
      expect(contrast(lightTokens.recovery, bg)).toBeLessThan(4.5);
    }
  });

  // The whole reason the palette is spaced by luminance and not only by hue.
  it("keeps every family pair distinguishable under colour blindness on dark themes", () => {
    for (const kind of ["deuteranopia", "protanopia", "tritanopia"]) {
      for (let i = 0; i < FAMILY_NAMES.length; i++) {
        for (let j = i + 1; j < FAMILY_NAMES.length; j++) {
          const [a, b] = [FAMILY_NAMES[i], FAMILY_NAMES[j]];
          expect(
            separation(darkTokens[a], darkTokens[b], kind),
            `${a} vs ${b} under ${kind}`
          ).toBeGreaterThan(40);
        }
      }
    }
  });
});

// The macro sub-palette is not a fifth family, but it is held to the same
// measurements: it is drawn at bar size on both grounds and has to survive
// colour blindness, or "which slice is fat" stops being answerable.
describe("macro palette", () => {
  // Protein is not in here because it has no token of its own: it is the family
  // colour. It still has to be measured against carbs and fat, because all
  // three sit in the same panel a row apart.
  const dark = {
    protein: tokenIn(":root {", "--fam-intake"),
    carbs: tokenIn(":root {", "--macro-carbs"),
    fat: tokenIn(":root {", "--macro-fat"),
  };
  const light = {
    protein: tokenIn('[data-theme="paper"],', "--fam-intake"),
    carbs: tokenIn('[data-theme="paper"],', "--macro-carbs"),
    fat: tokenIn('[data-theme="paper"],', "--macro-fat"),
  };
  const NAMES = ["protein", "carbs", "fat"];

  it("declares carbs and fat for both grounds, and takes protein from the family", () => {
    for (const n of NAMES) {
      expect(dark[n], `dark ${n} missing`).toBeTruthy();
      expect(light[n], `light ${n} missing`).toBeTruthy();
    }
    // The merge that happened when INTAKE was lifted: a separate protein blue
    // landed 12 apart from the family one, which is no separation at all.
    expect(css).not.toMatch(/--macro-protein/);
  });

  it("clears 3:1 against every theme background", () => {
    for (const [theme, bg] of Object.entries(DARK_GROUNDS)) {
      for (const n of NAMES) {
        expect(contrast(dark[n], bg), `${n} on ${theme}`).toBeGreaterThanOrEqual(3);
      }
    }
    for (const [theme, bg] of Object.entries(LIGHT_GROUNDS)) {
      for (const n of NAMES) {
        expect(contrast(light[n], bg), `${n} on ${theme}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps every macro pair distinguishable under colour blindness", () => {
    for (const kind of ["deuteranopia", "protanopia", "tritanopia"]) {
      for (let i = 0; i < NAMES.length; i++) {
        for (let j = i + 1; j < NAMES.length; j++) {
          const [a, b] = [NAMES[i], NAMES[j]];
          expect(
            separation(dark[a], dark[b], kind),
            `${a} vs ${b} under ${kind}`
          ).toBeGreaterThan(40);
        }
      }
    }
  });

  // Nothing recovery-coloured is ever on the Food tab, but a macro sitting on
  // top of another palette's value is the kind of thing that only bites once
  // something moves.
  it("does not reuse recovery's gold for fat", () => {
    expect(dark.fat).not.toBe(tokenIn(":root {", "--fam-recovery"));
    expect(dark.fat).not.toBe(tokenIn(":root {", "--rec-okay"));
  });
});

// A card on a light ground used to be a wash of black over the page, which
// measured 1.06:1 against it on Mission. Contrast ratio cannot fix that, since
// nothing legible sits slightly lighter than a near-white page, so the surface
// goes up to white and a shadow does the separating instead. These pin the
// mechanism, because reverting the panel to an overlay would look almost right
// on a screenshot and be invisible on a phone.
describe("card surfaces", () => {
  function declaredIn(selector, name) {
    const block = css.slice(css.indexOf(selector));
    const body = block.slice(block.indexOf("{"), block.indexOf("}"));
    return new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? null;
  }

  it("raises the surface above the page on the light themes, rather than darkening it", () => {
    for (const [selector, ground] of [
      ['[data-theme="paper"] {', "#f0e7d3"],
      ['[data-theme="mission"] {', "#eef2f7"],
    ]) {
      const panel = declaredIn(selector, "--panel");
      expect(panel, `${selector} --panel missing`).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(
        luminance(panel),
        `${selector} panel must be lighter than its own page`
      ).toBeGreaterThan(luminance(ground));
    }
  });

  it("gives the light themes a shadow and the dark themes none", () => {
    expect(declaredIn('[data-theme="sentinel"] {', "--panel-shadow")).toBe("none");
    const light = declaredIn('[data-theme="paper"],', "--panel-shadow");
    expect(light).toBeTruthy();
    expect(light).not.toBe("none");
  });

  it("firms up the card edge on the light themes", () => {
    const dark = declaredIn('[data-theme="sentinel"] {', "--panel-line");
    const light = declaredIn('[data-theme="paper"],', "--panel-line");
    const pct = (s) => Number(/(\d+)%/.exec(s)?.[1] ?? 0);
    expect(pct(light)).toBeGreaterThan(pct(dark));
  });
});

describe("recovery band palette", () => {
  const BANDS = ["low", "okay", "good", "great"];
  const dark = Object.fromEntries(BANDS.map((b) => [b, tokenIn(":root {", `--rec-${b}`)]));
  const light = Object.fromEntries(
    BANDS.map((b) => [b, tokenIn('[data-theme="paper"],', `--rec-${b}`)])
  );
  const lightInk = Object.fromEntries(
    BANDS.map((b) => [b, tokenIn('[data-theme="paper"],', `--rec-${b}-ink`)])
  );

  it("declares every band for both grounds", () => {
    for (const b of BANDS) {
      expect(dark[b], `dark --rec-${b} missing`).toBeTruthy();
      expect(light[b], `light --rec-${b} missing`).toBeTruthy();
      expect(lightInk[b], `light --rec-${b}-ink missing`).toBeTruthy();
    }
  });

  // The obvious ramp does not work, and this is the evidence. Red against a
  // deep green (#22c55e) simulates ~7 apart under deuteranopia, which is the
  // classic red/green trap: LOW and the green bands would look identical. What
  // saves it is luminance, not hue, so both greens have to stay light.
  it("keeps LOW apart from both greens, which a deep green would not be", () => {
    for (const kind of ["deuteranopia", "protanopia", "tritanopia"]) {
      expect(separation(dark.low, dark.good, kind), `low vs good under ${kind}`).toBeGreaterThan(40);
      expect(separation(dark.low, dark.great, kind), `low vs great under ${kind}`).toBeGreaterThan(40);
    }
    // Deuteranopia is the one that catches it: against the deeper #22c55e the
    // same red simulates ~7 apart, near enough identical.
    expect(separation(dark.low, "#22c55e", "deuteranopia")).toBeLessThan(40);
  });

  it("clears 3:1 as a dial stroke on every theme background", () => {
    for (const [theme, bg] of Object.entries(DARK_GROUNDS)) {
      for (const b of BANDS) {
        expect(contrast(dark[b], bg), `${b} on ${theme}`).toBeGreaterThanOrEqual(3);
      }
    }
    for (const [theme, bg] of Object.entries(LIGHT_GROUNDS)) {
      for (const b of BANDS) {
        expect(contrast(light[b], bg), `${b} on ${theme}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("clears 4.5:1 as label text on the light themes", () => {
    for (const [theme, bg] of Object.entries(LIGHT_GROUNDS)) {
      for (const b of BANDS) {
        expect(contrast(lightInk[b], bg), `${b} ink on ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // The band colour is the second channel; the label beside it is the first.
  // Even so, nobody should see the bottom band and a green one as the same dial.
  it("keeps the bands distinguishable from each other under colour blindness", () => {
    for (const kind of ["deuteranopia", "protanopia", "tritanopia"]) {
      for (let i = 0; i < BANDS.length; i++) {
        for (let j = i + 1; j < BANDS.length; j++) {
          expect(
            separation(dark[BANDS[i]], dark[BANDS[j]], kind),
            `${BANDS[i]} vs ${BANDS[j]} under ${kind}`
          ).toBeGreaterThan(40);
        }
      }
    }
  });

  // ACTIVITY is teal for exactly this reason. If a green band simulated as the
  // same colour, moving ACTIVITY off green would have bought nothing.
  it("keeps both green bands separable from the ACTIVITY teal", () => {
    const activity = tokenIn(":root {", "--fam-activity");
    for (const kind of ["deuteranopia", "protanopia", "tritanopia"]) {
      for (const b of ["good", "great"]) {
        expect(
          separation(dark[b], activity, kind),
          `${b} vs activity under ${kind}`
        ).toBeGreaterThan(40);
      }
    }
  });
});

describe("sleep stage palette", () => {
  const STAGES = ["deep", "light", "rem", "awake"];

  it("clears 3:1 on every theme background", () => {
    const dark = Object.fromEntries(STAGES.map((s) => [s, tokenIn(":root {", `--stage-${s}`)]));
    const light = Object.fromEntries(
      STAGES.map((s) => [s, tokenIn('[data-theme="paper"],', `--stage-${s}`)])
    );
    for (const [theme, bg] of Object.entries(DARK_GROUNDS)) {
      for (const s of STAGES) {
        expect(contrast(dark[s], bg), `${s} on ${theme}`).toBeGreaterThanOrEqual(3);
      }
    }
    for (const [theme, bg] of Object.entries(LIGHT_GROUNDS)) {
      for (const s of STAGES) {
        expect(contrast(light[s], bg), `${s} on ${theme}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("stress zone palette", () => {
  const ZONES = ["calm", "mild", "moderate", "high"];
  // The card is the harder ground than the page on the light themes, because
  // the surface goes up to white while the page stays tinted.
  const CARDS = { paper: "#fdfaf2", mission: "#ffffff" };

  const dark = Object.fromEntries(ZONES.map((z) => [z, tokenIn(":root {", `--stress-${z}`)]));
  const light = Object.fromEntries(
    ZONES.map((z) => [z, tokenIn('[data-theme="paper"],', `--stress-${z}`)])
  );

  // This is the test that was missing. Every other ramp had a light set and
  // the stress zones did not, so both light themes drew the dark values and
  // MILD measured 1.51:1 against a card for months.
  it("declares a light set at all", () => {
    for (const z of ZONES) {
      expect(light[z], `--stress-${z} on the light themes`).toBeTruthy();
      expect(light[z]).not.toBe(dark[z]);
    }
  });

  // 4.5:1 rather than the 3:1 the stage colours owe, because a zone colour is
  // used as text here: StressPage tints the hero reading and the zone label
  // with it, not just the chart columns.
  it("clears 4.5:1 as text on every background", () => {
    for (const [theme, bg] of Object.entries(DARK_GROUNDS)) {
      for (const z of ZONES) {
        expect(contrast(dark[z], bg), `${z} on ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const [theme, bg] of Object.entries({ ...LIGHT_GROUNDS, ...CARDS })) {
      for (const z of ZONES) {
        expect(contrast(light[z], bg), `${z} on ${theme}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  // Not the 40 the families are held to. This is a semantic ramp, and the same
  // argument recovery.js makes applies: the zone name sits beside the colour
  // everywhere it is used, so colour is never the only channel. What is
  // enforced is that the light set is no worse than the dark one it replaces.
  it("keeps the light set at least as separable as the dark one", () => {
    const weakest = (set) => {
      let worst = Infinity;
      for (let i = 0; i < ZONES.length; i++) {
        for (let j = i + 1; j < ZONES.length; j++) {
          for (const kind of ["deuteranopia", "protanopia", "tritanopia"]) {
            worst = Math.min(worst, separation(set[ZONES[i]], set[ZONES[j]], kind));
          }
        }
      }
      return worst;
    };
    expect(weakest(light)).toBeGreaterThanOrEqual(weakest(dark));
  });

  it("keeps calm clear of the recovery greens, so no ramp borrows the other's meaning", () => {
    // Blue for calm rather than green is deliberate: a high stress reading is
    // a state, not a verdict, and green-means-good belongs to Recovery.
    for (const [set, band] of [
      [dark, tokenIn(":root {", "--rec-good")],
      [light, tokenIn('[data-theme="paper"],', "--rec-good")],
    ]) {
      for (const kind of ["deuteranopia", "protanopia"]) {
        expect(separation(set.calm, band, kind), `calm vs GOOD under ${kind}`).toBeGreaterThan(40);
      }
    }
  });
});
