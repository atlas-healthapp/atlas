<!--
  One meal, opened by tapping its section header.

  **Why this exists.** The diary rows used to print protein and a sometimes-fibre
  in a 10px line: a bare "10G" that did not say of what, and a figure that
  appeared on some rows and not others so absence read as missing data. Worse,
  it was the wrong two numbers - that markup dates to 2026-07-29 and `goals.js`
  did not exist until 2026-08-12, so it had never been reconciled with the rule
  the rest of the app follows. Protein and fibre are both OFF by default;
  calories is ON. Every row was printing two goals nobody had opted into and
  omitting the one they had.

  So the row went down to name and calories, and every other number moved here,
  where there is room to label it. That is the trade: the diary stays scannable
  and the detail is one tap away instead of squeezed in.

  **A sheet, not a page.** A chevron means "opens a page" everywhere else in
  Atlas, but a page would be a second detail level under FOOD and the app's own
  rule is that a detail page never opens another one. This closes back to where
  it was.
-->
<template>
  <div class="scrim" @click.self="$emit('close')">
    <div class="sheet">
      <div class="hd">
        <span class="mono ttl">{{ sectionLabel }}</span>
        <button class="mono close" type="button" @click="$emit('close')">[ CLOSE ]</button>
      </div>

      <div class="kcal mono">{{ split.kcalText }}<i>KCAL</i></div>

      <!-- The same three tiles the day panel draws, scoped to this meal and
           from the same `energySplit`. Withheld entirely when the items carry
           no carb or fat figures, rather than claiming 100% protein. -->
      <div v-if="split.split" class="tiles">
        <div v-for="p in split.parts" :key="p.key" class="tile">
          <span class="tn mono">{{ p.label }}</span>
          <span class="tv mono" :style="{ color: p.color }">{{ p.grams }}</span>
          <span class="ts mono">G · {{ p.pct }}%</span>
        </div>
      </div>
      <div v-else class="mono note">
        NO CARB OR FAT FIGURES ON THESE ITEMS, SO THE SPLIT IS NOT SHOWN.
      </div>

      <div v-if="fibre" class="mono fibre">{{ fibre }}G FIBRE</div>

      <div class="items">
        <div v-for="row in rows" :key="row.key" class="item">
          <span class="nm">
            {{ row.name }}
            <i class="mono amt">{{ amountFor(row) }}</i>
          </span>
          <span class="mono vals">{{ macroLine(row) }}</span>
        </div>
      </div>

      <!-- The action moved off the section header and in here. It was a third
           element on a 10px line beside the name and the totals; here it has a
           row of its own and can say what it will do. -->
      <button
        v-if="canSaveAsMeal"
        class="databtn mono"
        type="button"
        @click="$emit('save-as-meal')"
      >
        SAVE {{ sectionLabel }} AS A MEAL
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useFoodStore } from "@/stores/food";
import { energySplit } from "./energySplit";
import { offerFor } from "./sectionMeal";
import { formatAmount } from "./rowDetail";

const props = defineProps({
  /** The section's rows, as the diary built them. */
  rows: { type: Array, required: true },
  sectionLabel: { type: String, required: true },
  /** `{ kcal, protein, carbs, fat, fibre }` for the whole section. */
  totals: { type: Object, default: () => ({}) },
});
defineEmits(["close", "save-as-meal"]);

const food = useFoodStore();

const split = computed(() => energySplit(props.totals));
const fibre = computed(() => Math.round(props.totals?.fibre ?? 0) || null);
const canSaveAsMeal = computed(() => offerFor(props.rows));

/**
 * The amount, through the one formatter every screen prints amounts with.
 *
 * It takes the unit and portion separately, never the item: a base unit is two
 * different kinds of thing, one taking a count and one already carrying its own
 * amount, and printing them the same way gives `1 1 PORTION (25 G)`.
 */
function amountFor(row) {
  const item = food.itemById(row.mealId);
  return formatAmount(row.quantity ?? 1, item?.baseUnit, item?.portion);
}

/**
 * Every macro this row actually has, labelled.
 *
 * A missing figure is left out rather than printed as zero: an item logged
 * without a fat figure is not a fat-free item, and this is the screen people
 * will come to when a number looks wrong.
 */
function macroLine(row) {
  const m = row.macros ?? {};
  const parts = [];
  if (m.kcal != null) parts.push(`${Math.round(m.kcal)} KCAL`);
  if (m.protein != null) parts.push(`${Math.round(m.protein)}P`);
  if (m.carbs != null) parts.push(`${Math.round(m.carbs)}C`);
  if (m.fat != null) parts.push(`${Math.round(m.fat)}F`);
  if (m.fibre != null) parts.push(`${Math.round(m.fibre)} FIBRE`);
  return parts.join(" · ");
}
</script>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-end;
  z-index: 700;
}
.sheet {
  width: 100%;
  max-height: 88vh;
  overflow-y: auto;
  background: var(--bg2);
  border-radius: 14px 14px 0 0;
  padding: 16px 14px calc(20px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hd {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.ttl {
  font-size: var(--fs-micro);
  letter-spacing: 1.4px;
  color: var(--acc);
}
.close {
  background: none;
  border: 0;
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  color: var(--dim);
  padding: 4px;
}
/* The unit outside the big string, the same rule MetricPage runs on: a bare
   number and a number with a unit welded to it are visibly different objects. */
.kcal {
  font-size: 34px;
  color: var(--ink);
  line-height: 1;
}
.kcal i {
  font-style: normal;
  font-size: var(--fs-micro);
  letter-spacing: 1.5px;
  color: var(--dim);
  margin-left: 8px;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.tile {
  border: 1px solid var(--panel-line);
  border-radius: 8px;
  padding: 8px;
  text-align: center;
}
.tn {
  display: block;
  font-size: 13px;
  letter-spacing: 1.2px;
  color: var(--dim);
}
.tv {
  display: block;
  font-size: 19px;
  margin-top: 2px;
}
.ts {
  display: block;
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--dim);
}
.note,
.fibre {
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  color: var(--dim);
  line-height: 1.5;
}
.items {
  display: flex;
  flex-direction: column;
  margin-top: 2px;
}
.item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--panel-line);
}
.nm {
  color: var(--ink);
  font-size: var(--fs-second);
  line-height: 1.35;
}
.amt {
  display: block;
  font-style: normal;
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  color: var(--dim);
}
.vals {
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  color: var(--dim);
  white-space: nowrap;
}
.databtn {
  margin-top: 6px;
  width: 100%;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--panel-line);
  background: transparent;
  color: var(--dim);
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
}
</style>
