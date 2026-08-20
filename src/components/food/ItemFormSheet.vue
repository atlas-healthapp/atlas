<template>
  <!-- Unified add/edit overlay for library items - one form serves both
       "add new" (item prop absent) and "edit existing" (item prop set),
       so composite building / ingredient picking / barcode scan work
       identically either way instead of being duplicated. Opened from
       LibraryView's "+ ADD TO LIBRARY" button (new) or from tapping a
       LibraryRow (edit) or the scan FAB (new + auto-scan). -->
  <Teleport to="body">
    <div class="sheetwrap" @click.self="$emit('close')">
      <div class="sheet grid-bg">
        <div class="panel-hd">
          <span>{{ isEdit ? "EDIT ITEM" : "ADD TO LIBRARY" }}</span>
          <span @click="$emit('close')">[ CLOSE ]</span>
        </div>

        <div class="kindpick">
          <button
            v-for="k in kinds"
            :key="k"
            :class="{ on: form.kind === k }"
            @click="form.kind = k"
          >
            {{ k.toUpperCase() }}
          </button>
        </div>
        <input v-model="form.name" class="field" placeholder="Name" />
        <div class="compositepick">
          <button
            :class="{ on: !form.composite }"
            @click="setComposite(false)"
          >
            FLAT
          </button>
          <button :class="{ on: form.composite }" @click="setComposite(true)">
            COMPOSITE
          </button>
        </div>
        <template v-if="!form.composite">
          <div class="fieldrow">
            <div class="fieldgroup">
              <span class="fieldlabel mono">PROTEIN (G)</span>
              <input
                v-model.number="form.protein"
                class="field"
                type="number"
              />
            </div>
            <div class="fieldgroup">
              <span class="fieldlabel mono">CALORIES</span>
              <input v-model.number="form.kcal" class="field" type="number" />
            </div>
          </div>
          <div class="fieldrow">
            <div class="fieldgroup">
              <span class="fieldlabel mono">CARBS (G)</span>
              <input
                v-model.number="form.carbs"
                class="field"
                type="number"
              />
            </div>
            <div class="fieldgroup">
              <span class="fieldlabel mono">FAT (G)</span>
              <input v-model.number="form.fat" class="field" type="number" />
            </div>
          </div>
          <div class="fieldrow">
            <div class="fieldgroup">
              <span class="fieldlabel mono">FIBRE (G)</span>
              <input
                v-model.number="form.fibre"
                class="field"
                type="number"
              />
            </div>
          </div>
        </template>
        <div v-else class="composite-block">
          <div class="fieldrow readonly-macro mono">
            <span>{{ previewMacros.protein ?? "–" }}G PRO</span>
            <span>{{ previewMacros.kcal ?? "–" }} KCAL</span>
          </div>
          <div class="fieldrow readonly-macro mono">
            <span>{{ previewMacros.carbs ?? "–" }}G CARB</span>
            <span>{{ previewMacros.fat ?? "–" }}G FAT</span>
          </div>
          <div class="fieldrow readonly-macro mono">
            <span>{{ previewMacros.fibre ?? "–" }}G FIBRE</span>
          </div>
          <div
            v-for="(ing, idx) in form.ingredients"
            :key="idx"
            class="ingredient-row"
          >
            <span class="name">{{ ingredientName(ing.itemId) }}</span>
            <span class="macro mono">{{ ingredientDetail(ing) }}</span>
            <button class="del mono" @click="removeIngredient(idx)">×</button>
          </div>
          <div v-if="!form.ingredients.length" class="emptyrow dim-text mono">
            NO INGREDIENTS YET.
          </div>
          <button
            class="add-ingredient-btn mono"
            @click="pickingIngredient = true"
          >
            + ADD INGREDIENT
          </button>
        </div>
        <div class="fieldrow">
          <div class="fieldgroup">
            <span class="fieldlabel mono">AMOUNT</span>
            <input
              v-model.number="form.baseAmount"
              class="field"
              type="number"
              min="0.01"
              step="any"
            />
          </div>
          <div class="fieldgroup">
            <span class="fieldlabel mono">UNIT</span>
            <input
              v-model="form.baseUnit"
              class="field"
              placeholder="egg, g, slice"
            />
          </div>
        </div>
        <!-- What one of those units actually is, when the unit itself does not
             say. "Serving" means nothing on its own; two eggs does. Optional,
             and pointless when the unit is already a measure. -->
        <div class="fieldrow">
          <div class="fieldgroup">
            <span class="fieldlabel mono">ONE {{ (form.baseUnit || "SERVING").toUpperCase() }} IS</span>
            <input
              v-model.number="form.portionAmount"
              class="field"
              type="number"
              min="0"
              step="any"
              placeholder="2"
            />
          </div>
          <div class="fieldgroup">
            <span class="fieldlabel mono">OF</span>
            <input
              v-model="form.portionUnit"
              class="field"
              placeholder="eggs, g, rashers"
            />
          </div>
        </div>
        <!-- The scanned figures are already in the fields above. What is left
             to decide is how far back the change reaches, and those are three
             genuinely different situations rather than a confirmation: the
             recipe changed, the recipe was always this and we had it wrong, or
             this is a different product that happens to share a name. -->
        <div v-if="duplicateChoice" class="deleteblocked mono">
          <div>
            "{{ duplicateChoice.existing.name.toUpperCase() }}" IS ALREADY IN THE
            LIBRARY AND THE SCANNED FIGURES ARE NOW IN THE FORM.
            <template v-if="duplicateUses">
              IT HAS BEEN LOGGED {{ duplicateUses }}
              {{ duplicateUses === 1 ? "TIME" : "TIMES" }}.
            </template>
          </div>
          <div class="dupchoices">
            <button
              class="dupbtn mono"
              :class="{ on: duplicateMode === 'forward' }"
              type="button"
              @click="duplicateMode = 'forward'"
            >
              <b>USE FROM NOW</b>
              <span>The recipe changed. Days already logged keep what they were.</span>
            </button>
            <button
              class="dupbtn mono"
              :class="{ on: duplicateMode === 'backdate' }"
              type="button"
              @click="duplicateMode = 'backdate'"
            >
              <b>USE AND FIX LOGGED DAYS</b>
              <span>We had it wrong. Rewrites every day it was logged on.</span>
            </button>
            <button class="dupbtn mono" type="button" @click="keepPrevious">
              <b>KEEP WHAT I HAD</b>
              <span>Discard the scan and put the old figures back.</span>
            </button>
            <button class="dupbtn mono" type="button" @click="addAsNew">
              <b>ADD AS NEW</b>
              <span>A different product that happens to share the name.</span>
            </button>
          </div>
          <!-- The confirm this panel never had, and without which a scan of
               something already in the library was a dead end: USE FROM NOW and
               USE AND FIX LOGGED DAYS only set the mode, and the button that
               commits it sits in the v-else this panel switches off. Nothing
               else was missing - save() has always read duplicateMode, down to
               calling refreshSnapshotsForItem on a backdate - so the feature was
               complete and simply unreachable. KEEP WHAT I HAD and ADD AS NEW
               were the only ways out, which is why it read as "no confirmation
               option". Same scanrow/save pattern the delete confirmation below
               uses, rather than a new one. -->
          <div class="scanrow">
            <button
              class="save mono"
              type="button"
              :disabled="!form.name || !form.baseAmount || form.baseAmount <= 0"
              @click="save"
            >
              {{ duplicateSaveLabel }}
            </button>
          </div>
        </div>
        <template v-else>
          <div v-if="scanNote" class="scannote dim-text mono">
            {{ scanNote }}
          </div>
          <div v-if="scanHint" class="scannote dim-text mono">
            {{ scanHint }}
          </div>
          <div v-if="cycleError" class="scannote dim-text mono">
            {{ cycleError }}
          </div>
          <div class="scanrow">
            <button
              v-if="!isEdit && !form.composite"
              class="scanbtn mono"
              @click="scanning = true"
            >
              SCAN
            </button>
            <button
              class="save mono"
              :disabled="
                !form.name ||
                !form.baseAmount ||
                form.baseAmount <= 0 ||
                (form.composite && !form.ingredients.length)
              "
              @click="save"
            >
              {{ isEdit ? "SAVE" : "+ ADD" }}
            </button>
          </div>

          <div v-if="deleteConfirm" class="deleteblocked mono">
            <div>
              THIS ITEM IS USED AS AN INGREDIENT IN {{ deleteConfirm.count }}
              COMPOSITE MEAL{{ deleteConfirm.count === 1 ? "" : "S" }}. REMOVE
              IT FROM THOSE TOO AND DELETE?
            </div>
            <div class="scanrow">
              <button class="scanbtn mono" @click="deleteConfirm = null">
                NO, CANCEL
              </button>
              <button class="save mono" @click="confirmForceDelete">
                YES, DELETE ANYWAY
              </button>
            </div>
          </div>
          <div v-else-if="isEdit" class="deleterow">
            <span class="deletelink mono" @click="tryDelete"
              >DELETE THIS ITEM</span
            >
          </div>
        </template>
      </div>
    </div>

    <BarcodeScanSheet
      v-if="scanning"
      @close="scanning = false"
      @result="onScanResult"
    />

    <MealPickSheet
      v-if="pickingIngredient"
      :kinds="['meal', 'snack', 'takeaway']"
      :exclude-id="props.item?.id"
      title="ADD INGREDIENT"
      @close="pickingIngredient = false"
      @pick="onIngredientPick"
    />
  </Teleport>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useFoodStore } from "@/stores/food";
