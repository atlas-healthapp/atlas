import { familyColor } from "@/utils/families";

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

/** Which family colours each ring. Recovery and routine are not plain metrics. */
function colorFor(key) {
  if (key === "routine") return familyColor("habits");
  return familyColor(key);
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
        opens: "recovery",
      };
    case "sleep":
      return {
        key,
        label: DIAL_LABELS[key],
        pct: v.sleepPct ?? 0,
        text: v.sleepText,
        color: colorFor("sleep"),
        opens: "sleep",
      };
    case "routine":
      return {
        key,
        label: DIAL_LABELS[key],
        pct: pct(v.habitsDone, v.habitsDue),
        // The count, not a percentage. "3/9" says what is left; "33%" does not.
        text: v.habitsDue ? `${v.habitsDone}/${v.habitsDue}` : "--",
        color: colorFor("routine"),
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
        color: colorFor(key),
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
