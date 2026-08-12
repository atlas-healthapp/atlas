<template>
  <div class="hd">
    <div class="toprow">
      <div class="wordmark" role="button" tabindex="0" aria-label="Atlas, go home" @click="ui.setTab('home')" @keydown.enter="ui.setTab('home')">
        <PeakMark />TLAS
      </div>
      <ProfileChip />
    </div>
    <!-- Label and meta are one flex item, not two: as separate children the
         row's gap would open up either side of the separator they already
         carry. Anything slotted in sits beside them as its own item. -->
    <div class="sys mono">
      <span><b>{{ label }}</b><template v-if="meta"> · {{ meta }}</template></span>
      <slot />
    </div>
  </div>
</template>

<script setup>
// One header for every tab that has one.
//
// Food, Body and Fitness each carried their own copy of this markup and its
// CSS, and the copies had drifted: three wordmark treatments, two sizes of the
// line underneath, and three different gaps to the first card. Nobody chose any
// of that, it just accumulated, and it is exactly the kind of difference that
// is invisible while writing one screen and obvious while using four.
//
// Home is deliberately NOT a consumer. Its wordmark types itself during boot
// and its header holds a second line, so it keeps its own markup and reads the
// shared .wordmark rule from style.css instead. The type is shared; the
// structure is not, because Home's structure is doing something.
import ProfileChip from "@/components/layout/ProfileChip.vue";
import PeakMark from "@/components/layout/PeakMark.vue";
import { useUIStore } from "@/stores/ui";

defineProps({
  /** The bold word: FUEL DB, BODY, FITNESS. */
  label: { type: String, required: true },
  /** What follows the separator. Omitted rather than empty when there is nothing to say. */
  meta: { type: String, default: "" },
});

const ui = useUIStore();
</script>

<style scoped>
.hd {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 18px;
}
/* align-items: center rather than baseline, so the chip's circle centres on the
   wordmark. The row's height comes from the 34px chip, which puts the top of
   that circle exactly on the page's padding top - the same origin SettingsPage
   anchors its avatar to, so the chip does not appear to jump when the page it
   opens replaces the screen. */
.toprow {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.wordmark {
  cursor: pointer;
}
.wordmark:focus-visible {
  outline: 2px solid var(--acc);
  outline-offset: 3px;
}
.sys {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-label);
  letter-spacing: 1.6px;
  color: var(--dim);
}
.sys b {
  color: var(--acc);
  font-weight: 400;
}
</style>
