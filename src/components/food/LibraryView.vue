<template>
  <div>
    <!-- The "update logged days too?" prompt used to sit here, appearing after
         the form had closed. It asked the right question at the wrong moment:
         by then the edit was saved, so it read as the app second-guessing a
         decision already made, and the item it was about was no longer on
         screen. `ItemFormSheet` asks inside the form now, before SAVE, and only
         when a figure that logged days actually copied has moved. -->
    <button class="addbtn mono" @click="openAdd()">+ ADD TO LIBRARY</button>

    <!-- Option A of three mocked up 2026-08-17: search and kind chips above the
         A-Z list, which is otherwise untouched. Its cost was named at the time -
         three rows of controls before the first piece of food - and the answer is
         that the chips row only draws when the library is big enough to need
         filtering. -->
    <label class="searchrow">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
        stroke-linecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><path d="M20 20l-4.3-4.3" />
      </svg>
      <input
        v-model="query"
        class="searchfield mono"
        type="search"
        placeholder="SEARCH THE LIBRARY"
        aria-label="Search the library"
      />
      <button v-if="query" class="clearbtn mono" type="button" @click="query = ''">
        CLEAR
      </button>
    </label>

    <div v-if="showChips" class="chips">
      <button
        v-for="k in visibleKinds"
        :key="k.value"
        class="ch mono"
        :class="{ on: kind === k.value }"
        type="button"
        :aria-pressed="kind === k.value"
        @click="kind = k.value"
      >
        {{ k.label }}
      </button>
    </div>

    <!-- **A panel rather than a bar pinned to the bottom.** The tab bar already
         owns that edge, and every tab scrolls inside its own overscanning
         container, so anything fixed there has to subtract --sb-overscan and
         still lands on the create button. Directly under the controls it is
         visible without scrolling and cannot collide with anything. -->
    <div v-if="selecting && picked.length" class="panel confirm-panel">
      <div class="dim-text mono">
        {{ picked.length }} PICKED · {{ pickedProtein }}G PROTEIN
      </div>
      <input
        v-model="mealName"
        class="field mealname"
        placeholder="Name this meal"
        aria-label="Name for the new meal"
      />
      <div class="scanrow">
        <button class="scanbtn mono" type="button" @click="clearPicked">CLEAR</button>
        <button
          class="save mono"
          type="button"
          :disabled="!canMakeMeal"
          @click="makeMeal"
        >
          MAKE A MEAL FROM {{ picked.length }}
        </button>
      </div>
      <div class="dim-text mono hint">
        ITS MACROS STAY THE SUM OF THESE {{ picked.length }}, SO EDITING ONE UPDATES IT.
      </div>
    </div>

    <!-- Hidden while filtering or picking: "most logged" is not an answer to a
         search, and a second list of the same rows would let you tick one row
         twice. -->
    <div class="panel" v-if="quickAccess.length && !filtering && !selecting">
      <div class="panel-hd">
        <span>QUICK ACCESS</span><span>MOST LOGGED</span>
      </div>
      <LibraryRow
        v-for="m in quickAccess"
        :key="m.id"
        :item="m"
        @edit="openEdit(m)"
      />
    </div>
    <div class="panel" v-if="shown.length">
      <div class="panel-hd">
        <span>{{ filtering ? "MATCHES" : "LIBRARY // A-Z" }}</span>
        <span class="hdright">
          <span>{{ shown.length }}</span>
          <button class="hdact mono" type="button" @click="toggleSelecting">
            {{ selecting ? "DONE" : "SELECT" }}
          </button>
        </span>
      </div>
      <!-- A category nobody chose has to say what put things in it. -->
      <div v-if="kind === 'staple'" class="stapnote dim-text mono">
        THINGS YOU USE INSIDE MEALS AND HAVE NEVER EATEN ON THEIR OWN. LOG ONE AND
        IT MOVES BACK.
      </div>
      <template v-for="letter in letters" :key="letter">
        <div class="indexletter mono">{{ letter }}</div>
        <LibraryRow
          v-for="m in grouped[letter]"
          :key="m.id"
          :item="m"
          :selectable="selecting"
          :selected="picked.includes(m.id)"
          @edit="openEdit(m)"
          @pick="togglePick(m.id)"
        />
      </template>
    </div>
    <!-- A search that finds nothing has to say so. Without this the list simply
         vanished, which reads as the library having been emptied. -->
    <div class="panel" v-else-if="food.library.length && filtering">
      <div class="panel-hd"><span>NO MATCHES</span></div>
      <div class="emptyrow dim-text mono">
        NOTHING IN THE LIBRARY MATCHES {{ describeFilter }}.
      </div>
    </div>
    <div class="panel" v-if="!food.library.length">
      <div class="panel-hd"><span>LIBRARY EMPTY</span></div>
      <div class="emptyrow dim-text mono">
        ADD YOUR REGULAR MEALS ABOVE TO START BUILDING TODAY'S PLAN.
      </div>
    </div>

    <ItemFormSheet
      v-if="formOpen"
      :item="editingItem"
      :auto-scan="autoScan"
      @close="formOpen = false"
      @saved="onFormSaved"
    />
  </div>