import BarcodeScanSheet from "./BarcodeScanSheet.vue";
import MealPickSheet from "./MealPickSheet.vue";
import { useBackClose } from "@/composables/useBackClose";
import { formatAmount } from "./rowDetail";
import { parseServingSize, baseUnitForScan } from "@/utils/servingSize";

const props = defineProps({
  // absent/null = creating a new item; set = editing this existing item
  item: { type: Object, default: null },
  // opens straight into the barcode scanner on mount (used by the Library
  // scan FAB, which skips the "fill in the form first" step entirely)
  autoScan: { type: Boolean, default: false },
  // Seeds the name when this sheet is opened from a search that found nothing,
  // so the thing you already typed is not typed twice.
  prefillName: { type: String, default: "" },
  // Restricts the kind picker when the caller only wants one, e.g. the snack
  // quick-add. Empty means all three.
  allowKinds: { type: Array, default: () => [] },
});
const emit = defineEmits(["close", "saved"]);
useBackClose(() => emit("close"));

const food = useFoodStore();
const kinds = computed(() =>
  props.allowKinds.length ? props.allowKinds : ["meal", "snack", "takeaway"]
);
// Normally just props.item's id - but a scan that matches an existing
// library item can pivot this sheet from "adding new" into "editing that
// match" mid-flow (see updateExisting below), so save()/isEdit/delete all
// key off this instead of props.item directly.
const activeItemId = ref(props.item?.id ?? null);
const isEdit = computed(() => !!activeItemId.value);

