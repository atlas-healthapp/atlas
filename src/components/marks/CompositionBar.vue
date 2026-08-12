<template>
  <svg
    class="comp"
    :viewBox="`0 0 100 ${height}`"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <rect
      v-for="seg in laid"
      :key="seg.key"
      :x="seg.x"
      y="0"
      :width="seg.width"
      :height="height"
      rx="1.5"
      :fill="seg.fill"
      :fill-opacity="seg.opacity"
    />
  </svg>
</template>

<script setup>
import { computed } from "vue";
import { compositionSegments } from "@/components/marks/markGeometry";

// A total made of named parts. Sleep is the only one: a night is deep plus
// light plus REM plus awake, and the row is a squashed version of the sheet
// the same data opens into.
//
// Two variants because the colour rules differ by where it sits. On Home the
// BODY card is one colour, so stages are opacity steps of that one family
// hue. Inside the sleep sheet nothing competes with sleep, so hue is free to
// name each stage. Same component, same order, so the row still previews the
// sheet's shape even though it does not preview its colours.
const props = defineProps({
  segments: { type: Object, default: () => ({}) },
  color: { type: String, default: "var(--acc)" },
  variant: {
    type: String,
    default: "family",
    validator: (v) => v === "family" || v === "stage",
  },
  height: { type: Number, default: 9 },
});

const laid = computed(() =>
  compositionSegments(props.segments, { color: props.color, variant: props.variant })
);
</script>

<style scoped>
.comp {
  display: block;
  width: 100%;
}
</style>
