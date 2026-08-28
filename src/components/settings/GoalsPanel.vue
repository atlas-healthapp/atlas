<!--
  The eight daily targets, and which of them you are keeping at all.

  **Saves on a button, not per keystroke.** Same reasoning as YOU above it: a
  half-typed protein target is a stored protein target, and every percentage on
  Home divides by it. The toggles ride in the same draft rather than applying
  immediately, because one panel that committed switches instantly and numbers
  on a button would leave you unable to say what SAVE was for.

  Grouped by colour family rather than listed flat, which is the same call
  `bodyModel` records for BODY's cards: an order that alternates families reads
  as scattered where a grouped one reads as a system.
-->
<template>
  <SettingsSection
    title="GOALS"
    :summary="summary"
    :open="open"
    @toggle="$emit('toggle')"
  >
    <template v-for="group in groups" :key="group.label">
      <div class="ghd mono" :style="{ color: group.color }">{{ group.label }}</div>

      <div v-for="key in group.keys" :key="key" class="grow">
        <!-- The pip is the switch, so the row's own label is the hit target for
             it. A separate checkbox column would put two controls on a row that
             has one number to change. -->
        <button
          type="button"
          class="pip"
          :class="{ on: draft[key].enabled }"
          :style="{ '--pipc': group.color }"
          :aria-label="`${labelFor(key)} ${draft[key].enabled ? 'on' : 'off'}`"
          :aria-pressed="draft[key].enabled"
          @click="draft[key].enabled = !draft[key].enabled"
        />
        <span class="glabel mono" :class="{ off: !draft[key].enabled }">
          {{ labelFor(key) }}
        </span>
        <span class="gfield">
          <input
            v-model.number="draft[key].value"
            class="gnum mono"
            type="number"
            inputmode="decimal"
            :step="stepFor(key)"
            min="0"
            :disabled="!draft[key].enabled"
          />
          <span class="gunit mono">{{ unitFor(key) }}</span>
        </span>
      </div>
    </template>

    <p class="note mono">
      A GOAL SWITCHED OFF DISAPPEARS RATHER THAN SITTING AT ZERO. NOTHING IS LOST:
      WHAT YOU LOGGED IS STILL RECORDED.
    </p>

    <div class="btnrow">
      <button class="databtn mono primary" :disabled="!dirty" @click="save">
        {{ saved ? "SAVED" : "SAVE GOALS" }}
      </button>
      <button class="databtn mono" :disabled="!dirty" @click="reset">DISCARD</button>
    </div>
  </SettingsSection>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import SettingsSection from "./SettingsSection.vue";
import { GOAL_KEYS, useGoalsStore } from "@/stores/goals";
import { metric } from "@/utils/metricRegistry";
import { familyColor } from "@/utils/families";

const props = defineProps({ open: { type: Boolean, default: false } });
defineEmits(["toggle"]);

const goals = useGoalsStore();

// All eight read the registry now. Calories briefly had its label, unit and
// step hardcoded here while it had no entry, which is precisely the drift that
// file exists to stop.
const labelFor = (key) => metric(key)?.label ?? key;
const unitFor = (key) => (metric(key)?.unit ?? "").trim() || unitFallback(key);
const stepFor = (key) => metric(key)?.step ?? 1;

// Sleep and steps carry no `unit` in the registry, because everywhere else they
// are formatted rather than suffixed. A bare number field needs one anyway.
function unitFallback(key) {
  if (key === "sleep") return "HOURS";
  if (key === "steps") return "STEPS";
  return "";
}

/**
 * Filtered against GOAL_KEYS, not just listed.
 *
 * **This is not defensiveness for its own sake.** Sleep was removed from the
 * goals and this list still named it, so `draft["sleep"].enabled` threw during
 * render and killed the whole settings page: every section stopped opening,
 * not just this one. A group naming a key that no longer exists must drop the
 * row, not take the page down with it.
 */
const groups = computed(() =>
  [
    { label: "INTAKE", color: familyColor("protein"), keys: ["calories", "protein", "fibre", "water", "creatine"] },
    { label: "ACTIVITY", color: familyColor("steps"), keys: ["steps"] },
  ]
    .map((g) => ({ ...g, keys: g.keys.filter((k) => GOAL_KEYS.includes(k)) }))
    .filter((g) => g.keys.length)
);

const draft = ref(blank());
const saved = ref(false);

function blank() {
  return Object.fromEntries(
    GOAL_KEYS.map((key) => [key, { ...goals.goals[key] }])
  );
}

// Re-read on every open rather than once on mount, or a panel closed and
// reopened after a restore shows the values from before it.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      draft.value = blank();
      saved.value = false;
    }
  }
);

const dirty = computed(() =>
  GOAL_KEYS.some(
    (key) =>
      draft.value[key].enabled !== goals.goals[key].enabled ||
      Number(draft.value[key].value) !== Number(goals.goals[key].value)
  )
);

const summary = computed(() => {
  const on = GOAL_KEYS.filter((key) => goals.isEnabled(key)).length;
  return `${on} OF ${GOAL_KEYS.length} ON`;
});

function save() {
  for (const key of GOAL_KEYS) {
    // Value first: `setValue` rejects anything at or below zero, so a field
    // cleared to nothing keeps the target it had rather than storing a goal
    // every percentage would divide by.
    goals.setValue(key, draft.value[key].value);
    goals.setEnabled(key, draft.value[key].enabled);
  }
  draft.value = blank();
  saved.value = true;
}

function reset() {
  draft.value = blank();
  saved.value = false;
}
</script>

<style scoped>
.ghd {
  margin: 14px 0 4px;
  font-size: var(--set-label);
  letter-spacing: 2px;
}
.ghd:first-child {
  margin-top: 2px;
}
.grow {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  border-bottom: 1px solid color-mix(in srgb, var(--dim) 12%, transparent);
}
.pip {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  padding: 0;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--dim) 55%, transparent);
  background: none;
  cursor: pointer;
}
.pip.on {
  border-color: var(--pipc);
  background: var(--pipc);
}
.glabel {
  flex: 1 1 auto;
  font-size: var(--set-summary);
  letter-spacing: 1.2px;
  color: var(--body);
}
.glabel.off {
  color: var(--dim);
}
.gfield {
  display: flex;
  align-items: baseline;
  gap: 5px;
}
.gnum {
  width: 74px;
  padding: 7px 8px;
  background: color-mix(in srgb, var(--acc) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--acc) 26%, transparent);
  border-radius: 6px;
  color: var(--ink);
  font-size: 15px;
  text-align: right;
}
.gnum:focus {
  outline: none;
  border-color: var(--acc);
}
.gnum:disabled {
  opacity: 0.35;
}
.gunit {
  width: 42px;
  font-size: var(--set-label);
  letter-spacing: 1.2px;
  color: var(--dim);
}
.note {
  margin: 14px 0 0;
  font-size: var(--set-label);
  line-height: 1.6;
  letter-spacing: 1px;
  color: var(--dim);
}
/* Repeated from AlarmPanel and DevicePanel rather than shared, because that is
   what those two already do to each other and scoped styles give no third
   option short of moving the rule into style.css. Kept byte-identical to them:
   these three panels sit on one page and a button that differed by a pixel
   would be visible. Without it the buttons render as bare text, which is how
   this was found. */
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
.databtn.primary {
  border-color: var(--acc);
  color: var(--acc);
}
.databtn:disabled {
  opacity: 0.4;
  cursor: default;
}
.databtn:active:not(:disabled) {
  background: color-mix(in srgb, var(--acc) 12%, transparent);
}
</style>
