<!--
  What that session was, shown once, immediately after STOP.

  **STOP used to record the session and close, which gave you nothing.** No way to
  see what it had captured, no way to fix a type you picked wrong at the start,
  and no way to change your mind about a session you did not mean to record. This
  is the screen that answers all three.

  **The session is already saved by the time this opens.** Holding it unsaved
  until you confirm would mean a crash, a low-memory kill or a mis-tap losing a
  window nothing can reconstruct - and the start time is the one fact here that
  cannot be re-entered from memory with any accuracy. So DISCARD deletes something
  real, which is why it asks, and CONFIRM is only a way of closing.

  **The heart rate is not here yet and the sheet says so rather than showing
  blanks.** At STOP the band has not handed the window over; a forced sync is
  already on its way, and the figures fill in underneath while you are reading.
  That is the same "derive on demand" rule the archive follows everywhere else.
-->
<template>
  <Teleport to="body">
    <div class="sheetwrap" @click.self="$emit('close')">
      <div class="sheet grid-bg">
        <div class="panel-hd">
          <span>SESSION FINISHED</span>
          <span @click="$emit('close')">[ CLOSE ]</span>
        </div>

        <div class="dur mono">{{ durationLabel }}</div>
        <div class="times mono">{{ startLabel }} → {{ endLabel }}</div>

        <!-- Editable here because the start is where you guess and the end is
             where you know. Changing it rewrites the annotation in place, so
             nothing downstream has to care that it was chosen late. -->
        <label class="field">
          <span class="flab mono">WHAT</span>
          <button type="button" class="picker mono" @click="typeOpen = true">
            {{ typeName ?? "NO TYPE" }}
            <span class="chev">›</span>
          </button>
        </label>

        <div class="hd2 mono">HEART RATE</div>

        <template v-if="summary">
          <div class="figs">
            <div class="fig">
              <div class="fignum mono">{{ summary.avg }}</div>
              <div class="figcap mono">AVERAGE</div>
            </div>
            <div class="fig">
              <div class="fignum mono">{{ summary.max }}</div>
              <div class="figcap mono">PEAK</div>
            </div>
            <div class="fig">
              <div class="fignum mono">{{ summary.min }}</div>
              <div class="figcap mono">LOWEST</div>
            </div>
          </div>

          <!-- **The whole session, not just its three summary figures.** An
               average of 128 says nothing about whether that was steady or a
               climb and a rest; the line is the only thing that can. Drawn from
               the same geometry MetricPage uses, so it breaks across a gap rather
               than joining over the minutes the strap was off. -->
          <svg
            v-if="chart"
            class="chart"
            :viewBox="`0 0 ${chart.width} ${chart.height}`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline
              v-for="(seg, i) in chart.segments"
              :key="i"
              :points="seg"
              fill="none"
              stroke="var(--fam-activity)"
              stroke-width="2"
              stroke-linejoin="round"
              stroke-linecap="round"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <div v-if="chart" class="axis mono">
            <span>{{ summary.min }}</span>
            <span>{{ summary.max }}</span>
          </div>

          <!-- Only the zones you were actually in. Five rows with three reading
               zero is a table about what did not happen. -->
          <div v-if="rows.length" class="zones">
            <div v-for="row in rows" :key="row.index" class="zrow">
              <span class="zname mono">{{ row.name }}</span>
              <span class="ztrack">
                <span class="zfill" :class="`z${row.index}`" :style="{ width: row.pct + '%' }" />
              </span>
              <span class="zmins mono">{{ row.label }}</span>
            </div>
          </div>

          <!-- Says what it was built from rather than only that it is an
               estimate: a figure from your own heart rate through the session is
               a different claim from one from an activity name and a clock. -->
          <div v-if="kcal" class="est mono">
            ~{{ kcal }} KCAL {{ kcalSource ?? "EST" }}
          </div>

          <!-- **Said where the figures are, not at the bottom of the sheet.** A
               recap opens provisional far more often than not: the live trail only
               fills while the screen is on, so a session spent in a pocket has
               almost nothing in it, and the strap's own copy does not arrive until
               the next sync. Without this the numbers read as final. -->
          <div v-if="coverage" class="dim-text mono note">{{ coverage }}</div>
        </template>

        <div v-else class="dim-text mono note">
          {{ waitingLabel }}
        </div>

        <div class="btnrow">
          <button type="button" class="action save mono" @click="$emit('close')">DONE</button>
          <button type="button" class="action mono" @click="confirmDiscard = true">
            DISCARD
          </button>
        </div>

        <!-- Asked, because this deletes a real record rather than abandoning a
             draft: by the time you are reading this the session is saved. -->
        <div v-if="confirmDiscard" class="confirm">
          <div class="dim-text mono note">
            DELETE THIS {{ durationLabel }} SESSION? IT CANNOT BE RECOVERED.
          </div>
          <div class="btnrow">
            <button type="button" class="action danger mono" @click="doDiscard">
              DELETE IT
            </button>
            <button type="button" class="action mono" @click="confirmDiscard = false">
              KEEP IT
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
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useSessionsStore } from "@/stores/sessions";
import { useHelioStore } from "@/stores/helio";
import { useProfileStore } from "@/stores/profile";
import { getSamples } from "@/utils/sampleDb";
import {
  coverageNote,
  durationWords,
  noHeartRateReason,
  summariseSession,
  zoneRows,
} from "./sessionRecap";
import { lineGeometry } from "@/utils/historyChart";
import { calorieSourceLabel } from "@/utils/sessionCalories";
import SessionTypeSheet from "./SessionTypeSheet.vue";

