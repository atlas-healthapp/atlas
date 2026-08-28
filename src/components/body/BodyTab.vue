<template>
  <div ref="scroller" class="body grid-bg">
    <PullIndicator :pull="pull" :refreshing="refreshing" :armed="armed" :note="note" />
    <AppHeader label="BODY" :meta="`${dayCount} DAYS OF READINGS`" />

    <div v-if="loaded && !hasReadings" class="panel">
      <div class="panel-hd"><span>NO READINGS YET</span></div>
      <div class="dim-text mono">
        CONNECT THE STRAP IN SETTINGS TO START COLLECTING BODY METRICS.
      </div>
    </div>

    <template v-else-if="hasReadings">
      <!-- Above TODAY, because it is the slowest-moving thing on the page and
           the one the rest of it accumulates into: a recovery score is about
           last night and this is about the last month of them. -->
      <FitnessAgeCard :result="fitnessAge" @open="openFitnessAge" />

      <!-- The two scores lead: they are what the rows underneath explain, and
           both already have pages of their own. This is also what makes BODY
           not a duplicate of those pages but the index that reaches them. -->
      <HomeCard
        title="TODAY"
        :color="recoveryColor(recovery.score)"
        :ink-color="recoveryInk(recovery.score)"
      >
        <MetricRow
          label="RECOVERY"
          :value="recovery.state === 'ready' ? String(recovery.score) : '--'"
          tappable
          @click.stop="recoveryOpen = true"
        >
          <span class="pill mono" :style="{ color: recoveryInk(recovery.score) }">{{
            recoveryMeta
          }}</span>
        </MetricRow>
      </HomeCard>

      <HomeCard
        v-for="card in BODY_CARDS"
        :key="card.key"
        :title="card.label"
        :color="famColor(card.metrics[0])"
      >
        <MetricRow
          v-for="row in rowsFor(card)"
          :key="row.key"
          :label="row.def.label"
          :value="row.key === 'sleep' ? sleepValueText : display(row)"
          tappable
          @click.stop="openRow(row)"
        >
          <!-- The same mark Home draws, for the same reason: the night's shape
               says whether it settled and whether it kept breaking up, which a
               duration in a pill never did. Sleep has no target to bar against
               here, so this is the mark that fits. Falls back to proportions
               when the decoder gave no timeline, exactly as Home does. -->
          <template v-if="row.key === 'sleep'">
            <!-- `variant="stage"`, which Home has passed since the stage colours
                 landed and this did not. Without it the same night is drawn in
                 one flat violet here and in four stage colours one screen away,
                 so the row you tap and the page it opens disagree about what the
                 picture means. The whole point of the stage palette is that this
                 row and the hypnogram are recognisably the same night. -->
            <SleepShape
              v-if="entry.sleepStages?.timeline?.length"
              :timeline="entry.sleepStages.timeline"
              :color="famColor('sleep')"
              variant="stage"
              :height="34"
            />
            <CompositionBar
              v-else-if="entry.sleepStages"
              :segments="entry.sleepStages"
              :color="famColor('sleep')"
              variant="stage"
            />
            <span v-else class="pill mono">NOT RECORDED</span>
          </template>
          <!-- Vitals take the baseline band, not a sparkline. A sparkline says
               which way a number moved; the band says whether today is
               unusual, which is the question these metrics exist to answer. -->
          <GoalBar
            v-else-if="row.def.goal"
            :value="row.value ?? 0"
            :goal="row.def.goal"
            :color="famColor(row.key)"
          />
          <TrendSpark
            v-else-if="row.def.key === 'weight'"
            :values="row.series"
            :color="famColor(row.key)"
          />
          <RangeMark
            v-else-if="row.range"
            :value="row.value"
            :low="row.range.low"
            :high="row.range.high"
            :baseline="row.range.mean"
            :series="row.prior"
            :color="famColor(row.key)"
          />
          <span v-else class="calib mono">{{
            row.value == null ? "NO READING TODAY" : "BUILDING A RANGE"
          }}</span>
        </MetricRow>
      </HomeCard>
    </template>

    <MetricPage v-if="openMetric" :def="openMetric" from="BODY" @close="openMetric = null" />
    <SleepPage v-if="sleepOpen" from="BODY" @close="sleepOpen = false" />
    <RecoveryPage v-if="recoveryOpen" :result="recovery" from="BODY" @close="recoveryOpen = false" />
    <StressPage v-if="stressOpen" from="BODY" @close="stressOpen = false" />
    <HeartPage v-if="heartOpen" from="BODY" @close="heartOpen = false" />
    <!-- Only ever opened from a `ready` card, so the page never has to render a
         withheld result: the card already explains a figure it cannot give. -->
    <FitnessAgePage
      v-if="fitnessAgeOpen"
      :result="fitnessAge"
      :series="fitnessAgeHistory"
      from="BODY"
      @close="fitnessAgeOpen = false"
    />
  </div>
