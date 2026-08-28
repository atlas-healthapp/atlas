<template>
  <SettingsSection
    title="HELIO STRAP"
    :summary="statusLabel"
    :danger="failing"
    :open="open"
    @toggle="$emit('toggle')"
  >

    <!-- Not set up. The explainer, the field and the connect all live in
         StrapConnect now, shared with first run, which does its own pairing
         rather than sending you here for it. -->
    <template v-if="!helio.connected">
      <StrapConnect />
    </template>

    <template v-else>
      <div class="row">
        <span class="k mono">LAST SYNC</span>
        <span class="v">{{ lastSyncLabel }}</span>
      </div>
      <div class="row">
        <span class="k mono">STRAP BATTERY</span>
        <span class="v">{{ helio.battery == null ? "—" : helio.battery + "%" }}</span>
      </div>
      <!-- **What the percentage above cannot say.** "72%" answers "will it
           survive tonight", which is a question you ask once. "Lasting 6.2 days,
           was 9.1" answers whether the strap is wearing out, whether a firmware
           change cost you battery, or whether syncing every half hour is too
           aggressive, and Atlas sets that interval itself, so it ought to be
           able to see what it costs.

           **The verdict, then the figure behind it.** One row said BATTERY
           HEALTH over "6.2 DAYS", which is a measurement wearing a judgement's
           label and left the reader to decide for themselves whether six days
           was good. Two rows: the word answers "is this fine", the figure
           answers "how long have I got", and neither has to do the other's job.
           NOT AVAILABLE rather than a dash, because there is a real difference
           between a strap that has not been measured yet and one measured
           badly. -->
      <div class="row">
        <span class="k mono">BATTERY HEALTH</span>
        <span class="v" :style="bandStyle">{{ bandLabel }}</span>
      </div>
      <div class="row">
        <span class="k mono">A FULL CHARGE LASTS</span>
        <span class="v">{{ lifeLabel }}</span>
      </div>
      <!-- A setting on the strap rather than a reading off it, and the only
           row here you can act on. It lives in HELIO STRAP because that is what
           it is about: it shipped inside ALARM on 2026-08-25 purely because
           that is where the config read was wired, and read as a paragraph
           about walks above two alarm times.

           LOW is marked, because it is the value that silently costs you
           records - a Sunday walk left none at all - but it is still a value
           somebody may choose on purpose, so the row states it rather than
           warning about it. -->
      <button
        v-if="detection"
        class="row rowbtn"
        type="button"
        @click="detectionOpen = true"
      >
        <span class="k mono">WORKOUT DETECTION</span>
        <span class="v" :class="{ low: detection.low }">{{ detection.label }}</span>
        <span class="chev" aria-hidden="true">›</span>
      </button>

      <div v-if="basisLabel" class="dim-text mono note">{{ basisLabel }}</div>
      <div v-if="trendLabel" class="dim-text mono note">{{ trendLabel }}</div>
      <!-- **One line about the charge, not two.** "On this charge 4.3 days, now
           at 28%" sat above this and said the same thing from the other end,
           so the block reported one run twice and the reader had to work out
           that they were the same charge. -->
      <div v-if="lastChargedLabel" class="dim-text mono note">{{ lastChargedLabel }}</div>

      <!-- **BACKGROUND · EVERY 30 MIN came off on 2026-08-20.** It was the one
           row here that stated a constant rather than a reading, and a fixed
           number is exactly what it is not: the interval already shortens for the
           sleep probe and for the smart alarm's window, so the row was reporting
           something that had stopped being true. Nothing acts on it either - it
           is not a setting, and there is no control anywhere to change it - so it
           said a number at somebody who could do nothing with it. -->

      <!-- **A rejected key is not a failed sync and must not read like one.**
           Every other failure here fixes itself on the next run: out of range,
           the link busy because the Zepp app has the band, a close mid-sync. This
           one never does. It means the strap was paired somewhere else - which is
           what happens when somebody logs out of Zepp and lets it re-bind the
           band - and Atlas will fail every connect until it is paired again. It
           is the only failure on this panel the reader has to do something about,
           so it says what happened and what to do rather than printing the
           protocol's own words at them. -->
      <div v-if="helio.authRejected" class="mono authgone">
        <div class="authhd">THE STRAP NO LONGER ACCEPTS THIS PAIRING</div>
        <p class="authbody">
          Something else has paired with it since, which is usually the Zepp app
          being signed out of and back in. Atlas cannot read the band until you
          pair it again below. Nothing already collected is affected.
        </p>
      </div>

      <div v-else-if="failing" class="dim-text mono err">
        {{ helio.lastSyncError.toUpperCase() }}
      </div>

      <div class="btnrow">
        <button
          class="databtn mono primary"
          :disabled="helio.syncing"
          @click="doSync"
        >
          {{ syncLabel }}
        </button>
        <button class="databtn mono" @click="doDisconnect">DISCONNECT</button>
      </div>
      <div v-if="helio.syncing" class="dim-text mono note">{{ phaseLabel }}</div>

    </template>

    <!-- **Outside both branches, so it exists before you have ever connected.**
         This sat inside the `v-else` above, which renders only once `connected`
         is true: the one person who most needs a log, somebody whose first
         connect keeps failing, was the one person structurally unable to open
         one. It is still folded away by default - a permanent wall of hex frames
         makes a working app look broken - but the row that opens it is always
         reachable, and COPY DETAILS is what turns "it says it could not connect"
         into a report that can be acted on. -->
    <div class="btnrow">
      <button class="databtn mono quiet" @click="showLog = !showLog">
        {{ showLog ? "HIDE LOG" : "SHOW LOG" }}
      </button>
      <button class="databtn mono quiet" @click="copyDetails">
        {{ copied ? "COPIED" : "COPY DETAILS" }}
      </button>
    </div>

    <LogLines v-if="showLog" :lines="helio.logLines" />

    <Transition name="toast">
      <div v-if="message" class="msg mono">{{ message }}</div>
    </Transition>
    <DetectionSheet
      v-if="detectionOpen"
      :current="bandConfig.detectionSensitivity"
      @close="detectionOpen = false"
      @saved="onDetectionSaved"
    />
  </SettingsSection>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useHelioStore } from "@/stores/helio";