const props = defineProps({
  /** The key the session was stored under, which is also its start. */
  startMillis: { type: Number, required: true },
  activeSeconds: { type: Number, required: true },
});
const emit = defineEmits(["close", "discarded"]);

const sessions = useSessionsStore();
const helio = useHelioStore();
const profile = useProfileStore();

const typeOpen = ref(false);
const confirmDiscard = ref(false);
const summary = ref(null);
const samples = ref([]);

const endMillis = computed(() => props.startMillis + props.activeSeconds * 1000);
const typeId = computed(() => sessions.annotationFor(props.startMillis)?.typeId ?? null);
const typeName = computed(() => sessions.typeById(typeId.value)?.name ?? null);

const time = (ms) =>
  new Date(ms).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false });
const startLabel = computed(() => time(props.startMillis));
const endLabel = computed(() => time(endMillis.value));

const durationLabel = computed(() => durationWords(props.activeSeconds));

const rows = computed(() => zoneRows(summary.value));
const storedCount = ref(0);
const trailCount = ref(0);
const coverage = computed(() =>
  coverageNote({
    activeSeconds: props.activeSeconds,
    storedCount: storedCount.value,
    trailCount: trailCount.value,
  })
);

/**
 * The session's own line.
 *
 * **Scaled to its own spread, not from zero.** A session between 118 and 141
 * drawn from nothing is a flat line across the top, which is why both ends are
 * printed underneath - the same bargain `nightlyBars` strikes in the app.
 */
const chart = computed(() => {
  const values = samples.value.map((s) => s.v);
  const geo = lineGeometry(values, { width: 320, height: 68, pad: 4 });
  return geo?.segments?.length ? geo : null;
});
const kcal = computed(
  () => sessions.annotationFor(props.startMillis)?.measured?.kcal ?? null
);
const kcalSource = computed(() =>
  calorieSourceLabel(sessions.annotationFor(props.startMillis)?.measured?.kcalSource)
);

/**
 * What to say while there is nothing to show.
 *
 * Three different states, because they want three different things from the
 * reader: a sync in progress is a wait, a finished sync with nothing in it means
 * the strap was not on, and no strap at all is neither.
 */
const waitingLabel = computed(() =>
  noHeartRateReason({
    activeSeconds: props.activeSeconds,
    samples: samples.value,
    minSamples: 2,
    connected: helio.connected,
    syncing: Boolean(helio.syncing || helio.syncPhase),
  })
);

/**
 * Read the window whenever a sync lands, until something is found.
 *
 * The forced sync STOP asked for is already in flight when this opens, so the
 * figures usually arrive while the sheet is being read. Watching `lastSyncAt`
 * rather than polling means nothing runs when nothing has changed.
 */
