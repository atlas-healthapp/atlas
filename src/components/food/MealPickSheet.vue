<template>
  <!-- Bottom-sheet library picker, used both for swapping a planned meal
       (currentMealId set, header reads "SWAP // X") and for picking a fresh
       item with no current one to replace, e.g. Day Log's snack quick-add
       (currentMealId absent, header reads "ADD SNACK"). Tapping an item
       reveals a quantity step before emitting pick, since a swap/add can
       need a different amount than the item's own base. -->
  <Teleport to="body">
    <div class="sheetwrap" @click.self="$emit('close')">
      <div class="sheet grid-bg">
        <div class="panel-hd">
          <span>{{ headerText }}</span>
          <span @click="$emit('close')">[ CLOSE ]</span>
        </div>
        <div v-if="!selected" class="list">
          <!-- Section and "how" both live at the top of the one sheet rather
               than on a screen of their own. Asking for the section first made
               it a gate: you answered a question before seeing anything, and it
               needed a [ CHANGE ] link to undo. Here both stay on screen with
               the list under them, so changing either is a tap rather than a
               step backwards.
               Only when this sheet is the one adding something. Swapping a
               planned meal already knows its section, and has no business
               scanning a barcode. -->
          <template v-if="pickMealType">
            <div class="qtylabel mono">WHICH SECTION?</div>
            <div class="sectionrow">
              <button
                v-for="opt in MEAL_TYPE_OPTIONS"
                :key="opt.key"
                type="button"
                class="sectionbtn mono"
                :class="{ on: chosenMealType === opt.key }"
                @click="chosenMealType = opt.key"
              >
                {{ opt.short ?? opt.label }}
              </button>
            </div>
          </template>

          <!-- The other ways in, as rows rather than a tile row. Two of them
               used to be nodes on the create button, as siblings of ADD FOOD,
               which gave the rarest ways the same billing as much the
               commonest. Rows because they can say what they do: QUICK ADD's
               own name cannot carry "nothing is saved to the library", and a
               58px tile has nowhere to put it. -->
          <template v-if="adding">
            <div class="ways">
              <button type="button" class="wayrow" @click="$emit('scan', activeMealType)">
                <svg class="wayic" viewBox="0 0 24 24" aria-hidden="true" v-html="HOW_ICONS.scan" />
                <span class="waylabel">Scan a barcode</span>
                <span class="waysub mono">NEW ITEM</span>
              </button>
              <!-- The batch version of the row above it, not a rival to it: one
                   scan still joins the library on its own. It is here rather
                   than on the create button because SCAN was taken off that
                   button on purpose, and a rarer way in has no business
                   reclaiming the billing the commonest one lost. -->
              <button type="button" class="wayrow" @click="$emit('batch-scan', activeMealType)">
                <svg class="wayic" viewBox="0 0 24 24" aria-hidden="true" v-html="HOW_ICONS.batchScan" />
                <span class="waylabel">Scan several into a meal</span>
                <span class="waysub mono">NEW MEAL</span>
              </button>
              <button type="button" class="wayrow" @click="$emit('quick-add', activeMealType)">
                <svg class="wayic" viewBox="0 0 24 24" aria-hidden="true" v-html="HOW_ICONS.quickAdd" />
                <span class="waylabel">Quick add</span>
                <span class="waysub mono">NOT SAVED</span>
              </button>
            </div>
          </template>

          <!-- The A-Z grouping below already covers "I know the first word".
               What it cannot do is find "Woolworths spinach salad" when what
               you remember is "spinach", which is what this is for. -->
          <input
            v-model="query"
            class="searchbox"
            type="search"
            inputmode="search"
            autocomplete="off"
            placeholder="Search the library"
          />
          <template v-if="query.trim()">
            <div
              v-for="item in results"
              :key="'s-' + item.id"
              class="row"
              @click="selected = item"
            >
              <span class="kind mono">{{ kindTag(item) }}</span>
              <span class="name">{{ item.name }}</span>
            </div>
            <!-- The point where a search fails is the point where you know
                 exactly what you want and it is not there yet. Sending you to
                 the Library to type the same name again is the friction this
                 removes. -->
            <template v-if="otherResults.length">
              <div class="listgrouphd mono">EVERYTHING ELSE</div>
              <div
                v-for="item in otherResults"
                :key="'so-' + item.id"
                class="row"
                @click="selected = item"
              >
                <span class="kind mono">{{ kindTag(item) }}</span>
                <span class="name">{{ item.name }}</span>
              </div>
            </template>
            <button
              v-if="!results.length && !otherResults.length"
              class="createbtn mono"
              type="button"
              @click="creating = true"
            >
              + CREATE "{{ query.trim().toUpperCase() }}"
            </button>
          </template>
          <template v-else>
          <template v-if="quickAccess.length">
            <div class="listgrouphd mono">QUICK ACCESS</div>
            <div
              v-for="item in quickAccess"
              :key="'qa-' + item.id"
              class="row"
              @click="selected = item"
            >
              <span class="kind mono">{{ kindTag(item) }}</span>
              <span class="name">{{ item.name }}</span>
            </div>
          </template>
          <template v-for="letter in letters" :key="letter">
            <div class="listgrouphd mono">{{ letter }}</div>
            <div
              v-for="item in grouped[letter]"
              :key="item.id"
              class="row"
              @click="selected = item"
            >
              <span class="kind mono">{{ kindTag(item) }}</span>
              <span class="name">{{ item.name }}</span>
            </div>
          </template>
          <template v-if="otherOptions.length">
            <div class="listgrouphd mono">EVERYTHING ELSE</div>
            <div
              v-for="item in otherOptions"
              :key="'o-' + item.id"
              class="row"
              @click="selected = item"
            >
              <span class="kind mono">{{ kindTag(item) }}</span>
              <span class="name">{{ item.name }}</span>
            </div>
          </template>
          <div v-if="!options.length && !otherOptions.length" class="emptyrow dim-text mono">
            NOTHING ELSE IN THE LIBRARY TO PICK.
          </div>
          </template>
        </div>
        <div v-else class="qtypick">
          <div class="qtylabel mono">{{ selected.name.toUpperCase() }}</div>
          <div class="qtyrow">
            <input
              v-model.number="quantity"
              type="number"
              min="0.01"
              step="any"
              class="field qty-field"
            />
            <!-- Follows the number being typed: at 1.5 servings of eggs the
                 label reads SERVING (3 EGGS), which is the answer you wanted
                 from the quantity box in the first place. -->
            <span class="unit mono">{{ unitLabel }}</span>
          </div>
          <div v-if="pickMealType" class="mealtypepick">
            <button
              v-for="mt in MEAL_TYPE_OPTIONS"
              :key="mt.key"
              class="mono"
              :class="{ on: chosenMealType === mt.key }"
              @click="chosenMealType = mt.key"
            >
              {{ mt.label }}
            </button>
          </div>
          <div class="qtybtns">
            <button class="back mono" @click="selected = null">BACK</button>
            <button class="save mono" :disabled="!canConfirm" @click="confirmPick">
              USE THIS AMOUNT
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Above this sheet on purpose: you are still mid-pick, and closing the
         picker to create something would lose the section you already chose. -->
    <ItemFormSheet
      v-if="creating"
      :prefill-name="query.trim()"
      :allow-kinds="kinds"
      @close="creating = false"
      @saved="onCreated"
    />
  </Teleport>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useFoodStore } from "@/stores/food";
