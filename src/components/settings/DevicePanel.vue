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
      <div v-if="basisLabel" class="dim-text mono note">{{ basisLabel }}</div>
      <div v-if="trendLabel" class="dim-text mono note">{{ trendLabel }}</div>
      <div v-if="currentLabel" class="dim-text mono note">{{ currentLabel }}</div>
      <div class="row">
        <span class="k mono">BACKGROUND</span>
        <span class="v">EVERY 30 MIN</span>
      </div>
      <!-- The open question this ticket was raised to answer. Reported as
           percent per sync rather than as a share of the drain, because a single
           interval gives one number with nothing to compare it against: it
           becomes evidence the moment the interval changes, and until then it
           says what it measured rather than implying a cause. -->
      <div v-if="perSyncLabel" class="dim-text mono note">{{ perSyncLabel }}</div>

      <div v-if="failing" class="dim-text mono err">
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

      <!-- Only offered once something has gone wrong. A permanent wall of hex
           frames makes a working app look broken, but the moment a sync fails
           it is the only thing worth having. -->
      <div v-if="failing || showLog" class="btnrow">
        <button class="databtn mono quiet" @click="showLog = !showLog">
          {{ showLog ? "HIDE LOG" : "SHOW LOG" }}
        </button>
      </div>

      <div v-if="showLog" ref="logEl" class="log mono">
        <div
          v-for="(line, i) in lines"
          :key="i"
          :class="{ err: line.startsWith('!') }"
        >
          {{ line }}
        </div>
        <div v-if="!lines.length" class="dim-text">
          NOTHING YET. RUN A SYNC TO SEE THE EXCHANGE.
        </div>
      </div>
    </template>

    <Transition name="toast">
      <div v-if="message" class="msg mono">{{ message }}</div>
    </Transition>
  </SettingsSection>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { registerPlugin } from "@capacitor/core";
import { useHelioStore } from "@/stores/helio";
import { getSamples } from "@/utils/sampleDb";
import { batteryLife, drainPerSync, formatDays, lifeBand } from "@/utils/strapHealth";
import SettingsSection from "./SettingsSection.vue";
import StrapConnect from "./StrapConnect.vue";

// Open state is owned by the settings page, not here, so only one section can be
// open at a time across all of them.
// Captured rather than discarded: the battery history is loaded when the section
// is opened, so the script needs to read `open` and not only the template.
const props = defineProps({ open: { type: Boolean, default: false } });
defineEmits(["toggle"]);

const HelioBle = registerPlugin("HelioBle");

const helio = useHelioStore();

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
const lines = ref([]);
const message = ref("");
const logEl = ref(null);

let handle = null;

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
    return out.fromCurrentRun
      ? "AT THE RATE OF THIS CHARGE SO FAR. SETTLES AFTER THE NEXT ONE."
      : "FROM ONE CHARGE. SETTLES AFTER THE NEXT ONE.";
  }
  if (out.state === "calibrating") {
    return batteryReadings.value.length
      ? "NOT ENOUGH OF A DISCHARGE TO MEASURE YET. IT NEEDS 15% OVER SIX HOURS."
      : "NO BATTERY HISTORY YET. IT IS RECORDED ON EVERY SYNC.";
  }
  return `MEASURED ACROSS ${out.usable} CHARGES.`;
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

const currentLabel = computed(() => {
  const run = life.value?.current;
  if (!run || run.hours < 1) return "";
  const days = (run.hours / 24).toFixed(1);
  return `ON THIS CHARGE ${days} DAYS, NOW AT ${Math.round(run.toPct)}%.`;
});

const perSyncLabel = computed(() => {
  const per = drainPerSync(batteryReadings.value, chargeTimes.value, 30);
  if (per == null) return "";
  return `ABOUT ${per.toFixed(2)}% PER SYNC, MEASURED.`;
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

  handle = await HelioBle.addListener("bleLog", ({ message: line }) => {
    if (!line) return;
    lines.value.push(line);
    // Bounded: a multi-day fetch emits hundreds of lines and the oldest are
    // never the interesting ones.
    if (lines.value.length > 300) lines.value.splice(0, lines.value.length - 300);
    nextTick(() => {
      if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
    });
  });
});

onUnmounted(() => {
  if (handle) handle.remove();
});

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
.panel-hd .err {
  color: var(--bad);
}
.dim-text {
  color: var(--dim);
  font-size: 10px;
  line-height: 1.6;
  letter-spacing: 0.05em;
  margin-bottom: 10px;
}
.dim-text.err {
  color: var(--bad);
  margin-top: 8px;
  margin-bottom: 0;
}
.dim-text.note {
  margin-top: 8px;
  margin-bottom: 0;
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 3px 0;
}
.k {
  font-size: 9.5px;
  letter-spacing: 1.4px;
  color: var(--dim);
}
.v {
  font-size: 13px;
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
  font-size: 10px;
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
  font-size: 10.5px;
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
  font-size: 9px;
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
  min-height: 44px;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--dim) 65%, transparent);
  color: var(--ink);
  font-size: 10px;
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
.log {
  margin-top: 10px;
  max-height: 220px;
  overflow-y: auto;
  /* Frame dumps are wide and fixed-width; wrapping them makes the columns
     unreadable, so the log scrolls sideways instead of the page doing it. */
  overflow-x: auto;
  background: var(--bg0);
  border: 1px solid var(--dim);
  padding: 8px;
  font-size: 9px;
  line-height: 1.5;
  white-space: pre;
  color: var(--body);
}
.log .err {
  color: var(--bad);
}
.msg {
  margin-top: 10px;
  font-size: 10px;
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
