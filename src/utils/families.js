// Which colour family a metric belongs to.
//
// Colour used to mean "this is interactive" and came from --acc everywhere.
// It now means "this is what kind of thing", so every metric needs an answer,
// and that answer has to live in exactly one place: a second copy would drift
// and a card would end up with a header disagreeing with its own rows.
//
// The families are domains, not screens. BODY is what your body reports,
// INTAKE is what went in, ACTIVITY is what you did. Recovery is deliberately
// its own thing: it is a verdict computed from several families, so it belongs
// to none of them, and it is the only member of its family.
//
// The hex values live in src/style.css as --fam-* tokens, per theme. Nothing
// here knows a colour, only which token to reach for.

export const FAMILY_VARS = {
  body: "--fam-body",
  intake: "--fam-intake",
  activity: "--fam-activity",
  recovery: "--fam-recovery",
};

export const METRIC_FAMILY = {
  // BODY: readings the strap or the scale reports about you.
  sleep: "body",
  hrv: "body",
  restingHr: "body",
  hr: "body",
  respRate: "body",
  spo2: "body",
  skinTemp: "body",
  stress: "body",
  weight: "body",

  // INTAKE: things you consumed today.
  calories: "intake",
  water: "intake",
  protein: "intake",
  fibre: "intake",
  creatine: "intake",

  // ACTIVITY: things you did. Habits sit here rather than in a family of their
  // own: they are the one non-physiological member, but they are still actions.
  steps: "activity",
  pai: "activity",
  workouts: "activity",
  habits: "activity",

  recovery: "recovery",
};

/** Family id for a metric, or null if it has none yet. */
export function familyOf(metric) {
  return METRIC_FAMILY[metric] ?? null;
}

/**
 * A CSS value for a metric's family colour, ready to drop into a style
 * binding. Unknown metrics fall back to --dim rather than to an accent: a
 * metric with no family is not a fifth family, it is one nobody has classified
 * yet, and it should look unremarkable rather than inventing a meaning.
 */
export function familyColor(metric) {
  const family = familyOf(metric);
  return family ? `var(${FAMILY_VARS[family]})` : "var(--dim)";
}

/**
 * Recovery's label needs a different token from its gauge stroke, because gold
 * clears the 3:1 a stroke owes but not the 4.5:1 a small label owes on the
 * light themes. Every other family uses one token for both.
 */
export function familyInkColor(metric) {
  return familyOf(metric) === "recovery"
    ? "var(--fam-recovery-ink)"
    : familyColor(metric);
}
