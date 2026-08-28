/**
 * Where a set of macros' energy actually came from.
 *
 * Extracted from `DiaryView` on 2026-08-24 when the section breakdown needed
 * the same three tiles the day panel draws. One implementation for the same
 * question asked at two scopes, which is the rule the rest of this codebase
 * already runs on: two rival definitions is how a screen ends up disagreeing
 * with the panel above it.
 */

/**
 * 4/4/9 kcal per gram. The figures the tiles are labelled with, not a
 * recalculation of the day's calories: an item's stored kcal is what it was
 * logged with, and the split is a separate statement about composition.
 */
export const ENERGY_PARTS = [
  { key: "protein", label: "PROTEIN", perGram: 4, color: "var(--fam-intake)" },
  { key: "carbs", label: "CARBS", perGram: 4, color: "var(--macro-carbs)" },
  { key: "fat", label: "FAT", perGram: 9, color: "var(--macro-fat)" },
];

/**
 * @param macros `{ kcal, protein, carbs, fat }`, any of them missing.
 * @returns the headline figure and one part per macro, each with its grams and
 *   its share of the energy.
 */
export function energySplit(macros) {
  const m = macros ?? {};
  const raw = ENERGY_PARTS.map((p) => ({
    ...p,
    grams: Math.round(m[p.key] ?? 0),
    energy: (m[p.key] ?? 0) * p.perGram,
  }));
  const total = raw.reduce((sum, p) => sum + p.energy, 0);
  // **Nobody eats a meal of pure protein.** Carbs and fat both at zero means
  // the items were logged without those figures, not that the food had none,
  // so the shares are withheld rather than shown as 100% protein. Scoping this
  // to a section makes it more likely, not less: one item logged from a
  // protein-only barcode is a whole meal's worth of nothing.
  const split = (m.carbs ?? 0) + (m.fat ?? 0) > 0;
  return {
    kcal: Math.round(m.kcal ?? 0),
    kcalText: m.kcal ? Math.round(m.kcal).toLocaleString() : "—",
    split,
    parts: raw.map((p) => ({
      ...p,
      pct: split && total ? Math.round((p.energy / total) * 100) : 0,
    })),
  };
}
