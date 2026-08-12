<template>
  <svg class="goal" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
    <rect x="0" y="3.5" width="100" height="3" rx="1.5" :fill="color" class="track" />
    <rect x="0" y="3.5" :width="fillPct" height="3" rx="1.5" :fill="color" />
    <rect :x="tickPct - 0.6" y="0.5" width="1.2" height="9" :fill="color" fill-opacity="0.9" />
  </svg>
</template>

<script setup>
import { computed } from "vue";
import { goalGeometry } from "@/components/marks/markGeometry";

// A metric with a daily target. The tick marks the target itself rather than
// letting a full bar imply it, so passing the goal stays visible instead of
// clipping at 100%.
const props = defineProps({
  value: { type: Number, default: 0 },
  goal: { type: Number, required: true },
  color: { type: String, default: "var(--acc)" },
});

const geo = computed(() => goalGeometry(props.value, props.goal));
const fillPct = computed(() => geo.value.fillPct);
const tickPct = computed(() => geo.value.tickPct);
</script>

<style scoped>
.goal {
  display: block;
  width: 100%;
  height: 9px;
}
/* The unfilled part of the bar. It needs more of the colour on a light ground
   than on a dark one: the same 18% that reads as a faint groove against
   near-black all but disappears against near-white. */
.track {
  fill-opacity: var(--mark-track);
}
</style>
