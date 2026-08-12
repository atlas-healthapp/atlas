<!--
  How numbers are printed. Four dimensions; water is deliberately not one of
  them and is always litres.

  **Applies immediately, unlike YOU and GOALS above it.** Those save on a button
  because a half-typed number is a stored number. Nothing here is typed: every
  control is a choice between two or three fixed options, so there is no
  half-finished state to protect against, and a SAVE button would sit there
  asking to confirm something already visible on the row above.

  **Four rows, no METRIC/IMPERIAL/UK presets.** They were built and pulled: a
  preset is an extra concept that has to be learned before it saves anybody a
  tap, the names mean different things in different places, and "UK" in
  particular was a label for a combination rather than a thing anyone asked for.
  Four rows of two or three chips is the whole feature, visible at once.
-->
<template>
  <SettingsSection
    title="UNITS"
    :summary="summary"
    :open="open"
    @toggle="$emit('toggle')"
  >
    <div v-for="dim in dims" :key="dim.key" class="drow">
      <span class="dlabel mono">{{ dim.label }}</span>
      <div class="dopts">
        <button
          v-for="opt in dim.options"
          :key="opt.id"
          class="dopt mono"
          :class="{ on: units.values[dim.key] === opt.id }"
          @click="units.setDimension(dim.key, opt.id)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>
  </SettingsSection>
</template>

<script setup>
import { computed } from "vue";
import SettingsSection from "./SettingsSection.vue";
import { useUnitsStore } from "@/stores/units";

defineProps({ open: { type: Boolean, default: false } });
defineEmits(["toggle"]);

const units = useUnitsStore();
// Labels rather than the raw system ids, since "ftin" and "st" mean nothing on
// a button. The order matches SYSTEMS, so metric is always leftmost.
const dims = [
  {
    key: "weight",
    label: "WEIGHT",
    options: [
      { id: "kg", label: "KG" },
      { id: "lb", label: "LB" },
      { id: "st", label: "ST · LB" },
    ],
  },
  {
    key: "height",
    label: "HEIGHT",
    options: [
      { id: "cm", label: "CM" },
      { id: "ftin", label: "FT · IN" },
    ],
  },
  {
    key: "distance",
    label: "DISTANCE",
    options: [
      { id: "km", label: "KM" },
      { id: "mi", label: "MILES" },
    ],
  },
  {
    key: "temperature",
    label: "TEMPERATURE",
    options: [
      { id: "c", label: "°C" },
      { id: "f", label: "°F" },
    ],
  },
];

/**
 * The four chosen units, not a preset name.
 *
 * More useful than a label and it cannot lie: a closed row saying METRIC while
 * distance was set to miles would be the summary misreporting what is set, and
 * that is the one thing a collapsed section must never do.
 */
const summary = computed(() =>
  dims
    .map((d) => d.options.find((o) => o.id === units.values[d.key])?.label ?? "")
    .join(" · ")
);
</script>

<style scoped>
.drow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 44px;
  border-bottom: 1px solid color-mix(in srgb, var(--dim) 12%, transparent);
}
.dlabel {
  font-size: 11px;
  letter-spacing: 1.2px;
  color: var(--body);
}
.dopts {
  display: flex;
  gap: 4px;
}
.dopt {
  min-height: 30px;
  padding: 0 9px;
  background: none;
  border: 1px solid color-mix(in srgb, var(--dim) 35%, transparent);
  border-radius: 5px;
  color: var(--dim);
  font-size: 10px;
  letter-spacing: 1px;
  cursor: pointer;
}
.dopt.on {
  border-color: var(--acc);
  color: var(--acc);
}
</style>