</template>

<script setup>
import PullIndicator from "@/components/layout/PullIndicator.vue";
import { usePullToRefresh } from "@/composables/usePullToRefresh";
import {
  ref,
  computed,
  onMounted,
  onActivated,
  watch,
} from "vue";
import { useUIStore } from "@/stores/ui";
import { useCheckinStore } from "@/stores/checkin";
import { goalOrDefault, useGoalsStore } from "@/stores/goals";
import { useLevelsStore } from "@/stores/levels";
import { useProfileStore } from "@/stores/profile";
import { useHelioStore } from "@/stores/helio";
import AppHeader from "@/components/layout/AppHeader.vue";
import { dailyValuesForRange } from "@/utils/dailyRollup";
import { today, addDays, fmtHoursMins } from "@/utils/date";
import { familyColor } from "@/utils/families";
import { recoveryColor, recoveryInk } from "@/utils/recovery";
import { recoveryFor } from "@/components/home/homeModel";
import { BODY_CARDS } from "./bodyModel";
import FitnessAgeCard from "./FitnessAgeCard.vue";
import { fitnessAgeFor, withWorkingHeartRate, fitnessAgeSeries } from "./fitnessAgeModel";
import { getWorkouts, getSamples } from "@/utils/sampleDb";
import { useSessionsStore } from "@/stores/sessions";
import { resolveSessions } from "@/components/activity/resolveSessions";
import { rowFor, daysWithData } from "@/utils/metricRow";
import { formatValue } from "@/utils/metricRegistry";
import HomeCard from "@/components/home/HomeCard.vue";
import MetricRow from "@/components/home/MetricRow.vue";
import SleepPage from "@/components/sleep/SleepPage.vue";
import RecoveryPage from "@/components/home/RecoveryPage.vue";
import MetricPage from "@/components/metrics/MetricPage.vue";
import StressPage from "./StressPage.vue";
import HeartPage from "./HeartPage.vue";
import FitnessAgePage from "./FitnessAgePage.vue";
import GoalBar from "@/components/marks/GoalBar.vue";
import RangeMark from "@/components/marks/RangeMark.vue";
import TrendSpark from "@/components/marks/TrendSpark.vue";
import SleepShape from "@/components/marks/SleepShape.vue";
import CompositionBar from "@/components/marks/CompositionBar.vue";

// 30 days, not 14. The vitals' own bands need more history than the 7 nights
// the baseline uses, or the band is drawn from barely more data than the
// reading it is judging.
const WINDOW_DAYS = 30;

const ui = useUIStore();
const checkin = useCheckinStore();
// A plain reactive object, so every GOALS.x below reads live and works the
// same in the template as it does here. See stores/goals.js.
const GOALS = useGoalsStore().values;
const levels = useLevelsStore();
const profile = useProfileStore();
const helio = useHelioStore();
const famColor = familyColor;

const openMetric = ref(null);
const sleepOpen = ref(false);
const recoveryOpen = ref(false);
const stressOpen = ref(false);
const heartOpen = ref(false);
const fitnessAgeOpen = ref(false);

// Some rows have a page of their own rather than the generic metric page: sleep,
// stress and heart rate all have a shape through the night or the day that a
// list of daily values cannot show.
function openRow(row) {
  if (row.key === "sleep") sleepOpen.value = true;
  else if (row.key === "stress") stressOpen.value = true;
  else if (row.key === "hr") heartOpen.value = true;
  else openMetric.value = row.def;
}

