<template>
  <div>
    <svg
      class="plotbox"
      :viewBox="`0 0 ${geo.width} ${geo.height}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect
        v-for="b in geo.bars"
        :key="b.i"
        :x="b.x"
        :y="b.y"
        :width="b.w"
        :height="b.h"
        :fill="color"
        :opacity="opacityFor(b.i)"
        rx="1"
      />
      <!-- The figure the metric is defined around, not a target anybody set. -->
      <line
        v-if="referenceY != null"
        :x1="0"
        :x2="geo.width"
        :y1="referenceY"
        :y2="referenceY"
        class="ref"
      />
    </svg>
    <div class="ends mono">
      <span>{{ firstLabel }}</span>
      <span>{{ lastLabel }}</span>
    </div>
  </div>
</template>

<script setup>
/**
 * The days a rolling score is made of, above the seam rather than below it.
 *
 * **Why this is not history.** PAI is seven days of effort by definition, so
 * the window is not a record of the past, it *is* the reading. Measured on the
 * phone, PAI moved from 169 to 170 across a whole day, which is why the
 * intraday chart steps gets would draw a flat line here and say nothing: a
 * rolling score has no within-day story and needs a different one.
 *
 * The oldest day is dimmed because it is the one that falls out tomorrow, which
 * is the only thing on this chart you can do anything about.
 */
import { computed } from "vue";
import { barGeometry } from "@/utils/historyChart";

const props = defineProps({
  /** Oldest first, one per day. */
  values: { type: Array, required: true },
  /** The fixed figure the metric is defined around, if it has one. */
  reference: { type: Number, default: null },
  color: { type: String, default: "var(--acc)" },
  firstLabel: { type: String, default: "" },
  lastLabel: { type: String, default: "" },
});

const geo = computed(() => barGeometry(props.values, props.reference, { height: 46 }));

const referenceY = computed(() => {
  if (props.reference == null || !geo.value.bars.length) return null;
  const max = Math.max(props.reference, ...props.values.filter((v) => v != null), 0) || 1;
  return geo.value.height - (props.reference / max) * geo.value.height;
});

/** Today at full strength, the day that drops off tomorrow at a third. */
function opacityFor(i) {
  if (i === props.values.length - 1) return 1;
  return i === 0 ? 0.3 : 0.6;
}
</script>

<style scoped>
.plotbox {
  display: block;
  width: 100%;
  height: 110px;
}
.ref {
  stroke: var(--dim);
  stroke-width: 0.5;
  stroke-dasharray: 2 2;
  vector-effect: non-scaling-stroke;
}
.ends {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  color: var(--dim);
}
</style>
