import { defineStore } from "pinia";
import { ref } from "vue";
import { load, persist } from "@/utils/storage";
import { today, uid } from "@/utils/date";

// Buckets a HH:MM time string into a meal-type section for the Diary view.
// Exported standalone (not a store method) so it can be imported without an
// active Pinia instance, and so ScheduleEditor/DiaryView share one boundary
// definition instead of duplicating the hour cutoffs.
export function mealTypeFromTime(hhmm) {
  const h = Number(hhmm.split(":")[0]);
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

// Meal library item: { id, name, kind: 'meal'|'snack'|'takeaway', protein, kcal,
// carbs?, fat?, baseAmount, baseUnit, ingredients? }. baseAmount/baseUnit describe
// what the stored macros represent (e.g. baseAmount: 1, baseUnit: "egg", or
// baseAmount: 100, baseUnit: "g") - items created before this field existed
// default to baseAmount: 1, baseUnit: "serving" everywhere.
// A non-empty `ingredients` array (`[{ itemId, quantity }]`) makes an item
// COMPOSITE: its protein/kcal/carbs/fat are never stored, always computed
// live from its ingredients via resolvedMacros() below - see that function's
// comment. An item is either flat (has its own typed macros) or composite
// (has ingredients), never both. Nesting is allowed - a composite's
// ingredient can itself be composite.
// A slot/snack may also carry `extras: [{ itemId, quantity, name, protein?,
// kcal?, carbs?, fat?, fibre? }]` - things added to that one logged meal on
// that one day. Their macros sit alongside the parent's rather than inside
// them, so the parent's snapshot keeps meaning "what the library said". Older
// plans have no extras field and read as none.
// It may also carry `components: [{ itemId, unit, name, quantity, protein?,
// kcal?, carbs?, fat?, fibre? }]` - what that meal was ACTUALLY made of that
// day, once its ingredients have been edited (no spinach, double rice). Unlike
// extras these are INSIDE the meal: the entry's own macros are recomputed as
// their sum, so the totals and the list can never disagree. Its presence also
// means the entry has stopped reading the library: it describes itself, it is
// skipped by refreshSnapshotsForItem, and the recipe-drift check stands down.
// Absent on every entry that has never been edited, which reads as "use the
// recipe" with no migration.
// Day plan: { date, slots: [{ time, mealId, confirmed, quantity?, name?,
// protein?, kcal?, carbs?, fat? }], snacks: [{ mealId, at, quantity?, name?,
// protein?, kcal?, carbs?, fat? }] }
// **Nothing writes a slot any more** (2026-08-18). Day plans are created empty
// and everything logged goes through addSnack into `snacks`, carrying a
// `mealType` that says which section it belongs to - which is what breakfast,
// lunch and dinner have always done. `slots` is read and summed for the plans
// that already hold some, and is otherwise vestigial: see the weekly-template
// removal note on planFor.
// name/protein/kcal/carbs/fat/quantity on a slot/snack are a snapshot of the
// library item, ALREADY SCALED by quantity, taken at seed/swap/add time -
// history stays honest even if the item is later edited or deleted from the
// library, or if any of a composite's ingredients change. Older stored plans
// predate this and simply lack the snapshot fields; every reader falls back
// to a live itemById() lookup for them.
// Editing a library item's macros/ingredients can optionally rewrite already-
// logged snapshots too, via refreshSnapshotsForItem - but only when the user
// explicitly opts in after an edit; it is never automatic.
export const useFoodStore = defineStore("food", () => {
  const library = ref(load("atlas_food_library", []));
  const dayPlans = ref(load("atlas_food_dayplans", []));

  function _persistLib() {
    persist("atlas_food_library", library.value);
  }
  function _persistPlans() {
    persist("atlas_food_dayplans", dayPlans.value);
  }

  // Returns the new id: a caller that creates an item in order to use it
  // straight away (the picker's "create this" path) would otherwise have to
  // guess which of the library's entries it had just made.
  function addLibraryItem(item) {
    const id = uid();
    library.value.push({
      id,
      carbs: null,
      fat: null,
      fibre: null,
      baseAmount: 1,
      baseUnit: "serving",
      ingredients: null,
      ...item,
    });
    _persistLib();
    return id;
  }

  function removeLibraryItem(id) {
    library.value = library.value.filter((i) => i.id !== id);
    _persistLib();
  }

  // Strips this item out of every composite's ingredient list that
  // references it directly (a nested composite built on top of one of
  // those composites needs no separate handling - its own macros just
  // recompute live once the direct parent's ingredient list changes), then
  // deletes the item itself. Used for the "delete anyway" force option the
  // UI offers after showing how many composites reference the item.
  function removeLibraryItemAndDetach(id) {
    for (const item of library.value) {
      if (item.ingredients?.length) {
        item.ingredients = item.ingredients.filter((ing) => ing.itemId !== id);
      }
    }
    removeLibraryItem(id);
  }

  function updateLibraryItem(id, updates) {
    const item = library.value.find((i) => i.id === id);
    if (item) {
      Object.assign(item, updates);
      _persistLib();
    }
  }

  function itemById(id) {
    return library.value.find((i) => i.id === id) ?? null;
  }

  // Exact-barcode lookup, used by the Add to Library scan flow to warn
  // before creating a duplicate of an item already scanned in previously.
  function findByBarcode(barcode) {
    if (!barcode) return null;
    return library.value.find((i) => i.barcode === barcode) ?? null;
  }

  // Every itemId reachable from the given ingredients list, including nested
  // composites' own ingredients. Backs both the save-time cycle check and
  // the delete guard below.
  function _ingredientClosure(ingredients, visited = new Set()) {
    for (const ing of ingredients) {
      if (visited.has(ing.itemId)) continue;
      visited.add(ing.itemId);
      const item = itemById(ing.itemId);
      if (item?.ingredients?.length) {
        _ingredientClosure(item.ingredients, visited);
      }
    }
    return visited;
  }

  // True if saving `itemId` with `ingredients` would make itemId reachable
  // from itself (directly, or through a nested composite). Called by the UI
  // before saving a composite edit - the store stays a dumb setter, same
  // convention as the baseAmount<=0 guard already living in the UI.
  function wouldCreateCycle(itemId, ingredients) {
    return _ingredientClosure(ingredients).has(itemId);
  }

  // How many composite library items (direct or nested) currently reference
  // this item as an ingredient - backs the "can't delete, still in use"
  // guard, so a composite's ingredient graph never has a dangling reference.
  function usedAsIngredientCount(itemId) {
    return library.value.filter(
      (i) =>
        i.ingredients?.length && _ingredientClosure(i.ingredients).has(itemId)
    ).length;
  }

  // An item's effective macros: a flat item's own stored fields, or - for a
  // composite (non-empty `ingredients`) - the sum of each ingredient's own
  // resolved+scaled macros, resolved recursively for nested composites. A
  // nutrient with no contributing ingredient stays null rather than becoming
  // 0, matching the flat-item convention. `visited` guards against an
  // unexpected cycle (the save-time check is what should prevent one; this
  // is only a defensive backstop against infinite recursion).
  // Macros are always whole numbers at every read - grams/kcal are never
  // usefully fractional, and rounding once here (in addition to scaleItem's
  // own rounding) means a manually-typed decimal in the add/edit form still
  // displays clean everywhere this is read from.
  function resolvedMacros(item, visited = new Set()) {
    if (!item.ingredients?.length) {
      return {
        protein: item.protein != null ? Math.round(item.protein) : null,
        kcal: item.kcal != null ? Math.round(item.kcal) : null,
        carbs: item.carbs != null ? Math.round(item.carbs) : null,
        fat: item.fat != null ? Math.round(item.fat) : null,
        fibre: item.fibre != null ? Math.round(item.fibre) : null,
      };
    }
    if (visited.has(item.id)) {
      return { protein: null, kcal: null, carbs: null, fat: null, fibre: null };
    }
    const nextVisited = new Set(visited).add(item.id);
    const sums = { protein: 0, kcal: 0, carbs: 0, fat: 0, fibre: 0 };
    const any = { protein: false, kcal: false, carbs: false, fat: false, fibre: false };
    for (const ing of item.ingredients) {
      const ingItem = itemById(ing.itemId);
      if (!ingItem) continue;
      const scaled = scaleItem(ingItem, ing.quantity, nextVisited);
      for (const key of ["protein", "kcal", "carbs", "fat", "fibre"]) {
        if (scaled[key] != null) {
          sums[key] += scaled[key];
          any[key] = true;
        }
      }
    }
    return {
      protein: any.protein ? Math.round(sums.protein) : null,
      kcal: any.kcal ? Math.round(sums.kcal) : null,
      carbs: any.carbs ? Math.round(sums.carbs) : null,
      fat: any.fat ? Math.round(sums.fat) : null,
      fibre: any.fibre ? Math.round(sums.fibre) : null,
    };
  }

  // Scales an item's macros for a given quantity of its baseUnit (e.g. an
  // item that's "1 egg" @ 6.5g protein, quantity 3 -> 19.5g protein). Missing
  // macro fields stay null rather than becoming 0 or NaN. Scales off
  // resolvedMacros() rather than the item's raw fields - the one change that
  // makes composite items work everywhere scaleItem is already called
  // (day-plan snapshots, schedule seeding, swap, snack-add) with no further
  // changes needed at any of those call sites.
  function scaleItem(item, quantity, visited = new Set()) {
    const resolved = resolvedMacros(item, visited);
    const base = item.baseAmount || 1;
    const q = quantity ?? base;
    const factor = q / base;
    // Rounded to whole numbers - macros are never usefully fractional at
    // display time, and multiplying floats (e.g. a 1/3-cup baseAmount) can
    // otherwise leave floating-point noise like 19.499999999999996 in a
    // stored snapshot.
    return {
      name: item.name,
      protein: resolved.protein != null ? Math.round(resolved.protein * factor) : null,
      kcal: resolved.kcal != null ? Math.round(resolved.kcal * factor) : null,
      carbs: resolved.carbs != null ? Math.round(resolved.carbs * factor) : null,
      fat: resolved.fat != null ? Math.round(resolved.fat * factor) : null,
      fibre: resolved.fibre != null ? Math.round(resolved.fibre * factor) : null,
      quantity: q,
    };
  }

  // Snapshot of a library item's display/macro fields, scaled by quantity,
  // spread onto a slot or snack at the moment its mealId is set - see the
  // day-plan comment above. quantity omitted defaults to the item's own
  // baseAmount (i.e. "1x the base", matching pre-scaling behavior).
  function _snapshot(mealId, quantity) {
    const item = itemById(mealId);
    if (!item) return {};
    return scaleItem(item, quantity);
  }

  // Returns (and lazily creates) an empty plan for a date.
  //
  // **The weekly template is gone** (2026-08-18). This used to seed today's
  // slots from it, and that was the whole plan-and-confirm model: a template you
  // filled in once, seeded into each day, confirmed with a tap. Measured on the
  // real archive before removing it: **0 items in the template, 0 confirmed
  // slots, and 118 logged entries** - all of them going through `addSnack`,
  // which is what every section writes to, breakfast and dinner included. The
  // user confirmed he adds food ad-hoc and does not want to schedule it.
  //
  // So nothing creates a slot any more. The slot machinery below still reads and
  // sums them for the day plans that already contain some, and removing it is a
  // second job with a real blast radius across the diary - see the ticket.
  // Used internally by every mutating
  // function below; read-only display code should use planForDate instead,
  // which never creates or persists anything.
  function planFor(date) {
    let plan = dayPlans.value.find((p) => p.date === date);
    if (!plan) {
      plan = { date, slots: [], snacks: [] };
      dayPlans.value.push(plan);
      _persistPlans();
    }
    return plan;
  }

  // Pure read for displaying a date's plan (e.g. the Diary browsing past
  // days) - never creates or persists a record, so casually arrowing through
  // history doesn't silently write dozens of empty day-plans to storage.
  function planForDate(date) {
    return (
      dayPlans.value.find((p) => p.date === date) ?? {
        date,
        slots: [],
        snacks: [],
      }
    );
  }

  function confirmSlot(date, index, confirmed = true) {
    const plan = planFor(date);
    if (plan.slots[index]) {
      plan.slots[index].confirmed = confirmed;
      _persistPlans();
    }
  }

  function swapSlot(date, index, mealId, quantity) {
    const plan = planFor(date);
    if (plan.slots[index]) {
      plan.slots[index].mealId = mealId;
      Object.assign(plan.slots[index], _snapshot(mealId, quantity));
      _persistPlans();
    }
  }

  // A snack-kind item is always a snack, regardless of what mealType the
  // caller passes (or doesn't) - only matters for Library's direct LOG
  // button, since Diary's own add flow already only ever offers snack-kind
  // items from the Snacks section itself.
  function addSnack(date, mealId, quantity, mealType) {
    const plan = planFor(date);
    const item = itemById(mealId);
    const resolvedMealType =
      item?.kind === "snack"
        ? "snack"
        : (mealType ?? mealTypeFromTime(new Date().toTimeString().slice(0, 5)));
    plan.snacks.push({
      mealId,
      at: new Date().toISOString(),
      mealType: resolvedMealType,
      ..._snapshot(mealId, quantity),
    });
    _persistPlans();
  }

  // ── Log-time extras ────────────────────────────────────────────────────
  // Something added to one logged meal on one day: the egg you put on today's
  // breakfast and no other day's. The library recipe is deliberately untouched.
  //
  // An extra carries its own snapshot for exactly the reason a slot does: it is
  // a record of what you ate, and editing the library later must not rewrite
  // history. It is kept as its own list rather than folded into the parent's
  // totals so the stored figure keeps meaning one thing, "what the library said
  // when this was logged". Folding it in would make every tweaked meal look
  // like a changed recipe, and the drift warning would fire on all of them.
  function _entryAt(date, kind, index) {
    const plan = dayPlans.value.find((p) => p.date === date);
    if (!plan) return null;
    return (kind === "snack" ? plan.snacks : plan.slots)[index] ?? null;
  }

  function addExtra(date, kind, index, itemId, quantity) {
    const entry = _entryAt(date, kind, index);
    const item = itemById(itemId);
    if (!entry || !item) return;
    (entry.extras ??= []).push({
      itemId,
      quantity,
      name: item.name,
      ..._snapshot(itemId, quantity),
    });
    _persistPlans();
  }

  function removeExtra(date, kind, index, extraIndex) {
    const entry = _entryAt(date, kind, index);
    if (!entry?.extras) return;
    entry.extras.splice(extraIndex, 1);
    if (!entry.extras.length) delete entry.extras;
    _persistPlans();
  }

  // ── Per-instance components ────────────────────────────────────────────
  // What one logged meal was ACTUALLY made of, on one day: no spinach, double
  // the rice. The library recipe is untouched, same as extras.
  //
  // Extras cannot express this. They sit beside the parent by design, so
  // removing an ingredient would need a negative extra and the row would read
  // as "dinner, plus minus-spinach". This is subtraction and scaling, which
  // belongs inside the meal.
  //
  // The first edit FREEZES the whole recipe onto the entry - every component
  // with its own name and macros, already scaled - and from then on the entry
  // describes itself and never consults the library again. That is the same
  // bargain the macro snapshot already makes, extended to the ingredient list,
  // which was the one part of a logged meal still being read live.

  /**
   * Freeze the library recipe onto the entry, once, so it can be edited.
   *
   * Returns the component list, or null when there is nothing to freeze: a flat
   * item has no ingredients, and "edit what went into it" means nothing there.
   */
  function _materialiseComponents(entry) {
    if (entry.components) return entry.components;
    const item = entry.mealId ? itemById(entry.mealId) : null;
    if (!item?.ingredients?.length) return null;

    // Both scalings, composed exactly as rowDetail does it: the ingredient's
    // quantity within the recipe, times how much of the parent was logged.
    const base = item.baseAmount || 1;
    const factor = (entry.quantity ?? base) / base;

    entry.components = item.ingredients
      .map((ing) => {
        const child = itemById(ing.itemId);
        if (!child) return null;
        const qty = (ing.quantity ?? 1) * factor;
        return {
          itemId: ing.itemId,
          unit: child.baseUnit || "serving",
          // Frozen with everything else: a portion is part of describing what
          // was eaten, and the entry stops reading the library once it has one.
          portion: child.portion ?? null,
          ...scaleItem(child, qty),
        };
      })
      // An ingredient already deleted from the library cannot be frozen, and
      // carrying a nameless row forward would put "REMOVED FROM LIBRARY" into
      // the record permanently rather than only while the library says so.
      .filter(Boolean);

    return entry.components;
  }

  // The entry's totals ARE its components once it has them, so nothing can
  // disagree: contributionsFor reads the snapshot, and the snapshot is this sum.
  function _recomputeFromComponents(entry) {
    for (const key of ["protein", "kcal", "carbs", "fat", "fibre"]) {
      const parts = entry.components.filter((c) => c[key] != null);
      // A macro nobody recorded stays null. Summing it as zero would turn "we
      // do not know the fibre" into "this meal had none".
      entry[key] = parts.length
        ? Math.round(parts.reduce((sum, c) => sum + c[key], 0))
        : null;
    }
  }

  function setComponentQuantity(date, kind, index, componentIndex, quantity) {
    const entry = _entryAt(date, kind, index);
    // Checked before materialising: freezing the recipe is a real change to the
    // entry (it stops tracking the library) and an edit that goes on to be
    // rejected must not leave that behind. Zero is REMOVE's job, not a quantity.
    if (!entry || !(quantity > 0)) return;
    const components = _materialiseComponents(entry);
    const component = components?.[componentIndex];
    const item = component ? itemById(component.itemId) : null;
    if (!component || !item) return;
    Object.assign(component, scaleItem(item, quantity));
    _recomputeFromComponents(entry);
    _persistPlans();
  }

  function removeComponent(date, kind, index, componentIndex) {
    const entry = _entryAt(date, kind, index);
    if (!entry) return;
    const components = _materialiseComponents(entry);
    if (!components?.[componentIndex]) return;
    components.splice(componentIndex, 1);
    // An empty list stays an empty list rather than reverting to the recipe:
    // "I ate none of it" is a statement, and dropping the field would silently
    // restore every ingredient the next time the sheet was opened.
    _recomputeFromComponents(entry);
    _persistPlans();
  }

  // Sums one nutrient across an entry's extras. Older plans have no `extras`
  // at all, which reads as zero without any migration.
  function _extrasTotal(entry, key) {
    return (entry.extras ?? []).reduce((sum, e) => sum + (e[key] ?? 0), 0);
  }

  // Removes a logged snack/takeaway entry entirely - used by the Diary's
  // tap-LOGGED-to-remove action. Slots aren't removed this way (they're
  // schedule-tied, not ad-hoc) - see confirmSlot(date, index, false) instead.
  /**
   * A one-off entry that never touches the library.
   *
   * The holiday case: you are not going to log every meal, but at the end of
   * the day you know roughly what the day was. Nothing here is reusable and
   * nothing is meant to be - creating a library item called "Tuesday in Bali"
   * would pollute the thing the weekly template is built from.
   *
   * Stored as a snack with **no mealId**, which every reader already copes
   * with: a logged entry carries its own macros as a snapshot and only falls
   * back to the library when it has none, so an entry that never had an item
   * behind it reads exactly like one whose item was later deleted.
   */
  function addAdHoc(date, { name, protein, kcal, carbs, fat, fibre }, mealType) {
    const plan = planFor(date);
    plan.snacks.push({
      mealId: null,
      at: new Date().toISOString(),
      mealType: mealType ?? "snack",
      name: name?.trim() || "Estimated",
      protein: protein ?? null,
      kcal: kcal ?? null,
      carbs: carbs ?? null,
      fat: fat ?? null,
      fibre: fibre ?? null,
      adHoc: true,
    });
    _persistPlans();
  }

  function removeSnack(date, index) {
    const plan = planFor(date);
    plan.snacks.splice(index, 1);
    _persistPlans();
  }

  // Reassigns which Diary section a logged snack/slot shows under, for
  // today's plan only - never touches the recurring weekly template, same
  // "day plans diverge independently" convention as everywhere else in this
  // file. Used by the Diary's drag-between-sections interaction.
  function setSnackMealType(date, index, mealType) {
    const plan = planFor(date);
    if (plan.snacks[index]) {
      plan.snacks[index].mealType = mealType;
      _persistPlans();
    }
  }

  function setSlotMealType(date, index, mealType) {
    const plan = planFor(date);
    if (plan.slots[index]) {
      plan.slots[index].mealType = mealType;
      _persistPlans();
    }
  }

  // Counts day-plan slots/snacks (any date, confirmed or not - all already
  // hold a frozen snapshot) currently referencing this item, for the opt-in
  // "also update already-logged history?" prompt after an edit.
  function countUsesOfItem(itemId) {
    let count = 0;
    for (const plan of dayPlans.value) {
      count += plan.slots.filter((s) => s.mealId === itemId).length;
      count += plan.snacks.filter((sn) => sn.mealId === itemId).length;
    }
    return count;
  }

  // Times this item has actually been eaten (confirmed slots + all snacks,
  // which are always logged the moment they exist) - backs the Library's
  // QUICK ACCESS ranking. Unlike countUsesOfItem above, unconfirmed slots
  // don't count here - a still-pending plan slot hasn't been logged yet.
  // `mealType` scopes the count to one diary section, so a picker opened for
  // SNACKS ranks by what actually gets eaten as a snack rather than by overall
  // popularity. Omit it for the unscoped total.
  function logCountForItem(itemId, mealType = null) {
    const matches = (entry) =>
      entry.mealId === itemId && (!mealType || entry.mealType === mealType);
    let count = 0;
    for (const plan of dayPlans.value) {
      count += plan.slots.filter((s) => matches(s) && s.confirmed).length;
      count += plan.snacks.filter(matches).length;
    }
    return count;
  }

  // Rewrites every day-plan slot/snack referencing this item to the item's
  // CURRENT macros, scaled by each entry's own stored quantity. Opt-in only -
  // called after an explicit user confirmation, never automatically.
  function refreshSnapshotsForItem(itemId) {
    const item = itemById(itemId);
    if (!item) return;
    // A customised entry is skipped. Its ingredient list is no longer the
    // library's, so refreshing it to "the item's current macros" would throw
    // away the corrections and quietly put the spinach back.
    for (const plan of dayPlans.value) {
      plan.slots.forEach((s) => {
        if (s.mealId === itemId && !s.components) Object.assign(s, scaleItem(item, s.quantity));
      });
      plan.snacks.forEach((sn) => {
        if (sn.mealId === itemId && !sn.components)
          Object.assign(sn, scaleItem(item, sn.quantity));
      });
    }
    _persistPlans();
  }

  /**
   * What a day's total for one nutrient is actually made of, one row per
   * confirmed slot and per logged snack, in the order they were eaten.
   *
   * Prefers each slot/snack's own snapshot so a later library edit or delete
   * can never retroactively change a day that's already in the books; falls
   * back to a live lookup only for plans stored before snapshots existed.
   * An entry's extras are folded into its own row rather than listed
   * separately: they belong to that meal, which is the whole reason addExtra
   * hangs them off it.
   *
   * Added 2026-08-05 for the metric page's WHAT WENT INTO IT card, and
   * proteinFor/fibreFor now sum it rather than walking the plan themselves.
   * They were two copies of one loop, and this would have been a third.
   */
  function contributionsFor(date, key) {
    const plan = dayPlans.value.find((p) => p.date === date);
    if (!plan) return [];
    const rows = [];
    for (const s of plan.slots) {
      if (!s.confirmed) continue;
      rows.push({
        name: s.name ?? itemById(s.mealId)?.name ?? "Meal",
        at: s.time ?? "",
        grams: (s[key] ?? itemById(s.mealId)?.[key] ?? 0) + _extrasTotal(s, key),
      });
    }
    for (const sn of plan.snacks) {
      rows.push({
        name: sn.name ?? itemById(sn.mealId)?.name ?? "Snack",
        at: "SNACK",
        grams: (sn[key] ?? itemById(sn.mealId)?.[key] ?? 0) + _extrasTotal(sn, key),
      });
    }
    return rows;
  }

  // Rounded once at the end, never per row: summing rounded parts drifts from
  // the total every reader of these two functions already agrees on.
  function _totalFor(date, key) {
    return Math.round(contributionsFor(date, key).reduce((sum, r) => sum + r.grams, 0));
  }

  function proteinFor(date) {
    return _totalFor(date, "protein");
  }

  function fibreFor(date) {
    return _totalFor(date, "fibre");
  }

  /**
   * The day's energy, through the same path as protein and fibre.
   *
   * `DiaryView` already summed this for its own headline, but a goal has to be
   * readable from Home and from `metricRegistry` too, and a second summation
   * over the same entries is exactly how two screens end up disagreeing about
   * one day.
   */
  function kcalFor(date) {
    return _totalFor(date, "kcal");
  }

  /**
   * The day's total for whichever macro a caller names.
   *
   * For `MetricPage`, which handles three composite metrics through one code
   * path. It previously branched `fibre ? fibreFor : proteinFor`, so calories
   * would have silently read the protein total: a two-way branch on a set that
   * had just become three, which is the shape of bug that passes every test.
   */
  function totalFor(date, key) {
    return _totalFor(date, key);
  }

  return {
    library,
    dayPlans,
    addExtra,
    removeExtra,
    setComponentQuantity,
    removeComponent,
    addLibraryItem,
    removeLibraryItem,
    removeLibraryItemAndDetach,
    updateLibraryItem,
    itemById,
    findByBarcode,
    resolvedMacros,
    scaleItem,
    wouldCreateCycle,
    usedAsIngredientCount,
    logCountForItem,
    planFor,
    planForDate,
    confirmSlot,
    swapSlot,
    addSnack,
    addAdHoc,
    removeSnack,
    setSnackMealType,
    setSlotMealType,
    countUsesOfItem,
    refreshSnapshotsForItem,
    proteinFor,
    fibreFor,
    kcalFor,
    totalFor,
    contributionsFor,
    today,
  };
});