const dayWindow = ref([]);
/**
 * Has the archive answered yet?
 *
 * **Separate from whether it holds anything**, because until this exists the two
 * are the same state and the tab tells a month-old archive it has no readings
 * and should connect a strap. Reported 2026-08-19 after tapping a widget, which
 * cold-starts the app: the read is queued behind the sync the launch kicks off,
 * so the false empty state stood for the whole sync rather than for a frame.
 *
 * Set in a `finally`, the same as Home's `dataReady` and for the same reason: a
 * read that throws must still release the gate, or the tab claims to be loading
 * for ever. This is the empty-state half of the rule the file already carries
 * one comment about - readings you have are readings you have - and a read that
 * has not come back is not an answer about what you have.
 */
const loaded = ref(false);

/**
 * Sessions for the activity index, which is a fitness age input and nothing else
 * on this tab uses.
 *
 * Read through `resolveSessions` rather than raw, the same as ActivityTab and
 * RecoveryPage: a hand-corrected duration applied in one place and not another
 * is how two screens end up disagreeing about a week.
 */
const rawSessions = ref([]);
const sessionStore = useSessionsStore();
const sessions = computed(() => resolveSessions(rawSessions.value, sessionStore));

/**
 * The same sessions with each one's **working** heart rate attached, for the
 * fitness age alone.
 *
 * A second ref rather than a computed, because reading the samples is async and
 * every other consumer of `sessions` is synchronous. It starts as the plain list
 * and is replaced once the reads finish, so the card draws on the old estimator
 * for a moment rather than not at all.
 */
const sessionsForAge = ref([]);
watch(
  sessions,
  async (list) => {
    sessionsForAge.value = list;
    if (!list.length) return;
    sessionsForAge.value = await withWorkingHeartRate(list, getSamples);
  },
  { immediate: true }
);

async function loadWindow() {
  const to = today();
  const from = addDays(to, -(WINDOW_DAYS - 1));
  try {
    dayWindow.value = await dailyValuesForRange(from, to);
  } finally {
    loaded.value = true;
  }
  // Not awaited alongside: the fitness age is the slowest thing on the page and
  // the rows above it should not wait on a second read to draw.
  getWorkouts(Date.parse(`${addDays(to, -(WINDOW_DAYS - 1))}T00:00:00`), Date.now())
    .then((found) => {
      rawSessions.value = found ?? [];
    })
    .catch(() => {
      // A failed read leaves the index unbuilt, which the card reports as
      // missing activity rather than as a zero. Never a silent zero: that would
      // read as "you did nothing this month".
      rawSessions.value = [];
    });
  // Not awaited with the above: the six-month window is only needed for the
  // condition half of the score, and the tab should draw without waiting on it.
  levels.ensure();
}

// onMounted alone is not enough: App.vue wraps the tabs in KeepAlive, so this
// mounts once per app run and would otherwise show whatever the numbers were
// the first time BODY was opened.
onMounted(loadWindow);
onActivated(loadWindow);

/**
 * Arriving from the heart widget, which is what BODY owns.
 *
 * **Claimed rather than consumed**: `claimOpen` only clears the target when it
 * is this one, so a tab cannot swallow another tab's arrival. Run on activation
 * too, since the tab may already be mounted inside KeepAlive when the tap lands.
 */
function claimWidgetTarget() {
  if (ui.claimOpen("heart")) heartOpen.value = true;
}
onMounted(claimWidgetTarget);
onActivated(claimWidgetTarget);
// A sync can finish while this tab is already visible. SettingsPage is a
// sibling overlay outside the KeepAlive block, so tapping SYNC NOW there never
// activates this component and neither hook above fires.
watch(() => helio.lastSyncAt, loadWindow);

// Live heart rate used to start here whenever the tab came on screen. It is
// gone (2026-08-12): **the strap takes one BLE central at a time**, so a stream
// held the only connection and every sync that wanted it had to stand the stream
// down, sync, and start it again. Opening BODY at the wrong moment was enough to
// make a sync look broken, which cost more than a number on screen was worth.
// The store still has startLiveHeartRate for a future screen that earns it.

const todayKey = computed(() => today());

const scroller = ref(null);
const { pull, refreshing, armed, note } = usePullToRefresh(scroller, async () => {
  const reason = await helio.refresh({ force: true, trigger: "pull-body" }).catch(() => null);
  await loadWindow();
  return reason;
});
const entry = computed(() => checkin.entryFor(todayKey.value) ?? {});
const dayCount = computed(() => daysWithData(dayWindow.value));
// Whether there is anything to show, not whether a strap is currently paired.
// The gate used to be the relay OR the strap being connected, which hid
// the entire tab the moment a source was disconnected - including the archive
// it had already collected, while the header above it went on counting "10 DAYS
// OF READINGS". Readings you have are readings you have.
const hasReadings = computed(() => dayCount.value > 0);