import { getSamples } from "@/utils/sampleDb";
import { batteryLife, formatDays, lifeBand } from "@/utils/strapHealth";
import SettingsSection from "./SettingsSection.vue";
import LogLines from "./LogLines.vue";
import DetectionSheet from "./DetectionSheet.vue";
import StrapConnect from "./StrapConnect.vue";

// Open state is owned by the settings page, not here, so only one section can be
// open at a time across all of them.
// Captured rather than discarded: the battery history is loaded when the section
// is opened, so the script needs to read `open` and not only the template.
const props = defineProps({ open: { type: Boolean, default: false } });
defineEmits(["toggle"]);

const helio = useHelioStore();

// ── the strap's own settings ───────────────────────────────────────────────
//
// Read from the band on every sync (HelioConfig, endpoint 0x000a) and cached
// natively, so this reads a mirror rather than talking to the strap itself.

const DETECTION_LABELS = ["HIGH", "STANDARD", "LOW"];
const detectionOpen = ref(false);
const bandConfig = ref({ detectionSensitivity: -1 });

/**
 * What to show on the row, or null while the band has said nothing.
 *
 * Withheld rather than defaulted: -1 is "not asked yet" and it has to be told
 * apart from HIGH, which is 0. A default here would be the app asserting a
 * setting it has never read, which is the whole thing the read exists to stop.
 */
const detection = computed(() => {
  const level = bandConfig.value.detectionSensitivity;
  if (level < 0 || level > 2) return null;
  return { label: DETECTION_LABELS[level], low: level === 2 };
});

async function loadBandConfig() {
  const res = await helio.alarmHistory();
  if (!res) return;
  bandConfig.value = { detectionSensitivity: res.detectionSensitivity ?? -1 };
}

