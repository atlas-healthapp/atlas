<template>
  <Teleport to="body">
    <div class="sheetwrap" @click.self="$emit('close')">
      <div class="sheet grid-bg">
        <div class="panel-hd">
          <span>ADD A SESSION</span><span @click="$emit('close')">[ CLOSE ]</span>
        </div>

        <p class="intro">
          For something the band never recorded, or was not on your wrist for.
        </p>

        <label class="field">
          <span class="flab mono">WHAT</span>
          <button type="button" class="picker mono" @click="typeOpen = true">
            {{ typeName ?? "PICK A TYPE" }}
            <span class="chev">›</span>
          </button>
        </label>

        <div class="pair">
          <label class="field">
            <span class="flab mono">DAY</span>
            <input v-model="date" class="inp mono" type="date" :max="today" />
          </label>
          <label class="field">
            <span class="flab mono">STARTED</span>
            <input v-model="time" class="inp mono" type="time" />
          </label>
        </div>

        <label class="field">
          <span class="flab mono">HOW LONG</span>
          <!-- Minutes, stepped, rather than a free number: this is the one
               figure that decides everything downstream (the week chart, the
               month totals), and nobody knows a session to the second. -->
          <span class="durbox">
            <button type="button" class="step mono" aria-label="Five minutes less" @click="nudge(-5)">
              −
            </button>
            <span class="durval mono">{{ durationLabel }}</span>
            <button type="button" class="step mono" aria-label="Five minutes more" @click="nudge(5)">
              +
            </button>
          </span>
        </label>

        <label class="field">
          <span class="flab mono">NOTE</span>
          <input
            v-model="note"
            class="inp mono"
            type="text"
            placeholder="OPTIONAL"
            autocomplete="off"
          />
        </label>

        <p v-if="clash" class="warn mono">{{ clash }}</p>

        <div class="savebar">
          <button type="button" class="action mono" @click="$emit('close')">CANCEL</button>
          <button type="button" class="action save mono" :disabled="!valid" @click="save">
            ADD {{ durationLabel }}
          </button>
        </div>
      </div>

      <SessionTypeSheet
        v-if="typeOpen"
        :current-type-id="typeId"
        @pick="onPickType"
        @close="typeOpen = false"
      />
    </div>
  </Teleport>
</template>

<script setup>
// Logging a session the band missed.
//
// It writes through `sessions.addManualSession`, which stores a session rather
// than an annotation: everything else in that store hangs off a device record,
// and this has none. `resolveSessions` emits these alongside the band's own, so
// once saved a manual session behaves like any other - it can be typed, noted,
// corrected, merged, split or deleted, because all of that joins on
// `startMillis` and this has one.
//
// Deliberately not asked for: calories and heart rate. The band measures those
// and you cannot, and a typed-in number would sit in the same column as a
// measured one with nothing to say which was which.
import { computed, ref } from "vue";
import { useBackClose } from "@/composables/useBackClose";
import { useSessionsStore } from "@/stores/sessions";
import SessionTypeSheet from "./SessionTypeSheet.vue";
import { today as todayKey } from "@/utils/date";

const emit = defineEmits(["close", "saved"]);
useBackClose(() => emit("close"));

const sessions = useSessionsStore();

const today = todayKey();
const date = ref(today);
// Defaults to an hour ago rather than now, since this is written up after the
// fact and a session that has not happened yet is the one thing it cannot be.
const time = ref(
  new Date(Date.now() - 60 * 60 * 1000).toTimeString().slice(0, 5)
);
const minutes = ref(60);
const note = ref("");
const typeId = ref(null);
const typeOpen = ref(false);

const typeName = computed(() => sessions.typeById(typeId.value)?.name ?? null);

function onPickType(id) {
  typeId.value = id;
  typeOpen.value = false;
}

function nudge(by) {
  minutes.value = Math.max(5, minutes.value + by);
}

const durationLabel = computed(() => {
  const m = minutes.value;
  if (m < 60) return `${m}M`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}H ${rest}M` : `${h}H`;
});

const startMillis = computed(() => {
  const t = new Date(`${date.value}T${time.value || "00:00"}:00`).getTime();
  return Number.isFinite(t) ? t : null;
});

/**
 * A session cannot have happened in the future, and one starting before it
 * finishes is the same mistake in the other direction.
 */
const clash = computed(() => {
  if (startMillis.value == null) return "THAT DAY AND TIME DO NOT MAKE SENSE.";
  if (startMillis.value > Date.now()) return "THAT IS IN THE FUTURE.";
  return null;
});

const valid = computed(() => clash.value == null && minutes.value > 0);

function save() {
  if (!valid.value) return;
  sessions.addManualSession({
    startMillis: startMillis.value,
    activeSeconds: minutes.value * 60,
    typeId: typeId.value,
    note: note.value,
  });
  emit("saved");
  emit("close");
}
</script>

<style scoped>
.sheetwrap {
  position: fixed;
  inset: 0;
  background: rgba(2, 5, 9, 0.55);
  z-index: 700;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  background: var(--bg2);
  border-radius: 14px 14px 0 0;
  padding: 20px 18px calc(26px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  /* Five labelled fields stacked at 13px read as one dense block. The gap is
     what separates them into things you answer one at a time. */
  gap: 18px;
  max-height: 90vh;
  overflow-y: auto;
}
.panel-hd {
  display: flex;
  justify-content: space-between;
  font-family: var(--font-mono);
  font-size: var(--fs-cardhd);
  letter-spacing: 0.09em;
  color: var(--fam-activity);
  font-weight: 600;
}
.panel-hd span:last-child {
  color: var(--dim);
  cursor: pointer;
}
.intro {
  margin: 0;
  font-size: var(--fs-second);
  color: var(--body);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.flab {
  font-size: var(--fs-micro);
  letter-spacing: 0.1em;
  color: var(--dim);
}
.inp,
.picker {
  background: var(--panel);
  border: 1px solid var(--panel-line);
  border-radius: 8px;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--fs-second);
  padding: 0 12px;
  /* The same 44pt floor every other row in Atlas is held to. */
  min-height: 44px;
  width: 100%;
}
.picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  text-align: left;
}
.chev {
  color: var(--dim);
}
.durbox {
  display: flex;
  align-items: center;
  gap: 10px;
}
.step {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  border: 1px solid var(--panel-line);
  background: var(--panel);
  color: var(--fam-activity);
  font-size: 20px;
  cursor: pointer;
}
.durval {
  flex: 1;
  text-align: center;
  font-size: var(--fs-value);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.warn {
  margin: 0;
  font-size: var(--fs-micro);
  letter-spacing: 0.08em;
  color: var(--bad);
}
.savebar {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
.action {
  flex: 1;
  min-height: 44px;
  border-radius: 8px;
  border: 1px solid var(--panel-line);
  background: none;
  color: var(--body);
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  letter-spacing: 0.08em;
  cursor: pointer;
}
.action.save {
  border-color: var(--fam-activity);
  background: var(--fam-activity);
  color: var(--bg1);
  font-weight: 600;
}
.action:disabled {
  opacity: 0.45;
}
</style>