import { useBackClose } from "@/composables/useBackClose";
import { searchItems } from "./searchItems";
import { portionText } from "./rowDetail";
import ItemFormSheet from "./ItemFormSheet.vue";

const props = defineProps({
  // mealId currently in the slot - shown in the header and excluded from
  // options. Absent (null) means "picking a fresh item," e.g. snack quick-add.
  currentMealId: { type: String, default: null },
  // which library kinds are pickable - meals/takeaways for swap (default),
  // snacks for quick-add.
  kinds: { type: Array, default: () => ["meal", "takeaway"] },
  // an additional id to exclude from options, independent of currentMealId's
  // header-text role - used when picking a composite's ingredients, to keep
  // the item being edited out of its own ingredient list without affecting
  // the header (which uses `title` instead in that case).
  excludeId: { type: String, default: null },
  // overrides the SWAP// / ADD SNACK header text entirely when set, e.g.
  // "ADD INGREDIENT" for the composite ingredient picker.
  title: { type: String, default: null },
  // fixed meal-type bucket to tag the resulting log entry with, when this
  // sheet is opened from a specific Diary section's "+ ADD" action.
  mealType: { type: String, default: null },
  // when true, the quantity step also asks which section to file this under
  // instead of using a fixed mealType - nothing pre-selected, confirming
  // stays disabled until the user actively picks one. Used wherever there's
  // no section already implied by how the sheet was opened (Library's
  // quick-log LOG button, the Diary FAB) - deliberately no auto-guess by
  // time-of-day or item kind, per user decision 2026-07-25.
  pickMealType: { type: Boolean, default: false },
});
// `scan`, `batch-scan` and `quick-add` carry the section already chosen, so the
// sheet they open does not have to ask a question this one just answered.
const emit = defineEmits(["close", "pick", "scan", "batch-scan", "quick-add"]);

