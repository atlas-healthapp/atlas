/**
 * Display units. **Atlas stores metric and converts on the way out, never the
 * other way round.**
 *
 * That rule is the whole design. If a unit change rewrote stored values, then
 * switching twice would round-trip every reading through two conversions and
 * leave the archive quietly wrong, with no undo and nothing on screen to say it
 * had happened. Weight in particular is a 90-day chart of numbers that differ by
 * a few hundred grams: the damage would be invisible until it mattered.
 *
 * So everything here is one-way, pure, and used only where a number is printed.
 */

/** What each dimension can be shown as. The first of each is what is stored. */
export const SYSTEMS = {
  weight: ["kg", "lb", "st"],
  height: ["cm", "ftin"],
  distance: ["km", "mi"],
  temperature: ["c", "f"],
};

/**
 * The three presets, and **UK is not a novelty**: stones and feet alongside
 * miles but with litres and Celsius is a real and common combination, and no
 * metric/imperial binary can express it. Someone who has to correct three of
 * four rows on first launch has been told the app was not built for them.
 */
export const PRESETS = {
  metric: { weight: "kg", height: "cm", distance: "km", temperature: "c" },
  imperial: { weight: "lb", height: "ftin", distance: "mi", temperature: "f" },
  uk: { weight: "st", height: "ftin", distance: "mi", temperature: "c" },
};

export const PRESET_LABELS = {
  metric: { label: "METRIC", sub: "KG · CM · KM · °C" },
  imperial: { label: "IMPERIAL", sub: "LB · FT · MILES · °F" },
  uk: { label: "UK", sub: "ST · FT · MILES · °C" },
};

const LB_PER_KG = 2.2046226218;
const LB_PER_STONE = 14;
const CM_PER_INCH = 2.54;
const KM_PER_MILE = 1.609344;

/**
 * A weight in kilograms, printed in the chosen system.
 *
 * Stones is **two numbers**, which is the one genuinely awkward case here: it
 * cannot be a single figure with a suffix like every other unit, so anything
 * laying out a weight has to cope with a longer string. Rounded to the nearest
 * pound within the stone, because half-pounds are noise at this scale and the
 * arithmetic reads badly (`12st 4.4lb`).
 */
export function formatWeight(kg, system = "kg", { decimals = 1 } = {}) {
  if (kg == null || !Number.isFinite(kg)) return null;
  if (system === "lb") return `${(kg * LB_PER_KG).toFixed(decimals)} LB`;
  if (system === "st") {
    const totalLb = Math.round(kg * LB_PER_KG);
    const stones = Math.floor(totalLb / LB_PER_STONE);
    const pounds = totalLb % LB_PER_STONE;
    // 13st 0lb rather than a bare 13st: the second number is always printed, or
    // an exact stone reads as a rounding rather than as a measurement.
    return `${stones}ST ${pounds}LB`;
  }
  return `${kg.toFixed(decimals)} KG`;
}

/** A height in centimetres, printed in the chosen system. */
export function formatHeight(cm, system = "cm") {
  if (cm == null || !Number.isFinite(cm)) return null;
  if (system === "ftin") {
    const totalIn = Math.round(cm / CM_PER_INCH);
    // 5'12" is not a height. Carrying the twelve is not optional.
    const feet = Math.floor(totalIn / 12);
    const inches = totalIn % 12;
    return `${feet}'${inches}"`;
  }
  return `${Math.round(cm)} CM`;
}

/** A distance in metres, printed in the chosen system. */
export function formatDistance(metres, system = "km", { decimals = 2 } = {}) {
  if (metres == null || !Number.isFinite(metres)) return null;
  if (system === "mi") return `${(metres / 1000 / KM_PER_MILE).toFixed(decimals)} MI`;
  return `${(metres / 1000).toFixed(decimals)} KM`;
}

/** A temperature in Celsius, printed in the chosen system. */
export function formatTemperature(c, system = "c", { decimals = 1 } = {}) {
  if (c == null || !Number.isFinite(c)) return null;
  if (system === "f") return `${(c * 9 / 5 + 32).toFixed(decimals)}°F`;
  return `${c.toFixed(decimals)}°C`;
}

/**
 * Back to storage, for the two fields a user types into.
 *
 * Only height and weight need this, because they are the only measurements
 * Atlas asks for rather than reads from the strap. Everything else arrives
 * metric from the band and is never entered by hand.
 */
export function weightToKg(value, system = "kg") {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (system === "lb") return n / LB_PER_KG;
  if (system === "st") return (n * LB_PER_STONE) / LB_PER_KG;
  return n;
}

/** Feet and inches as two separate fields, since that is how they are typed. */
export function heightToCm(feet, inches, system = "cm") {
  if (system !== "ftin") {
    const n = Number(feet);
    return Number.isFinite(n) ? n : null;
  }
  const f = Number(feet) || 0;
  const i = Number(inches) || 0;
  if (!f && !i) return null;
  return Math.round((f * 12 + i) * CM_PER_INCH);
}

/** Centimetres split for the two-field editor. */
export function cmToFeetInches(cm) {
  if (cm == null || !Number.isFinite(cm)) return { feet: null, inches: null };
  const totalIn = Math.round(cm / CM_PER_INCH);
  return { feet: Math.floor(totalIn / 12), inches: totalIn % 12 };
}
