<!--
  Which three rings Home shows.

  In Settings rather than on Home itself, because tapping a dial already opens
  its drill-through and long-press is the only gesture left, which nobody would
  ever find. That is the same discoverability problem the tour exists for, and
  hiding a second control behind an undiscoverable gesture would make it worse.

  Applies immediately, like UNITS and unlike GOALS: nothing here is typed, so
  there is no half-finished state a SAVE button would be protecting.
-->
<template>
  <SettingsSection
    title="HOME DIALS"
    :summary="summary"
    :open="open"
    @toggle="$emit('toggle')"
  >
    <p class="note mono">
      THE THREE RINGS AT THE TOP OF HOME. ONLY THINGS WITH A SCORE OR A GOAL CAN
      FILL ONE, SO STRESS AND HRV ARE NOT HERE: A RING WOULD HAVE TO INVENT A
      TARGET TO HAVE ANYTHING TO FILL.
    </p>

    <div v-for="(chosen, i) in home.dials" :key="i" class="slot">
      <div class="shd mono">DIAL {{ i + 1 }}</div>
      <div class="opts">
        <button
          v-for="key in candidates"
          :key="key"
          class="opt mono"
          :class="{ on: chosen === key, off: !available(key) }"
          :disabled="!available(key)"
          @click="home.setDial(i, key)"
        >
          {{ labelFor(key) }}
        </button>
      </div>
    </div>

    <p v-if="anyUnavailable" class="note mono">
      GREYED OUT MEANS THAT GOAL IS SWITCHED OFF IN GOALS. A RING FOR A TARGET
      YOU ARE NOT KEEPING COULD ONLY EVER READ ZERO.
    </p>

    <div class="btnrow">
      <button class="databtn mono" @click="home.resetDials()">RESET TO DEFAULT</button>
    </div>
  </SettingsSection>
</template>

<script setup>
import { computed } from "vue";
import SettingsSection from "./SettingsSection.vue";
import { useHomeStore } from "@/stores/home";
import { useGoalsStore } from "@/stores/goals";
import { DIAL_CANDIDATES, DIAL_LABELS } from "@/components/home/dialModel";

defineProps({ open: { type: Boolean, default: false } });
defineEmits(["toggle"]);

const home = useHomeStore();
const goals = useGoalsStore();

const candidates = DIAL_CANDIDATES;
const labelFor = (key) => DIAL_LABELS[key] ?? key;

// Recovery, sleep and the routine are not goals, so they are always offerable.
// Everything else needs its target to be switched on.
function available(key) {
  // These four have a reference that is not a settable goal: two scores, a
  // tally, and PAI's own published threshold.
  if (["recovery", "sleep", "routine", "pai"].includes(key)) return true;
  return goals.valueFor(key) != null;
}

const anyUnavailable = computed(() => candidates.some((key) => !available(key)));

const summary = computed(() => home.dials.map((k) => labelFor(k)).join(" · "));
</script>

<style scoped>
.note {
  margin: 0 0 12px;
  font-size: 10.5px;
  line-height: 1.6;
  letter-spacing: 1px;
  color: var(--dim);
}
.slot {
  margin-bottom: 14px;
}
.shd {
  margin-bottom: 6px;
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--dim);
}
/* Wrapped chips rather than a scrolling row: nine options is more than fits on
   a phone in one line, and a horizontal scroller hides the ones off the end
   with nothing saying they are there. */
.opts {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.opt {
  min-height: 32px;
  padding: 0 10px;
  background: none;
  border: 1px solid color-mix(in srgb, var(--dim) 35%, transparent);
  border-radius: 5px;
  color: var(--dim);
  font-size: 10px;
  letter-spacing: 1.1px;
  cursor: pointer;
}
.opt.on {
  border-color: var(--acc);
  color: var(--acc);
}
.opt.off {
  opacity: 0.32;
  cursor: default;
}
/* Byte-identical to AlarmPanel, DevicePanel and GoalsPanel. Scoped styles give
   no third option and these all sit on one page. */
.btnrow {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.databtn {
  flex: 1;
  min-height: 44px;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--dim) 65%, transparent);
  color: var(--ink);
  font-size: 10px;
  letter-spacing: 0.1em;
  cursor: pointer;
}
.databtn:active {
  background: color-mix(in srgb, var(--acc) 12%, transparent);
}
</style>