// Drawn to sit together as a set: 1.7 stroke, round caps, nothing filled, in
// the same vocabulary as TabBar's own. The pencil is the one that used to be a
// literal "12", which was a label drawn as a picture and did not read as one of
// the three.
const HOW_ICONS = {
  library: '<circle cx="10.6" cy="10.6" r="6.4"/><path d="M15.4 15.4 20 20"/>',
  scan:
    '<path d="M4 8.6V5.8A1.8 1.8 0 0 1 5.8 4h2.8"/><path d="M15.4 4h2.8A1.8 1.8 0 0 1 20 5.8v2.8"/>' +
    '<path d="M20 15.4v2.8a1.8 1.8 0 0 1-1.8 1.8h-2.8"/><path d="M8.6 20H5.8A1.8 1.8 0 0 1 4 18.2v-2.8"/>' +
    '<path d="M7.4 12h9.2"/>',
  quickAdd: '<path d="M4.6 19.4 8.2 18.5 19 7.7a2 2 0 0 0-2.8-2.8L5.4 15.7z"/><path d="M14.6 6.5 17.5 9.4"/>',
  // The scan frame with three lines in it instead of one: same glyph, said in
  // the plural, so the two scan rows read as one thing at two scales.
  batchScan:
    '<path d="M4 8.6V5.8A1.8 1.8 0 0 1 5.8 4h2.8"/><path d="M15.4 4h2.8A1.8 1.8 0 0 1 20 5.8v2.8"/>' +
    '<path d="M20 15.4v2.8a1.8 1.8 0 0 1-1.8 1.8h-2.8"/><path d="M8.6 20H5.8A1.8 1.8 0 0 1 4 18.2v-2.8"/>' +
    '<path d="M7.4 9.2h9.2"/><path d="M7.4 12h9.2"/><path d="M7.4 14.8h9.2"/>',
};
useBackClose(() => emit("close"));

const food = useFoodStore();

const replacing = computed(() =>
  props.currentMealId
    ? food.itemById(props.currentMealId)?.name?.toUpperCase() ?? "MEAL"
    : null
);
const options = computed(() =>
  food.library.filter(
    (i) =>
      props.kinds.includes(i.kind) &&
      i.id !== props.currentMealId &&
      i.id !== props.excludeId
  )
);
/**
 * The kinds this sheet was not opened for, listed under the ones it was.
 *
 * They used to be filtered out entirely, so opening the sheet for a snack made
 * every meal unreachable and the only way to log one was to close the sheet and
 * come back through a different section. The section still decides the order and
 * what QUICK ACCESS is counted over; it no longer decides what exists.
 */
const otherOptions = computed(() =>
  food.library
    .filter(
      (i) =>
        !props.kinds.includes(i.kind) &&
        i.id !== props.currentMealId &&
        i.id !== props.excludeId
    )
    .sort((a, b) => a.name.localeCompare(b.name))
);

/** Search reaches the other kinds too, still below the ones asked for. */
const otherResults = computed(() => searchItems(otherOptions.value, query.value));

function kindTag(item) {
  return item.kind === "takeaway" ? "TA" : item.kind === "snack" ? "S" : "M";
}