async function load() {
  try {
    // **Both sources, merged.** The archive is better where it exists - it
    // covers the whole window rather than only the parts where the screen was on
    // - but it arrives late and for a short session may never arrive at all. The
    // live trail is what the service kept while streaming. Taking the union
    // rather than choosing means a recap has something to show immediately and
    // gets better when the band catches up.
    const [stored, trail] = await Promise.all([
      getSamples("hr", props.startMillis, endMillis.value),
      helio.sessionHeartTrail(),
    ]);
    const byTime = new Map();
    for (const point of trail ?? []) {
      if (point.t >= props.startMillis && point.t <= endMillis.value) byTime.set(point.t, point);
    }
    // The archive wins on a collision: it is the band's own record of the
    // minute, where the trail is a sample of it.
    for (const point of stored ?? []) byTime.set(point.t, point);
    storedCount.value = (stored ?? []).length;
    trailCount.value = byTime.size - storedCount.value > 0 ? (trail ?? []).length : 0;
    samples.value = [...byTime.values()].sort((a, b) => a.t - b.t);
    // **Whatever readings exist are worth describing.** The gate used to be five,
    // and it hid the zones as well as the figures - so a session with three real
    // readings showed nothing at all rather than three readings' worth. Two is
    // the floor for an average meaning anything.
    summary.value = summariseSession({
      samples: samples.value,
      ageYears: profile.age ?? null,
      minSamples: 2,
    });
  } catch {
    // An archive read that throws leaves the waiting line in place, which is
    // the honest thing to show.
  }
}

onMounted(load);
const stop = watch(() => helio.lastSyncAt, load);
onBeforeUnmount(stop);

function onPickType(id) {
  sessions.setType(props.startMillis, id);
  typeOpen.value = false;
}

function doDiscard() {
  // `setHidden` takes the start time, not a workout object. Passing
  // `{ startMillis }` wrote an annotation under a key nothing reads, so
  // DISCARD appeared to work and the session stayed in FITNESS.
  sessions.setHidden(props.startMillis, true);
  emit("discarded");
  emit("close");
}
</script>

<style scoped>
.sheetwrap {
  position: fixed;
  inset: 0;
  /* Above the tab bar (100) and the create button (110), like every other sheet.
     Below that, the buttons at the bottom sit under the furniture and a tap on
     DISCARD goes to the tab bar. */
  z-index: 700;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.55);
}
.sheet {
  width: 100%;
  max-height: 90vh;
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
  margin-bottom: 12px;
}
.panel-hd span:last-child {
  color: var(--dim);
  cursor: pointer;
}
.dur {
  font-size: 42px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
}
.times {
  font-size: var(--fs-micro);
  letter-spacing: 0.12em;
  color: var(--dim);
  margin-top: 5px;
}
.field {
  display: block;
  margin-top: 16px;
}
.flab {
  display: block;
  font-size: 13px;
  letter-spacing: 0.14em;
  color: var(--dim);
  margin-bottom: 7px;
}
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
  font-size: 19px;
}
.hd2 {
  margin-top: 20px;
  font-size: 13.5px;
  letter-spacing: 0.16em;
  color: var(--fam-activity);
}
.figs {
  display: flex;
  gap: 26px;
  margin-top: 10px;
}
.fignum {
  font-size: 28px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.figcap {
  font-size: 13px;
  letter-spacing: 0.13em;
  color: var(--dim);
  margin-top: 4px;
}
.chart {
  display: block;
  width: 100%;
  height: 68px;
  margin-top: 14px;
}
.axis {
  display: flex;
  justify-content: space-between;
  margin-top: 3px;
  font-size: 13px;
  letter-spacing: 0.1em;
  color: var(--dim);
  font-variant-numeric: tabular-nums;
}
.zones {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 16px;
}
.zrow {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  letter-spacing: 0.1em;
}
.zname {
  width: 132px;
  flex: none;
  color: var(--dim);
}
.ztrack {
  flex: 1;
  height: 7px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--dim) 18%, transparent);
  overflow: hidden;
}
.zfill {
  display: block;
  height: 100%;
}
/* The same ramp the gauge and the strip use. Index 0 is the time below zone one,
   which is not a zone and takes the quiet colour rather than a band's. */
.zfill.z0 {
  background: color-mix(in srgb, var(--dim) 55%, transparent);
}
.zfill.z1 {
  background: #60a5fa;
}
.zfill.z2 {
  background: #4ade80;
}
.zfill.z3 {
  background: #fbbf24;
}
.zfill.z4 {
  background: #fb923c;
}
.zfill.z5 {
  background: #ef4444;
}
.zmins {
  width: 58px;
  flex: none;
  text-align: right;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.est {
  margin-top: 14px;
  font-size: var(--fs-label);
  letter-spacing: 0.1em;
  color: var(--dim);
}
.note {
  margin-top: 10px;
  font-size: var(--fs-micro);
  line-height: 1.5;
  letter-spacing: 0.08em;
}
.btnrow {
  display: flex;
  gap: 9px;
  margin-top: 20px;
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
.action.danger {
  background: var(--bad);
  border-color: var(--bad);
  color: #2a0606;
  font-weight: 600;
}
.confirm {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--panel-line);
}
</style>
