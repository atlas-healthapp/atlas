<!--
  Which three rings Home shows.

  In Settings rather than on Home itself, because tapping a dial already opens
  its drill-through and long-press is the only gesture left, which nobody would
  ever find. That is the same discoverability problem the tour exists for, and
  hiding a second control behind an undiscoverable gesture would make it worse.

  Applies immediately, like UNITS and unlike GOALS: nothing here is typed, so
  there is no half-finished state a SAVE button would be protecting.

  **Three rows that open, not three lists** (option B of four mocked up
  2026-08-25). It was `DIAL 1/2/3` headings with the same nine chips wrapped
  under each: twenty-seven controls for a three-item choice, all of them one
  colour, so the only thing marking the chosen one was an accent border - which
  is what "tappable" means everywhere else in the app. A row that opens is the
  shape settings is already made of, and it is the same `nested` idea SETUP
  ships.

  **The chips carry their family colour**, which is the second half of the fix:
  colour in Atlas says what kind of number a thing is, and a picker for nine
  metrics is exactly a place where that is worth saying.

  What B gives up, deliberately: the swatch shows the family, not the reading.
  Home's figures are computed in `HomeTab` from the archive, and pulling them
  in here would be a second implementation of them - the drift `metricRegistry`
  exists to stop, for a preview nobody asked for.
-->
<template>
  <SettingsSection
    title="HOME DIALS"
    :summary="summary"
    :open="open"
    @toggle="$emit('toggle')"
  >
    <div v-for="(chosen, i) in home.dials" :key="i" class="slot">
      <button
        class="drow"
        type="button"
        :aria-expanded="openSlot === i"
        @click="toggleSlot(i)"
      >
        <span class="dnum mono">{{ i + 1 }}</span>
        <!-- A ring, not a filled dot: the thing it stands for is a ring. -->
        <span class="dswatch" :style="{ borderColor: strokeFor(chosen) }" />
        <span class="dname mono" :style="{ color: inkFor(chosen) }">
          {{ labelFor(chosen) }}
        </span>
        <svg
          class="caret"
          :class="{ up: openSlot === i }"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <!-- The explainers live in here rather than at the top of the panel: they
           are about choosing, and closed this should be three rows and nothing
           else. -->
      <div v-if="openSlot === i" class="picker">
        <p class="note mono">
          ONLY THINGS WITH A SCORE OR A GOAL CAN FILL A RING, SO STRESS AND HRV
          ARE NOT HERE: A RING WOULD HAVE TO INVENT A TARGET TO HAVE ANYTHING TO
          FILL.
        </p>
        <div class="opts">
          <button
            v-for="key in candidates"
            :key="key"
            class="opt mono"
            :class="{
              on: chosen === key,
              taken: takenBy(key, i) != null,
              off: !available(key),
            }"
            :style="{ '--famc': strokeFor(key), '--famink': inkFor(key) }"
            :disabled="!available(key)"
            @click="pick(i, key)"
          >
            <!-- Which other ring already has it. Without this a chip that is
                 about to swap two rings looks the same as one that is simply
                 not chosen, and the swap reads as a bug. -->
            <span v-if="takenBy(key, i) != null" class="pip">
              {{ takenBy(key, i) + 1 }}
            </span>
            {{ labelFor(key) }}
          </button>
        </div>
        <p v-if="anyUnavailable" class="note mono">
          GREYED OUT MEANS THAT GOAL IS SWITCHED OFF IN GOALS. A RING FOR A
          TARGET YOU ARE NOT KEEPING COULD ONLY EVER READ ZERO.
        </p>
      </div>
    </div>

    <div class="btnrow">
      <button class="databtn mono" @click="home.resetDials()">RESET TO DEFAULT</button>
    </div>
  </SettingsSection>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import SettingsSection from "./SettingsSection.vue";
import { useHomeStore } from "@/stores/home";
import { useGoalsStore } from "@/stores/goals";
import {
  DIAL_CANDIDATES,
  DIAL_LABELS,
  dialColor,
  dialInkColor,
} from "@/components/home/dialModel";

const props = defineProps({ open: { type: Boolean, default: false } });
defineEmits(["toggle"]);

const home = useHomeStore();
const goals = useGoalsStore();

const candidates = DIAL_CANDIDATES;
const labelFor = (key) => DIAL_LABELS[key] ?? key;

/** The stroke value: swatches and chip borders, which owe 3:1. */
const strokeFor = (key) => dialColor(key);
/** The label value: chip and row text, which owes 4.5:1. Differs for gold. */
const inkFor = (key) => dialInkColor(key);

/** Which row's options are showing, or null. One at a time, like the page. */
const openSlot = ref(null);

function toggleSlot(i) {
  openSlot.value = openSlot.value === i ? null : i;
}

/**
 * Closes the row after a pick.
 *
 * The confirmation is the row above going back to three, now reading what you
 * chose - and since picking something another ring holds *swaps* the two, both
 * rows have changed and the closed list is the only place that is visible.
 */
function pick(i, key) {
  home.setDial(i, key);
  openSlot.value = null;
}

// Any row left open when the panel closes would be open again on reopening,
// which is a state nobody set.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) openSlot.value = null;
  }
);

/** The index of the other ring holding this metric, or null. */
function takenBy(key, self) {
  const at = home.dials.indexOf(key);
  return at === -1 || at === self ? null : at;
}

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
/* A row of the same weight as every other settings row, at the 48dp Android
   asks for, which is what `--set-row-h` already holds inside this page. */
.drow {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: var(--set-row-h);
  padding: 0;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-size: var(--set-summary);
  letter-spacing: 1px;
  color: var(--ink);
}
.slot + .slot .drow {
  border-top: 1px solid var(--panel-line);
}
.dnum {
  flex: none;
  width: 12px;
  font-size: var(--set-label);
  letter-spacing: 1.4px;
  color: var(--dim);
}
.dswatch {
  flex: none;
  width: 16px;
  height: 16px;
  border: 2.5px solid var(--dim);
  border-radius: 50%;
}
.dname {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.caret {
  width: 15px;
  height: 15px;
  flex: none;
  margin-left: auto;
  color: var(--dim);
  transition: transform 140ms ease;
}
.caret.up {
  transform: rotate(180deg);
}

.picker {
  padding: 2px 0 12px;
}
.note {
  margin: 0 0 10px;
  font-size: var(--set-label);
  line-height: 1.6;
  letter-spacing: 1px;
  color: var(--dim);
}
.note:last-child {
  margin: 10px 0 0;
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  background: none;
  border: 1px solid color-mix(in srgb, var(--famc) 38%, transparent);
  border-radius: 5px;
  color: var(--famink);
  font-size: var(--set-label);
  letter-spacing: 1.1px;
  cursor: pointer;
}
/* The chosen one is a fill as well as a border. A border alone is what every
   tappable thing in Atlas has, so on its own it cannot say "chosen". */
.opt.on {
  border-color: var(--famc);
  background: color-mix(in srgb, var(--famc) 14%, transparent);
}
.opt.taken {
  opacity: 0.55;
}
.opt.off {
  opacity: 0.32;
  cursor: default;
}
.pip {
  flex: none;
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  border-radius: 3px;
  background: var(--famc);
  color: var(--panel);
  font-size: calc(var(--set-label) - 2px);
  letter-spacing: 0;
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
  min-height: var(--set-row-h);
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--dim) 65%, transparent);
  color: var(--ink);
  font-size: var(--set-label);
  letter-spacing: 0.1em;
  cursor: pointer;
}
.databtn:active {
  background: color-mix(in srgb, var(--acc) 12%, transparent);
}
</style>
