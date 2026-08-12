// Scanning several things in a row and turning them into one library meal.
//
// All of it is pure, because none of it can be checked by running the app: the
// sheet that uses this is template-shaped, and the arithmetic underneath it is
// the part that can be silently wrong. A meal whose totals disagree with the
// list under them is exactly the defect `components` was built to make
// impossible on a logged entry, and a library composite has the same duty.

import { uid } from "@/utils/date";
import { formatAmount } from "./rowDetail";

export const MACRO_KEYS = ["protein", "kcal", "carbs", "fat", "fibre"];

/** Only the five macros, and a missing one stays missing rather than becoming 0. */
function pickMacros(src) {
  const out = {};
  for (const key of MACRO_KEYS) out[key] = src?.[key] ?? null;
  return out;
}

/**
 * The same rounding the store will apply once this is saved.
 *
 * `resolvedMacros` rounds a flat item's own figure, then `scaleItem` multiplies
 * by the quantity factor and rounds again. The preview has to round in the same
 * two places or the total on screen changes the moment the meal is created,
 * which is the one thing a preview may not do.
 */
export function scaleMacro(value, quantity, baseAmount) {
  if (value == null) return null;
  const base = baseAmount || 1;
  return Math.round(Math.round(value) * ((quantity ?? base) / base));
}

/**
 * Whether a scan says the same thing the library already says.
 *
 * Compared at whole numbers, which is the resolution everything downstream
 * stores and prints: Open Food Facts hands back 249.6 kcal where the library
 * holds 250, and that is the same product rather than a changed recipe. A macro
 * recorded on one side and absent on the other IS a difference - "we do not
 * know the fibre" and "it has 3g" are not the same claim.
 */
export function macrosMatch(a, b) {
  return MACRO_KEYS.every((key) => {
    const x = a?.[key];
    const y = b?.[key];
    if (x == null || y == null) return x == null && y == null;
    return Math.round(x) === Math.round(y);
  });
}

/**
 * A scan becomes a row in the collection.
 *
 * `existing` is the library item the barcode or name matched, if any, and
 * `existingMacros` its resolved figures (resolved, because a composite has none
 * of its own). A matched row keeps the library's identity - its name, unit and
 * base amount are what the rest of Atlas already calls this thing, and a scan
 * is no reason to rename it underneath the schedule.
 *
 * A per-100g scan lands as 100 g rather than as "1 serving": the figures
 * describe 100 grams, and there is no form in this flow to correct that on.
 */
export function entryFromScan(scanned, existing = null, existingMacros = null) {
  const per100g = scanned.servingBasis === "100g";
  const baseAmount = existing ? existing.baseAmount || 1 : per100g ? 100 : 1;
  const baseUnit = existing
    ? existing.baseUnit || "serving"
    : per100g
      ? "g"
      : scanned.servingSize || "serving";

  return {
    key: uid(),
    // Set once the row is created in the library, or straight away for a match.
    itemId: existing?.id ?? null,
    name: existing?.name ?? scanned.name,
    baseAmount,
    baseUnit,
    portion: existing?.portion ?? null,
    quantity: baseAmount,
    scannedMacros: pickMacros(scanned),
    libraryMacros: existing ? pickMacros(existingMacros) : null,
    // A composite's macros are the sum of its own ingredients, so there is
    // nothing here to overwrite them with and the choice is never offered.
    composite: Boolean(existing?.ingredients?.length),
    // A match keeps what the library says unless the user asks otherwise. The
    // single-scan flow defaults the other way on purpose: it puts the figures in
    // front of you on a form, and this is six taps with your eyes on the shelf.
    useScanned: !existing,
    barcode: scanned.barcode ?? null,
  };
}

/** The figures this row is currently claiming, per base unit. */
export function activeMacros(entry) {
  return entry.useScanned || !entry.libraryMacros
    ? entry.scannedMacros
    : entry.libraryMacros;
}

/** A matched row whose scan disagrees with the library, and can say so. */
export function entryDiffers(entry) {
  if (!entry.itemId || entry.composite) return false;
  return !macrosMatch(entry.scannedMacros, entry.libraryMacros);
}

/** This row's contribution to the meal, scaled to its quantity. */
export function entryMacros(entry) {
  const src = activeMacros(entry);
  const out = {};
  for (const key of MACRO_KEYS) {
    out[key] = scaleMacro(src?.[key], entry.quantity, entry.baseAmount);
  }
  return out;
}