const form = reactive({
  kind: "meal",
  name: "",
  protein: null,
  kcal: null,
  carbs: null,
  fat: null,
  fibre: null,
  baseAmount: 1,
  baseUnit: "serving",
  portionAmount: null,
  portionUnit: "",
  composite: false,
  ingredients: [],
  barcode: null,
});
const scanning = ref(false);
const scanNote = ref("");
const scanHint = ref("");
const pickingIngredient = ref(false);
const cycleError = ref("");
// { existing, scanned } while a scan matches an already-in-library item and
// we're waiting on the user to pick UPDATE EXISTING vs ADD AS NEW.
const duplicateChoice = ref(null);
/**
 * How far a scanned change reaches: "forward" leaves logged days alone,
 * "backdate" rewrites them.
 *
 * Forward is the default because it is the safe one. A logged entry stores its
 * own macro snapshot precisely so history survives the library being edited,
 * and backdating deliberately breaks that guarantee - which is right when the
 * figures were simply wrong, and wrong when the recipe genuinely changed.
 */
const duplicateMode = ref("forward");

/** How many logged days a backdate would rewrite, so the choice is informed. */
const duplicateUses = computed(() =>
  duplicateChoice.value ? food.countUsesOfItem(duplicateChoice.value.existing.id) : 0
);