// Same QUICK ACCESS + A-Z grouping as LibraryView.vue's browse list, built
// over `options` (not food.library directly) so it automatically respects
// whatever kind/exclude filtering this particular sheet instance already
// has in play - swap, snack add, ingredient pick, and the Food FAB's ADD
// FOOD all get the same structure without needing their own logic.
// Scoped to the chosen section when there is one, so opening this for SNACKS
// surfaces what actually gets eaten as a snack rather than the overall
// favourites. Falls back to the unscoped count everywhere else (swap, the
// ingredient picker), which is what those call sites want.
const quickAccess = computed(() => {
  const scope = activeMealType.value;
  return options.value
    .map((item) => ({ item, count: food.logCountForItem(item.id, scope) }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((x) => x.item);
});
const grouped = computed(() => {
  const sorted = [...options.value].sort((a, b) => a.name.localeCompare(b.name));
  const buckets = {};
  for (const item of sorted) {
    const first = item.name.trim()[0]?.toUpperCase() ?? "#";
    const letter = /[A-Z]/.test(first) ? first : "#";
    (buckets[letter] ??= []).push(item);
  }
  return buckets;
});
const letters = computed(() => Object.keys(grouped.value).sort());

const query = ref("");
const results = computed(() => searchItems(options.value, query.value));

const creating = ref(false);
// Straight into the quantity step with the new item selected: you created it in
// order to log it, so stopping to find it in the list again would be a step for
// its own sake.
function onCreated({ newId }) {
  creating.value = false;
  const item = newId ? food.itemById(newId) : null;
  if (item) {
    query.value = "";
    selected.value = item;
  }
}

const selected = ref(null);
const quantity = ref(1);

// The unit beside the quantity box, plus what that many of them actually is.
const unitLabel = computed(() => {
  const unit = (selected.value?.baseUnit || "serving").toUpperCase();
  const portion = selected.value?.portion;
  return portion ? `${unit} (${portionText(quantity.value, portion)})` : unit;
});
const chosenMealType = ref(null);

// The section this log will land in, however the sheet was told about it: the
// user's pick when the sheet asked, the caller's when it was opened from a
// section that already knows. One computed rather than the same conditional in
// four places, which is how the way-in rows and the pick emit could disagree.
const activeMealType = computed(() =>
  props.pickMealType ? chosenMealType.value : props.mealType
);

// Whether this sheet is ADDING food to a day, as opposed to swapping a planned
// meal or picking a composite's ingredient. Only an add has any business
// offering a barcode or a quick add.
//
// This used to be `pickMealType` alone, which meant the three rows appeared on
// the create button's ADD FOOD and nowhere else. Opening the same sheet from a
// section's own + ADD row - the commonest way in there is - hid all three, so
// adding to DINNER offered the library and nothing else.
const adding = computed(() => props.pickMealType || !!props.mealType);
watch(selected, (item) => {
  quantity.value = item?.baseAmount ?? 1;
  // chosenMealType deliberately survives: the section is picked before the
  // list now, so clearing it here would bounce the user back to step one
  // every time they tapped an item. The chips on the quantity step remain
  // as a way to change it without starting over.
});

const headerText = computed(() => {
  if (replacing.value) return `SWAP // ${replacing.value}`;
  // The chosen section is named even when a title was passed in. It used to be
  // short-circuited by `title`, so the header read a bare "ADD" beside a
  // [ CHANGE ] link offering to change something it never said.
  // Named whether the sheet asked for the section or was handed it, because
  // the way-in rows carry it into the scanner and the quick add: a bare "ADD"
  // over three rows that all file something somewhere says nothing about
  // where.
  if (adding.value) {
    const label = MEAL_TYPE_OPTIONS.find(
      (o) => o.key === activeMealType.value
    )?.label;
    const base = props.title ?? "ADD";
    return label ? `${base} // ${label}` : (props.title ?? "ADD FOOD");
  }
  if (props.title) return props.title;
  return "ADD SNACK";
});

// `short` is for the chip row, where four across a phone leaves about 70px a
// cell and BREAKFAST does not fit. The full label is still what the header and
// every other reader prints.
const MEAL_TYPE_OPTIONS = [
  { key: "breakfast", label: "BREAKFAST", short: "BFAST" },
  { key: "lunch", label: "LUNCH" },
  { key: "dinner", label: "DINNER" },
  { key: "snack", label: "SNACKS" },
];
const canConfirm = computed(
  () => !!quantity.value && (!props.pickMealType || !!chosenMealType.value)
);

function confirmPick() {
  emit("pick", selected.value.id, quantity.value, activeMealType.value);
  selected.value = null;
}
</script>

<style scoped>
.sheetwrap {
  position: fixed;
  inset: 0;
  background: rgba(2, 5, 9, 0.55);
  z-index: 500;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  border-top: 1px solid color-mix(in srgb, var(--fam-intake) 35%, transparent);
  background: color-mix(in srgb, var(--bg1) 96%, black);
  padding: 20px 18px calc(26px + env(safe-area-inset-bottom));
  position: relative;
  font-family: var(--font-sans);
  color: var(--body);
}
.sheet::before {
  content: "";
  position: absolute;
  top: -1px;
  left: -1px;
  width: 11px;
  height: 11px;
  border: 1px solid var(--fam-intake);
  border-width: 1px 0 0 1px;
}
.panel-hd span:last-child {
  cursor: pointer;
}
.list {
  margin-top: 16px;
  /* Taller than it was, because the two ways-in rows and the section chips now
     sit inside this scroller with the list: at 45vh the library had about four
     rows left under them. */
  max-height: 60vh;
  overflow-y: auto;
}
/* Sticky, because the results scroll under it and losing the box you are
   typing in as soon as the list moves is the whole frustration this replaces. */
.searchbox {
  position: sticky;
  top: 0;
  z-index: 1;
  width: 100%;
  margin-bottom: 8px;
  padding: 11px 12px;
  min-height: 44px;
  background: var(--bg2);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 30%, transparent);
  border-radius: 6px;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--fs-prose);
}
.searchbox:focus {
  outline: none;
  border-color: var(--fam-intake);
}
.searchbox::-webkit-search-cancel-button {
  filter: invert(0.6);
}
.createbtn {
  display: block;
  width: 100%;
  text-align: center;
  font-size: var(--fs-label);
  letter-spacing: 1.4px;
  padding: 14px 10px;
  min-height: 48px;
  border: 1px dashed color-mix(in srgb, var(--fam-intake) 55%, transparent);
  border-radius: 6px;
  color: var(--fam-intake);
  margin-top: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.listgrouphd {
  font-size: 13px;
  letter-spacing: 2px;
  color: var(--fam-intake);
  padding: 8px 0 3px;
}
.listgrouphd:first-child {
  padding-top: 0;
}
.row {
  display: grid;
  grid-template-columns: 22px 1fr;
  align-items: baseline;
  column-gap: 10px;
  padding: 8px 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.8px;
  cursor: pointer;
  border-bottom: 1px solid color-mix(in srgb, var(--fam-intake) 10%, transparent);
}
.kind {
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--fam-intake);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 40%, transparent);
  padding: 2px 5px;
  text-align: center;
}
.name {
  overflow-wrap: anywhere;
  min-width: 0;
}
.emptyrow {
  padding: 8px 0;
}
.dim-text {
  color: var(--dim);
  font-size: 13.5px;
  font-weight: 400;
  cursor: default;
}
.qtypick {
  margin-top: 8px;
}
.qtylabel {
  font-size: 14px;
  letter-spacing: 1px;
  color: var(--ink);
  margin-bottom: 10px;
}
.qtyrow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.mealtypepick {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 14px;
}
/* Four across, so the whole choice is one row above the list rather than a
   screen of its own. Sized to the same 44pt floor as everything else. */