/**
 * What the meal comes out as: the sum of its parts and nothing else.
 *
 * A macro no part records stays null. Summing it as zero would turn "nobody
 * measured the fibre" into "this meal has none", which is the same rule the
 * store applies when it recomputes an entry from its components.
 */
export function mealTotals(entries) {
  const totals = {};
  for (const key of MACRO_KEYS) {
    const parts = entries
      .map((e) => entryMacros(e)[key])
      .filter((v) => v != null);
    totals[key] = parts.length
      ? Math.round(parts.reduce((sum, v) => sum + v, 0))
      : null;
  }
  return totals;
}

/** How this row's amount is written, through the one formatter that may print one. */
export function entryAmount(entry) {
  return formatAmount(entry.quantity, entry.baseUnit, entry.portion);
}

/**
 * How much one tap of the stepper moves.
 *
 * Half a unit is right for eggs and slices and absurd for grams, and a per-100g
 * scan lands here as a base amount of 100. The split is on the base amount
 * rather than on the unit string, because the unit can be anything Open Food
 * Facts wrote in it.
 */
export function quantityStep(baseAmount) {
  return (baseAmount || 1) >= 10 ? 10 : 0.5;
}

/**
 * The stepped quantity, or null when the step is refused.
 *
 * Never to zero or below: an amount of nothing is a removal, and REMOVE says so.
 */
export function steppedQuantity(entry, direction) {
  const step = quantityStep(entry.baseAmount);
  const next = +((entry.quantity ?? step) + direction * step).toFixed(2);
  return next < step ? null : next;
}

/**
 * Add a scan to what has been collected, or bump what is already there.
 *
 * Scanning the same barcode twice is a double tap far more often than it is a
 * genuine second helping, and two rows for one product then need two quantity
 * edits to fix. Bumping by one base amount is the same statement and is
 * reversible with the stepper. Matched on the barcode first, since two library
 * items can share a name but not a code.
 */
export function mergeScan(entries, entry) {
  const at = entries.findIndex((e) =>
    entry.barcode && e.barcode
      ? e.barcode === entry.barcode
      : Boolean(entry.itemId) && e.itemId === entry.itemId
  );
  if (at < 0) return [...entries, entry];
  const bumped = {
    ...entries[at],
    quantity: +(entries[at].quantity + entries[at].baseAmount).toFixed(2),
  };
  return entries.map((e, i) => (i === at ? bumped : e));
}

/** A scanned row that is not in the library yet, as a library item. */
export function libraryPayload(entry) {
  const macros = activeMacros(entry);
  return {
    name: entry.name,
    // Matches what a single scan defaults to. There is no "ingredient" kind:
    // that concept was removed on 2026-07-25 and every item is pickable anyway.
    kind: "meal",
    ...pickMacros(macros),
    baseAmount: entry.baseAmount,
    baseUnit: entry.baseUnit,
    portion: entry.portion ?? null,
    ingredients: null,
    barcode: entry.barcode,
  };
}

/**
 * The macro fields to write back onto a matched item the user chose the scan for.
 *
 * Only the macros and the barcode. The name, unit and base amount are the
 * library's own vocabulary and the rest of Atlas is already using them.
 */
export function scannedUpdate(entry) {
  return { ...pickMacros(entry.scannedMacros), barcode: entry.barcode };
}

/** Which matched rows would be rewritten by creating this meal. */
export function rowsToRewrite(entries) {
  return entries.filter((e) => e.itemId && e.useScanned && !e.composite);
}

/**
 * The composite's ingredient list, in the order they were scanned.
 *
 * `idByKey` carries the ids the store handed back for rows that had to be
 * created first. A row with no id could only come from a failed write, and a
 * recipe referencing nothing renders as REMOVED FROM LIBRARY forever.
 */
export function ingredientsFor(entries, idByKey) {
  return entries
    .map((e) => ({ itemId: e.itemId ?? idByKey[e.key] ?? null, quantity: e.quantity }))
    .filter((ing) => ing.itemId);
}

/** A meal needs a name and something in it. Both are the user's to give. */
export function canCreateMeal(name, entries) {
  return Boolean(name?.trim()) && entries.length > 0;
}
