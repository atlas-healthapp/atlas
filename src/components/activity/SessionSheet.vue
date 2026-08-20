<!--
  Starting and stopping a session Atlas times itself.

  **One sheet with two states, behind one node.** The ACTIVITY node cannot offer
  to start a second session while one is running, so rather than an arc whose
  nodes change meaning, the same sheet shows either the start form or the session
  in progress. Which state it is in is a property of the store, not of how you
  got here.

  **The type picker is the one that already exists.** `ManualSessionSheet` has a
  WHAT field and a `.picker` button that opens `SessionTypeSheet`, which already
  does search, add-a-type and a SUGGESTED list. Reusing both is what keeps one
  type picker in Atlas rather than two that drift apart, which is the failure this
  codebase has paid for repeatedly. It costs a tap against "tapping a type starts
  it", and that tap is bought back by opening pre-filled with your last type.
-->
<template>
  <Teleport to="body">
    <div class="sheetwrap" @click.self="$emit('close')">
      <div class="sheet grid-bg">
        <div class="panel-hd">
          <span>{{ running ? "SESSION RUNNING" : "START A SESSION" }}</span>
          <span @click="$emit('close')">[ CLOSE ]</span>
        </div>

        <!-- ── Running ────────────────────────────────────────────────── -->
        <template v-if="running">
          <div class="elapsed mono">{{ elapsedLabel }}</div>
          <div class="submeta mono">{{ runningMeta }}</div>

          <!-- **Live heart rate, and only while this sheet is open.**
               `HelioLink` has held the protocol for this since the spike and the
               backlog wrote down the rule for bringing it back: a screen may hold
               the radio only if the reading is the reason you opened it and you
               cannot get it any other way. This sheet is the strongest case that
               rule has had - you opened it to watch a session - and it is also
               why the stream is NOT held for the whole session. The strap takes
               one central at a time and the band needs a keepalive every second
               to keep its sensor awake, so a 45-minute stream would spend real
               battery for a number nobody is looking at. Open the sheet and it
               reads; close it and the radio goes back. -->
          <div v-if="liveBpm" class="live">
            <div class="liverow">
              <span class="livebpm mono">{{ liveBpm }}</span>
              <span class="liveunit mono">BPM</span>
              <span v-if="zoneName" class="livezone mono">{{ zoneName }}</span>
            </div>
            <!-- Drawn only when there is a maximum to draw it against, which
                 needs a date of birth. A strip with no scale would be five
                 coloured boxes meaning nothing. -->
            <template v-if="zoneBands.length">
              <div class="caretrow">
                <span class="caret" :style="{ left: caretLeft }">▼</span>
              </div>
              <div class="strip">
                <span
                  v-for="(z, i) in zoneBands"
                  :key="z.name"
                  class="seg"
                  :class="`z${i + 1}`"
                  :style="{ opacity: zoneIndex === i + 1 ? 1 : 0.4 }"
                />
              </div>
              <!-- **Both ends printed**, because the axis does not start at zero:
                   it runs from half of maximum, and an axis that hides that is
                   the defect nightlyBars carries a warning about. -->
              <div class="stripends mono">
                <span>{{ zoneBands[0].from }}</span>
                <span>{{ zoneBands.at(-1).to }}</span>
              </div>
            </template>
          </div>
          <div v-else-if="liveWanted" class="dim-text mono note">READING THE STRAP…</div>

          <!-- Changeable while it runs, because the commonest correction is
               having started the right activity under the wrong name. -->
          <label class="field">
            <span class="flab mono">WHAT</span>
            <button type="button" class="picker mono" @click="typeOpen = true">
              {{ typeName ?? "NO TYPE" }}
              <span class="chev">›</span>
            </button>
          </label>

          <!-- **Says what is not knowable yet rather than showing blanks.** A
               blank where a figure belongs reads as a failure, and at this moment
               nothing is wrong: the band has simply not handed the window over.

               **Worded around the timing, not the source.** It said the figures
               "come off the strap after you stop", which stops being true the
               moment a live reading appears on this same sheet: the strap is the
               source either way, and what actually changes is when Atlas can see
               it. This sentence survives that. -->
          <div class="dim-text mono note">
            THE FULL HEART RATE AND CALORIES ARRIVE ON THE FIRST SYNC AFTER YOU
            STOP.
          </div>

          <div class="btnrow">
            <button type="button" class="action stop mono" @click="doStop">STOP</button>
            <button type="button" class="action mono" @click="confirmCancel = true">
              DISCARD
            </button>
          </div>

          <!-- Asked, because discarding is the one act here that destroys
               something nothing can rebuild: the start time. -->
          <div v-if="confirmCancel" class="confirm">
            <div class="dim-text mono note">
              THROW AWAY {{ elapsedLabel }} AND RECORD NOTHING?
            </div>
            <div class="btnrow">
              <button type="button" class="action danger mono" @click="doCancel">
                DISCARD IT
              </button>
              <button type="button" class="action mono" @click="confirmCancel = false">
                KEEP GOING
              </button>
            </div>
          </div>
        </template>

        <!-- ── Not running ────────────────────────────────────────────── -->
        <template v-else>
          <p class="intro">
            Atlas times it. Heart rate and calories come off the strap afterwards.
          </p>

          <label class="field">
            <span class="flab mono">WHAT</span>
            <button type="button" class="picker mono" @click="typeOpen = true">
              {{ typeName ?? "PICK A TYPE" }}
              <span class="chev">›</span>
            </button>
          </label>

          <div class="btnrow">
            <button type="button" class="action save mono" @click="doStart">START</button>
          </div>

          <!-- The other way a session gets recorded, kept as a labelled row
               rather than a second node on the create arc. Same treatment
               MealPickSheet gives SCAN and QUICK ADD. -->
          <button type="button" class="wayin mono" @click="$emit('record-earlier')">
            RECORD ONE I ALREADY DID
            <span class="sub">TYPED TIMES</span>
          </button>
        </template>

        <SessionTypeSheet
          v-if="typeOpen"
          :current-type-id="typeId"
          @pick="onPickType"
          @close="typeOpen = false"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useSessionsStore } from "@/stores/sessions";
