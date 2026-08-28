import { familyColor, familyInkColor } from "@/utils/families";

/**
 * Which of Home's three rings shows what.
 *
 * **The row used to be fixed at Recovery / Sleep / Protein, one per colour
 * family, so it doubled as a standing legend for what the colours mean. That
 * second job is given up here deliberately**: any set the user picks can put two
 * rings in one family, and a rule that cannot be enforced is not a rule. The
 * families still do their work on the cards below, which is where it matters.
 *
 * A candidate has to be able to honestly fill a ring, which means it has a score
 * or a goal. Stress and HRV are therefore not on the list: neither has a target,
 * and a ring would have to invent one to have anything to fill.
 */
export const DIAL_CANDIDATES = [
  "recovery",
  "sleep",
  "steps",
  "pai",
  "calories",
  "protein",
  "fibre",
  "water",
  "routine",
];

export const DIAL_COUNT = 3;

/**
 * Recovery and Sleep first because they are scores rather than tallies, then
 * steps rather than protein: steps needs no configuration and works from the
 * first sync, where protein needs the food side to be in use.
 */
export const DEFAULT_DIALS = ["recovery", "sleep", "steps"];

export const DIAL_LABELS = {
  recovery: "RECOVERY",
  sleep: "SLEEP",
  steps: "STEPS",
  pai: "PAI",
  calories: "CALORIES",
  protein: "PROTEIN",
  fibre: "FIBRE",
  water: "WATER",
  routine: "ROUTINE",
};

/**
 * Which family colours each ring. Recovery and routine are not plain metrics.
 *
 * Exported because the settings picker draws a swatch per dial and would
 * otherwise need its own copy of the routine-is-habits rule, which is the one
 * kind of duplication `families.js` exists to prevent.
 */
export function dialColor(key) {
  if (key === "routine") return familyColor("habits");
  return familyColor(key);
}

/**
 * The same, for anything that sets *text* rather than a stroke. Gold clears the
 * 3:1 a gauge stroke owes and misses the 4.5:1 a small label owes on both light
 * themes, so Recovery - and only Recovery - reads a darker token here.
 */
export function dialInkColor(key) {
  if (key === "routine") return familyInkColor("habits");
  return familyInkColor(key);
}



function pct(value, goal) {
  // A goal switched off leaves the ring empty rather than full: dividing by null
  // gives Infinity, and a ring reading 100% on a target nobody is keeping is the
  // worst possible answer.
  if (!value || !goal) return 0;
  return Math.min(100, (value / goal) * 100);
}

/**
 * One dial's numbers, from values the component has already computed.
 *
 * Pure and takes a bag rather than reaching into stores, so the choosing logic
 * is testable without mounting Home. `bootScale` is applied by the caller, not
 * here, because the boot animation is the component's business.
 */
export function dialFor(key, v) {
  switch (key) {
    case "recovery":
      return {
        key,
        label: DIAL_LABELS[key],
        pct: v.recoveryScore ?? 0,
        text: v.recoveryText,
        color: v.recoveryColor,
        inkColor: v.recoveryInk,
        glow: v.recoveryBand === "GREAT",
        // **The sub-line is for the widget, not for Home.** Home's ring has the
        // band in the card below it and a page one tap away; a widget has
        // neither, so a bare 54 there says nothing about whether 54 is a good
        // morning. Home ignores it, which is why it is computed here rather
        // than assembled in Java: the widget renders and the app computes.
        sub: v.recoveryBand ?? null,
        opens: "recovery",
      };
    case "sleep":
      return {
        key,
        label: DIAL_LABELS[key],
        pct: v.sleepPct ?? 0,
        text: v.sleepText,
        color: dialColor("sleep"),
        // The hours, because the figure above is the score. Whichever of the two
        // is not leading is the one worth saying underneath.
        sub: v.sleepHoursText ?? null,
        opens: "sleep",
      };
    case "routine":
      return {
        key,
        label: DIAL_LABELS[key],
        pct: pct(v.habitsDone, v.habitsDue),
        // The count, not a percentage. "3/9" says what is left; "33%" does not.
        text: v.habitsDue ? `${v.habitsDone}/${v.habitsDue}` : "--",
        color: dialColor("routine"),
        opens: "routine",
      };
    default: {
      const value = v.totals?.[key] ?? null;
      // `fixedGoals` covers the references that are not settable goals - PAI's
      // published threshold, for one - so a ring for them still fills.
      const goal = v.goals?.[key] ?? v.fixedGoals?.[key] ?? null;
      return {
        key,
        label: DIAL_LABELS[key] ?? key,
        pct: pct(value, goal),
        text: v.texts?.[key] ?? (value == null ? "--" : String(Math.round(value))),
        color: dialColor(key),
        // "OF 160G", formatted by the registry rather than here, so the widget
        // cannot print a unit the rest of the app does not use.
        sub: v.subs?.[key] ?? null,
        // Food metrics open the diary, everything else its own metric page.
        opens: ["calories", "protein", "fibre"].includes(key) ? "food" : "metric",
      };
    }
  }
}

/**
 * The three to draw, defaulted and repaired.
 *
 * **Repaired matters more than defaulted.** A stored choice can name a goal the
 * user has since switched off, and a ring for a target nobody is keeping can
 * only ever read zero. Those fall back to the first default not already on
 * screen rather than being dropped, because the row is a fixed three across and
 * two rings would leave a hole where the layout expects one.
 */
export function resolveDials(stored, isAvailable) {
  const out = [];
  const wanted = Array.isArray(stored) && stored.length ? stored : DEFAULT_DIALS;

  for (const key of wanted.slice(0, DIAL_COUNT)) {
    if (DIAL_CANDIDATES.includes(key) && isAvailable(key) && !out.includes(key)) {
      out.push(key);
    }
  }
  for (const key of [...DEFAULT_DIALS, ...DIAL_CANDIDATES]) {
    if (out.length >= DIAL_COUNT) break;
    if (!out.includes(key) && isAvailable(key)) out.push(key);
  }
  // Everything switched off is not a state the picker allows, but a stored
  // record from a future version could produce it, and three empty rings beat
  // a crash.
  while (out.length < DIAL_COUNT) out.push(DEFAULT_DIALS[out.length] ?? "recovery");
  return out;
}
