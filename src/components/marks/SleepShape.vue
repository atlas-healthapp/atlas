<template>
  <svg
    class="shape"
    :viewBox="`0 0 100 ${height}`"
    preserveAspectRatio="none"
    :style="{ height: `${height}px` }"
    aria-hidden="true"
  >
    <rect
      v-for="(seg, i) in laid"
      :key="i"
      :x="seg.x"
      :y="(seg.row * height) / seg.rows"
      :width="seg.width"
      :height="height / seg.rows - GAP"
      rx="0.6"
      :fill="seg.fill"
      :fill-opacity="seg.opacity"
    />
  </svg>
</template>

<script setup>
import { computed } from "vue";
import { hypnogramSegments } from "@/components/marks/markGeometry";

// The seventh mark: the shape of a night.
//
// It replaced a composition bar on Home's SLEEP row. That bar had to separate
// four stages using tone alone, because a BODY card is one colour and hue is
// spoken for, and one hue does not have four readable shades on a dark ground.
// This does not have that problem: depth is vertical position, so a single hue
// is enough, and the chart says what the night did rather than only how much of
// each stage there was.
//
// Falls back to CompositionBar at the call site when a night has totals but no
// timeline, which is what older records and a still-forming session look like.
const props = defineProps({
  /** `sleepStages.timeline` - `[{ stage, startMinute, minutes }]`. */
  timeline: { type: Array, default: () => [] },
  color: { type: String, default: "var(--acc)" },
  height: { type: Number, default: 18 },
  /** "family" keeps the BODY hue; "stage" uses the four sleep-stage colours. */
  variant: {
    type: String,
    default: "family",
    validator: (v) => v === "family" || v === "stage",
  },
});

// A hairline between depth rows. In viewBox units, and the viewBox height is
// the pixel height, so this is 0.8px however tall the mark is drawn.
const GAP = 0.8;

const laid = computed(() =>
  hypnogramSegments(props.timeline, { color: props.color, variant: props.variant })
);
</script>

<style scoped>
.shape {
  display: block;
  width: 100%;
}
</style>
