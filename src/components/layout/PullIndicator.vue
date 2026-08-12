<template>
  <div class="ptr" :style="{ height: `${pull}px` }" aria-hidden="true">
    <div class="inner" :style="{ opacity: Math.min(1, pull / 40) }">
      <span
        class="ring"
        :class="{ spin: refreshing }"
        :hidden="!!note"
        :style="refreshing ? null : { transform: `rotate(${pull * 4}deg)` }"
      ></span>
      <span class="label mono">{{ label }}</span>
    </div>
  </div>
</template>

<script setup>
// The bit of the pull you can see: a ring that turns as you drag and spins
// while the strap is being talked to, over a word that says what will happen.
//
// The word matters more than the ring. A gesture nobody told you about needs to
// announce itself the first time, and "PULL TO SYNC" does that where a lone
// spinner would leave you guessing whether anything is happening at all.
import { computed } from "vue";
import { useHelioStore } from "@/stores/helio";

const props = defineProps({
  pull: { type: Number, default: 0 },
  refreshing: { type: Boolean, default: false },
  armed: { type: Boolean, default: false },
  /** Why the pull did nothing, held for a moment after the spinner stops. */
  note: { type: String, default: null },
});

const helio = useHelioStore();

// While the strap is being read this says what it is reading and how much of it
// has arrived, because a spinner alone cannot tell a slow fetch from a hung one
// and the backfill fetch is slow enough to look hung. The words come from the
// band's own events, so a stalled sync stops updating rather than lying.
const label = computed(() => {
  if (props.note) return props.note;
  if (props.refreshing) return helio.syncPhase ?? "SYNCING";
  return props.armed ? "RELEASE TO SYNC" : "PULL TO SYNC";
});
</script>

<style scoped>
.ptr {
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  /* No transition while the finger is down - the height is following the touch
     and easing it would lag behind the drag. The snap back at the end is fast
     enough not to need one either. */
}
.inner {
  display: flex;
  align-items: center;
  gap: 9px;
}
.ring {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--dim) 35%, transparent);
  border-top-color: var(--acc);
}
.ring.spin {
  animation: ptrspin 0.8s linear infinite;
}
@keyframes ptrspin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ring.spin {
    animation-duration: 2.4s;
  }
}
.label {
  font-size: var(--fs-micro);
  letter-spacing: 2px;
  color: var(--dim);
}
</style>
