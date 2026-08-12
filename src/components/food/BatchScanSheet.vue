<template>
  <!-- Scan several things in a row, then make one meal out of them. Opened from
       the add sheet's "Scan several" row, which is the same door SCAN and QUICK
       ADD use: this is an extra mode, not a replacement for either. -->
  <Teleport to="body">
    <div class="sheetwrap" @click.self="$emit('close')">
      <div class="sheet grid-bg">
        <div class="panel-hd">
          <span>SCAN INTO A MEAL</span>
          <span @click="$emit('close')">[ CLOSE ]</span>
        </div>

        <div v-if="note" class="note mono">{{ note }}</div>

        <template v-if="entries.length">
          <div class="sectionlabel mono">SCANNED</div>
          <div class="hint mono">TAP A ROW TO CHANGE HOW MUCH</div>
          <!-- Stacked and read-only until tapped, same as the diary's own
               ingredient list: a real product name runs past forty-five
               characters, and six rows with three live controls each buries the
               thing this sheet exists to show you. -->
          <div
            v-for="entry in entries"
            :key="entry.key"
            class="ingrow"
            :class="{ open: openKey === entry.key }"
            @click="toggle(entry.key)"
          >
            <div class="iname">{{ entry.name }}</div>
            <div class="imeta mono">
              <span>{{ amountOf(entry) }}</span>
              <span v-if="macroLine(entry)">{{ macroLine(entry) }}</span>
            </div>

            <!-- Always visible, never behind the tap. A barcode that matched
                 something already in the library with different figures is the
                 one thing here that must not be missed, and it is rare enough
                 that it costs the list nothing. -->
            <div v-if="differs(entry)" class="mismatch mono" @click.stop>
              <div>ALREADY IN THE LIBRARY, WITH DIFFERENT FIGURES.</div>
              <div class="mismatchbtns">
                <button
                  type="button"
                  :class="{ on: !entry.useScanned }"
                  @click="entry.useScanned = false"
                >
                  <b>KEEP LIBRARY</b>
                  <span>{{ figuresOf(entry.libraryMacros) }}</span>
                </button>
                <button
                  type="button"
                  :class="{ on: entry.useScanned }"
                  @click="entry.useScanned = true"
                >
                  <b>USE SCAN</b>
                  <span>{{ figuresOf(entry.scannedMacros) }}</span>
                </button>
              </div>
            </div>

            <div v-if="openKey === entry.key" class="ingedit" @click.stop>
              <button class="step mono" type="button" @click="step(entry, -1)">−</button>
              <span class="stepq mono">{{ amountOf(entry) }}</span>
              <button class="step mono" type="button" @click="step(entry, 1)">+</button>
              <button class="removex mono" type="button" @click="remove(entry)">
                REMOVE
              </button>
            </div>
          </div>

          <!-- The meal IS this sum. It is drawn from the same arithmetic the
               library will use once it exists, rounding included, so nothing
               here can change the moment it is saved. -->
          <div class="sectionlabel mono">THE MEAL COMES OUT AS</div>
          <div v-if="totalChips.length" class="macros">
            <div v-for="m in totalChips" :key="m.key" class="macro">
              <span class="mv">{{ m.value }}</span>
              <span class="ml mono">{{ m.label }}</span>
            </div>
          </div>
          <div v-else class="note mono">NO MACROS ON ANYTHING SCANNED SO FAR.</div>

          <!-- Asked for, never invented: "Tuna Rice Spinach" is not what anyone
               calls their lunch. Visible from the first scan rather than as a
               question at the end, so nothing is gated behind a field you have
               not seen yet. -->
          <div class="sectionlabel mono">CALL IT</div>
          <input v-model="name" class="field" placeholder="Name this meal" />
        </template>
        <div v-else class="note mono">
          NOTHING SCANNED YET. EACH SCAN BECOMES ONE PART OF THE MEAL.
        </div>

        <button class="scanbtn mono" type="button" @click="scanning = true">
          {{ entries.length ? "+ SCAN ANOTHER" : "SCAN" }}
        </button>
        <button
          class="save mono"
          type="button"
          :disabled="!canCreate"
          @click="create"
        >
          CREATE THE MEAL
        </button>
        <!-- Batch mode is additive: four things scanned and then judged not to
             be a meal should still leave you with four library items. -->
        <button
          v-if="pendingWrites"
          class="itemsonly mono"
          type="button"
          @click="saveItemsOnly"
        >
          SAVE THE ITEMS ONLY, NO MEAL
        </button>
      </div>
    </div>

    <BarcodeScanSheet
      v-if="scanning"
      @close="scanning = false"
      @result="onScanResult"
    />
  </Teleport>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useFoodStore } from "@/stores/food";