/** The strap has accepted it, so the row can show the new value at once. */
function onDetectionSaved(level) {
  detectionOpen.value = false;
  bandConfig.value = { detectionSensitivity: level };
}

// Loaded when the panel opens, and again after a sync: a sync is when the band
// reports this, and when a queued change actually goes out.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) loadBandConfig();
  },
  { immediate: true }
);
watch(
  () => helio.lastSyncAt,
  () => {
    if (props.open) loadBandConfig();
  }
);

const keyDraft = ref("");

/**
 * Where the key comes from. Shown as text rather than linked: this WebView has
 * no browser chrome to come back from, and the step is done on a computer
 * anyway, which is where the page tells you to be.
 */
const TOKEN_GUIDE = "gadgetbridge.org/basics/pairing/huami-xiaomi-server";

/**
 * 32 hex characters, which is the 16-byte key written out.
 *
 * Checked here rather than discovered by the band, because the alternative is a
 * BLE connect that wakes the strap, spends its battery, fails, and reports it as
 * a sync error that says nothing about a mistyped character. `0x` prefixes and
 * separators are stripped rather than rejected, since every place you can copy
 * this from formats it differently.
 */
const cleanedKey = computed(() =>
  keyDraft.value.trim().replace(/^0x/i, "").replace(/[\s:-]/g, "")
);
const keyLooksRight = computed(() => /^[0-9a-f]{32}$/i.test(cleanedKey.value));
const keyProblem = computed(() => {
  const k = cleanedKey.value;
  if (!/^[0-9a-f]*$/i.test(k)) return "THAT HAS CHARACTERS THAT ARE NOT 0-9 OR A-F IN IT.";
  if (k.length < 32) return `THAT IS ${k.length} CHARACTERS. IT SHOULD BE 32.`;
  return `THAT IS ${k.length} CHARACTERS. IT SHOULD BE 32.`;
});
const showLog = ref(false);
const message = ref("");
const copied = ref(false);

async function copyDetails() {
  try {
    await navigator.clipboard.writeText(helio.diagnosticReport());
    copied.value = true;
    setTimeout(() => (copied.value = false), 3000);
  } catch {
    // Same fallback as StrapConnect: open the log so it can be selected by hand
    // rather than leaving a button that silently did nothing.
    showLog.value = true;
    flash("COULD NOT COPY. SELECT THE LOG BELOW INSTEAD.");
  }
}

const failing = computed(() => Boolean(helio.lastSyncError));

const statusLabel = computed(() => {
  if (helio.connecting) return "CONNECTING";
  if (!helio.connected) return "NOT CONNECTED";
  if (helio.syncing) return "SYNCING";
  if (failing.value) return "NOT SYNCING";
  return "CONNECTED";
});

const syncLabel = computed(() => {
  if (helio.syncing) return "SYNCING…";
  return failing.value ? "TRY AGAIN" : "SYNC NOW";
});

/**
 * What the connect is actually doing, under the button that started it.
 *
 * A reconnect takes the best part of a minute: the strap has to be woken, and
 * the fetch then runs through samples, sleep and sessions. A button that says
 * CONNECTING… and nothing else for that long reads as a button that did not
 * work, and the user's report was exactly that (2026-08-12: "thought it hadn't
 * worked for 5 seconds"). This is the same fix Home's header already carries,
 * for the same reason, and it reuses the same phases so the two cannot describe
 * one sync differently.
 *
 * Falls back to the first phase rather than to an empty line, because the gap
 * this closes is at the very start, before the store has published anything.
 */
const phaseLabel = computed(() => helio.syncPhase || "WAKING THE STRAP");

/**
 * Relative, because "10:04" is only useful if you also know today's date and
 * that the sync was today. "4 min ago" answers the actual question, which is
 * whether the numbers on the rings are current.
 */
