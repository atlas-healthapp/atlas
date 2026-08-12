<template>
  <div class="panel">
    <div class="panel-hd">
      <span>WEEKLY SCHEDULE</span><span>{{ dayLabel }}</span>
    </div>
    <div class="daystrip">
      <button
        v-for="d in days"
        :key="d.key"
        :class="{ on: selectedDay === d.key }"
        @click="selectedDay = d.key"
      >
        {{ d.label }}
      </button>
    </div>
    <div v-for="(slot, idx) in slots" :key="idx" class="row">
      <span class="time mono">{{ fmtTime(slot.time) }}</span>
      <span class="name">{{ itemName(slot.mealId) }}</span>
      <span class="macro mono">{{ slotDetail(slot) }}</span>
      <button class="del mono" @click="removeSlot(idx)">×</button>
    </div>
    <div v-if="!slots.length" class="emptyrow dim-text mono">
      NO SLOTS SCHEDULED
    </div>
    <div class="addslot">
      <div class="fieldrow">
        <div class="fieldgroup time-group">
          <span class="fieldlabel mono">TIME</span>
          <input v-model="newTime" type="time" class="field" />
        </div>
        <div class="fieldgroup item-group">
          <span class="fieldlabel mono">ITEM</span>
          <select v-model="newMealId" class="field" @change="onMealPicked">
            <option value="" disabled>SELECT ITEM</option>
            <option v-for="i in schedulableItems" :key="i.id" :value="i.id">
              {{ i.name }}
            </option>
          </select>
        </div>
        <div class="fieldgroup qty-group">
          <span class="fieldlabel mono">QTY</span>
          <input
            v-model.number="newQuantity"
            type="number"
            min="0.01"
            step="any"
            class="field"
          />
        </div>
        <div class="fieldgroup type-group">
          <span class="fieldlabel mono">TYPE</span>
          <select
            v-model="newMealType"
            class="field"
            @change="mealTypeTouched = true"
          >
            <option v-for="mt in MEAL_TYPES" :key="mt.key" :value="mt.key">
              {{ mt.label }}
            </option>
          </select>
        </div>
      </div>
      <button
        class="save mono add-btn"
        :disabled="!newTime || !newMealId || !newQuantity"
        @click="addSlot"
      >
        + ADD SLOT
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useFoodStore, mealTypeFromTime } from "@/stores/food";
import { formatAmount } from "./rowDetail";
import { fmtTime, today } from "@/utils/date";

const food = useFoodStore();

// Displayed Monday-first to match the rest of the app's week strips,
// but keyed to the store's native JS getDay() indices (0 = Sunday).
const days = [
  { key: 1, label: "MON" },
  { key: 2, label: "TUE" },
  { key: 3, label: "WED" },
  { key: 4, label: "THU" },
  { key: 5, label: "FRI" },
  { key: 6, label: "SAT" },
  { key: 0, label: "SUN" },
];

const MEAL_TYPES = [
  { key: "breakfast", label: "BREAKFAST" },
  { key: "lunch", label: "LUNCH" },
  { key: "dinner", label: "DINNER" },
  { key: "snack", label: "SNACK" },
];

const selectedDay = ref(new Date(today() + "T12:00:00").getDay());
const newTime = ref("");
const newMealId = ref("");
const newQuantity = ref(1);
const newMealType = ref("breakfast");
const mealTypeTouched = ref(false);

const dayLabel = computed(
  () => days.find((d) => d.key === selectedDay.value)?.label ?? ""
);

watch(newTime, (t) => {
  if (t && !mealTypeTouched.value) newMealType.value = mealTypeFromTime(t);
});
const slots = computed(() => food.schedule[selectedDay.value] ?? []);
// Snacks stay out of the template - they're quick-added per-day, not scheduled.
const schedulableItems = computed(() =>
  food.library.filter((i) => i.kind === "meal" || i.kind === "takeaway")
);

function itemName(id) {
  return food.itemById(id)?.name ?? "UNKNOWN";
}
function slotDetail(slot) {
  const item = food.itemById(slot.mealId);
  if (!item) return "";
  const qty = slot.quantity ?? item.baseAmount ?? 1;
  const scaled = food.scaleItem(item, qty);
  // Stays quiet on a plain "1 serving", which says nothing, but not when the
  // item knows what a serving actually is: "1 SERVING (2 EGGS)" is the reason
  // the portion field exists.
  const bare = item.baseUnit === "serving" && !item.portion;
  const qtyLabel = bare ? "" : `${formatAmount(qty, item.baseUnit, item.portion)} · `;
  return `${qtyLabel}${scaled.protein}G · ${scaled.kcal}`;
}

// pre-fill a sensible quantity default (the item's own base amount) the
// moment a library item is picked, rather than leaving it at whatever the
// previous slot's quantity happened to be
function onMealPicked() {
  const item = food.itemById(newMealId.value);
  newQuantity.value = item?.baseAmount ?? 1;
}

function addSlot() {
  if (!newTime.value || !newMealId.value || !newQuantity.value) return;
  const updated = [
    ...slots.value,
    {
      time: newTime.value,
      mealId: newMealId.value,
      quantity: newQuantity.value,
      mealType: newMealType.value,
    },
  ].sort((a, b) => a.time.localeCompare(b.time));
  food.setScheduleForDay(selectedDay.value, updated);
  newTime.value = "";
  newMealId.value = "";
  newQuantity.value = 1;
  newMealType.value = "breakfast";
  mealTypeTouched.value = false;
}

function removeSlot(idx) {
  const updated = slots.value.filter((_, i) => i !== idx);
  food.setScheduleForDay(selectedDay.value, updated);
}
</script>

<style scoped>
.panel-hd {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--dim);
  margin-bottom: 8px;
}
.daystrip {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}
.daystrip button {
  flex: 1;
  border: 1px solid color-mix(in srgb, var(--fam-intake) 30%, transparent);
  color: var(--dim);
  font-size: 10.5px;
  letter-spacing: 1px;
  padding: 6px 0;
  font-family: var(--font-mono);
}
.daystrip .on {
  color: var(--bg1);
  background: var(--fam-intake);
}
.row {
  display: grid;
  grid-template-columns: 56px 1fr auto auto;
  align-items: baseline;
  column-gap: 8px;
  padding: 6px 0;
  font-size: 14px;
  font-weight: 600;
}
.emptyrow {
  padding: 6px 0;
}
.time {
  font-size: 11px;
  color: var(--fam-intake);
}
.name {
  overflow-wrap: anywhere;
  min-width: 0;
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
.field {
  width: 100%;
  background: color-mix(in srgb, var(--fam-intake) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 45%, transparent);
  color: var(--ink);
  padding: 9px 11px;
  font-size: 14px;
}
.field[type="number"] {
  -moz-appearance: textfield;
}
.field[type="number"]::-webkit-inner-spin-button,
.field[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.addslot {
  margin-top: 10px;
}
.addslot .fieldrow {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.fieldgroup {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.fieldlabel {
  font-size: 9px;
  letter-spacing: 1.5px;
  color: var(--dim);
}
.time-group {
  flex: 0 0 100px;
}
.item-group {
  flex: 1;
  min-width: 0;
}
.qty-group {
  flex: 0 0 64px;
}
.type-group {
  flex: 0 0 84px;
}
.add-btn {
  flex: 1 0 100%;
  text-align: center;
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--bg1);
  background: var(--fam-intake);
  padding: 10px 0;
}
.add-btn:disabled {
  opacity: 0.4;
}
</style>