import { useBackClose } from "@/composables/useBackClose";
import BarcodeScanSheet from "./BarcodeScanSheet.vue";
import { macroChips } from "./rowDetail";
import {
  entryFromScan,
  entryAmount,
  entryMacros,
  entryDiffers,
  mealTotals,
  mergeScan,
  steppedQuantity,
  libraryPayload,
  scannedUpdate,
  rowsToRewrite,
  ingredientsFor,
  canCreateMeal,
  MACRO_KEYS,
} from "./batchMeal";

// `created` carries the meal so whoever opened this can log it into the section
// that was already chosen; `saved-items` says nothing was logged.
const emit = defineEmits(["close", "created", "saved-items"]);
useBackClose(() => emit("close"));

const food = useFoodStore();

const entries = ref([]);
const name = ref("");
const note = ref("");
const scanning = ref(false);
const openKey = ref(null);

// Straight into the scanner. You pressed a row that says "scan several"; asking
// again on a screen with nothing on it would be a step for its own sake.
onMounted(() => {
  scanning.value = true;
});

function onScanResult(scanned) {
  scanning.value = false;
  if (!scanned) {
    note.value = "BARCODE NOT FOUND. NOTHING WAS ADDED.";
    return;
  }
  note.value = "";
  // Same match rule the single-scan flow uses: the barcode first, then the name,
  // since a product scanned in before this field existed carries no code.
  const existing =
    food.findByBarcode(scanned.barcode) ??
    food.library.find(
      (i) => i.name.trim().toLowerCase() === scanned.name.trim().toLowerCase()
    ) ??
    null;
  entries.value = mergeScan(
    entries.value,
    entryFromScan(scanned, existing, existing ? food.resolvedMacros(existing) : null)
  );
}

function toggle(key) {
  openKey.value = openKey.value === key ? null : key;
}

function amountOf(entry) {
  return entryAmount(entry);
}

/** The three macros a row has room for, in the order the app always prints them. */
function macroLine(entry) {
  const macros = entryMacros(entry);
  return macroChips(macros)
    .slice(0, 3)
    .map((m) => m.value)
    .join(" · ");
}

/** Enough of a figure to tell two versions of one product apart. */
function figuresOf(macros) {
  return MACRO_KEYS.filter((k) => macros?.[k] != null)
    .slice(0, 2)
    .map((k) => (k === "kcal" ? `${Math.round(macros[k])} KCAL` : `${Math.round(macros[k])}G ${k.toUpperCase()}`))
    .join(" · ");
}

const differs = entryDiffers;

function step(entry, direction) {
  const next = steppedQuantity(entry, direction);
  if (next != null) entry.quantity = next;
}

function remove(entry) {
  entries.value = entries.value.filter((e) => e.key !== entry.key);
  openKey.value = null;
}

const totalChips = computed(() => macroChips(mealTotals(entries.value)));

const canCreate = computed(() => canCreateMeal(name.value, entries.value));

// What creating (or saving the items) would actually write to the library.
const pendingWrites = computed(
  () =>
    entries.value.filter((e) => !e.itemId).length +
    rowsToRewrite(entries.value).length
);

/**
 * Everything scanned that is not in the library yet, plus the rewrites asked for.
 *
 * Returns the id per row, since a fresh item's id is only known once the store
 * has minted it and the recipe below is built out of exactly those ids.
 */