const lastSyncLabel = computed(() => {
  if (!helio.lastSyncAt) return "NEVER";
  const mins = Math.floor((Date.now() - helio.lastSyncAt) / 60000);
  if (mins < 1) return "JUST NOW";
  if (mins < 60) return `${mins} MIN AGO`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} HOUR${hours === 1 ? "" : "S"} AGO`;
  const days = Math.floor(hours / 24);
  return `${days} DAY${days === 1 ? "" : "S"} AGO`;
});

/* ── how long the battery is lasting ──────────────────────────────────── */

/**
 * Half a year of battery readings.
 *
 * Long enough to hold a run of charges even on a strap that lasts a fortnight,
 * and cheap: this is one reading per sync rather than the hundreds a minute the
 * real metrics arrive at.
 *
 * **Read when the section is opened, not on mount.** Settings is a list of
 * closed rows now, so a drawer opened to change the theme should not touch
 * IndexedDB for a figure nobody asked to see.
 */
const HISTORY_DAYS = 186;
const batteryReadings = ref([]);
const chargeTimes = ref([]);

async function loadBattery() {
  const to = Date.now() + 1;
  const from = to - HISTORY_DAYS * 24 * 60 * 60 * 1000;
  try {
    const [levels, charges] = await Promise.all([
      getSamples("strapBattery", from, to),
      getSamples("strapCharging", from, to),
    ]);
    batteryReadings.value = levels;
    chargeTimes.value = charges.map((c) => c.t);
  } catch {
    // A settings row is not worth an error state. It simply says it is still
    // working out the rate, which is true.
    batteryReadings.value = [];
    chargeTimes.value = [];
  }
}

const life = computed(() => batteryLife(batteryReadings.value, chargeTimes.value));

/**
 * Three states, and each one says something rather than going blank.
 *
 * A settled rate takes two complete discharges, which on a strap lasting a week
 * is a fortnight of an empty row. So a single run that has gone far enough is
 * reported with a `~`, and the line under it says what it is based on: "at this
 * rate, six days" is a true statement about the run in hand, where a settled
 * figure would be a claim about the strap that one run cannot support.
 */
const lifeLabel = computed(() => {
  const out = life.value;
  if (out.state === "ready") return formatDays(out.days);
  if (out.state === "provisional") return `~${formatDays(out.days)}`;
  return "MEASURING";
});

/**
 * The verdict word, or an honest absence.
 *
 * A provisional figure still earns a band: the band is a judgement about the
 * rate, and the rate is the thing being measured whether or not a second charge
 * has confirmed it. The `~` on the figure beside it already says how firm it is.
 */
const band = computed(() => lifeBand(life.value?.days));
const bandLabel = computed(() => band.value?.label ?? "NOT AVAILABLE");
const bandStyle = computed(() =>
  band.value ? { color: `var(${band.value.token})` } : {}
);

const basisLabel = computed(() => {
  const out = life.value;
  if (out.state === "provisional") {
    // **"Discharge" for the measurement, "charge" for the event.** This said
    // "FROM ONE CHARGE. SETTLES AFTER THE NEXT ONE." under a headline reading
    // "~11.1 DAYS", and the word was doing two jobs at once: the headline means
    // one charge LASTS eleven days, the sub-line meant the figure was measured
    // FROM one charge. Reported as a very confusing sentence, which it was.
    //
    // "Run" was the first replacement and it is worse, not better: it is this
    // file's own jargon for a discharge segment and means nothing to a reader.
    // The "early estimate" sub-line came off on 2026-08-25. BATTERY HEALTH
    // above already says MEASURING while the figure is provisional, so this
    // was a second hedge about the same number.
    return "";
  }
  if (out.state === "calibrating") {
    return batteryReadings.value.length
      ? "NOT ENOUGH OF A DISCHARGE TO MEASURE YET. IT NEEDS 15% OVER SIX HOURS."
      : "NO BATTERY HISTORY YET. IT IS RECORDED ON EVERY SYNC.";
  }
  // **How much discharge, not just how many charges.** "Measured across 2
  // charges" sounds settled while saying nothing about the evidence, and the
  // figure is an extrapolation to a full 100%: two runs of 16% each is a very
  // different claim from two of 70%. Reported as too high against the vendor's
  // 10 days, and the honest answer is to show what it is built on rather than
  // to quietly tune the number.
  return `MEASURED ACROSS ${out.usable} CHARGES, ${Math.round(out.basisDrop)}% OF DISCHARGE.`;
});

const trendLabel = computed(() => {
  const trend = life.value?.trend;
  if (!trend) return "";
  // A tenth of a day is inside the noise of a percentage that moves in whole
  // points, so a change smaller than half a day is not reported at all.
  if (Math.abs(trend.change) < 0.5) return "STEADY ACROSS YOUR LAST FEW CHARGES.";
  const way = trend.change < 0 ? "DOWN FROM" : "UP FROM";
  return `${way} ${formatDays(trend.previous)} BEFORE THAT.`;
});

// `currentLabel` was here: "ON THIS CHARGE 4.3 DAYS, NOW AT 28%". Removed
// 2026-08-18 as a second telling of the run that `lastChargedLabel` already
// describes - one from its start, one from its end - which made the block
// report a single charge twice.

/**
 * When it was last charged, and how full it got.
 *
 * **Replaces a per-sync drain figure**, which was measured honestly and still
 * told you nothing you could act on: 0.1% a sync is inside the noise of a
 * percentage that moves in whole points, and nobody decides anything from it.
 * When the strap last came off the cable, and how full it got, is a fact you can
 * check against your own memory - which is what makes it worth a line.
 *
 * Read off the run in progress: its start IS the charge that began it.
 */
const lastChargedLabel = computed(() => {
  const run = life.value?.current;
  if (!run) return "";
  const days = (Date.now() - run.from) / (24 * 60 * 60 * 1000);
  if (!Number.isFinite(days) || days < 0) return "";
  // Hours under a day: "0.2 DAYS AGO" is a worse way of saying five hours.
  const when =
    days < 1
      ? `${Math.max(1, Math.round(days * 24))}H AGO`
      : `${days.toFixed(1)} DAYS AGO`;
  return `LAST CHARGED ${when}, TO ${Math.round(run.fromPct)}%.`;
});

// Opening the section is what asks for the figure; a sync that just finished is
// what makes it worth reading again.
watch(
  () => [props.open, helio.lastSyncAt],
  ([isOpen]) => {
    if (isOpen) loadBattery();
  },
  { immediate: true }
);

onMounted(async () => {
  await helio.hydrate();
  keyDraft.value = helio.authKey;
});

// **The log is the store's now, not this panel's.** It was collected here, into
// a buffer that started empty when the section was opened and lived inside the
// branch that only renders once `connected` is true - so it never held the
// attempt you opened it to look at, and somebody whose first connect was failing
// could not reach it at all. One buffer, always collecting, both panels read it.
function flash(text) {
  message.value = text;
  setTimeout(() => (message.value = ""), 4000);
}

async function doConnect() {
  try {
    // The cleaned form, so a key pasted with `0x`, spaces or colons in it
    // connects rather than being stored verbatim and failing at the handshake.
    helio.setAuthKey(cleanedKey.value);
    const res = await helio.connect();
    flash(`CONNECTED. ${res.days} DAY${res.days === 1 ? "" : "S"} IMPORTED`);
  } catch (e) {
    flash("COULD NOT CONNECT: " + (e?.message || String(e)).toUpperCase());
  }
}

async function doSync() {
  try {
    const res = await helio.sync(3);
    if (!res) return;
    flash(res.days === 0 ? "UP TO DATE" : `SYNCED - ${res.days} DAYS UPDATED`);
  } catch (e) {
    flash("SYNC FAILED - " + (e?.message || String(e)).toUpperCase());
  }
}

async function doDisconnect() {
  await helio.disconnect();
  flash("DISCONNECTED");
}
</script>

<style scoped>
/* A row you can act on, among rows you cannot. Keeps `.row`'s layout and only
   undoes what a <button> brings with it. */
.rowbtn {
  min-height: var(--set-row-h);
  width: 100%;
  background: none;
  border: none;
  padding: 9px 0;
  text-align: left;
}
/* `.row` is space-between, so a third child lands the value in the MIDDLE of
   the row instead of against the right edge where every other value sits.
   Pushing the value over groups it with the chevron. */
.rowbtn .v {
  margin-left: auto;
}
.rowbtn .chev {
  color: var(--dim);
  font-size: var(--set-value);
  margin-left: 8px;
}
/* LOW is the value that silently costs you records. Marked rather than warned
   about: it is still a value somebody may choose on purpose. */
.rowbtn .v.low {
  color: var(--bad);
}

.panel-hd /* Its own treatment, because it is the one message here that is an instruction
   rather than a report. --bad for the heading; the body stays readable prose
   rather than a second line of shouting mono. */
.authgone {
  border: 1px solid color-mix(in srgb, var(--bad) 45%, transparent);
  border-radius: 8px;
  padding: 12px 13px;
  margin-top: 10px;
}
.authhd {
  font-size: var(--fs-label);
  letter-spacing: 1.4px;
  color: var(--bad);
}
.authbody {
  font-family: var(--font-sans);
  font-size: var(--fs-second);
  line-height: 1.5;
  color: var(--body);
  margin: 8px 0 0;
  text-transform: none;
  letter-spacing: 0;
}
.err {
  color: var(--bad);
}
.dim-text {
  color: var(--dim);
  font-size: var(--set-label);
  line-height: 1.6;
  letter-spacing: 0.05em;
  margin-bottom: 10px;
}
.dim-text/* Its own treatment, because it is the one message here that is an instruction
   rather than a report. --bad for the heading; the body stays readable prose
   rather than a second line of shouting mono. */
.authgone {
  border: 1px solid color-mix(in srgb, var(--bad) 45%, transparent);
  border-radius: 8px;
  padding: 12px 13px;
  margin-top: 10px;
}
.authhd {
  font-size: var(--fs-label);
  letter-spacing: 1.4px;
  color: var(--bad);
}
.authbody {
  font-family: var(--font-sans);
  font-size: var(--fs-second);
  line-height: 1.5;
  color: var(--body);
  margin: 8px 0 0;
  text-transform: none;
  letter-spacing: 0;
}
.err {
  color: var(--bad);
  margin-top: 8px;
  margin-bottom: 0;
}
.dim-text.note {
  margin-top: 8px;
  margin-bottom: 0;
}
/* Real height rather than padding scraps. Measured at 23px before this, well
   under Android's 48dp minimum - and these rows carry the smallest type on the
   surface, so they were the hardest to both read and hit. */
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: var(--set-row-h);
  padding: 3px 0;
}
.k {
  font-size: var(--set-label);
  letter-spacing: 1.4px;
  color: var(--dim);
}
.v {
  font-size: var(--set-value);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.keyfield {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 8px;
  padding: 9px;
  background: var(--bg0);
  border: 1px solid var(--dim);
  color: var(--ink);
  font-size: var(--set-label);
  letter-spacing: 0.08em;
}
.keyfield:focus {
  outline: none;
  border-color: var(--acc);
}
.keyfield.bad {
  border-color: var(--bad);
}

/* The one-off setup, as numbered steps. Two devices are involved and the order
   matters, which a paragraph cannot carry. */
.steps {
  list-style: none;
  margin: 10px 0 6px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.steps li {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  font-size: var(--set-label);
  letter-spacing: 0.9px;
  line-height: 1.5;
  color: var(--dim);
}
.sn {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid currentColor;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--set-label);
  opacity: 0.85;
  margin-top: 1px;
}
/* Selectable, since the whole point of it is being typed somewhere else. */
.url {
  color: var(--ink);
  font-weight: 400;
  user-select: all;
  overflow-wrap: anywhere;
}
.btnrow {
  display: flex;
  gap: 8px;
  margin-top: 10px;
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
.databtn.quiet {
  color: var(--dim);
}
.databtn:disabled {
  opacity: 0.4;
  cursor: default;
}
.databtn:active:not(:disabled) {
  background: color-mix(in srgb, var(--acc) 12%, transparent);
}
.msg {
  margin-top: 10px;
  font-size: var(--set-label);
  letter-spacing: 1px;
  color: var(--acc);
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
}
</style>
