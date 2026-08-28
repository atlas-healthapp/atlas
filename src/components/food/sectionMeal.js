/**
 * Turning a day's logged rows into a reusable meal.
 *
 * Lunch was beans, bread and eggs on two days, added as three separate items
 * each time. This is the arithmetic behind saving those three as one thing, so
 * next time is one tap.
 *
 * **The composite machinery already exists twice** - Library's SELECT mode and
 * `batchMeal.js` - and neither could start from *logged* rows, which is the
 * only new part. The rules below are all about that difference.
 *
 * Pure and tested, because `SectionMealSheet.vue` is template-shaped and cannot
 * be checked here.
 */

/**
 * A row can only become an ingredient if there is something in the library to
 * point at.
 *
 * A composite stores `{itemId, quantity}` and computes its macros live from
 * them. A quick-added row carries its own macros and no `mealId`, so there is
 * nothing to reference - and creating a library item for it is exactly the
 * pollution `addAdHoc` exists to avoid ("Tuesday in Bali" is not a recipe).
 * Such a row is shown and explained rather than silently dropped.
 */
export function isUsable(row) {
  return Boolean(row?.mealId) && row.kind === "snack";
}

/** Why a row cannot be used, or null when it can. */
export function reasonUnusable(row) {
  if (isUsable(row)) return null;
  // A slot belongs to the retired weekly template. Nothing creates one any
  // more, but plans recorded before 2026-08-18 still hold some and they still
  // render. There is no store call that removes one, so a "tidy today" that
  // included it would delete the snacks around it and silently leave the slot
  // behind - which is what the first version of this did.
  if (row?.kind === "slot") return "FROM AN OLD MEAL PLAN";
  return "NOT IN THE LIBRARY";
}

/**
 * The rows of one section, each marked with whether it can be used and why not.
 *
 * Order is preserved: it is the order they were eaten in, and a recipe that
 * lists them in a different order reads as a different meal.
 */
export function candidates(rows) {
  return (rows ?? []).map((row) => ({
    row,
    usable: isUsable(row),
    // Named here rather than in the sheet, so there is one answer to "why not"
    // and the two cannot drift apart.
    why: reasonUnusable(row),
  }));
}

/**
 * The ingredient list for the new composite.
 *
 * **Extras become ingredients in their own right.** An extra is something added
 * to one logged meal on one day - the egg on today's breakfast - and it sits
 * beside the parent's totals rather than inside them. When the whole section
 * becomes a recipe, that egg was part of what was eaten, so it is part of the
 * recipe. Leaving it out would make the meal quietly smaller than the day it
 * came from.
 *
 * A row that was edited that day (`components`) still references its library
 * item rather than freezing that day's version: what is being made here is a
 * template for next time, and next time should start from the recipe.
 */
export function ingredientsFrom(rows) {
  const out = [];
  for (const row of rows ?? []) {
    if (!isUsable(row)) continue;
    out.push({ itemId: row.mealId, quantity: row.quantity ?? 1 });
    for (const extra of row.extras ?? []) {
      if (extra?.itemId) out.push({ itemId: extra.itemId, quantity: extra.quantity ?? 1 });
    }
  }
  return out;
}

/**
 * Two ingredients is the floor.
 *
 * One row is already a thing you can log in one tap, so saving it as a meal
 * makes a second name for the same food and teaches the library to grow
 * duplicates.
 */
export function canSave(name, rows) {
  return Boolean(name?.trim()) && ingredientsFrom(rows).length >= 2;
}

/**
 * Whether the action is worth putting on a section header at all.
 *
 * Matches {@link canSave}'s floor rather than a looser one, so the control is
 * never offered for a section it would refuse to save.
 */
export function offerFor(rows) {
  return ingredientsFrom(rows).length >= 2;
}

/**
 * A name to start from: the section and the day, which is what people call it.
 *
 * Deliberately not built from the ingredients ("Beans, Bread and Eggs" runs
 * past every row this will ever be drawn in, and the third item is rarely what
 * the meal is about). It is a prefill, not a decision.
 */
export function suggestedName(sectionLabel, date) {
  const label = String(sectionLabel ?? "MEAL").toLowerCase();
  const named = label.charAt(0).toUpperCase() + label.slice(1);
  if (!date) return named;
  const when = new Date(`${date}T00:00:00`);
  if (Number.isNaN(when.getTime())) return named;
  return `${named}, ${when.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/**
 * The rows a "tidy today" would remove, newest index first.
 *
 * **Descending on purpose.** The store removes by index, so taking them in
 * ascending order shifts every later index by one and deletes the wrong rows -
 * the classic version of this bug removes the first and third of three and
 * leaves the second.
 */
export function removalOrder(rows) {
  return (rows ?? [])
    .filter((r) => isUsable(r))
    .map((r) => ({ kind: r.kind, index: r.index }))
    .sort((a, b) => b.index - a.index);
}

/**
 * Whether every row being saved can also be removed.
 *
 * The two sets are the same by construction today, since {@link isUsable}
 * already refuses everything the removal cannot handle. This asserts it at the
 * point of use rather than trusting that, because the failure is silent and
 * destructive: rows deleted, one left behind, no error.
 */
export function canTidy(rows) {
  const usable = (rows ?? []).filter(isUsable);
  return usable.length > 0 && usable.length === removalOrder(rows).length;
}
