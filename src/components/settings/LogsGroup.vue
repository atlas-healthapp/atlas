<!--
  The three things Atlas records about itself, in one card.

  **Built 2026-08-25 because two of the three were effectively unreadable.** The
  alarm mornings were the only log with a home, and it was inside ALARM. The BLE
  exchange sits behind SHOW LOG inside the strap panel, which is where you look
  when pairing fails and nowhere you would look otherwise. And the sync trail -
  sixty lines saying why every refresh ran or declined, written on every sync
  since 2026-08-14 - was surfaced nowhere at all: it existed to be read over adb,
  which means it could only ever be read by the author, on his own phone. The
  ticket it was built for is about a morning on somebody else's.

  **Last on the page, above the version row**, which is where diagnostics live
  in every app anybody has used, and pointedly not inside SETUP: that group is
  the four things you set once and never return to, and a log is the opposite -
  you go looking for it on the morning something went wrong. Same argument that
  kept HELIO STRAP out of SETUP.

  Each row's summary is its headline fact, so the card answers the three
  commonest questions before you open anything: did the alarm work, is the strap
  syncing, did the last connection fail.
-->
<template>
  <SettingsGroup
    title="LOGS"
    summary="ALARM, SYNC, STRAP"
    open-summary="3 THINGS ATLAS RECORDS"
    :open="open"
    @toggle="$emit('toggle-group')"
  >
    <MorningsPanel
      :open="openSection === 'log-mornings'"
      @toggle="$emit('toggle', 'log-mornings')"
    />

    <!-- The decisions, not the exchange. `alarm_trail` taught this lesson on the
         alarm and the sync side learned it second: a trigger that fired and
         declined is indistinguishable from one that never fired at all unless
         something writes down which it was. -->
    <SettingsSection
      nested
      title="SYNC TRAIL"
      :summary="trailSummary"
      :open="openSection === 'log-sync'"
      @toggle="$emit('toggle', 'log-sync')"
    >
      <div class="note mono">
        WHY EACH SYNC RAN OR DID NOT, NEWEST LAST. THE BACKGROUND SERVICE AND THE
        APP BOTH WRITE HERE.
      </div>
      <LogLines
        :lines="trail"
        empty="NOTHING YET. THE FIRST LINE APPEARS ON THE NEXT SYNC."
      />
    </SettingsSection>

    <!-- The strap panel keeps its own SHOW LOG: that is the pairing-failure
         moment and sending somebody to another card mid-failure is worse than a
         second way in. Both read `helio.logLines`, which is one buffer. -->
    <SettingsSection
      nested
      title="STRAP LOG"
      :summary="logSummary"
      :open="openSection === 'log-strap'"
      @toggle="$emit('toggle', 'log-strap')"
    >
      <div class="note mono">
        EVERY FRAME EXCHANGED WITH THE BAND THIS SESSION. IT STARTS EMPTY EACH
        TIME THE APP OPENS.
      </div>
      <LogLines :lines="helio.logLines" />
    </SettingsSection>

    <div class="foot">
      <!-- One button, because a bug report wants all of it and nobody pastes
           three. `diagnosticReport` already carries the version, the device, the
           last error, the exchange and the trail; the alarm records are fetched
           from the service here rather than held, since only a press needs them.

           **The pairing key is in none of it and there is a test that proves
           that**, not a comment that claims it. -->
      <button class="databtn mono" type="button" @click="copyEverything">
        {{ copied ? "COPIED" : "COPY EVERYTHING" }}
      </button>
    </div>
  </SettingsGroup>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import SettingsGroup from "./SettingsGroup.vue";
import SettingsSection from "./SettingsSection.vue";
import MorningsPanel from "./MorningsPanel.vue";
import LogLines from "./LogLines.vue";
import { useHelioStore } from "@/stores/helio";
import { alarmReport } from "@/utils/alarmHistory";

const props = defineProps({
  /** Whether the group's card is open. */
  open: { type: Boolean, default: false },
  /** The page's one-open-at-a-time section id, so this card obeys it too. */
  openSection: { type: String, default: null },
});
defineEmits(["toggle", "toggle-group"]);

const helio = useHelioStore();

/**
 * Read on open rather than held in a ref: the trail is written to storage by
 * `noteRefresh` and by nothing else, and a reactive mirror of an append-only log
 * is a second copy that can disagree with the file.
 */
const trail = ref([]);
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) trail.value = helio.syncTrail();
  },
  { immediate: true }
);

/** The time off the newest line, which is `HH:MM:SS trigger outcome`. */
const trailSummary = computed(() => {
  const last = trail.value[trail.value.length - 1];
  if (!last) return "NOTHING YET";
  const at = String(last).slice(0, 5);
  return /^\d\d:\d\d$/.test(at) ? `LAST RAN ${at}` : `${trail.value.length} LINES`;
});

const logSummary = computed(() =>
  helio.logLines.length ? `${helio.logLines.length} LINES` : "NOTHING YET"
);

const copied = ref(false);

async function copyEverything() {
  let text = helio.diagnosticReport();
  try {
    const history = await helio.alarmHistory();
    if (history) text += `\n\n${alarmReport({ ...history, version: __APP_VERSION__ })}`;
  } catch {
    // A service that will not answer should not cost you the rest of the report.
    text += "\n\nALARM HISTORY UNAVAILABLE";
  }
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // A clipboard the WebView refuses is not worth an error state: every log is
    // on screen above and is selectable by hand.
    copied.value = false;
  }
}
</script>

<style scoped>
.note {
  font-size: var(--set-label);
  line-height: 1.6;
  letter-spacing: 1px;
  color: var(--dim);
}
/* Inset to the same 26px the nested rows use, so the button lines up with the
   rows it belongs to rather than with the group's own header. */
.foot {
  padding: 4px 14px 14px 26px;
}
.databtn {
  width: 100%;
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
