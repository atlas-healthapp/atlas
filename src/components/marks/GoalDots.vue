<template>
  <div class="dots" aria-hidden="true">
    <i
      v-for="i in count"
      :key="i"
      :class="{ on: i <= filled }"
      :style="i <= filled ? { background: color } : { borderColor: color }"
    ></i>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { dotGeometry } from "@/components/marks/markGeometry";

// A daily target counted out in tenths. Filled is solid, remaining is a ring,
// so the split reads without relying on the colour being distinguishable.
//
// Laid out with flex rather than an SVG viewBox: the row has to span the full
// width up to the value, and a scaled viewBox would grow the dots themselves
// along with the gaps. Here the dots keep their size and only the spacing
// stretches.
const props = defineProps({
  value: { type: Number, default: 0 },
  goal: { type: Number, required: true },
  color: { type: String, default: "var(--acc)" },
});

const geo = computed(() => dotGeometry(props.value, props.goal));
const count = computed(() => geo.value.count);
const filled = computed(() => geo.value.filled);
</script>

<style scoped>
.dots {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.dots i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.1px solid transparent;
  box-sizing: border-box;
  flex-shrink: 0;
  opacity: 0.38;
}
.dots i.on {
  border-color: transparent;
  opacity: 1;
}
</style>
