<template>
  <svg
    v-if="geo"
    class="day"
    :viewBox="`0 0 100 ${height}`"
    preserveAspectRatio="none"
    :style="{ height: `${height}px` }"
    aria-hidden="true"
  >
    <rect
      v-for="(col, i) in geo.columns"
      :key="i"
      :x="col.x"
      :y="col.y"
      :width="col.width"
      :height="col.height"
      :fill="color"
      :fill-opacity="ZONE_TONE[col.zone.key]"
    />
  </svg>
</template>

<script setup>
import { computed } from "vue";
import { stressDayGeometry } from "@/components/body/stressDay";

// The stress day at row size, for Home.
//
// Same geometry as the page draws, at a fraction of the height and in one hue:
// a BODY card is one colour, so the zones cannot have their own. Tone carries
// them instead, which is enough at three levels where it was not enough at the
// four the sleep stages needed.
//
// Thinned, because two hundred columns in 150px is a solid block rather than a
// day. Every third reading is roughly one every twenty minutes, which still
// shows the shape and still leaves a hole where the band was not reporting.
const props = defineProps({
  samples: { type: Array, default: () => [] },
  color: { type: String, default: "var(--acc)" },
  // Taller than the other row marks because this one draws a whole day from
  // a zero baseline: at 22px a calm overnight reading was under five pixels.
  height: { type: Number, default: 34 },
});

// Calm is the quiet end by design, but it was drawn so faint and so short that
// two thirds of a normal day read as almost nothing. It carries more tone now;
// the columns still rise from zero, so a column's height still means what it
// has always meant.
const ZONE_TONE = {
  calm: 0.62,
  mild: 0.75,
  moderate: 0.95,
  high: 1,
};

const THIN = 3;

const geo = computed(() =>
  stressDayGeometry(
    (props.samples ?? []).filter((_, i) => i % THIN === 0),
    { height: props.height }
  )
);
</script>

<style scoped>
.day {
  display: block;
  width: 100%;
}
</style>
