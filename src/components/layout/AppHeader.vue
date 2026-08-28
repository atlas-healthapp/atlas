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
      <span><b>{{ label }}</b><template v-if="shownMeta"> · {{ shownMeta }}</template></span>
      <slot />
    </div>

    <!-- Under the header line on every tab that has one. Home mounts the same
         component itself, since it keeps its own header structure. -->
    <RunningSessionRow />
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
import { computed } from "vue";
import ProfileChip from "@/components/layout/ProfileChip.vue";
import PeakMark from "@/components/layout/PeakMark.vue";
import RunningSessionRow from "@/components/activity/RunningSessionRow.vue";
import { useUIStore } from "@/stores/ui";
import { useHelioStore, DRAIN_PHASE } from "@/stores/helio";

const props = defineProps({
  /** The bold word: FUEL DB, BODY, FITNESS. */
  label: { type: String, required: true },
  /** What follows the separator. Omitted rather than empty when there is nothing to say. */
  meta: { type: String, default: "" },
});

const ui = useUIStore();
const helio = useHelioStore();

/**
 * A running sync takes the line over, then gives it back.
 *
 * **Here rather than in each tab.** Three tabs pass their own meta and all three
 * want the same behaviour, so putting it in the shared header is one definition
 * instead of three that drift - which is the whole reason this component was
 * extracted. A tab keeps saying its own thing the moment the sync ends, because
 * `syncPhase` goes back to null and this falls through to the prop.
 *
 * **Replaces the meta rather than joining it**, matching Home, where the phase
 * takes the sync line over instead of queueing behind "SYNCED 09:17". Appending
 * would also put two separators in one short line.
 *
 * Falls back to SYNCING for the same reason Home does: `syncing` turns on before
 * the first phase is set, and a blank line at that moment is what made the app
 * look frozen rather than busy.
 */
const shownMeta = computed(() => {
  if (helio.syncing) return helio.syncPhase || "SYNCING";
  // The drain moves the numbers without `syncing` ever going true on the
  // rate-limited path, which is what let Recovery change while the app claimed
  // to be current. Same reasoning as Home's sync line.
  if (helio.draining) return helio.syncPhase || DRAIN_PHASE;
  return props.meta;
});
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