const fitnessAge = computed(() =>
  fitnessAgeFor({
    profile: { age: profile.age, sex: profile.sex || null, heightCm: profile.heightCm ?? null },
    entries: checkin.entries,
    // **The long window, not this tab's thirty-day one.** The model wants 30
    // days of resting heart rate and today is deliberately excluded from the
    // average, so a thirty-day window tops out at 29 and the figure could never
    // stop being provisional. Caught by screenshotting it with forty days of
    // history seeded and watching it still say "1 day to go".
    //
    // `levels.window` is already loaded for the condition half of Recovery and
    // runs to several months, so this needs no second read. It falls back to
    // the short window only while that one is still loading, which shows a
    // provisional figure for a moment rather than nothing.
    dayWindow: levels.window.length ? levels.window : dayWindow.value,
    sessions: sessionsForAge.value,
    todayKey: todayKey.value,
  })
);

/**
 * The weekly history the drill-through draws.
 *
 * Computed only while the page is open. Every point re-runs the whole model, and
 * twelve of those on a tab that is not showing them is work nobody asked for.
 */
const fitnessAgeHistory = computed(() => {
  if (!fitnessAgeOpen.value) return [];
  return fitnessAgeSeries({
    profile: { age: profile.age, sex: profile.sex || null, heightCm: profile.heightCm ?? null },
    entries: checkin.entries,
    dayWindow: levels.window.length ? levels.window : dayWindow.value,
    sessions: sessionsForAge.value,
    todayKey: todayKey.value,
    dob: profile.dob ?? null,
  });
});

function openFitnessAge() {
  // A withheld figure has nothing to explain: the card itself says what is
  // missing and how long is left, which is more than the page could add.
  if (fitnessAge.value?.state === "ready") fitnessAgeOpen.value = true;
}

const recovery = computed(() =>
  recoveryFor({
    dayWindow: dayWindow.value,
    entry: entry.value,
    todayKey: todayKey.value,
    sleepGoalHours: goalOrDefault("sleep"),
    entries: checkin.entries,
    longWindow: levels.window,
    profile: { age: profile.age, sex: profile.sex || null },
  })
);
const recoveryMeta = computed(() => {
  if (recovery.value.state === "calibrating") {
    // "N OF M NIGHTS" rather than CALIBRATING, matching what `NotYet` says
    // where a whole block fits. CALIBRATING is the app describing its own
    // arithmetic; the count says what is actually being waited for.
    return `${recovery.value.nights} OF ${recovery.value.needed} NIGHTS`;
  }
  return recovery.value.state === "ready" ? recovery.value.label : "NO DATA";
});
// The night's length, the same reading Home's sleep row carries. The score it
// used to show lives on the sleep page and on Home's dial; a row with the
// shape beside it wants the number that shape is made of.
const sleepValueText = computed(() =>
  entry.value.sleep ? fmtHoursMins(entry.value.sleep) : "--"
);

function rowsFor(card) {
  return card.metrics
    .map((key) => rowFor(dayWindow.value, key, checkin.entryFor, todayKey.value))
    .filter(Boolean);
}

function display(row) {
  return formatValue(row.def, row.value);
}
</script>

<style scoped>
.body {
  height: 100%;
  overflow-y: auto;
  padding: calc(12px + env(safe-area-inset-top)) 18px
    calc(100px + env(safe-area-inset-bottom));
  /* Hides the Android overlay scroll bar by overscanning past #app-shell.
     See --sb-overscan in style.css. */
  margin-right: calc(-1 * var(--sb-overscan));
  padding-right: calc(18px + var(--sb-overscan));
  color: var(--body);
  font-family: var(--font-sans);
}
.pill {
  font-size: var(--fs-label);
  letter-spacing: 0.8px;
  color: var(--dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.calib {
  font-size: var(--fs-label);
  letter-spacing: 1px;
  color: var(--dim);
}
.dim-text {
  color: var(--dim);
  font-size: var(--fs-second);
}
</style>