/**
 * What the confirm says it is about to do.
 *
 * The two modes differ in the one way that matters - whether days already logged
 * get rewritten - so the button names it rather than saying SAVE twice. It stays
 * SAVE when a backdate would touch nothing, because "AND FIX 0 DAYS" describes a
 * rewrite that is not going to happen.
 */
const duplicateSaveLabel = computed(() => {
  if (duplicateMode.value !== "backdate" || !duplicateUses.value) return "SAVE";
  return `SAVE AND FIX ${duplicateUses.value} ${duplicateUses.value === 1 ? "DAY" : "DAYS"}`;
});

/** Put back what was there before the scan overwrote the fields. */
function keepPrevious() {
  const prev = duplicateChoice.value?.previous;
  if (prev) {
    form.name = prev.name;
    form.protein = prev.protein;
    form.kcal = prev.kcal;
    form.carbs = prev.carbs;
    form.fat = prev.fat;
    form.fibre = prev.fibre;
    form.barcode = prev.barcode;
  }
  duplicateChoice.value = null;
  scanHint.value = "";
}

onMounted(() => {
  if (props.item) {
    const item = props.item;
    form.kind = item.kind;
    form.name = item.name;
    form.composite = !!item.ingredients?.length;
    form.ingredients = item.ingredients
      ? item.ingredients.map((i) => ({ ...i }))
      : [];
    form.protein = form.composite ? null : item.protein;
    form.kcal = form.composite ? null : item.kcal;
    form.carbs = form.composite ? null : item.carbs;
    form.fat = form.composite ? null : item.fat;
    form.fibre = form.composite ? null : item.fibre;
    form.baseAmount = item.baseAmount ?? 1;
    form.baseUnit = item.baseUnit ?? "serving";
    form.portionAmount = item.portion?.amount ?? null;
    form.portionUnit = item.portion?.unit ?? "";
    form.barcode = item.barcode ?? null;
  }
  if (props.prefillName && !props.item) {
    form.name = props.prefillName;
    if (props.allowKinds.length) form.kind = props.allowKinds[0];
  }
  if (props.autoScan) scanning.value = true;
});

// clears a stale "not found" note once the user starts fixing it by hand
watch(
  () => form.name,
  () => {
    scanNote.value = "";
  }
);

function onScanResult(item) {
  scanning.value = false;
  if (!item) {
    scanNote.value = "BARCODE NOT FOUND, ENTER MANUALLY";
    scanHint.value = "";
    return;
  }
  const existing =
    food.findByBarcode(item.barcode) ??
    food.library.find(
      (i) => i.name.trim().toLowerCase() === item.name.trim().toLowerCase()
    );
  if (existing) {
    // **The scanned figures go into the form straight away**, rather than being
    // held behind the choice. Scanning a barcode is how you find out what is
    // actually in something, and refusing to show that until you have decided
    // what to do with it makes the decision harder rather than safer. The
    // warning still stands, and nothing is written until SAVE.
    duplicateChoice.value = {
      existing,
      scanned: item,
      // What it looked like before, so KEEP WHAT I HAD can put it back.
      previous: {
        protein: existing.protein,
        kcal: existing.kcal,
        carbs: existing.carbs,
        fat: existing.fat,
        fibre: existing.fibre,
        name: existing.name,
        barcode: existing.barcode ?? null,
      },
    };
    updateExisting();
    return;
  }
  applyScannedAsNew(item);
}

