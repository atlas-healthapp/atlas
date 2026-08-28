<!--
  What the alarm actually did, morning by morning.

  Four things per morning because those are the four that get asked: did it
  fire, what stage were you in, what it was set for against when it went off,
  and whether it was in smart mode at all.

  **Moved out of `AlarmPanel` into LOGS on 2026-08-25.** It lived inline under
  the alarm on the argument that somebody wondering whether it worked opens that
  panel, and a second tap is a tap most people will not take. What changed is
  that it is no longer the only log: the strap log and the sync trail are the
  same kind of thing and were in worse places - one buried inside two panels,
  the other readable over adb and nowhere else. One card for the three of them
  beats a good position for one of them.

  Read from the background service, which is the only thing that was awake when
  any of it happened. Loaded when the row opens rather than on mount, since
  Settings mounts every section and this one costs a plugin call.
-->
<template>
  <SettingsSection
    nested
    title="ALARM MORNINGS"
    :summary="summary"
    :open="open"
    @toggle="$emit('toggle')"
  >
    <template v-if="mornings.length">
      <div v-for="m in shownMornings" :key="m.day" class="morning">
        <div class="mtop">
          <span class="mdate mono">{{ morningDate(m) }}</span>
          <span class="mverdict mono" :class="m.outcome">{{ verdictWord(m) }}</span>
        </div>
        <div class="mtimes mono">
          <template v-if="m.firedAt">
            SET {{ m.setFor ?? "?" }} · WOKE YOU {{ m.firedAt }}
          </template>
          <template v-else-if="m.setFor"> SET {{ m.setFor }} · NO EARLY WAKE </template>
        </div>
        <div class="mwhy">{{ m.reason }}</div>
      </div>
      <button
        v-if="mornings.length > SHOWN"
        class="databtn mono"
        type="button"
        @click="showAll = !showAll"
      >
        {{ showAll ? "SHOW FEWER" : `ALL ${mornings.length} MORNINGS` }}
      </button>
      <!-- The same block a stranger pastes into a bug report. It is the raw
           records, not these sentences: a paraphrase of a diagnostic is not a
           diagnostic, and the person reading it needs what the service wrote. -->
      <button class="databtn mono" type="button" @click="copyReport">
        {{ copied ? "COPIED" : "COPY ALARM LOG" }}
      </button>
    </template>

    <!-- Nothing recorded is not a fault: a fixed alarm never opens a window, and
         a phone that has just been reinstalled has no history yet. -->
    <div v-else-if="historyLoaded" class="mwhy">{{ emptyNote }}</div>
    <div v-else class="mwhy dim">Reading the service…</div>
  </SettingsSection>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import SettingsSection from "./SettingsSection.vue";
import { useHelioStore } from "@/stores/helio";
import { describeMornings, alarmReport } from "@/utils/alarmHistory";

const props = defineProps({ open: { type: Boolean, default: false } });
defineEmits(["toggle"]);

const helio = useHelioStore();

/** How many mornings show before the fold. Three is a habit, not a history. */
const SHOWN = 3;

const history = ref(null);
const historyLoaded = ref(false);
const showAll = ref(false);
const copied = ref(false);

const mornings = computed(() => describeMornings(history.value?.mornings));
const shownMornings = computed(() =>
  showAll.value ? mornings.value : mornings.value.slice(0, SHOWN)
);

/**
 * The closed row's answer to "did it work", which is the question that used to
 * be answered by this being inline under the alarm. Costs the same plugin call
 * as opening it, so the load is no longer gated on the row being open - it is
 * gated on the LOGS card being open, one level up.
 */
const summary = computed(() => {
  if (!historyLoaded.value) return "";
  const first = mornings.value[0];
  if (!first) return "NOTHING YET";
  return first.firedAt ? `WOKE YOU ${first.firedAt}` : verdictWord(first);
});

async function loadHistory() {
  const res = await helio.alarmHistory();
  history.value = res;
  // Distinguishes "the plugin answered with nothing" from "no plugin", so the
  // empty state can say which. An older build returns null and should stay
  // silent rather than claim no alarm has ever run.
  historyLoaded.value = res != null;
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !historyLoaded.value) loadHistory();
  },
  { immediate: true }
);

/**
 * What to say when there are no mornings yet.
 *
 * **Reads the live mode from the service, never an editor's draft.** The alarm
 * panel's `mode` ref is only filled by `openEditor`, so until you tap EDIT it
 * holds its initial "fixed" whatever the alarm is actually set to - which had
 * this telling somebody with SMART selected that nothing was being watched.
 */
const emptyNote = computed(() => {
  if (history.value?.mode !== "smart") {
    return "Only the smart mode watches for light sleep, so there is nothing to record.";
  }
  if (!history.value?.enabled) {
    return "The alarm is off, so no morning is being watched.";
  }
  return "No morning has been recorded yet. The first one appears after the next time your alarm is due.";
});

/** The date as a person says it, with today and yesterday named. */
function morningDate(m) {
  if (!m.date) return m.day;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.round((midnight - m.date) / 86_400_000);
  if (days === 0) return "TODAY";
  if (days === 1) return "YESTERDAY";
  return m.date
    .toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
    .toUpperCase();
}

/**
 * One word for the outcome.
 *
 * `WOKE YOU` rather than `FIRED`: the question being answered is "did it wake
 * me", and a word that describes the machinery instead of the morning is the
 * kind of thing only the person who wrote it can read.
 */
function verdictWord(m) {
  switch (m.outcome) {
    case "fired":
      return "WOKE YOU";
    case "fired-unconfirmed":
      return "UNCONFIRMED";
    case "not-watching":
      return "NOT SMART";
    case "never-looked":
      return "DID NOT RUN";
    case "no-data":
      return "NO SLEEP DATA";
    case "stale":
      return "STRAP BEHIND";
    case "not-wakeable":
      return "LET YOU SLEEP";
    default:
      return "WATCHED";
  }
}

async function copyReport() {
  const text = alarmReport({ ...history.value, version: __APP_VERSION__ });
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // A clipboard the WebView refuses is not worth an error state here: the
    // records are on screen above and can be read out.
    copied.value = false;
  }
}
</script>

<style scoped>
.morning {
  margin-bottom: 12px;
}
.mtop {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.mdate {
  font-size: var(--set-summary);
  letter-spacing: 1px;
  color: var(--ink);
}
/* The verdict carries the only colour in the block. WOKE YOU is the good
   outcome and gets the accent; DID NOT RUN is the one genuine fault and gets
   the bad token. Everything between is dim, because a strap that was behind is
   not a failure of the alarm and colouring it as one would teach people to
   ignore the row. */
.mverdict {
  font-size: var(--set-micro);
  letter-spacing: 1px;
  color: var(--dim);
}
.mverdict.fired {
  color: var(--acc);
}
.mverdict.never-looked,
.mverdict.fired-unconfirmed {
  color: var(--bad);
}
.mtimes {
  font-size: var(--set-micro);
  letter-spacing: 1px;
  color: var(--dim);
  margin-top: 2px;
}
.mwhy {
  font-size: var(--set-micro);
  line-height: 1.5;
  color: var(--body);
  margin-top: 3px;
}
.mwhy.dim {
  color: var(--dim);
}
.databtn {
  width: 100%;
  min-height: var(--set-row-h);
  margin-top: 6px;
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
