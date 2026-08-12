<template>
  <div class="notyet">
    <!-- The readings first, because they are the part that is real. A screen
         that leads with the countdown has told you about its own arithmetic
         before it has told you anything about you. -->
    <div v-if="shown.length" class="reads">
      <div v-for="r in shown" :key="r.label" class="read">
        <span class="rlabel mono">{{ r.label }}</span>
        <span class="rvalue mono">{{ r.value }}</span>
      </div>
    </div>

    <div class="count mono">
      <span class="have">{{ have }}</span
      ><span class="of"> OF {{ need }} {{ unit }}</span>
    </div>
    <div class="track" :style="{ '--fill': `${pct}%` }"><span></span></div>
    <p v-if="explain" class="why">{{ explain }}</p>
  </div>
</template>

<script setup>
import { computed } from "vue";

/**
 * What a screen shows while its history is too short to judge, instead of the
 * word CALIBRATING.
 *
 * **The distinction this is built on:** a figure can be *thin* or it can be
 * *circular*, and only the second is worth withholding. An average of six days
 * is a real average of six days. But Recovery scores today's deviation from a
 * baseline, so with two nights the baseline is largely the night being judged,
 * and a day compared with itself scores 63 by construction - that number is not
 * imprecise, it is meaningless. So the thresholds stay exactly where they are
 * and only the presentation changes: the readings that exist are shown, and the
 * wait is given an end.
 *
 * Deliberately not a card. It sits inside whatever card already owns the
 * subject, so it inherits that section's family colour rather than introducing
 * a treatment of its own.
 */
const props = defineProps({
  /** `[{ label, value }]`. Anything with a null value is dropped, not zeroed. */
  readings: { type: Array, default: () => [] },
  have: { type: Number, required: true },
  need: { type: Number, required: true },
  /** NIGHTS, DAYS, READINGS. Plural: there is never exactly one left to go. */
  unit: { type: String, default: "NIGHTS" },
  /** Why the wait exists, in one sentence. Omitted rather than padded. */
  explain: { type: String, default: "" },
});

const shown = computed(() =>
  props.readings.filter((r) => r && r.value != null && r.value !== "")
);

// Clamped, because a history longer than the threshold can still land here
// while some other input is missing, and a bar past its own end reads as a bug.
const pct = computed(() => {
  if (!props.need) return 0;
  return Math.max(0, Math.min(100, (props.have / props.need) * 100));
});
</script>

<style scoped>
.notyet {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.reads {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.read {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  min-height: 30px;
  border-bottom: 1px solid color-mix(in srgb, var(--dim) 12%, transparent);
}
.rlabel {
  font-size: 10.5px;
  letter-spacing: 1.6px;
  color: var(--dim);
}
.rvalue {
  font-size: 14px;
  letter-spacing: 0.5px;
  color: var(--ink);
}
.count {
  display: flex;
  align-items: baseline;
  gap: 1px;
  margin-top: 2px;
}
/* The number you have is the fact; the target is context for it. Setting both
   at one size made the row read as a fraction to be solved. */
.have {
  font-size: 17px;
  color: var(--ink);
  letter-spacing: 0.5px;
}
.of {
  font-size: 10.5px;
  letter-spacing: 1.8px;
  color: var(--dim);
}
.track {
  position: relative;
  height: 2px;
  background: color-mix(in srgb, var(--dim) 20%, transparent);
  border-radius: 2px;
  overflow: hidden;
}
/* currentColor, so the fill takes the family of whatever card it is sitting in
   rather than naming a colour and disagreeing with its own header. */
.track span {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--fill);
  background: currentColor;
  opacity: 0.75;
}
.why {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--dim);
}
</style>
