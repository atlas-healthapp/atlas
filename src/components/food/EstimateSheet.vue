<template>
  <Teleport to="body">
    <div class="sheetwrap" @click.self="$emit('close')">
      <div class="sheet grid-bg">
        <div class="panel-hd">
          <!-- "QUICK ADD", not "ESTIMATE". The old word named what the numbers
               were rather than what you were doing, and meant nothing to anyone
               who had not already used it. -->
          <span>QUICK ADD</span><span @click="$emit('close')">[ CLOSE ]</span>
        </div>

        <p class="blurb mono">
          FOR A DAY YOU DID NOT LOG.
          {{
            keepIt && name.trim()
              ? "THIS ONE WILL JOIN THE LIBRARY."
              : "NOTHING IS SAVED TO THE LIBRARY."
          }}
        </p>

        <input
          ref="nameEl"
          v-model="name"
          class="field mono"
          type="text"
          placeholder="WHAT IT WAS (OPTIONAL)"
          autocomplete="off"
        />

        <!-- Always visible, so the option is known about before you have decided
             what to type rather than appearing under your hands. The default stays
             off: the library is the list the weekly template is built from, and
             "Tuesday in Bali" has no business in it.
             A nameless library item is the one case still refused, because it
             would land in that list as "Estimated" - so the row says so rather
             than silently dropping the save. -->
        <label class="keeprow mono">
          <input v-model="keepIt" type="checkbox" />
          <span>ALSO SAVE IT TO THE LIBRARY</span>
        </label>
        <p v-if="keepIt && !name.trim()" class="keephint mono">
          GIVE IT A NAME ABOVE AND IT WILL BE SAVED.
        </p>

        <div class="macrogrid">
          <label v-for="f in FIELDS" :key="f.key" class="macro">
            <span class="k mono" :style="{ color: f.color }">{{ f.label }}</span>
            <input
              v-model="values[f.key]"
              class="field mono num"
              type="number"
              inputmode="decimal"
              min="0"
              placeholder="0"
            />
            <span class="u mono">{{ f.unit }}</span>
          </label>
        </div>

        <div class="cadence mono"><span>LOG IT UNDER</span></div>
        <div class="daystrip">
          <button
            v-for="t in MEAL_TYPES"
            :key="t.key"
            type="button"
            class="mono"
            :class="{ on: mealType === t.key }"
            @click="mealType = t.key"
          >
            {{ t.label }}
          </button>
        </div>

        <button class="save mono" type="button" :disabled="!canSave" @click="save">
          + ADD TO {{ dateLabel }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
// A day, or a meal, entered as numbers and nothing else.
//
// The case it exists for: a holiday, where logging each meal is not going to
// happen but the day's rough totals are known at the end of it. Creating a
// library item called "Tuesday in Bali" to log that would put a thing you will
// never eat again into the list the weekly template is built from, so this
// writes straight to the day and leaves the library alone.
import { computed, nextTick, onMounted, ref } from "vue";
import { useFoodStore } from "@/stores/food";
import { useBackClose } from "@/composables/useBackClose";

const props = defineProps({
  date: { type: String, required: true },
  dateLabel: { type: String, default: "TODAY" },
  // Where it should file itself, when the sheet that opened this one already
  // asked. The row below stays, so it can still be changed here, but it starts
  // on the answer already given rather than on a default that would have to be
  // corrected every time.
  mealType: { type: String, default: null },
});
const emit = defineEmits(["close", "saved"]);
useBackClose(() => emit("close"));

const food = useFoodStore();

// Energy first: on a day being estimated rather than logged, calories are what
// is actually known and the rest is often a guess on top of it.
const FIELDS = [
  { key: "kcal", label: "ENERGY", unit: "KCAL", color: "var(--ink)" },
  { key: "protein", label: "PROTEIN", unit: "G", color: "var(--fam-intake)" },
  { key: "carbs", label: "CARBS", unit: "G", color: "var(--macro-carbs)" },
  { key: "fat", label: "FAT", unit: "G", color: "var(--macro-fat)" },
  { key: "fibre", label: "FIBRE", unit: "G", color: "var(--fam-intake)" },
];

const MEAL_TYPES = [
  { key: "breakfast", label: "BFAST" },
  { key: "lunch", label: "LUNCH" },
  { key: "dinner", label: "DINNER" },
  { key: "snack", label: "SNACKS" },
];

const name = ref("");
const keepIt = ref(false);
const values = ref({ kcal: "", protein: "", carbs: "", fat: "", fibre: "" });
const mealType = ref(props.mealType ?? "snack");
const nameEl = ref(null);

onMounted(async () => {
  await nextTick();
  nameEl.value?.focus();
});

// A number or nothing: an empty box means "not known", which is different from
// zero and has to stay different all the way into the stored entry, or an
// estimate with no fibre figure would claim the day had none.
function num(key) {
  const raw = values.value[key];
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

const canSave = computed(() => FIELDS.some((f) => num(f.key) != null));

function save() {
  if (!canSave.value) return;
  const macros = {
    kcal: num("kcal"),
    protein: num("protein"),
    carbs: num("carbs"),
    fat: num("fat"),
    fibre: num("fibre"),
  };

  // The library copy is a separate act from the day's entry, and deliberately
  // not linked to it: the entry keeps its own macro snapshot, so editing the
  // library item later cannot rewrite a day you have already logged. That is the
  // same rule every other logged row follows.
  if (keepIt.value && name.value.trim()) {
    food.addLibraryItem({
      name: name.value.trim(),
      kind: mealType.value === "snack" ? "snack" : "meal",
      ...macros,
    });
  }

  food.addAdHoc(props.date, { name: name.value, ...macros }, mealType.value);
  // Distinct from close, because only a save should move the tab underneath to
  // the day it landed on. Cancelling leaves you where you were.
  emit("saved");
  emit("close");
}
</script>

<style scoped>
.sheetwrap {
  position: fixed;
  inset: 0;
  background: rgba(2, 5, 9, 0.55);
  z-index: 700;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  max-height: 88%;
  overflow-y: auto;
  background: var(--bg1);
  border-top: 1px solid color-mix(in srgb, var(--fam-intake) 30%, transparent);
  padding: 16px 18px calc(20px + env(safe-area-inset-bottom));
  color: var(--body);
  font-family: var(--font-sans);
}
/* A row rather than a bare checkbox: the label is the tap target too, and at
   44px it clears the minimum every other control on this sheet holds to. */
.keeprow {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  margin-top: 4px;
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  color: var(--dim);
}
.keephint {
  margin: 0 0 0 26px;
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  color: var(--fam-intake);
}
.keeprow input {
  width: 16px;
  height: 16px;
  accent-color: var(--fam-intake);
  flex: none;
}
.blurb {
  margin: 12px 0 0;
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  line-height: 1.5;
  color: var(--dim);
}
.field {
  width: 100%;
  margin-top: 12px;
  padding: 12px 13px;
  min-height: 46px;
  background: color-mix(in srgb, var(--fam-intake) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 30%, transparent);
  border-radius: 7px;
  color: var(--ink);
  font-size: 14px;
  letter-spacing: 1px;
}
.field::placeholder {
  color: var(--dim);
  letter-spacing: 1.4px;
  font-size: 12px;
}
.field:focus {
  outline: none;
  border-color: var(--fam-intake);
}
.macrogrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 10px;
  margin-top: 14px;
}
/* Energy takes the full width: it is the one number an estimate usually starts
   from, and the others are apportioned around it. */
.macrogrid .macro:first-child {
  grid-column: 1 / -1;
}
.macro {
  display: flex;
  align-items: center;
  gap: 8px;
}
.macro .k {
  width: 58px;
  flex: none;
  font-size: 10.5px;
  letter-spacing: 1.4px;
}
.macro .num {
  margin-top: 0;
  min-height: 44px;
  flex: 1;
  min-width: 0;
  font-variant-numeric: tabular-nums;
}
.macro .u {
  width: 34px;
  flex: none;
  font-size: 9.5px;
  letter-spacing: 1px;
  color: var(--dim);
}
.cadence {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin: 18px 0 6px;
  font-size: var(--fs-micro);
  letter-spacing: 1.6px;
  color: var(--dim);
}
.daystrip {
  display: flex;
  gap: 4px;
}
.daystrip button {
  flex: 1;
  min-height: 44px;
  border: 1px solid color-mix(in srgb, var(--fam-intake) 30%, transparent);
  border-radius: 6px;
  background: none;
  color: var(--dim);
  font-size: 10px;
  letter-spacing: 1px;
  cursor: pointer;
}
.daystrip .on {
  color: var(--bg1);
  background: var(--fam-intake);
  border-color: var(--fam-intake);
}
.save {
  width: 100%;
  min-height: 48px;
  margin-top: 18px;
  border: 0;
  border-radius: 7px;
  background: var(--fam-intake);
  color: var(--bg1);
  font-size: 12.5px;
  letter-spacing: 2px;
  cursor: pointer;
}
.save:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