</template>

<script setup>
// Logging happens exclusively through the Food tab's shared FAB (ADD FOOD)
// now, not from a per-row LOG button here - a flat accent-filled LOG button
// sitting near the FAB (Atlas is one-accent-does-everything, see DESIGN.md)
// made the FAB read as just another same-colored button instead of the one
// elevated control. Every row here just opens edit.
import { computed, ref } from "vue";
import { useFoodStore } from "@/stores/food";
import LibraryRow from "./LibraryRow.vue";
import ItemFormSheet from "./ItemFormSheet.vue";
import { searchItems } from "./searchItems";
import { stapleIds } from "./libraryStaples";

const food = useFoodStore();

const formOpen = ref(false);
const editingItem = ref(null); // item being edited, null = adding new
const autoScan = ref(false); // opens ItemFormSheet straight into the scanner

function openAdd(scan = false) {
  editingItem.value = null;
  autoScan.value = scan;
  formOpen.value = true;
}
function openEdit(item) {
  editingItem.value = item;
  autoScan.value = false;
  formOpen.value = true;
}
function onFormSaved() {
  formOpen.value = false;
}

// Ingredient-only staples are folded in here too now (previously a separate,
// hidden-by-default panel) - rows are lean enough now that the original
// "don't clutter the main list" reasoning carries less weight.
const allItems = computed(() => food.library);

const KINDS = [
  { value: "all", label: "ALL" },
  { value: "meal", label: "MEALS" },
  { value: "snack", label: "SNACKS" },
  { value: "takeaway", label: "TAKEAWAY" },
  { value: "staple", label: "STAPLES" },
];

/**
 * The items that are building blocks rather than things you eat.
 *
 * **Derived, not a field.** Asked as "why takeaway and not ingredients": because
 * kind says where an item may be used and ingredient is a role you acquire by
 * being referenced, so there is no fourth kind to add. A flag was the obvious
 * alternative and it is worse - it needs setting on every item, migrating for the
 * 66 that exist, and it goes stale the day you eat one.
 *
 * An item referenced by a composite that has never been logged **is** a staple,
 * with nothing to declare. Measured on the real library: 11 of them, against 9
 * more that are both eaten and an ingredient - and those 9 are exactly why this
 * cannot be a kind, since kind is exclusive and they need both.
 *
 * Both halves already existed in the store, so this adds no state.
 */
const staples = computed(() =>
  stapleIds(allItems.value, (id) => food.logCountForItem(id))
);

const query = ref("");
const kind = ref("all");

/**
 * Whether a kind filter could change anything.
 *
 * **A reason rather than a threshold.** This was `library.length > 6` first, which
 * is a magic number: it hid the chips from a seven-item library for no stated
 * cause and would have shown them to somebody whose seven items are all snacks.
 * Filtering by kind is only ever useful when more than one kind is present, and
 * that is exactly the condition.
 */
const showChips = computed(() => new Set(allItems.value.map((i) => i.kind)).size > 1);

