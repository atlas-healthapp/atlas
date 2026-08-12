// What a logged diary row was made of. Pure, so the scaling and the
// snapshot-versus-recipe comparison are testable without a store.

export const DETAIL_MACROS = [
  { key: "kcal", label: "KCAL", unit: "" },
  { key: "protein", label: "PROTEIN", unit: "G" },
  { key: "carbs", label: "CARBS", unit: "G" },
  { key: "fat", label: "FAT", unit: "G" },
  { key: "fibre", label: "FIBRE", unit: "G" },
];

/**
 * How much of an ingredient, written the way its own unit wants.
 *
 * Base units in the real library are two different kinds of thing and printing
 * them the same way is wrong for one of them. A bare unit ("g", "serving",
 * "slice") takes a count: 50 g, 2 slice. A unit that already carries its own
 * amount ("125 g", "1 portion (25 g)", "1 Cup (200 g)") does not, and prefixing
 * a count gives "1 1 PORTION (25 G)", which is what shipped. Those take a
 * multiplier instead, and only when it is not 1.
 *
 * The test is whether the unit starts with a digit, which is exactly what
 * distinguishes "125 g" from "g".
 */
export function formatAmount(quantity, unit, portion) {
  const u = (unit || "serving").toUpperCase();
  const q = +(quantity ?? 1).toFixed(2);
  const base = !/^\d/.test(u) ? `${q} ${u}` : q === 1 ? u : `×${q} · ${u}`;
  return portion ? `${base} (${portionText(q, portion)})` : base;
}

/**
 * What that many of them actually is.
 *
 * Multiplied, not restated: a serving of eggs is two, so one and a half
 * servings is three, and printing "(2 EGGS)" beside 1.5 servings would be
 * worse than printing nothing. `portion` describes ONE base unit.
 */
export function portionText(quantity, { amount, unit }) {
  return `${+(quantity * amount).toFixed(2)} ${String(unit).toUpperCase()}`;
}

/** Only the macros actually recorded. A missing macro is not a zero. */
export function macroChips(macros) {
  const src = macros ?? {};
  return DETAIL_MACROS.filter((m) => src[m.key] != null).map((m) => ({
    key: m.key,
    label: m.label,
    value: `${Math.round(src[m.key])}${m.unit}`,
  }));
}

/**
 * A composite's ingredients, scaled to how much of it was logged.
 *
 * Two scalings compose here and getting either wrong is silently plausible: an
 * ingredient's own quantity within the recipe, and how many of the parent were
 * logged. Half a serving of a recipe containing two eggs is one egg, and the
 * bug that reads as correct is showing two.
 *
 * The ingredient list can only come from the library, because a logged row
 * stores totals rather than a recipe. So this is always the current
 * definition, whatever the row's own numbers say.
 */
export function ingredientBreakdown(item, quantity, { itemById, scaleItem }) {
  if (!item?.ingredients?.length) return [];

  const base = item.baseAmount || 1;
  const factor = (quantity ?? base) / base;

  return item.ingredients.map((ing, i) => {
    const child = itemById(ing.itemId);
    const qty = (ing.quantity ?? 1) * factor;
    const scaled = child ? scaleItem(child, qty) : null;
    return {
      key: `${ing.itemId}-${i}`,
      // Same shape componentBreakdown returns, so the editor can address a row
      // and step its quantity without knowing which source it came from.
      index: i,
      quantity: qty,
      // An ingredient deleted from the library leaves the recipe referencing
      // an id that resolves to nothing. Saying so beats a blank row.
      name: child?.name ?? "REMOVED FROM LIBRARY",
      amount: child ? formatAmount(qty, child.baseUnit, child.portion) : "",
      macro: DETAIL_MACROS.filter((m) => scaled?.[m.key] != null)
        .slice(0, 3)
        .map((m) => `${Math.round(scaled[m.key])}${m.unit}`)
        .join(" · "),
    };
  });
}

/**
 * The same list for a row whose ingredients have been edited for one day.
 *
 * Reads only the entry. That is the whole point of freezing them: a customised
 * meal has stopped being the library's recipe, so consulting the library would
 * put back an ingredient that was removed and re-scale one that was doubled.
 */
export function componentBreakdown(components, { itemById } = {}) {
  return (components ?? []).map((c, i) => ({
    key: `${c.itemId}-${i}`,
    index: i,
    name: c.name,
    quantity: c.quantity,
    // The portion is the one field allowed to come from the library after
    // freezing, and only when the entry has none. Macros are a measurement of
    // what was eaten and must never move; a portion is vocabulary - "a serving
    // of eggs is two" - and a row frozen before that was recorded should learn
    // it rather than be stuck saying 1.5 SERVING forever.
    amount: formatAmount(
      c.quantity,
      c.unit,
      c.portion ?? (itemById ? itemById(c.itemId)?.portion : null)
    ),
    macro: DETAIL_MACROS.filter((m) => c[m.key] != null)
      .slice(0, 3)
      .map((m) => `${Math.round(c[m.key])}${m.unit}`)
      .join(" · "),
  }));
}

/**
 * Whether this row can have its ingredients edited at all.
 *
 * A flat item has nothing to take apart, and a row already customised is
 * editable whatever the library now says about the item behind it.
 */
export function canEditComponents(item, row) {
  return Boolean(row?.components || item?.ingredients?.length);
}

/**
 * Whether the recipe now adds up to something other than what was logged.
 *
 * Protein alone, with a gram of slack: the snapshot was rounded when it was
 * taken, and a rounding difference is not a changed recipe.
 */
export function recipeDrifted(item, row, { scaleItem }) {
  const logged = row?.macros?.protein;
  // A customised row is not claiming to be the recipe any more, so comparing it
  // against one would fire the warning permanently and for the wrong reason.
  if (row?.components) return false;
  if (!item?.ingredients?.length || logged == null) return false;
  const now = scaleItem(item, row.quantity)?.protein;
  return now != null && Math.abs(now - logged) > 1;
}