// Fills the form as a brand-new item from scan data - the original
// scan-fill behavior, also used for the ADD AS NEW choice on a duplicate.
function applyScannedAsNew(item) {
  scanNote.value = "";
  // Matches manual add's own default now - was hardcoded to "snack"
  // regardless of what was actually scanned (a frozen meal kit scans in as
  // a "snack" just as readily as an actual snack food), which was wrong
  // often enough to be worth fixing rather than just a starting guess.
  form.kind = "meal";
  form.name = item.name;
  form.protein = item.protein;
  form.kcal = item.kcal;
  form.carbs = item.carbs;
  form.fat = item.fat;
  form.fibre = item.fibre;
  form.barcode = item.barcode;
  // **The serving description goes to `portion`, never to `baseUnit`.** It used
  // to be assigned straight to the unit, and `serving_size` is free text a
  // stranger typed, so a real library collected 23 distinct "units" - `1 portion
  // (13 g)`, `11 chips (27 g)`, `60.0g`, `375ml`. `baseUnit` is the noun a
  // quantity counts; `portion` is what one of them actually is, which is exactly
  // what this string describes and what prints `1.5 SERVING (45 G)`.
  //
  // Unparseable descriptions are dropped rather than kept as prose: a portion
  // multiplies every macro shown for the item, so a wrong one is worse than none.
  form.baseUnit = baseUnitForScan(item.servingBasis);
  const portion = parseServingSize(item.servingSize);
  if (portion) {
    form.portionAmount = portion.amount;
    form.portionUnit = portion.unit;
  }
  scanHint.value =
    item.servingBasis === "100g"
      ? "PER 100G, CHECK QUANTITY BEFORE SAVING"
      : "";
}

function addAsNew() {
  const { scanned } = duplicateChoice.value;
  duplicateChoice.value = null;
  applyScannedAsNew(scanned);
}

// Pivots this sheet into editing the matched library item: keeps its kind/
// base amount/unit/ingredients as they already were, overlays the scanned
// macros/barcode/name on top. Saving from here goes through the same
// updateLibraryItem path as a manual edit, so the "update N already-logged
// entries too?" prompt (LibraryView's refreshPrompt) fires automatically.
function updateExisting() {
  const { existing, scanned } = duplicateChoice.value;
  activeItemId.value = existing.id;
  form.kind = existing.kind;
  form.composite = !!existing.ingredients?.length;
  form.ingredients = existing.ingredients
    ? existing.ingredients.map((i) => ({ ...i }))
    : [];
  form.baseAmount = existing.baseAmount ?? 1;
  form.baseUnit = existing.baseUnit ?? "serving";
  scanNote.value = "";
  form.name = scanned.name;
  form.protein = scanned.protein;
  form.kcal = scanned.kcal;
  form.carbs = scanned.carbs;
  form.fat = scanned.fat;
  form.fibre = scanned.fibre;
  form.barcode = scanned.barcode;
  scanHint.value =
    scanned.servingBasis === "100g"
      ? "PER 100G, CHECK QUANTITY BEFORE SAVING"
      : "";
}

const previewMacros = computed(() =>
  food.resolvedMacros({
    id: activeItemId.value ?? "__new__",
    ingredients: form.ingredients,
  })
);

function ingredientName(id) {
  return food.itemById(id)?.name ?? "UNKNOWN";
}
function ingredientDetail(ing) {
  const item = food.itemById(ing.itemId);
  if (!item) return "";
  const scaled = food.scaleItem(item, ing.quantity);
  // formatAmount, not a local copy: this line and the diary's ingredient rows
  // describe the same thing and had drifted into saying it two ways.
  return `${formatAmount(ing.quantity, item.baseUnit, item.portion)} · ${scaled.protein}G`;
}
function removeIngredient(idx) {
  form.ingredients.splice(idx, 1);
}
function onIngredientPick(itemId, quantity) {
  form.ingredients.push({ itemId, quantity });
  pickingIngredient.value = false;
}