function writeItems() {
  const idByKey = {};
  for (const entry of entries.value) {
    if (entry.itemId) {
      // Only when the row was explicitly switched to the scan. Nothing about a
      // matched item is touched otherwise, and the days it is already logged on
      // are never rewritten from here: that reaches backwards, and the
      // single-scan flow is where that question gets asked properly.
      if (entry.useScanned && !entry.composite) {
        food.updateLibraryItem(entry.itemId, scannedUpdate(entry));
      }
    } else {
      idByKey[entry.key] = food.addLibraryItem(libraryPayload(entry));
    }
  }
  return idByKey;
}

function create() {
  if (!canCreate.value) return;
  const idByKey = writeItems();
  // A composite: its macros are never stored, they are the live sum of these
  // ingredients. That is what makes the totals and the list unable to disagree,
  // and it is why this is an `ingredients` list rather than a frozen snapshot.
  const mealId = food.addLibraryItem({
    name: name.value.trim(),
    kind: "meal",
    protein: null,
    kcal: null,
    baseAmount: 1,
    baseUnit: "serving",
    ingredients: ingredientsFor(entries.value, idByKey),
  });
  emit("created", { mealId });
}

function saveItemsOnly() {
  writeItems();
  emit("saved-items");
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
  max-height: 90vh;
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
.sectionlabel {
  font-size: var(--fs-micro);
  letter-spacing: 2px;
  color: var(--dim);
  margin: 20px 0 8px;
}
.hint {
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  color: var(--dim);
  padding-bottom: 6px;
}
.note {
  font-size: 12.5px;
  letter-spacing: 0.3px;
  color: var(--dim);
  padding: 8px 0;
}
.ingrow {
  min-height: 44px;
  padding: 9px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--dim) 14%, transparent);
  cursor: pointer;
}
.ingrow.open {
  background: color-mix(in srgb, var(--fam-intake) 8%, transparent);
  margin: 0 -10px;
  padding-left: 10px;
  padding-right: 10px;
  border-radius: 6px;
}
.iname {
  font-size: var(--fs-second);
  line-height: 1.3;
  color: var(--ink);
  overflow-wrap: anywhere;
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
/* Two versions of one product, each with its own figures under it: the choice
   is which of them this meal is made of, and a pair of bare buttons cannot
   carry that. Same treatment as the scan's own duplicate choices. */
.mismatch {
  margin-top: 8px;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--bad) 45%, transparent);
  border-radius: 6px;
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  color: var(--bad);
}
.mismatchbtns {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.mismatchbtns button {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  text-align: left;
  min-height: 44px;
  padding: 7px 8px;
  border: 1px solid var(--panel-line);
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
.mismatchbtns button.on {
  border-color: var(--fam-intake);
  background: color-mix(in srgb, var(--fam-intake) 12%, transparent);
}
.mismatchbtns b {
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  color: var(--dim);
}
.mismatchbtns button.on b {
  color: var(--fam-intake);
}
.mismatchbtns span {
  font-size: var(--fs-micro);
  letter-spacing: 0.8px;
  color: var(--body);
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
.field {
  width: 100%;
  background: color-mix(in srgb, var(--fam-intake) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 45%, transparent);
  color: var(--ink);
  padding: 10px 12px;
  font-size: 15px;
}
.scanbtn {
  display: block;
  width: 100%;
  text-align: center;
  margin-top: 18px;
  border: 1px solid color-mix(in srgb, var(--fam-intake) 45%, transparent);
  color: var(--fam-intake);
  font-size: 12px;
  letter-spacing: 2px;
  padding: 12px 0;
  min-height: 46px;
}
.save {
  width: 100%;
  text-align: center;
  margin-top: 8px;
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--bg1);
  background: var(--fam-intake);
  padding: 12px 0;
  min-height: 46px;
}
.save:disabled {
  opacity: 0.4;
}
.itemsonly {
  display: block;
  width: 100%;
  text-align: center;
  margin-top: 10px;
  font-size: 10px;
  letter-spacing: 1.5px;
  color: var(--dim);
  min-height: 38px;
}
</style>
