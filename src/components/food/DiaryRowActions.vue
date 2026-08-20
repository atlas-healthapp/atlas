<template>
  <!-- Replaces an earlier hand-rolled long-press-drag attempt at moving a
       logged Diary row between meal-type sections - it didn't work
       reliably on a real device. Tap-to-open-sheet is far more robust:
       one tap on a logged row shows DELETE (unlog a slot / remove a
       snack) plus MOVE TO buttons for the other three sections. -->
  <Teleport to="body">
    <div class="sheetwrap" @click.self="$emit('close')">
      <div class="sheet grid-bg">
        <!-- Real ingredient names run past forty-five characters, so the name
             has to be allowed to wrap and CLOSE has to be allowed not to. The
             shared .panel-hd is a plain space-between row, which let a long name
             push the button onto a second line and land on top of it. -->
        <div class="panel-hd rowhd">
          <span class="rowname">{{ row.name.toUpperCase() }}</span>
          <span class="rowclose" @click="$emit('close')">[ CLOSE ]</span>
        </div>
        <div v-if="amount" class="amount mono">{{ amount }}</div>

        <div v-if="macroList.length" class="macros">
          <div v-for="m in macroList" :key="m.key" class="macro">
            <span class="mv">{{ m.value }}</span>
            <span class="ml mono">{{ m.label }}</span>
          </div>
        </div>
        <div v-else class="note mono">NO MACROS RECORDED FOR THIS ITEM.</div>

        <template v-if="ingredients.length || customised">
          <div class="sectionlabel mono">MADE FROM</div>

          <!-- The list reads first and edits second: one row opens at a time,
               so five ingredients are not fifteen buttons. Each edit changes
               THIS meal on THIS day; the library recipe is never touched. -->
          <div v-if="editable" class="hint mono">TAP AN INGREDIENT TO CHANGE IT</div>
          <div
            v-for="ing in ingredients"
            :key="ing.key"
            class="ingrow"
            :class="{ open: openIngredient === ing.index, tappable: editable }"
            @click="editable && toggleIngredient(ing.index)"
          >
            <div class="iname">{{ ing.name }}</div>
            <div class="imeta mono">
              <span>{{ ing.amount }}</span>
              <span v-if="ing.macro">{{ ing.macro }}</span>
            </div>
            <!-- @click.stop so a tap on a control never closes the row it is
                 controlling, which is the whole row's own tap target. -->
            <div v-if="openIngredient === ing.index" class="ingedit" @click.stop>
              <button class="step mono" type="button" @click="stepComponent(ing, -1)">−</button>
              <span class="stepq mono">{{ ing.amount }}</span>
              <button class="step mono" type="button" @click="stepComponent(ing, 1)">+</button>
              <button
                class="removex mono"
                type="button"
                @click="$emit('remove-component', ing.index)"
              >
                REMOVE
              </button>
            </div>
          </div>

          <div v-if="customised && !ingredients.length" class="note mono">
            NOTHING LEFT IN THIS MEAL. UNDO / UNLOG BELOW IF YOU DID NOT EAT IT.
          </div>

          <!-- Two different states, and they must not be confused. Customised
               means the list IS the record. Drifted means the totals are a
               snapshot and the list underneath them is the library's current
               recipe, which is a different pair of numbers. -->
          <div v-if="customised" class="note mono">
            EDITED FOR THIS DAY. THE RECIPE IS UNCHANGED.
          </div>
          <div v-else-if="recipeChanged" class="note mono">
            THE RECIPE CHANGED SINCE THIS WAS LOGGED. THE TOTALS ARE WHAT WAS
            LOGGED, THE LIST IS HOW IT IS MADE NOW.
          </div>
        </template>

        <!-- Added to this one meal on this one day. Listed apart from MADE
             FROM because the recipe is the library's and these are yours. -->
        <div class="sectionlabel mono">ADDED TODAY</div>
        <div v-for="(ex, i) in row.extras ?? []" :key="'x' + i" class="extrarow">
          <span class="iname added">{{ ex.name }}</span>
          <span class="iqty mono">{{ extraAmount(ex) }}</span>
          <button class="removex mono" type="button" @click="$emit('remove-extra', i)">
            REMOVE
          </button>
        </div>
        <button class="addx mono" type="button" @click="$emit('add-extra')">
          + ADD SOMETHING TO THIS MEAL
        </button>

        <div class="sectionlabel mono">ACTIONS</div>

        <!-- **Only for a quick add.** Those deliberately save nothing to the
             library, because an item called "Tuesday in Bali" would pollute the
             list you build meals from. But the ones worth keeping are only
             obvious after the fact, which is why the way in is here, on the entry
             you are looking at, rather than a decision at the moment you typed
             the numbers. -->
        <template v-if="isQuickAdd">
          <button class="savelib mono" type="button" @click="$emit('save-to-library')">
            SAVE TO LIBRARY
          </button>
          <div class="note mono">
            COPIES THE NUMBERS INTO A NEW ITEM. THIS DAY'S RECORD IS NOT CHANGED.
          </div>
        </template>

        <button class="deletebtn mono" @click="$emit('delete')">
          {{ row.kind === "slot" ? "UNDO / UNLOG" : "DELETE" }}
        </button>
        <div class="movelabel mono">MOVE TO</div>
        <button
          v-for="mt in otherTypes"
          :key="mt.key"
          class="movebtn mono"
          @click="$emit('move', mt.key)"
        >
          {{ mt.label }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useFoodStore } from "@/stores/food";
