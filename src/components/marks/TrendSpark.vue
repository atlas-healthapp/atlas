<template>
  <div class="spark">
    <svg :viewBox="`0 0 ${W} ${H}`" aria-hidden="true">
      <polyline
        v-if="points"
        :points="points"
        fill="none"
        :stroke="color"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <span v-if="delta" class="delta" :style="{ color }">{{ delta }}</span>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { sparklinePoints } from "@/components/body/sparkline";

// A metric where the direction carries the meaning and the level does not.
// Weight is the only one on Home: 74.2kg means nothing on its own, and
// "down 0.3 over a week" means everything.
//
// Reuses the existing sparkline maths rather than a second copy, which also
// means it inherits the rule that a null day is skipped instead of plotted as
// zero.
const props = defineProps({
  values: { type: Array, default: () => [] },
  delta: { type: String, default: "" },
  color: { type: String, default: "var(--acc)" },
});

const W = 60;
const H = 14;
const points = computed(() => sparklinePoints(props.values, W, H));
</script>

<style scoped>
.spark {
  display: flex;
  align-items: center;
  gap: 7px;
}
.spark svg {
  display: block;
  width: 60px;
  height: 13px;
  flex-shrink: 0;
}
.delta {
  font-size: var(--fs-label);
  letter-spacing: 0.4px;
  white-space: nowrap;
}
</style>