function setComposite(val) {
  form.composite = val;
  if (val) {
    form.protein = null;
    form.kcal = null;
    form.carbs = null;
    form.fat = null;
    form.fibre = null;
  } else {
    form.ingredients = [];
  }
}

function save() {
  if (!form.name || !form.baseAmount || form.baseAmount <= 0) return;
  if (form.composite && !form.ingredients.length) return;
  cycleError.value = "";
  if (
    form.composite &&
    activeItemId.value &&
    food.wouldCreateCycle(activeItemId.value, form.ingredients)
  ) {
    cycleError.value =
      "CAN'T SAVE: THAT WOULD MAKE THIS ITEM AN INGREDIENT OF ITSELF (DIRECTLY OR THROUGH ANOTHER COMPOSITE).";
    return;
  }
  const payload = {
    name: form.name,
    kind: form.kind,
    protein: form.composite ? null : form.protein || 0,
    kcal: form.composite ? null : form.kcal || 0,
    carbs: form.composite ? null : (form.carbs ?? null),
    fat: form.composite ? null : (form.fat ?? null),
    fibre: form.composite ? null : (form.fibre ?? null),
    baseAmount: form.baseAmount,
    baseUnit: form.baseUnit || "serving",
    // Both halves or neither: an amount with no unit says "1 serving is 2", and
    // a unit with no amount cannot be multiplied out.
    portion:
      form.portionAmount > 0 && form.portionUnit
        ? { amount: form.portionAmount, unit: form.portionUnit }
        : null,
    ingredients: form.composite ? form.ingredients : null,
    barcode: form.barcode,
  };
  if (activeItemId.value) {
    const id = activeItemId.value;
    food.updateLibraryItem(id, payload);
    // Only when it was explicitly asked for. Refreshing snapshots is the one
    // action here that reaches backwards into days already recorded, so it
    // never happens as a side effect of saving.
    if (duplicateChoice.value && duplicateMode.value === "backdate") {
      food.refreshSnapshotsForItem(id);
    }
    const count = food.countUsesOfItem(id);
    emit("saved", { editingId: id, count });
  } else {
    const newId = food.addLibraryItem(payload);
    emit("saved", { editingId: null, count: 0, newId });
  }
}

// Deleting lives inside the edit sheet itself rather than a separate row
// button - same delete-guard flow as before (composites referencing this
// item block a plain delete until the user explicitly force-deletes).
const deleteConfirm = ref(null); // { count } while the force-delete prompt is showing
function tryDelete() {
  const count = food.usedAsIngredientCount(activeItemId.value);
  if (count > 0) {
    deleteConfirm.value = { count };
    return;
  }
  food.removeLibraryItem(activeItemId.value);
  emit("close");
}
function confirmForceDelete() {
  food.removeLibraryItemAndDetach(activeItemId.value);
  deleteConfirm.value = null;
  emit("close");
}
</script>

<style scoped>
/* One row per situation, each with its own sentence: the difference between
   "the recipe changed" and "we had it wrong" is the whole decision, and a row
   of bare buttons cannot carry it. */
