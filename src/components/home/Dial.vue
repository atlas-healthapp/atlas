<template>
  <div class="dial" :class="{ tappable, glow }">
    <svg viewBox="0 0 112 112" aria-hidden="true">
      <circle
        cx="56"
        cy="56"
        :r="R"
        fill="none"
        :stroke="color"
        stroke-opacity="0.18"
        stroke-width="7"
      />
      <circle
        v-if="pct > 0"
        cx="56"
        cy="56"
        :r="R"
        fill="none"
        :stroke="color"
        stroke-width="7"
        stroke-linecap="round"
        :stroke-dasharray="C"
        :stroke-dashoffset="offset"
        transform="rotate(-90 56 56)"
      />
    </svg>
    <div class="vwrap">
      <div class="v" :style="{ fontSize: valueSize }">{{ text }}</div>
    </div>
    <div class="l mono" :style="{ color: inkColor || color }">{{ label }}</div>
  </div>
</template>

<script setup>
import { computed } from "vue";

// One headline gauge. Three of them sit across the top of Home, one per
// family, so the row doubles as a standing legend for what the colours mean.
const props = defineProps({
  pct: { type: Number, default: 0 },
  text: { type: String, default: "--" },
  label: { type: String, required: true },
  color: { type: String, default: "var(--acc)" },
  // Recovery's label needs a darker token than its stroke on the light themes,
  // where gold clears the 3:1 a stroke owes but not the 4.5:1 a label owes.
  inkColor: { type: String, default: "" },
  tappable: { type: Boolean, default: false },
  // Reserved for the top Recovery band. Its colour has to be pale to stay clear
  // of the LOW red under colour blindness, and pale alone reads as washed out
  // rather than as the best day in three weeks.
  glow: { type: Boolean, default: false },
});

// The dials are the focal point of the screen, so they are sized like it.
const R = 45;
const C = 2 * Math.PI * R;

// The value has to fit inside the ring, and the ring does not grow. A two or
// three digit score gets the full size; a duration like "7h 30m" is twice as
// wide and has to come down or it runs out past the stroke. Rajdhani hid this
// by being condensed; the platform sans does not.
const valueSize = computed(() => {
  const n = String(props.text).length;
  if (n <= 3) return "30px";
  if (n <= 5) return "24px";
  return "19px";
});
const offset = computed(() => C * (1 - Math.max(0, Math.min(100, props.pct)) / 100));
</script>

<style scoped>
.dial {
  position: relative;
  text-align: center;
  flex: 1;
}
.tappable {
  cursor: pointer;
}
.glow svg {
  filter: drop-shadow(0 0 9px color-mix(in srgb, var(--rec-great) 55%, transparent));
}
/* Grows to 120px where there is room and shrinks below it where there is not.
   Three fixed 120px dials overflow a 375px phone; three that scale do not. */
.dial svg {
  display: block;
  width: 100%;
  max-width: 120px;
  aspect-ratio: 1;
  height: auto;
  margin: 0 auto;
}
/* Centred over the ring rather than pinned at a fixed offset, so the number
   stays put whatever size the ring settles at. */
.vwrap {
  position: absolute;
  inset: 0;
  bottom: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.v {
  /* Set inline from the text length; this is only the floor. */
  font-size: 30px;
  font-weight: 600;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.l {
  font-size: var(--fs-label);
  letter-spacing: 1.6px;
  margin-top: 8px;
}
</style>