.sectionrow {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin: 8px 0 20px;
}
.sectionbtn {
  min-height: 44px;
  padding: 0 2px;
  font-size: 13px;
  letter-spacing: 0.8px;
  background: none;
  color: var(--dim);
  border: 1px solid var(--panel-line);
  border-radius: 8px;
  cursor: pointer;
}
.sectionbtn.on {
  color: var(--fam-intake);
  border-color: color-mix(in srgb, var(--fam-intake) 45%, transparent);
}
.mealtyperow {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 12px;
}
.mealtypebtn {
  padding: 16px 8px;
  font-size: 14px;
  letter-spacing: 1.5px;
  background: none;
  color: var(--body);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 30%, transparent);
  cursor: pointer;
}
/* The other ways in. No LIBRARY row: the library is the list underneath,
   already on screen, so a button leading to what you are looking at is a button
   that does nothing. */
.ways {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 4px 0 18px;
}
.wayrow {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 0 14px;
  background: var(--panel);
  color: var(--body);
  border: 1px solid var(--panel-line);
  border-radius: 10px;
  font-size: var(--fs-second);
  text-align: left;
  cursor: pointer;
}
.waylabel {
  flex: 1;
}
.waysub {
  font-size: 13px;
  letter-spacing: 0.09em;
  color: var(--dim);
  flex: none;
}
.wayic {
  width: 19px;
  height: 19px;
  flex: none;
  fill: none;
  stroke: var(--fam-intake);
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mealtypepick button {
  border: 1px solid color-mix(in srgb, var(--fam-intake) 30%, transparent);
  color: var(--dim);
  font-size: 13.5px;
  letter-spacing: 1px;
  padding: 9px 0;
}
.mealtypepick button.on {
  color: var(--bg1);
  background: var(--fam-intake);
}
.field {
  background: color-mix(in srgb, var(--fam-intake) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 45%, transparent);
  color: var(--ink);
  padding: 9px 11px;
  font-size: 15px;
}
.field[type="number"] {
  -moz-appearance: textfield;
}
.field[type="number"]::-webkit-inner-spin-button,
.field[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.qty-field {
  flex: 0 0 100px;
}
.unit {
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--dim);
}
.qtybtns {
  display: flex;
  gap: 8px;
}
.back {
  flex: 1;
  text-align: center;
  font-size: 13.5px;
  letter-spacing: 1px;
  color: var(--dim);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 30%, transparent);
  padding: 10px 0;
}
.save {
  flex: 2;
  text-align: center;
  font-size: 13.5px;
  letter-spacing: 1px;
  color: var(--bg1);
  background: var(--fam-intake);
  padding: 10px 0;
}
.save:disabled {
  opacity: 0.4;
}
</style>
