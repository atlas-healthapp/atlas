<template>
  <!-- Labelled date-range annotations (holidays, sick days, travel) that
       explain gaps in the Trends charts - opened from the settings drawer,
       same overlay pattern as Trends' HabitManager. -->
  <Teleport to="body">
    <div class="overlay grid-bg">
      <div class="hd">
        <div class="logo">ATLAS</div>
        <div class="sys mono"><b>TRIPS</b> · {{ trips.trips.length }} LOGGED</div>
      </div>
      <div class="mhead">
        <span class="back mono" @click="$emit('close')">◂ SETTINGS</span>
        <span class="title mono">TRIPS // GAPS</span>
      </div>

      <div class="panel">
        <div class="panel-hd">
          <span>NEW TRIP</span>
        </div>
        <input v-model="label" class="field" placeholder="Label (e.g. BALI)" />
        <div class="daterow">
          <input v-model="start" type="date" class="field" />
          <input v-model="end" type="date" class="field" />
        </div>
        <button
          class="save mono"
          :disabled="!label.trim() || !start || !end"
          @click="add"
        >
          + ADD
        </button>
      </div>

      <div class="panel" v-if="sorted.length">
        <div class="panel-hd"><span>LOGGED</span></div>
        <div v-for="t in sorted" :key="t.id" class="trow">
          <div class="tmain">
            <span class="nm">{{ t.label }}</span>
            <span class="range mono">{{ t.start }} → {{ t.end }}</span>
          </div>
          <button class="del mono" @click="trips.removeTrip(t.id)">
            DELETE
          </button>
        </div>
      </div>
      <div class="panel" v-else>
        <div class="panel-hd"><span>LOGGED</span></div>
        <div class="dim-text mono">NO TRIPS LOGGED YET. ADD ONE ABOVE.</div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref } from "vue";
import { useTripsStore } from "@/stores/trips";
import { useBackClose } from "@/composables/useBackClose";

const emit = defineEmits(["close"]);
useBackClose(() => emit("close"));

const trips = useTripsStore();

const label = ref("");
const start = ref("");
const end = ref("");

const sorted = computed(() =>
  [...trips.trips].sort((a, b) => b.start.localeCompare(a.start))
);

function add() {
  if (!label.value.trim() || !start.value || !end.value) return;
  trips.addTrip(label.value.trim().toUpperCase(), start.value, end.value);
  label.value = "";
  start.value = "";
  end.value = "";
}
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  /* opened from inside SettingsPage (z-index 600), so this must
     outrank it - not 400 like HabitManager, which opens over a plain tab */
  z-index: 650;
  background: radial-gradient(
    120% 70% at 50% 0%,
    var(--bg0) 0%,
    var(--bg1) 55%,
    var(--bg2) 100%
  );
  color: var(--body);
  font-family: var(--font-sans);
  padding: calc(22px + env(safe-area-inset-top)) 18px 40px;
  overflow-y: auto;
}
.hd {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.logo {
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 7px;
  color: var(--ink);
  text-shadow: 0 0 16px color-mix(in srgb, var(--acc) 50%, transparent);
}
.sys {
  font-size: 9px;
  letter-spacing: 2px;
  color: var(--dim);
}
.sys b {
  color: var(--acc);
  font-weight: 400;
}
.mhead {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 14px 0 20px;
}
.back {
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--acc);
  cursor: pointer;
}
.title {
  font-size: 9px;
  letter-spacing: 3px;
  color: var(--dim);
  margin-left: auto;
}
.field {
  width: 100%;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--acc) 25%, transparent);
  color: var(--ink);
  padding: 8px 10px;
  margin-bottom: 8px;
  font-size: 14px;
  font-family: var(--font-sans);
}
.daterow {
  display: flex;
  gap: 8px;
}
.daterow .field {
  flex: 1;
  font-size: 12px;
}
.save {
  width: 100%;
  text-align: center;
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--bg1);
  background: var(--acc);
  padding: 10px 0;
}
.save:disabled {
  opacity: 0.4;
}
.trow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 14px;
  font-weight: 600;
}
.tmain {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}
.range {
  font-size: 8px;
  letter-spacing: 1px;
  color: var(--dim);
}
.del {
  font-size: 9px;
  letter-spacing: 1px;
  color: var(--bad);
  border: 1px solid color-mix(in srgb, var(--bad) 40%, transparent);
  padding: 8px 10px;
  margin: -4px 0;
}
.dim-text {
  color: var(--dim);
  font-size: 11px;
  font-weight: 400;
}
</style>