import { useHelioStore } from "@/stores/helio";
import { useProfileStore } from "@/stores/profile";
import { maxHeartRate, zoneOf, zonePosition, zones } from "@/utils/hrZones";
import SessionTypeSheet from "./SessionTypeSheet.vue";

const emit = defineEmits(["close", "started", "stopped", "record-earlier"]);
const sessions = useSessionsStore();
const helio = useHelioStore();
const profile = useProfileStore();

const running = computed(() => sessions.running);
const typeOpen = ref(false);
const confirmCancel = ref(false);

/**
 * Pre-filled with the last type used, so the ordinary case is one tap on START.
 *
 * Read from the newest annotation that carries one rather than from the type
 * list, because "the last thing I did" is a better guess than "the first
 * alphabetically" and costs nothing to work out.
 */
const lastTypeId = computed(() => {
  const withType = sessions.sessions
    .filter((s) => s.typeId)
    .sort((a, b) => b.startMillis - a.startMillis);
  return withType[0]?.typeId ?? null;
});

const draftTypeId = ref(null);
const typeId = computed(() =>
  running.value ? running.value.typeId : (draftTypeId.value ?? lastTypeId.value)
);
const typeName = computed(() => sessions.typeById(typeId.value)?.name ?? null);

/**
 * A clock that ticks while the sheet is open.
 *
 * A plain `setInterval` is right here and a `requestAnimationFrame` loop is not:
 * this updates once a second, and rAF would wake sixty times for it. The shade's
 * copy of this number is a `Chronometer`, which the system ticks in its own
 * process, so nothing here has to run while the app is closed.
 */
const now = ref(Date.now());
const tick = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(tick));