// STAPLES only appears once there is something to put in it, so a library with no
// composites never sees a chip that would always come back empty.
const visibleKinds = computed(() =>
  KINDS.filter((k) => k.value !== "staple" || staples.value.size > 0)
);
const filtering = computed(() => query.value.trim() !== "" || kind.value !== "all");

/**
 * What the list shows.
 *
 * **`searchItems` unchanged**, which is the whole reason searching the library was
 * a small job: it already requires every query term to appear somewhere in the
 * name in any order, so "chicken rice" narrows rather than widens. It was written
 * and tested for the meal picker and only ever wired in there, which is how the
 * picker could search the library and the library could not.
 */
const shown = computed(() => {
  let items = allItems.value;
  if (kind.value === "staple") {
    items = items.filter((i) => staples.value.has(i.id));
  } else if (kind.value !== "all") {
    // **Staples come out of the other kinds.** This is the half that fixes the
    // complaint rather than just answering it: cheddar, capsicum, rice and stock
    // are all stored as `meal` because nothing else fitted, so MEALS listed them
    // beside Beige Dinner. ALL still shows everything, so nothing is hidden, it
    // is only sorted.
    items = items.filter((i) => i.kind === kind.value && !staples.value.has(i.id));
  }
  const q = query.value.trim();
  return q ? searchItems(items, q) : items;
});

const describeFilter = computed(() => {
  const q = query.value.trim();
  const k = KINDS.find((x) => x.value === kind.value);
  if (q && kind.value !== "all") return `"${q}" IN ${k.label}`;
  if (q) return `"${q}"`;
  return k.label;
});

/**
 * Picking several to make one meal out of them.
 *
 * A mode rather than a tick on every row always. The cost of that was named when
 * the option was chosen: it is only discoverable by reading the panel header. The
 * alternative spends 20px of every row's name on a control that is wanted rarely.
 */
const selecting = ref(false);
const picked = ref([]);
const mealName = ref("");

function toggleSelecting() {
  selecting.value = !selecting.value;
  if (!selecting.value) clearPicked();
}
function togglePick(id) {
  picked.value = picked.value.includes(id)
    ? picked.value.filter((x) => x !== id)
    : [...picked.value, id];
}
function clearPicked() {
  picked.value = [];
  mealName.value = "";
}

const pickedProtein = computed(() =>
  picked.value.reduce((sum, id) => {
    const item = food.library.find((i) => i.id === id);
    return sum + (item ? (food.resolvedMacros(item).protein ?? 0) : 0);
  }, 0)
);

// Two, not one: a "meal" made of a single item is that item, and would be a
// second row saying the same thing with a name that can drift from it.
const canMakeMeal = computed(() => mealName.value.trim() !== "" && picked.value.length >= 2);

/**
 * A composite, never a copy.
 *
 * `ingredients` means the store computes its macros live through `resolvedMacros`,
 * so the meal cannot drift from the things it is made of - the same guarantee the
 * batch scanner's meals already have. Quantity is each item's own base amount,
 * which is "one of whatever this is measured in".
 */
function makeMeal() {
  if (!canMakeMeal.value) return;
  const ingredients = picked.value.map((id) => {
    const item = food.library.find((i) => i.id === id);
    return { itemId: id, quantity: item?.baseAmount ?? 1 };
  });
  food.addLibraryItem({
    name: mealName.value.trim(),
    kind: "meal",
    protein: null,
    kcal: null,
    ingredients,
  });
  clearPicked();
  selecting.value = false;
  // Cleared so the new meal is visible in the list it was just made from.
  query.value = "";
  kind.value = "all";
}

