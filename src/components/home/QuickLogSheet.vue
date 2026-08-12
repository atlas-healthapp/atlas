<template>
  <!-- Bottom-sheet stepper for tap-to-log satellites. Accepts either one
       field object (sleep/water/weight/creatine - unchanged usage) or an
       array of them (Home's protein satellite, which logs protein+fibre
       together) - normalized to a list internally either way, so there's
       one component instead of a near-duplicate for the multi-field case. -->
  <Teleport to="body">
    <div class="sheetwrap" @click.self="$emit('close')">
      <div class="sheet grid-bg">
        <div class="panel-hd">
          <span>{{ fieldList.length > 1 ? "LOG" : fieldList[0].label }}</span
          ><span @click="$emit('close')">[ CLOSE ]</span>
        </div>
        <div
          v-for="(f, i) in fieldList"
          :key="f.key"
          class="fieldblock"
        >
          <div v-if="fieldList.length > 1" class="fieldname mono">
            {{ f.label }}
          </div>
          <div class="stepper">
            <button
              class="step"
              @click="
                values[i] = Math.max(0, +(values[i] - f.step).toFixed(2))
              "
            >
              −
            </button>
            <div class="val mono">
              <input
                class="valinput"
                type="number"
                inputmode="decimal"
                v-model.number="values[i]"
                @focus="$event.target.select()"
              /><span>{{ f.unit }}</span>
            </div>
            <button
              class="step"
              @click="values[i] = +(values[i] + f.step).toFixed(2)"
            >
              +
            </button>
          </div>
        </div>
        <button class="save mono" @click="save">SAVE</button>

        <!-- The only route to nutrition history. It used to live in TRENDS,
             which was unhooked when FITNESS took the fourth tab, and nothing
             replaced it: protein, fibre, water and creatine had no reachable
             history at all. Logging stays one tap; history is the second. -->
        <button
          v-for="f in fieldList"
          :key="`h-${f.key}`"
          type="button"
          class="history mono"
          @click="$emit('history', f.key)"
        >
          <!-- The metric's own name, not the field's label: a field is called
               "PROTEIN · MANUAL EXTRA" because that is what the stepper edits,
               and "PROTEIN · MANUAL EXTRA HISTORY" is not a thing. -->
          SEE {{ f.key.toUpperCase() }} HISTORY ›
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref } from "vue";
import { useBackClose } from "@/composables/useBackClose";

const props = defineProps({ field: { type: [Object, Array], required: true } });
const emit = defineEmits(["close", "save", "history"]);
useBackClose(() => emit("close"));

const fieldList = computed(() =>
  Array.isArray(props.field) ? props.field : [props.field]
);
const values = ref(fieldList.value.map((f) => f.value));

function save() {
  emit(
    "save",
    fieldList.value.map((f, i) => [f.key, values.value[i]])
  );
}
</script>

<style scoped>
/* 700, which is the layer a sheet opened over a PAGE sits in. The app stacks
   tabs at 1 to 110, drill-through pages at 600, and sheets those pages open at
   700 (ManualSessionSheet, SessionTypeSheet, EstimateSheet all do).

   This was 500 because it had only ever been opened from Home, which is a tab
   and so below everything. The moment MetricPage offered it, the sheet opened
   underneath the page that opened it and the button read as doing nothing. */
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
  border-top: 1px solid color-mix(in srgb, var(--acc) 35%, transparent);
  background: color-mix(in srgb, var(--bg1) 96%, black);
  padding: 16px 18px calc(26px + env(safe-area-inset-bottom));
  position: relative;
}
.sheet::before {
  content: "";
  position: absolute;
  top: -1px;
  left: -1px;
  width: 11px;
  height: 11px;
  border: 1px solid var(--acc);
  border-width: 1px 0 0 1px;
}
.panel-hd span:last-child {
  cursor: pointer;
}
.fieldblock {
  margin: 14px 0;
}
.fieldname {
  text-align: center;
  font-size: 10px;
  letter-spacing: 1.5px;
  color: var(--dim);
  margin-bottom: 6px;
}
.stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 22px;
}
.step {
  width: 48px;
  height: 48px;
  border: 1px solid var(--acc);
  color: var(--acc);
  font-size: 26px;
}
.val {
  font-size: 30px;
  color: var(--ink);
  min-width: 96px;
  text-align: center;
}
.val span {
  font-size: 12px;
  color: var(--dim);
  margin-left: 4px;
}
.valinput {
  width: 84px;
  background: none;
  border: none;
  border-bottom: 1px solid color-mix(in srgb, var(--acc) 35%, transparent);
  color: var(--ink);
  font-size: 30px;
  font-family: var(--font-sans);
  text-align: center;
  -moz-appearance: textfield;
}
.valinput::-webkit-inner-spin-button,
.valinput::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.valinput:focus {
  outline: none;
  border-bottom-color: var(--acc);
}
.save {
  width: 100%;
  text-align: center;
  font-size: 13px;
  letter-spacing: 2px;
  color: var(--bg1);
  background: var(--acc);
  padding: 12px 0;
  box-shadow: 0 0 18px color-mix(in srgb, var(--acc) 45%, transparent);
  margin-top: 8px;
}
.history {
  width: 100%;
  min-height: 44px;
  margin-top: 8px;
  background: none;
  border: 1px solid color-mix(in srgb, var(--dim) 38%, transparent);
  border-radius: 7px;
  color: var(--dim);
  font-size: 11px;
  letter-spacing: 1.6px;
  cursor: pointer;
}
.history:focus-visible {
  outline: 2px solid var(--acc);
  outline-offset: 2px;
}
</style>
