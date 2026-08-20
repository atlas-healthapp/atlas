/**
 * Which library items are building blocks rather than things you eat.
 *
 * Asked as "why TAKEAWAY and not ingredients". Because kind says *where an item
 * may be used* - `meal` and `takeaway` are the schedulable ones, `snack` is what
 * the diary's snack flow offers - while being an ingredient is a role an item
 * acquires by being referenced in a composite. There is no fourth kind to add.
 *
 * **And a flag would have been worse.** It needs setting on every item, migrating
 * for the ones that already exist, and it goes stale the day you eat one. An item
 * referenced by a composite that has never been logged already *is* a staple, with
 * nothing to declare and no way to get out of step.
 *
 * Measured on the real library 2026-08-17: 11 staples, plus **9 items that are
 * both eaten and an ingredient** (bread, yoghurt, chicken breast). Those 9 are the
 * reason this cannot be a kind - kind is exclusive and they need both - and the
 * reason the rule is "never logged" rather than "referenced".
 *
 * Direct references only, deliberately. A nested composite's own ingredients are
 * reachable through the parent, but the question here is whether a person put this
 * item in something, and that is a direct edge.
 *
 * @param library the whole library
 * @param logCountFor (id) => how many times it has been logged
 */
export function stapleIds(library, logCountFor) {
  const referenced = new Set();
  for (const item of library ?? []) {
    for (const ing of item.ingredients ?? []) referenced.add(ing.itemId);
  }
  const out = new Set();
  for (const item of library ?? []) {
    if (referenced.has(item.id) && logCountFor(item.id) === 0) out.add(item.id);
  }
  return out;
}