const elapsedLabel = computed(() => {
  if (!running.value) return "";
  const seconds = Math.max(0, Math.floor((now.value - running.value.startMillis) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
});

const runningMeta = computed(() => {
  if (!running.value) return "";
  const started = new Date(running.value.startMillis).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return [typeName.value?.toUpperCase(), `STARTED ${started}`].filter(Boolean).join(" · ");
});

/**
 * Hold the radio while this sheet shows a running session, and give it back the
 * moment it does not.
 *
 * Reference counted in the store, so this cannot strand the stream if something
 * else is also watching. Failures are silent: a live reading is a nicety on a
 * sheet whose job is starting and stopping, and a strap that will not stream
 * must not stop you pressing STOP.
 */
/**
 * **Read from the service, never streamed here.**
 *
 * This sheet used to open its own live stream. The strap takes one BLE central
 * at a time and the background service holds one whenever the screen is on and a
 * session is running, so the two fought and the app lost every time: the sheet
 * sat on READING THE STRAP indefinitely, the app's own sync failed link-busy, and
 * the shade - fed by the process that had won - was the only surface showing
 * anything. Reported exactly that way.
 *
 * One owner of the radio, every surface reading what it publishes. Polling is
 * right rather than lazy: the value is written to SharedPreferences by another
 * process, so there is nothing to subscribe to, and a second is the rate the band
 * produces readings at anyway.
 */
const liveWanted = computed(() => Boolean(running.value) && helio.connected);
const live = ref({ bpm: null, at: null });
const liveBpm = computed(() => live.value.bpm);

let livePoll = null;
watch(
  liveWanted,
  (wanted) => {
    clearInterval(livePoll);
    livePoll = null;
    if (!wanted) {
      live.value = { bpm: null, at: null };
      return;
    }
    const read = async () => {
      live.value = await helio.liveHeartRateReading();
    };
    read();
    livePoll = setInterval(read, 1000);
  },
  { immediate: true }
);
onBeforeUnmount(() => clearInterval(livePoll));

const maxHr = computed(() => maxHeartRate({ ageYears: profile.age ?? null }));
const zoneBands = computed(() => (maxHr.value ? zones(maxHr.value) : []));
const zoneIndex = computed(() => zoneOf(liveBpm.value, maxHr.value));
const zoneName = computed(() =>
  zoneIndex.value ? `ZONE ${zoneIndex.value} · ${zoneBands.value[zoneIndex.value - 1].name}` : null
);
const caretLeft = computed(() => {
  const p = zonePosition(liveBpm.value, maxHr.value);
  return p == null ? "0%" : `${(p * 100).toFixed(1)}%`;
});

function onPickType(id) {
  if (running.value) sessions.setRunningType(id);
  else draftTypeId.value = id;
  typeOpen.value = false;
}

function doStart() {
  // A trail belongs to one session. Yesterday's readings carried into today's
  // recap would draw a chart of two different afternoons joined in the middle.
  helio.clearSessionHeartTrail();
  const started = sessions.startSession(typeId.value);
  if (started) emit("started", started);
}

function doStop() {
  const result = sessions.stopSession();
  // **A sync is asked for immediately, and it must bypass the rate limit.** The
  // heart rate and calories for this window are on the band, and the ten-minute
  // limit is measured against a `lastSyncAt` the background service also moves,
  // so on a phone whose service is running normally an unforced request here
  // would simply be declined and the row would sit empty until something else
  // happened to sync. Same reasoning as the deep-fetch exemption.
  //
  // Fire and forget: the figures arrive through the watcher in App.vue whenever
  // they arrive, so nothing here waits on a BLE round trip to close a sheet.
  if (result) helio.refresh({ force: true, trigger: "session-stopped" }).catch(() => null);
  // Null when it was under a minute, which is discarded rather than stored. The
  // sheet still closes: the session is over either way, and an error about a
  // session too short to matter is noise.
  emit("stopped", result);
}

function doCancel() {
  sessions.cancelSession();
  confirmCancel.value = false;
  emit("close");
}
</script>

<style scoped>
.sheetwrap {
  position: fixed;
  inset: 0;
  /* **700, matching ManualSessionSheet**, and this is load-bearing rather than
     copied. The tab bar is 100 and the create button is 110, so a sheet below
     those has its lowest rows covered by them: at 60 the STOP and DISCARD
     buttons sat underneath the tab bar, and a tap on STOP went to the tab bar
     instead. The sheet still looked completely correct, because the bar draws a
     translucent surface over the bottom of it. Found by asking
     elementFromPoint what was actually on top of the button, not by looking. */
  z-index: 700;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.55);
}
.sheet {
  width: 100%;
  max-height: 88vh;
  overflow: auto;
  padding: 14px 16px calc(20px + env(safe-area-inset-bottom));
  background: var(--bg2);
  border-radius: 14px 14px 0 0;
  border-top: 1px solid var(--panel-line);
}
.panel-hd {
  display: flex;
  justify-content: space-between;
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  letter-spacing: 0.14em;
  color: var(--fam-activity);
  margin-bottom: 14px;
}
.panel-hd span:last-child {
  color: var(--dim);
  cursor: pointer;
}
.intro {
  font-size: var(--fs-second);
  line-height: 1.5;
  color: var(--dim);
  margin: 0 0 4px;
}
/* The elapsed time is the one thing this screen is about while a session runs,
   so it takes the hero treatment MetricPage gives a reading. Tabular figures
   because a proportional colon-separated clock jitters as it counts. */
.elapsed {
  font-size: 46px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}
.submeta {
  font-size: var(--fs-micro);
  letter-spacing: 0.12em;
  color: var(--dim);
  margin: 6px 0 4px;
}
.field {
  display: block;
  margin-top: 14px;
}
.flab {
  display: block;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--dim);
  margin-bottom: 7px;
}
/* Lifted from ManualSessionSheet so the two forms are the same object. */
.picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  text-align: left;
  background: var(--panel);
  border: 1px solid var(--panel-line);
  border-radius: 8px;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--fs-second);
  cursor: pointer;
}
.chev {
  color: var(--dim);
  font-size: 18px;
}
.note {
  margin-top: 12px;
  font-size: var(--fs-micro);
  line-height: 1.5;
  letter-spacing: 0.08em;
}
.btnrow {
  display: flex;
  gap: 9px;
  margin-top: 16px;
}
.action {
  flex: 1;
  min-height: 46px;
  border-radius: 8px;
  border: 1px solid var(--panel-line);
  background: var(--panel);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  letter-spacing: 0.15em;
  cursor: pointer;
}
.action.save {
  background: var(--fam-activity);
  border-color: var(--fam-activity);
  color: #04201c;
  font-weight: 600;
}
.action.stop {
  color: var(--bad);
  border-color: color-mix(in srgb, var(--bad) 45%, transparent);
}
.action.danger {
  background: var(--bad);
  border-color: var(--bad);
  color: #2a0606;
  font-weight: 600;
}
.live {
  margin-top: 14px;
}
.liverow {
  display: flex;
  align-items: baseline;
  gap: 7px;
}
.livebpm {
  font-size: 26px;
  font-weight: 600;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.liveunit {
  font-size: 11px;
  letter-spacing: 0.13em;
  color: var(--dim);
}
.livezone {
  margin-left: auto;
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--dim);
}
.caretrow {
  position: relative;
  height: 10px;
  margin-top: 8px;
}
.caret {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  font-size: 9px;
  color: var(--ink);
}
.strip {
  display: flex;
  gap: 2px;
  height: 8px;
}
.seg {
  flex: 1;
  border-radius: 1px;
}
/* The conventional ramp, measured as the most separable option available: 58
   apart between adjacent zones under the worst of the three colour blindnesses,
   against 11 for every single-hue alternative. It overlaps Recovery's band
   tokens, which is allowed for the same reason the stress ramp already overlaps
   them: the zone is named beside the colour, so colour is never the only
   channel, and here the caret gives it a third. */
.seg.z1 { background: #60a5fa; }
.seg.z2 { background: #4ade80; }
.seg.z3 { background: #fbbf24; }
.seg.z4 { background: #fb923c; }
.seg.z5 { background: #ef4444; }
.stripends {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  font-size: 9.5px;
  letter-spacing: 0.1em;
  color: var(--dim);
  font-variant-numeric: tabular-nums;
}
.confirm {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--panel-line);
}
/* A labelled row, not a button that competes with START. */
.wayin {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 48px;
  margin-top: 18px;
  padding: 0 2px;
  background: none;
  border: none;
  border-top: 1px solid var(--panel-line);
  color: var(--acc);
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  letter-spacing: 0.12em;
  cursor: pointer;
}
.wayin .sub {
  margin-left: auto;
  font-size: 9.5px;
  letter-spacing: 0.1em;
  color: var(--dim);
}
</style>
