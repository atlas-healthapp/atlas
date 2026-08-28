<!--
  The stepper that edits one day's reading.

  **Extracted 2026-08-26 when the week strip needed a second copy of it.** It had
  lived inline in `MetricPage`'s EVERY DAY list; a second inline copy under the
  strip would have been the same control in two places, drifting the moment
  either gained a field - which is the drift `rowDetail.js` and `metricRegistry`
  were both extracted to stop.

  It owns its own draft value rather than binding a parent ref. Two of these are
  mounted at once (the strip's and the list's), and a shared `editVal` meant
  opening one silently rewrote what the other was showing.
-->
<template>
  <div class="editrow">
    <span v-if="def.composite" class="editnote mono">
      MANUAL EXTRA, ON TOP OF WHAT THE DIARY ALREADY COUNTED
    </span>
    <div class="stepper">
      <button
        class="step"
        type="button"
        :aria-label="`Less ${def.label}`"
        @click="draft = Math.max(0, +(draft - step).toFixed(2))"
      >
        −
      </button>
      <div class="val mono">
        <input
          v-model.number="draft"
          class="valinput"
          type="number"
          inputmode="decimal"
          :aria-label="def.label"
          @focus="$event.target.select()"
        /><span>{{ def.unit || "" }}</span>
      </div>
      <button
        class="step"
        type="button"
        :aria-label="`More ${def.label}`"
        @click="draft = +(draft + step).toFixed(2)"
      >
        +
      </button>
    </div>
    <!-- The field stays decimal because this stepper is shared with water,
         creatine and weight, where a decimal is the natural unit. But 8.63 is
         not a duration anybody reads, so the same number is echoed in hours and
         minutes underneath it. -->
    <span v-if="def.format === 'hours'" class="editecho mono">
      {{ fmtHoursMins(draft) }}
    </span>
    <button class="save mono" type="button" @click="$emit('save', draft)">SAVE</button>
  </div>
</template>

<script setup>
import { ref, watch, computed } from "vue";
import { fmtHoursMins } from "@/utils/date";

const props = defineProps({
  /** The metric's registry entry: unit, step, format, composite. */
  def: { type: Object, required: true },
  /** What the day currently holds. Null reads as nothing logged, which is 0. */
  value: { type: Number, default: null },
});
defineEmits(["save"]);

const step = computed(() => props.def.step ?? 1);
const draft = ref(props.value ?? 0);

// Reseeded when the caller points this at a different day, which the strip does
// without unmounting: tapping Tuesday after Monday reuses the same instance, and
// without this it would open holding Monday's figure.
watch(
  () => props.value,
  (v) => {
    draft.value = v ?? 0;
  }
);
</script>

<style scoped>
.editrow {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 0 4px;
}
.editnote {
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  color: var(--dim);
}
.stepper {
  display: flex;
  align-items: center;
  gap: 10px;
}
/* 44px is the app's touch minimum, and a stepper is the one control here that
   gets pressed repeatedly. */
.step {
  flex: none;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--dim) 45%, transparent);
  border-radius: 8px;
  background: none;
  color: var(--ink);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.step:active {
  background: color-mix(in srgb, var(--acc) 12%, transparent);
}
.val {
  flex: 1;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 5px;
  font-size: 24px;
  color: var(--ink);
}
/* Sized to its content so the unit sits beside the number rather than at the
   far edge of a full-width field. */
.valinput {
  width: 3.5em;
  background: none;
  border: none;
  border-bottom: 1px solid color-mix(in srgb, var(--dim) 45%, transparent);
  color: var(--ink);
  font: inherit;
  text-align: center;
  padding: 0 2px 2px;
}
.valinput:focus {
  outline: none;
  border-bottom-color: var(--acc);
}
.val span {
  font-size: var(--fs-label);
  letter-spacing: 1.2px;
  color: var(--dim);
}
.editecho {
  text-align: center;
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  color: var(--dim);
}
.save {
  min-height: 44px;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--dim) 65%, transparent);
  border-radius: 8px;
  color: var(--ink);
  font-size: var(--fs-label);
  letter-spacing: 0.1em;
  cursor: pointer;
}
.save:active {
  background: color-mix(in srgb, var(--acc) 12%, transparent);
}
</style>