.dupchoices {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}
.dupbtn {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  text-align: left;
  min-height: 48px;
  padding: 8px 10px;
  border: 1px solid var(--panel-line);
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
.dupbtn.on {
  border-color: var(--acc);
  background: color-mix(in srgb, var(--acc) 12%, transparent);
}
.dupbtn b {
  font-size: var(--fs-micro);
  letter-spacing: 1.4px;
  color: var(--dim);
}
.dupbtn.on b {
  color: var(--acc);
}
.dupbtn span {
  font-family: var(--font-sans);
  font-size: 12.5px;
  letter-spacing: 0;
  line-height: 1.35;
  color: var(--body);
  text-transform: none;
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
  margin-bottom: 14px;
}
.panel-hd span:last-child {
  cursor: pointer;
  color: var(--dim);
}
.kindpick {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.kindpick button {
  flex: 1;
  border: 1px solid color-mix(in srgb, var(--fam-intake) 30%, transparent);
  color: var(--dim);
  font-size: 11px;
  letter-spacing: 1px;
  padding: 6px 0;
  font-family: var(--font-mono);
}
.kindpick .on {
  color: var(--bg1);
  background: var(--fam-intake);
}
.field {
  width: 100%;
  background: color-mix(in srgb, var(--fam-intake) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 45%, transparent);
  color: var(--ink);
  padding: 10px 12px;
  margin-bottom: 8px;
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
.fieldrow {
  display: flex;
  gap: 8px;
}
.fieldrow .field {
  flex: 1;
}
.fieldgroup {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.fieldlabel {
  font-size: 10.5px;
  letter-spacing: 1.5px;
  color: var(--dim);
}
.save {
  width: 100%;
  text-align: center;
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--bg1);
  background: var(--fam-intake);
  padding: 10px 0;
}
.save:disabled {
  opacity: 0.4;
}
.scanrow {
  display: flex;
  gap: 8px;
}
.scanrow .scanbtn {
  flex: 1;
  border: 1px solid color-mix(in srgb, var(--fam-intake) 45%, transparent);
  color: var(--fam-intake);
  font-size: 12px;
  letter-spacing: 2px;
  padding: 10px 0;
}
.scanrow .save {
  flex: 2;
}
.scannote {
  margin-bottom: 8px;
}
.emptyrow {
  padding: 6px 0;
}
.macro {
  text-align: right;
  font-size: 11px;
  color: var(--dim);
  white-space: nowrap;
}
.del {
  color: var(--bad);
  font-size: 16px;
  line-height: 1;
  padding: 12px;
  margin: -12px;
}
.dim-text {
  color: var(--dim);
  font-size: 12.5px;
  font-weight: 400;
}
.compositepick {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.compositepick button {
  flex: 1;
  border: 1px solid color-mix(in srgb, var(--fam-intake) 30%, transparent);
  color: var(--dim);
  font-size: 11px;
  letter-spacing: 1px;
  padding: 6px 0;
  font-family: var(--font-mono);
}
.compositepick .on {
  color: var(--bg1);
  background: var(--fam-intake);
}
.readonly-macro {
  justify-content: space-between;
  color: var(--dim);
  font-size: 12px;
  padding: 8px 0;
  border-bottom: 1px dashed color-mix(in srgb, var(--fam-intake) 20%, transparent);
}
.ingredient-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: baseline;
  column-gap: 8px;
  padding: 6px 0;
  font-size: 14px;
  font-weight: 600;
  border-bottom: 1px solid color-mix(in srgb, var(--fam-intake) 10%, transparent);
}
.ingredient-row .name {
  overflow-wrap: anywhere;
  min-width: 0;
}
.add-ingredient-btn {
  width: 100%;
  margin-top: 8px;
  text-align: center;
  border: 1px solid color-mix(in srgb, var(--fam-intake) 45%, transparent);
  color: var(--fam-intake);
  font-size: 12px;
  letter-spacing: 2px;
  padding: 10px 0;
}
.deleteblocked {
  color: var(--bad);
  font-size: 12.5px;
  letter-spacing: 0.3px;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--bad) 45%, transparent);
  margin-top: 12px;
}
.deleteblocked .scanrow {
  margin-top: 10px;
}
.deleterow {
  margin-top: 12px;
  text-align: center;
}
.deletelink {
  color: var(--bad);
  font-size: 10px;
  letter-spacing: 1.5px;
  cursor: pointer;
}
</style>