import { useBackClose } from "@/composables/useBackClose";
import {
  formatAmount,
  macroChips,
  ingredientBreakdown,
  componentBreakdown,
  canEditComponents,
  recipeDrifted,
} from "./rowDetail";

const MEAL_TYPES = [
  { key: "breakfast", label: "BREAKFAST" },
  { key: "lunch", label: "LUNCH" },
  { key: "dinner", label: "DINNER" },
  { key: "snack", label: "SNACKS" },
];

const props = defineProps({
  // { name, kind, sectionKey, mealId?, quantity?, macros? }
  row: { type: Object, required: true },
});
const emit = defineEmits([
  "close",
  "delete",
  "move",
  "add-extra",
  "remove-extra",
  "set-component",
  "remove-component",
  "save-to-library",
]);
useBackClose(() => emit("close"));

const food = useFoodStore();

/**
 * A quick add: typed straight into the day, never joined to the library.
 *
 * Tested on `mealId` rather than only on the `adHoc` flag, because an entry whose
 * library item has since been deleted also has nothing to reuse, and offering to
 * save that is the same favour.
 */
const isQuickAdd = computed(() => props.row.kind !== "slot" && !props.row.mealId);

const libraryItem = computed(() =>
  props.row.mealId ? food.itemById(props.row.mealId) : null
);

const macroList = computed(() => macroChips(props.row.macros));

const amount = computed(() => {
  const item = libraryItem.value;
  const q = props.row.quantity;
  if (q == null || !item) return "";
  return formatAmount(q, item.baseUnit, item.portion);
});

// Whether this meal has been edited for this day. Once it has, the entry holds
// its own frozen ingredient list and the library is not consulted at all.
const customised = computed(() => Boolean(props.row.components));

/**
 * What the item is made of, scaled to how much of it was logged.
 *
 * Two sources, and which one is in play changes what the list MEANS. A
 * customised row reads its own components: that list is the record of what was
 * eaten. Any other row reads the library, which only knows the recipe as it
 * stands now, since the snapshot on a logged row holds totals and not a recipe.
 * That is why a changed recipe gets called out rather than quietly reconciled.
 */
const ingredients = computed(() =>
  customised.value
    ? componentBreakdown(props.row.components, food)
    : ingredientBreakdown(libraryItem.value, props.row.quantity, food)
);

const editable = computed(() => canEditComponents(libraryItem.value, props.row));

// Which ingredient is open, by its index. One at a time: the sheet's job is
// showing what the meal was, and fifteen controls over five ingredients buries
// that under furniture.
const openIngredient = ref(null);
function toggleIngredient(index) {
  openIngredient.value = openIngredient.value === index ? null : index;
}

// Removing a row shifts every index after it, so the open row would silently
// become a different ingredient. Closing is the honest response.
watch(
  () => ingredients.value.length,
  () => (openIngredient.value = null)
);

const recipeChanged = computed(() => recipeDrifted(libraryItem.value, props.row, food));

// Half a unit at a time, in the ingredient's own base unit, never below half.
// A step to zero would be a removal by another name, and REMOVE says so.
const STEP = 0.5;
function stepComponent(ing, direction) {
  // Before the first edit the quantity being stepped is the one the recipe
  // implies; after it, the one already stored. Both breakdowns carry it.
  const next = +((ing.quantity ?? 1) + direction * STEP).toFixed(2);
  if (next < STEP) return;
  emit("set-component", { index: ing.index, quantity: next });
}

function extraAmount(ex) {
  const macro = ex.protein != null ? ` · ${Math.round(ex.protein)}G` : "";
  return `${ex.quantity ?? 1}${macro}`;
}

const otherTypes = computed(() =>
  MEAL_TYPES.filter((mt) => mt.key !== props.row.sectionKey)
);
</script>