// Ranked by actual log count, not just "in the library" - a stale item
// scanned once months ago shouldn't crowd out what's actually eaten often.
const quickAccess = computed(() =>
  allItems.value
    .map((item) => ({ item, count: food.logCountForItem(item.id) }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((x) => x.item)
);

const grouped = computed(() => {
  const sorted = [...shown.value].sort((a, b) => a.name.localeCompare(b.name));
  const buckets = {};
  for (const item of sorted) {
    const first = item.name.trim()[0]?.toUpperCase() ?? "#";
    const letter = /[A-Z]/.test(first) ? first : "#";
    (buckets[letter] ??= []).push(item);
  }
  return buckets;
});
const letters = computed(() => Object.keys(grouped.value).sort());

</script>

<style scoped>
.emptyrow {
  padding: 6px 0;
}
.dim-text {
  color: var(--dim);
  font-size: 14px;
  font-weight: 400;
}
.confirm-panel {
  margin-bottom: 14px;
}
.confirm-panel .dim-text {
  margin-bottom: 8px;
  line-height: 1.5;
}
.scanrow {
  display: flex;
  gap: 8px;
}
.scanrow .scanbtn {
  flex: 1;
  border: 1px solid color-mix(in srgb, var(--fam-intake) 45%, transparent);
  color: var(--fam-intake);
  font-size: 14px;
  letter-spacing: 2px;
  padding: 10px 0;
}
.scanrow .save {
  flex: 2;
  text-align: center;
  font-size: 14px;
  letter-spacing: 2px;
  color: var(--bg1);
  background: var(--fam-intake);
  padding: 10px 0;
}
.addbtn {
  width: 100%;
  text-align: center;
  border: 1px solid color-mix(in srgb, var(--fam-intake) 45%, transparent);
  color: var(--fam-intake);
  font-size: 14px;
  letter-spacing: 2px;
  padding: 12px 0;
  margin-bottom: 14px;
}
/* The search field. `.panel`'s surface so it reads as part of the list it filters
   rather than as a control floating above it. */
.searchrow {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 12px;
  margin-bottom: 10px;
  background: var(--panel);
  border-radius: 10px;
}
.searchrow svg {
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--dim);
}
.searchfield {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  color: var(--ink);
  font-size: 14px;
  letter-spacing: 1.4px;
  outline: none;
}
.searchfield::placeholder {
  color: var(--dim);
}
/* The browser's own clear control is unstyleable and differs per platform. */
.searchfield::-webkit-search-cancel-button {
  display: none;
}
.clearbtn {
  flex: none;
  background: none;
  border: none;
  color: var(--fam-intake);
  font-size: 13px;
  letter-spacing: 1.4px;
  cursor: pointer;
}
.chips {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}
.ch {
  flex: 1;
  min-height: 34px;
  background: none;
  border: 1px solid color-mix(in srgb, var(--dim) 30%, transparent);
  border-radius: 20px;
  color: var(--dim);
  font-size: 13px;
  letter-spacing: 1.2px;
  cursor: pointer;
}
.ch.on {
  color: var(--bg1);
  background: var(--fam-intake);
  border-color: var(--fam-intake);
  font-weight: 600;
}
.hdright {
  display: flex;
  align-items: center;
  gap: 12px;
}
.hdact {
  background: none;
  border: none;
  color: var(--fam-intake);
  font-size: 13px;
  letter-spacing: 1.4px;
  cursor: pointer;
  padding: 4px 0;
}
/* **Styled here, not borrowed.** `.field` is scoped to ItemFormSheet, so reusing
   the class name got the browser's own white box sitting in the middle of an
   Atlas panel - the same mistake the height field in settings made once, and
   equally invisible until something rendered it. */
.mealname {
  width: 100%;
  margin: 8px 0;
  min-height: 42px;
  padding: 0 12px;
  background: var(--bg1);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 40%, transparent);
  border-radius: 6px;
  color: var(--ink);
  font-family: inherit;
  font-size: 15px;
  outline: none;
}
.mealname::placeholder {
  color: var(--dim);
}
.mealname:focus-visible {
  border-color: var(--fam-intake);
}
.confirm-panel .hint {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.5;
}
.scanrow .save:disabled {
  opacity: 0.4;
  cursor: default;
}
.stapnote {
  padding: 2px 0 8px;
  font-size: 13px;
  line-height: 1.55;
  letter-spacing: 0.8px;
}
.indexletter {
  font-size: 13px;
  letter-spacing: 2px;
  color: var(--dim);
  padding: 8px 0 4px;
}
.indexletter:first-child {
  padding-top: 0;
}
</style>