<style scoped>
.rowhd {
  align-items: flex-start;
  gap: 12px;
}
.rowname {
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.4;
}
/* Never shrinks and never wraps: it is the way out of the sheet. */
.rowclose {
  flex: none;
  white-space: nowrap;
  cursor: pointer;
}
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
  max-height: 86vh;
  overflow-y: auto;
  border-top: 1px solid color-mix(in srgb, var(--fam-intake) 35%, transparent);
  background: color-mix(in srgb, var(--bg1) 96%, black);
  padding: 16px 18px calc(26px + env(safe-area-inset-bottom));
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
.panel-hd {
  display: flex;
  justify-content: space-between;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 3px;
  color: var(--fam-intake);
  margin-bottom: 16px;
}
.panel-hd span:last-child {
  cursor: pointer;
  color: var(--dim);
}
.amount {
  font-size: var(--fs-label);
  letter-spacing: 1.2px;
  color: var(--dim);
  margin-bottom: 12px;
}
.macros {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.macro {
  flex: 1 1 auto;
  min-width: 62px;
  border: 1px solid var(--panel-line);
  border-radius: 7px;
  padding: 9px 10px;
  text-align: center;
}
.mv {
  display: block;
  font-size: var(--fs-value);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.ml {
  display: block;
  margin-top: 3px;
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  color: var(--dim);
}
.sectionlabel {
  font-size: var(--fs-micro);
  letter-spacing: 2px;
  color: var(--dim);
  margin: 20px 0 8px;
}
/* Stacked, not a row. Real ingredient names run past 45 characters, so laying
   the name beside its amount could only ever truncate it. */
.ingrow {
  min-height: 44px;
  padding: 9px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--dim) 14%, transparent);
}
.ingrow.tappable {
  cursor: pointer;
}
.ingrow.open {
  /* Set apart rather than outlined: a box round one row inside a sheet reads as
     a second container, and the sheet is already one. */
  background: color-mix(in srgb, var(--fam-intake) 8%, transparent);
  margin: 0 -10px;
  padding-left: 10px;
  padding-right: 10px;
  border-radius: 6px;
}
.hint {
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  color: var(--dim);
  padding-bottom: 6px;
}
.iname {
  font-size: var(--fs-second);
  line-height: 1.3;
  color: var(--ink);
}
.imeta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 3px;
  font-size: var(--fs-micro);
  letter-spacing: 0.8px;
  color: var(--dim);
}
/* An extra is a single library item added to the meal, so its name is one you
   chose from a list and fits: it keeps the old one-line treatment. */
.extrarow {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-height: 44px;
  padding: 4px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--dim) 14%, transparent);
}
.extrarow .iname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iqty,
.imacro {
  font-size: var(--fs-micro);
  letter-spacing: 0.8px;
  color: var(--dim);
  white-space: nowrap;
}
.added {
  color: var(--fam-intake);
}
/* The open row's controls: the quantity sits between the two steps so the
   number being changed is between the things that change it. */
.ingedit {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 9px;
}
.step {
  font-size: var(--fs-second);
  line-height: 1;
  color: var(--fam-intake);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 45%, transparent);
  border-radius: 5px;
  width: 46px;
  min-height: 44px;
  flex-shrink: 0;
}
.stepq {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-size: var(--fs-micro);
  letter-spacing: 0.8px;
  color: var(--ink);
}
.removex {
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  color: var(--dim);
  border: 1px solid color-mix(in srgb, var(--dim) 40%, transparent);
  border-radius: 5px;
  padding: 7px 9px;
  min-height: 38px;
  flex-shrink: 0;
}
.addx {
  display: block;
  width: 100%;
  text-align: center;
  font-size: var(--fs-label);
  letter-spacing: 1.4px;
  padding: 13px 0;
  min-height: 46px;
  margin-top: 10px;
  border: 1px dashed color-mix(in srgb, var(--fam-intake) 55%, transparent);
  border-radius: 6px;
  color: var(--fam-intake);
}
.note {
  margin-top: 10px;
  font-size: var(--fs-micro);
  line-height: 1.6;
  letter-spacing: 0.8px;
  color: var(--dim);
}
/* The family colour, not the danger colour: this one keeps something. Same
   metrics as the delete button below so the two read as one stack of actions. */
.savelib {
  width: 100%;
  text-align: center;
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--fam-intake);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 45%, transparent);
  padding: 10px 0;
  margin-bottom: 6px;
}
.deletebtn {
  width: 100%;
  text-align: center;
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--bad);
  border: 1px solid color-mix(in srgb, var(--bad) 45%, transparent);
  padding: 10px 0;
  margin-bottom: 16px;
}
.movelabel {
  font-size: 9px;
  letter-spacing: 2px;
  color: var(--dim);
  margin-bottom: 8px;
}
.movebtn {
  width: 100%;
  text-align: center;
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--fam-intake);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 30%, transparent);
  padding: 10px 0;
  margin-bottom: 8px;
}
</style>
