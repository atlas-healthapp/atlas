<template>
  <div ref="scroller" class="home grid-bg" :class="{ boot: playBoot }" @click="skipBoot">
    <PullIndicator :pull="pull" :refreshing="refreshing" :armed="armed" :note="note" />
    <div v-if="playBoot" class="blackout" :style="{ opacity: blackoutOpacity }"></div>

    <!-- Same row as every other tab: wordmark left, chip right, chip's circle
         centred on the wordmark. The chip used to be absolutely positioned 4px
         above the page padding, which put it on a different line from the one
         it sits on everywhere else. Heights stay fixed rather than being left
         to the content, because the wordmark shifted mid-boot on the real
         Android WebView, and the chip is absent during boot. -->
    <div class="hd">
      <div class="logo wordmark">
        <!-- The peak lands on the tick the first character used to, then TLAS
             types after it: it is what the boot is building toward, so it
             arrives first rather than being typed like a letter. -->
        <PeakMark v-if="logoCount >= 1" />{{ typedLogo
        }}<span v-if="logoTyping" class="cursor" aria-hidden="true"></span>
      </div>
      <ProfileChip v-if="!playBoot" />
    </div>

    <!-- The date is the header line now. "SYSTEM ONLINE" said nothing: it was
         true every time you read it, so it stopped being read. What sits beside
         the date instead is the strap's actual state, and only when there is
         something to say about it. -->
    <div class="hd-sub">
      <div v-if="!playBoot" class="sys mono datechip">{{ dateLabel }}</div>
      <div v-if="!playBoot && syncNote" class="sys mono" :class="{ warn: syncNote.warn }">
        {{ syncNote.text }}
      </div>
      <div v-if="playBoot" class="sys mono">{{ bootLine }}</div>
    </div>

    <!-- **User-chosen since 2026-08-12, and the row has stopped being a colour
         legend because of it.** It was Recovery / Sleep / Protein, one per
         family, which made the three rings double as a standing key for what the
         colours mean. Any chosen set can now put two rings in one family, so
         that second job is given up rather than half-kept: the families still do
         their work on the cards below, which is where it matters. Protein came
         off the default because it needs the food side to be in use, and steps
         works from the first sync. Each ring still opens the screen that owns
         its number. -->
    <div class="dials" :style="{ opacity: reveal(0) }">
      <Dial
        v-for="d in dials"
        :key="d.key"
        :pct="d.pct * bootScale"
        :text="d.text"
        :label="d.label"
        :color="d.color"
        :ink-color="d.inkColor"
        :glow="d.glow"
        tappable
        @click.stop="dialTap(() => openDial(d))"
      />
    </div>

    <HomeCard
      title="TODAY"
      :meta="recoveryMeta"
      :color="recoveryColor(recovery.score)"
      :ink-color="recoveryInk(recovery.score)"
      :style="cardStyle(1)"
    >
      <!-- The verdict asserts; tapping it shows the working. -->
      <div class="verdictrow" @click.stop="recoveryOpen = true">
        <div class="verdictcol">
          <p class="verdict">{{ recoveryExplanationText }}</p>
          <!-- The gap and nothing else. The figures, the per-term paragraphs and
               the baseline note all live on the page this row opens: Home is the
               glance, and three paragraphs of arithmetic on it made the answer to
               "how am I doing" something you had to read rather than see. -->
          <p v-if="gapText" class="headroom">{{ gapText }}</p>
          <p class="more mono">MORE INFORMATION</p>
        </div>
        <span class="chev" aria-hidden="true">›</span>
      </div>
    </HomeCard>

    <HomeCard title="BODY" :color="famColor('sleep')" :style="cardStyle(2)">
      <template v-for="row in body" :key="row.key">
        <!-- The tallest row on Home. Four depth bands in an 18px mark gave each
             about 4px, and the night's shape had to be looked for rather than
             seen; at 34px each band gets roughly 8px. Sleep is the only metric
             here with four parts, and it is the only row that earns the space. -->
        <MetricRow
          v-if="row.kind === 'sleep'"
          class="sleeprow"
          label="SLEEP"
          :value="row.hours != null ? fmtHoursMins(row.hours) : '--'"
          tappable
          @click.stop="sleepOpen = true"
        >
          <!-- The night's shape when the decoder gave us one, its proportions
               when it did not. Older records and a session the band was still
               computing carry totals with no timeline. -->
          <!-- Stage colours, not the BODY hue, so this row and the hypnogram it
               opens are recognisably the same picture. -->
          <SleepShape
            v-if="row.stages?.timeline?.length"
            :timeline="row.stages.timeline"
            :color="famColor('sleep')"
            variant="stage"
            :height="34"
          />
          <CompositionBar
            v-else-if="row.stages"
            :segments="row.stages"
            :color="famColor('sleep')"
            variant="stage"
          />
        </MetricRow>

        <!-- Stress alone is tappable, because it alone has somewhere to go: a
             page of the day's shape. The other vitals are one reading a night
             and their metric page is reached from BODY. Stress reads its zone
             where the others read their number: 28 means nothing on its own,
             CALM means something immediately, and the number is on the page
             one tap away. The word used to sit beside the mark as well as the
             number, which crowded both. -->
        <MetricRow
          v-else-if="row.kind === 'baseline'"
          :label="row.label"
          :value="
            row.key === 'stress'
              ? stressZoneLabel(row.value)
              : `${Math.round(row.value)}${row.unit}`
          "
          :tappable="canOpenVital(row.key)"
          @click.stop="openVital(row.key)"
        >
          <!-- Stress gets the day's own shape rather than a band. It is the
               one vital that moves hour to hour, so where it sat all day says
               more than where it sits against a range, and the row is then a
               small version of the page it opens. -->
          <StressDay
            v-if="row.key === 'stress' && stressSamples.length"
            class="stressmark"
            :samples="stressSamples"
            :color="famColor('stress')"
          />
          <RangeMark
            v-else
            :value="row.value"
            :low="row.low"
            :high="row.high"
            :baseline="row.baseline"
            :series="row.history"
            :color="famColor(row.key)"
          />
        </MetricRow>

        <!-- Not a BinaryCheck. A tick box is a control you set, and this is a
             report that nothing needs you: the box invited a tap that toggled
             nothing. A status pip says the same thing without promising it. -->
        <MetricRow
          v-else-if="row.kind === 'allNormal'"
          :label="row.label"
          tappable
          goes="BODY"
          @click.stop="ui.setTab('body')"
        >
          <span class="pipnote">
            <i :style="{ background: famColor('sleep') }"></i>
            <span :style="{ color: famColor('sleep') }">{{ row.text }}</span>
          </span>
        </MetricRow>

        <MetricRow
          v-else-if="row.kind === 'plain'"
          :label="row.label"
          :value="`${Math.round(row.value)}${row.unit}`"
          :tappable="canOpenVital(row.key)"
          @click.stop="openVital(row.key)"
        >
          <span class="calib mono">CALIBRATING</span>
        </MetricRow>

        <MetricRow v-else :label="row.label">
          <span class="calib mono">{{ row.text }}</span>
        </MetricRow>
      </template>
    </HomeCard>

    <HomeCard title="NUTRITION" :color="famColor('protein')" :style="cardStyle(3)">
      <!-- Up Next lives inside Nutrition rather than in a card of its own: a
           planned meal is intake, and the rows beneath it are the numbers it
           moves. It stays on Home because plan-and-confirm is the whole reason
           logging trends toward zero on an ordinary day. -->
      <!-- Two rows rather than one. At a readable size the meal name and both
           buttons cannot share a line without the name truncating, and the
           name is the part you are deciding about. -->
      <!-- No empty state. With the weekly schedule hidden there is no way to
           create a plan, so "nothing scheduled" would be a permanent row
           reporting the absence of a feature you cannot reach. -->
      <div v-if="upNext" class="upnext">
        <div class="upline">
          <span class="t mono">{{ upNext.timeLabel }}</span>
          <span class="meal">{{ upNext.name }}</span>
        </div>
        <div class="upacts">
          <button class="swp mono" @click.stop="swapTarget = upNext.swap">SWAP</button>
          <button class="cfm mono" @click.stop="upNext.confirm()">CONFIRM</button>
        </div>
      </div>

      <!-- Each of these draws only while its goal is being kept. A switched-off
           goal is null, not 0, so a row left in would read `3/nullL` and, on
           creatine, mark itself done for ever - `x >= null` is `x >= 0`. -->
      <MetricRow
        v-if="GOALS.water != null"
        label="WATER"
        :value="`${entry.water ?? 0}/${GOALS.water}L`"
        :streak="streaks.water"
        :streak-color="famColor('water')"
        tappable
        @click.stop="logWater"
      >
        <GoalDots :value="entry.water ?? 0" :goal="GOALS.water" :color="famColor('water')" />
      </MetricRow>
      <!-- Protein and fibre open the same sheet: it logs both, and the manual
           figure is an extra on top of whatever the diary already counted, so
           the bar is still fillable on a day with nothing planned. -->
      <MetricRow
        v-if="GOALS.protein != null"
        label="PROTEIN"
        :value="`${proteinTotal}/${GOALS.protein}G`"
        :streak="streaks.protein"
        :streak-color="famColor('protein')"
        tappable
        @click.stop="openMetric = metricDef('protein')"
      >
        <GoalDots :value="proteinTotal" :goal="GOALS.protein" :color="famColor('protein')" />
      </MetricRow>
      <MetricRow
        v-if="GOALS.fibre != null"
        label="FIBRE"
        :value="`${fibreTotal}/${GOALS.fibre}G`"
        :streak="streaks.fibre"
        :streak-color="famColor('fibre')"
        tappable
        @click.stop="openMetric = metricDef('fibre')"
      >
        <GoalDots :value="fibreTotal" :goal="GOALS.fibre" :color="famColor('fibre')" />
      </MetricRow>
      <MetricRow
        v-if="GOALS.creatine != null"
        label="CREATINE"
        :streak="streaks.creatine"
        :streak-color="famColor('creatine')"
        tappable
        @click.stop="toggleCreatine"
      >
        <BinaryCheck
          :done="(entry.creatine ?? 0) >= GOALS.creatine"
          :label="creatineLabel"
          :color="famColor('creatine')"
        />
      </MetricRow>
    </HomeCard>

    <!-- FITNESS, matching the tab it leads to. The colour family underneath is
         still called activity; that name is internal and no user sees it. -->
    <HomeCard
      title="FITNESS"
      :color="famColor('steps')"
      :meta-color="famColor('steps')"
      :style="cardStyle(4)"
    >
      <!-- **Each row opens its own metric, not the tab.** They led to FITNESS
           while the numbers had no page of their own, so the tab was the only
           place with any more of the story. Now that both have a drill-through,
           landing on the tab is a stop on the way: it shows the same two figures
           the row just showed, and the history is another tap further on. Every
           other row in Atlas that carries a mark opens the thing the mark is
           about, and these are the last two that did not. -->
      <MetricRow
        label="STEPS"
        :value="stepsText"
        :streak="stepStreak"
        :streak-color="famColor('steps')"
        tappable
        @click.stop="openMetric = metricDef('steps')"
      >
        <GoalBar :value="stepsToday ?? 0" :goal="STEP_GOAL" :color="famColor('steps')" />
      </MetricRow>
      <MetricRow
        v-if="paiToday != null"
        label="PAI"
        :value="String(Math.round(paiToday))"
        tappable
        @click.stop="openMetric = metricDef('pai')"
      >
        <GoalBar :value="paiToday" :goal="PAI_GOAL" :color="famColor('pai')" />
      </MetricRow>
    </HomeCard>

    <!-- The routine gets a card of its own rather than a row per due habit.
         Nine of those was most of the screen, and the bands say which part of
         the day is untouched, which nine rows never did. -->
    <!-- The payload says whether to land on the page or straight in the add
         sheet: the empty state is an offer to add a habit, and repeating the
         offer on arrival would be a step of ceremony between the two. -->
    <RoutineCard :style="cardStyle(5)" @open="openRoutine($event)" />

    <QuickLogSheet
      v-if="quickLog"
      :field="quickLog"
      @close="quickLog = null"
      @save="onQuickLogSave"
      @history="onQuickLogHistory"
    />
    <RoutinePage
      v-if="routineOpen"
      from="HOME"
      :add-on-open="routineAdd"
      @close="routineOpen = false"
    />
    <MetricPage v-if="openMetric" :def="openMetric" from="HOME" @close="openMetric = null" />
    <MealPickSheet
      v-if="swapTarget"
      :current-meal-id="swapTarget.mealId"
      @close="swapTarget = null"
      @pick="onSwapPick"
    />
    <SleepPage v-if="sleepOpen" from="HOME" @close="sleepOpen = false" />
    <RecoveryPage v-if="recoveryOpen" :result="recovery" from="HOME" @close="recoveryOpen = false" />
    <StressPage v-if="stressOpen" from="HOME" @close="stressOpen = false" />
  </div>
</template>

<script setup>
import PullIndicator from "@/components/layout/PullIndicator.vue";
import { usePullToRefresh } from "@/composables/usePullToRefresh";
import { ref, computed, onMounted, onActivated, onUnmounted, watch } from "vue";
import { useCheckinStore } from "@/stores/checkin";
import { goalOrDefault, useGoalsStore } from "@/stores/goals";
import { useLevelsStore } from "@/stores/levels";
import { useProfileStore } from "@/stores/profile";
import { useFoodStore } from "@/stores/food";
import { useUIStore } from "@/stores/ui";
import { useHelioStore } from "@/stores/helio";
import { today, addDays, fmtTime, fmtHoursMins } from "@/utils/date";
import { dailyValuesForRange } from "@/utils/dailyRollup";
import { familyColor, familyInkColor } from "@/utils/families";
import {
  recoveryExplanation,
  recoveryColor,
  recoveryInk,
  recoveryHeadroom,
} from "@/utils/recovery";
import {
  recoveryFor,
  sleepScoreFor,
  bodyRows,
  nutritionStreaks,
  stepsStreak,
} from "@/components/home/homeModel";
import Dial from "@/components/home/Dial.vue";
import HomeCard from "@/components/home/HomeCard.vue";
import MetricRow from "@/components/home/MetricRow.vue";
import SleepPage from "@/components/sleep/SleepPage.vue";
import RecoveryPage from "@/components/home/RecoveryPage.vue";
import StressPage from "@/components/body/StressPage.vue";
import StressDay from "@/components/marks/StressDay.vue";
import MetricPage from "@/components/metrics/MetricPage.vue";
import { getSamples } from "@/utils/sampleDb";
import { metric as metricDef } from "@/utils/metricRegistry";
import { zoneFor } from "@/components/body/stressDay";
import QuickLogSheet from "@/components/home/QuickLogSheet.vue";
import GoalBar from "@/components/marks/GoalBar.vue";
import GoalDots from "@/components/marks/GoalDots.vue";
import RangeMark from "@/components/marks/RangeMark.vue";
import BinaryCheck from "@/components/marks/BinaryCheck.vue";
import CompositionBar from "@/components/marks/CompositionBar.vue";
import SleepShape from "@/components/marks/SleepShape.vue";
import MealPickSheet from "@/components/food/MealPickSheet.vue";
import RoutineCard from "@/components/home/RoutineCard.vue";
import { publishSummary, buildSummary } from "@/utils/nativeSummary";
import { routineStatus, routineTally } from "@/components/routine/routineModel";
import { dialFor, resolveDials } from "@/components/home/dialModel";
import { useHomeStore } from "@/stores/home";
import { useHabitsStore } from "@/stores/habits";
import RoutinePage from "@/components/routine/RoutinePage.vue";
import ProfileChip from "@/components/layout/ProfileChip.vue";
import PeakMark from "@/components/layout/PeakMark.vue";

const checkin = useCheckinStore();
// A plain reactive object, so every GOALS.x below reads live and works the
// same in the template as it does here. See stores/goals.js.
const GOALS = useGoalsStore().values;
const levels = useLevelsStore();
const profile = useProfileStore();
const food = useFoodStore();
const ui = useUIStore();
const helio = useHelioStore();

// Read, not declared. Home held its own copy of this and the registry held
// another, which is the exact drift metricRegistry exists to prevent.
const STEP_GOAL = metricDef("steps").goal;
// PAI's own literature puts 100 as the threshold linked to lower
// cardiovascular risk, so the tick marks a line to cross rather than a bar to
// fill. Exceeding it is the point.
const PAI_GOAL = 100;
const WINDOW_DAYS = 14;

/**
 * Force every measured vital onto its own row, for checking rows an ordinary day
 * hides. Read once at setup: it is a debugging switch, not a setting, and it has
 * no UI on purpose.
 *
 *   localStorage.setItem('atlas_show_all_vitals', 'true')
 */
const showAllVitals = (() => {
  try {
    return localStorage.getItem("atlas_show_all_vitals") === "true";
  } catch {
    return false;
  }
})();

const todayKey = computed(() => today());
const entry = computed(() => checkin.entryFor(todayKey.value) ?? {});
const famColor = familyColor;
const famInk = familyInkColor;

// ── Wearable history ──────────────────────────────────────────────────────
// Read as one window rather than per metric, matching BodyTab: Recovery needs
// today plus seven prior nights, and the baseline bands need the same rows.
const dayWindow = ref([]);
async function loadWindow() {
  const to = todayKey.value;
  dayWindow.value = await dailyValuesForRange(addDays(to, -(WINDOW_DAYS - 1)), to);
  // Deliberately not awaited, and deliberately after the short window. The
  // condition half of Recovery needs six months of rollups, which is an order
  // more reads than anything else Home does; blocking the first paint on it
  // would be felt during the boot animation. The score shows its
  // deviation-only shape until this lands, which is a state it handles anyway.
  levels.ensure();
}
onMounted(loadWindow);
onMounted(loadStress);
// Home is inside KeepAlive and is the tab you return to, so a sync finished on
// another tab has to be picked up on the way back.
onActivated(loadStress);
// App.vue wraps the tabs in KeepAlive, so returning to Home does not remount.
onActivated(loadWindow);
// A sync finishing while Home is already the visible tab has to land too.
watch(() => helio.lastSyncAt, loadWindow);

// dailyValuesForRange nests the metrics under `values`, the same shape BodyTab
// reads. Reading them flat off the row silently yields undefined for every
// metric, which looks exactly like a device that reported nothing.
const todayValues = computed(
  () => dayWindow.value.find((d) => d.date === todayKey.value)?.values ?? {}
);
const stepsToday = computed(() => todayValues.value.steps ?? null);
const paiToday = computed(() => todayValues.value.pai ?? null);
const stepsText = computed(() =>
  stepsToday.value == null ? "--" : Math.round(stepsToday.value).toLocaleString("en-AU")
);

// ── Dials ─────────────────────────────────────────────────────────────────
// The choosing and the arithmetic live in dialModel.js so they can be tested
// without mounting Home; this only assembles the values it already computes and
// applies the boot multiplier, which is the component's own business.
const home = useHomeStore();
const dialKeys = computed(() =>
  // A ring for a goal that has been switched off can only ever read zero, so a
  // stored choice naming one is replaced rather than drawn empty.
  resolveDials(home.dials, (key) => {
    // Recovery, sleep, the routine and PAI all have a reference that is not a
    // settable goal, so they are always offerable.
    if (["recovery", "sleep", "routine", "pai"].includes(key)) return true;
    return GOALS[key] != null;
  })
);
const dials = computed(() => {
  const tally = routineTally(habitsStore, todayKey.value);
  const bag = {
    recoveryScore: recovery.value.score ?? 0,
    recoveryText: recoveryText.value,
    recoveryColor: recoveryColor(recovery.value.score),
    recoveryInk: recoveryInk(recovery.value.score),
    recoveryBand: recovery.value.label,
    sleepPct: sleepPct.value,
    sleepText: sleepText.value,
    habitsDone: tally.done,
    habitsDue: tally.due,
    totals: {
      steps: stepsToday.value,
      pai: paiToday.value,
      calories: caloriesTotal.value,
      protein: proteinTotal.value,
      fibre: fibreTotal.value,
      water: entry.value.water ?? null,
    },
    goals: GOALS,
    fixedGoals: { pai: metricDef("pai")?.goal ?? null },
    texts: { steps: stepsText.value },
  };
  return dialKeys.value.map((key) => dialFor(key, bag));
});

function openDial(dial) {
  if (dial.opens === "recovery") recoveryOpen.value = true;
  else if (dial.opens === "sleep") sleepOpen.value = true;
  else if (dial.opens === "routine") openRoutine();
  else if (dial.opens === "food") ui.goToFood("diary");
  else openMetric.value = metricDef(dial.key);
}

// ── Recovery ──────────────────────────────────────────────────────────────
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
const recoveryText = computed(() =>
  recovery.value.state === "ready" ? String(recovery.value.score) : "--"
);
const recoveryMeta = computed(() => {
  if (recovery.value.state === "calibrating") {
    return `CALIBRATING · ${recovery.value.nights}/${recovery.value.needed} NIGHTS`;
  }
  return recovery.value.state === "ready" ? recovery.value.label : "NO DATA";
});
const recoveryExplanationText = computed(() => recoveryExplanation(recovery.value));
/**
 * The gap alone: "12 points to GREAT." On a GREAT day there is no gap, and the
 * band's own meaning is already the verdict line above, so this stays empty
 * rather than repeating it.
 */
const gapText = computed(() => {
  const head = recoveryHeadroom(recovery.value);
  if (!head) return "";
  return `${head.pointsNeeded} ${head.pointsNeeded === 1 ? "point" : "points"} to ${head.nextLabel}.`;
});

// ── Cards ─────────────────────────────────────────────────────────────────
const body = computed(() =>
  bodyRows({
    dayWindow: dayWindow.value,
    entry: entry.value,
    todayKey: todayKey.value,
    showAllVitals,
  })
);
const streaks = computed(() =>
  nutritionStreaks({ checkin, food, goals: GOALS, todayKey: todayKey.value })
);
const stepStreak = computed(() =>
  stepsStreak({ dayWindow: dayWindow.value, todayKey: todayKey.value, goal: STEP_GOAL })
);
// Atlas's own sleep score, not the strap's (2026-08-07, user's call: one number
// rather than two while ours was on probation). It is the one the sleep page
// leads with and the one Recovery's sleep term now takes, all three through
// sleepScoreFor, so nothing can show a different number for the same night.
//
// Falls back to duration against goal when the score cannot be had: under three
// nights of recorded bedtimes there is no regularity to measure.
const sleepScore = computed(() =>
  sleepScoreFor({ entries: checkin.entries, entry: entry.value, todayKey: todayKey.value })
);
const sleepPct = computed(() => {
  if (sleepScore.value != null) return Math.min(100, sleepScore.value);
  // Guarded, because a switched-off goal is null and dividing by it gives
  // Infinity, which clamps to a full ring on a day nothing was recorded.
  if (!GOALS.sleep || !entry.value.sleep) return 0;
  return Math.min(100, (entry.value.sleep / GOALS.sleep) * 100);
});
const sleepText = computed(() => {
  if (sleepScore.value != null) return String(sleepScore.value);
  return entry.value.sleep ? fmtHoursMins(entry.value.sleep) : "--";
});

// Protein stays additive: confirmed plan slots and snacks, plus a manual
// override, so a day with no plan filled in can still be logged by hand.
// The day's energy, for the calories dial. Same shape as protein and fibre:
// what the diary logged plus anything added by hand.
const caloriesTotal = computed(() =>
  Math.round(food.kcalFor(todayKey.value) + (entry.value.calories || 0))
);
const proteinTotal = computed(() =>
  Math.round(food.proteinFor(todayKey.value) + (entry.value.protein || 0))
);
const proteinPct = computed(() =>
  GOALS.protein ? Math.min(100, (proteinTotal.value / GOALS.protein) * 100) : 0
);
const fibreTotal = computed(() =>
  Math.round(food.fibreFor(todayKey.value) + (entry.value.fibre || 0))
);
const creatineLabel = computed(() =>
  GOALS.creatine != null && (entry.value.creatine ?? 0) >= GOALS.creatine
    ? `TAKEN · ${entry.value.creatine}G`
    : "NOT TAKEN"
);

// ── Up Next ───────────────────────────────────────────────────────────────
const upNext = computed(() => {
  const plan = food.planFor(todayKey.value);
  const next = plan.slots.find((s) => !s.confirmed);
  if (!next) return null;
  const idx = plan.slots.indexOf(next);
  return {
    timeLabel: fmtTime(next.time),
    name: next.name ?? food.itemById(next.mealId)?.name ?? "MEAL",
    confirm: () => food.confirmSlot(todayKey.value, idx, true),
    swap: { slotIndex: idx, mealId: next.mealId },
  };
});

const swapTarget = ref(null);
function onSwapPick(mealId, quantity) {
  food.swapSlot(todayKey.value, swapTarget.value.slotIndex, mealId, quantity);
  swapTarget.value = null;
}

// ── Quick log ─────────────────────────────────────────────────────────────
// QuickLogSheet takes a field descriptor (or a list of them) and hands back
// [key, value] pairs. The Home rewrite passed it the bare string "creatine"
// instead, which produced a sheet with no label, a NaN stepper and a save that
// wrote nothing.
const quickLog = ref(null);
const sleepOpen = ref(false);
const recoveryOpen = ref(false);
const stressOpen = ref(false);
const routineOpen = ref(false);
const routineAdd = ref(false);
function openRoutine(mode) {
  routineAdd.value = mode === "add";
  routineOpen.value = true;
}

// ── Pull to refresh ───────────────────────────────────────────────────────
// Forced, unlike the resume and tick refreshes: a deliberate pull should always
// talk to the strap, or the gesture reads as broken on the second try.
const scroller = ref(null);
const { pull, refreshing, armed, note } = usePullToRefresh(scroller, async () => {
  // Returned, not swallowed: a refresh that declined to run says why, and the
  // indicator holds that line up for a moment instead of shutting silently.
  const reason = await helio.refresh({ force: true }).catch(() => null);
  await Promise.all([loadStress(), loadWindow()]);
  return reason;
});

// ── The mirror the native surfaces read ───────────────────────────────────
// Home already computes every number the notification and the widget show, and
// nothing native can reach the app's storage to compute them itself. So Home
// publishes them, and the native side only renders. Watched rather than pushed
// on a timer: the numbers change when the numbers change.
const habitsStore = useHabitsStore();
const nativeSummary = computed(() => {
  const tally = routineTally(habitsStore, todayKey.value);
  return buildSummary({
    steps: stepsToday.value,
    stepsGoal: metricDef("steps")?.goal ?? null,
    routineDone: tally.done,
    routineDue: tally.due,
    recovery: recovery.value.state === "ready" ? Math.round(recovery.value.score) : null,
    recoveryBand: recovery.value.state === "ready" ? recovery.value.label : null,
    sleepText: entry.value.sleep ? fmtHoursMins(entry.value.sleep) : null,
    sleepHours: entry.value.sleep ?? null,
    sleepGoal: goalOrDefault("sleep"),
    protein: proteinTotal.value,
    proteinGoal: GOALS.protein,
    nextHabit: routineStatus(habitsStore, todayKey.value).next?.name ?? null,
    syncedAt: helio.lastSyncAt,
    strapBattery: helio.battery,
  });
});
watch(nativeSummary, (value) => publishSummary(value), { immediate: true, deep: true });
const openMetric = ref(null);

/**
 * A vital row on Home opens the same place the identical row on BODY opens.
 *
 * Stress was the only one wired up, so HRV and resting HR were dead rows on the
 * screen most likely to be tapped, while the same row one tab over navigated.
 * Stress and sleep keep their own pages; everything else has a MetricPage, which
 * this component was already mounting for protein and fibre.
 */
const canOpenVital = (key) => key === "stress" || key === "sleep" || !!metricDef(key);

function openVital(key) {
  if (key === "stress") stressOpen.value = true;
  else if (key === "sleep") sleepOpen.value = true;
  else {
    const def = metricDef(key);
    if (def) openMetric.value = def;
  }
}

// The log sheet closes first: two overlays stacked on a phone leaves nowhere
// to tap out of, and back would only ever dismiss one of them.
function onQuickLogHistory(key) {
  const def = metricDef(key);
  quickLog.value = null;
  if (def) openMetric.value = def;
}

// Sentence case, not the shouted mono the zone constants carry: this sits in
// the value column beside "7h 30m", which is a reading and not a label.
const stressZoneLabel = (value) => {
  const label = zoneFor(value)?.label ?? "";
  return label ? label.charAt(0) + label.slice(1).toLowerCase() : "";
};

// Today's stress readings, for the row's own little chart. Loaded separately
// from the day window because that holds one rolled-up figure per day and this
// row wants the shape underneath it.
const stressSamples = ref([]);
async function loadStress() {
  const start = new Date(`${today()}T00:00:00`).getTime();
  try {
    stressSamples.value = await getSamples("stress", start, start + 86400000);
  } catch {
    stressSamples.value = [];
  }
}

function logWater() {
  quickLog.value = {
    key: "water",
    label: "WATER",
    unit: "L",
    step: 0.25,
    value: entry.value.water ?? 0,
  };
}

// Protein and fibre used to open a manual-extra stepper here. They now go
// straight to their page, where the same manual figure is editable per day
// alongside the history - so nothing is lost, and the row stops being the only
// place on Home that opened a sheet to type a number into.

// Creatine is a binary dose, not a quantity you creep up on, so it stays a
// toggle rather than a stepper: one tap fills to the goal, a second undoes a
// mistap.
function toggleCreatine() {
  // Unreachable while the goal is off, since the row is not drawn. Guarded
  // anyway: `x >= null` is `x >= 0`, so without this the tap would record a
  // dose of null and the row would then call itself taken.
  if (GOALS.creatine == null) return;
  const done = (entry.value.creatine ?? 0) >= GOALS.creatine;
  checkin.logMetric({ creatine: done ? 0 : GOALS.creatine });
}

function onQuickLogSave(pairs) {
  checkin.logMetric(Object.fromEntries(pairs));
  quickLog.value = null;
}

const dateLabel = computed(() =>
  new Date(`${todayKey.value}T00:00:00`)
    .toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })
    // The locale's comma is punctuation for a sentence, and this is a chip.
    .replace(",", "")
    .toUpperCase()
);

// The strap's state. This used to go silent when everything was fine, on the
// grounds that a permanent "SYSTEM ONLINE" is a light that is always on and so
// says nothing. That still holds for a *status word* - but the user could not
// tell from Home whether the data in front of them was live, which is a fair
// complaint about silence. A **time** is not a permanent light: it changes with
// every sync, and it answers the question the silence left open. So a current
// strap now says when it last spoke, and only the wording changes as it ages.
const syncNote = computed(() => {
  // **First, and ahead of every other state.** Opening the app fires
  // `helio.startup()` and a silent sync, and both read IndexedDB, so the page
  // paints with the wordmark and Recovery up but the sleep row, the date and the
  // sync time still arriving, and the scroller not yet responding. Reported as
  // "the app is frozen", which is the right reading of a screen that is showing
  // finished work while doing unfinished work and saying nothing about it. It
  // sits above the failure states deliberately: while a sync is actually running,
  // the error still on the store is by definition from a previous one, which is
  // the same ordering `DevicePanel`'s status label already uses.
  if (helio.syncing) return { text: helio.syncPhase || "SYNCING" };
  if (!helio.connected) return { text: "STRAP NOT CONNECTED", warn: true };
  if (helio.lastSyncError) return { text: "SYNC FAILING", warn: true };
  if (recovery.value.state === "calibrating") return { text: "LEARNING YOUR BASELINE" };
  if (!helio.lastSyncAt) return { text: "NOT SYNCED YET", warn: true };

  const mins = Math.round((Date.now() - helio.lastSyncAt) / 60000);
  if (mins < 60) {
    const at = new Date(helio.lastSyncAt).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return { text: `SYNCED ${at}` };
  }
  const hours = Math.round(mins / 60);
  return { text: hours >= 24 ? "SYNCED OVER A DAY AGO" : `SYNCED ${hours}H AGO`, warn: hours >= 12 };
});

// ── Boot ──────────────────────────────────────────────────────────────────
// Retargeted from the orbit instrument to the new geometry, keeping the one
// idea worth keeping: this is not an overlay played over the UI, it is the
// real data rendered with a time-scaled multiplier. The multiplier reaches 1
// and stays there, so there is no seam where the animation hands over.
//
// Do not reimplement as CSS keyframes. That was the first attempt and it read
// as a generic pop-in rather than an instrument calibrating.
const BOOT_END = 2200;
const DIAL_START = 700;
const DIAL_DUR = 900;
const CARD_START = 1300;
const CARD_STEP = 150;
// The nav comes back just before the clock stops, so the frame does not
// pre-exist the instrument.
const NAV_BACK = 1900;

const playBoot = ref(true);
const bootT = ref(0);
let rafId = null;

function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3);
}
function segProgress(t, start, dur) {
  if (t <= start) return 0;
  if (t >= start + dur) return 1;
  return easeOutCubic((t - start) / dur);
}

const bootScale = computed(() =>
  playBoot.value ? segProgress(bootT.value, DIAL_START, DIAL_DUR) : 1
);
const blackoutOpacity = computed(() => 1 - segProgress(bootT.value, 120, 460));
const logoCount = computed(() => Math.max(0, Math.min(5, Math.floor((bootT.value - 260) / 105))));
// TLAS, not ATLAS: the A is the peak beside it. The count still runs 0-5 on the
// old rhythm, with 1 spent on the peak, so the boot's timing is unchanged.
const typedLogo = computed(() =>
  playBoot.value ? "TLAS".slice(0, Math.max(0, logoCount.value - 1)) : "TLAS"
);
const logoTyping = computed(() => playBoot.value && bootT.value < 900);
// The boot line reports the one thing worth reporting while the instrument
// comes up: whether the strap is there. It types in with the wordmark, holds
// long enough to read, then clears rather than settling into a permanent
// caption nobody reads twice.
const bootLine = computed(() => {
  if (bootT.value < 620) return "";
  if (bootT.value > 1700) return "";
  return helio.connected ? "STRAP CONNECTED" : "STRAP NOT CONNECTED";
});

function reveal(index) {
  if (!playBoot.value) return 1;
  const start = index === 0 ? DIAL_START : CARD_START + (index - 1) * CARD_STEP;
  return segProgress(bootT.value, start, 380);
}
// Opacity and transform together, so a card that has arrived carries no
// transform at all: a lingering translate on every card is a compositing cost
// for nothing.
function cardStyle(index) {
  const p = reveal(index);
  return p >= 1 ? { opacity: 1 } : { opacity: p, transform: `translateY(${(1 - p) * 10}px)` };
}

// While the boot clock is still running, a tap on a dial means "skip", not
// "navigate". The dials are mid-calibration at that point, and leaving Home
// with the sequence half-played strands it: coming back does not remount.
function dialTap(action) {
  if (playBoot.value) {
    skipBoot();
    return;
  }
  action();
}

function skipBoot() {
  if (!playBoot.value) return;
  bootT.value = BOOT_END;
  playBoot.value = false;
  ui.bootActive = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

onMounted(() => {
  // Fire and forget, both of them. Boot must not block on a sync, and failures
  // are recorded on the stores rather than swallowed, so a storage problem
  // surfaces in Settings instead of silently dropping samples.
  helio.startup();

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    skipBoot();
    return;
  }
  const t0 = performance.now();
  function frame(now) {
    bootT.value = now - t0;
    if (bootT.value >= NAV_BACK) ui.bootActive = false;
    if (bootT.value < BOOT_END) {
      rafId = requestAnimationFrame(frame);
    } else {
      playBoot.value = false;
      rafId = null;
    }
  }
  rafId = requestAnimationFrame(frame);
});

onUnmounted(() => rafId && cancelAnimationFrame(rafId));
</script>

<style scoped>
.home {
  /* Each tab is its own scroll container, because `body` is `overflow: hidden`.
     Home used to size itself with min-height instead, so anything past the fold
     was simply clipped and unreachable. */
  height: 100%;
  overflow-y: auto;
  /* Matches every other tab. Without the top inset the wordmark and the
     profile chip sit underneath the clock and battery icons. */
  padding: calc(12px + env(safe-area-inset-top)) 18px
    calc(96px + env(safe-area-inset-bottom));
  /* Overscans past #app-shell so the Android overlay scroll bar is drawn off
     the edge; the padding puts the 18px gutter back. See style.css. */
  margin-right: calc(-1 * var(--sb-overscan));
  padding-right: calc(18px + var(--sb-overscan));
  position: relative;
}
.blackout {
  position: fixed;
  inset: 0;
  background: var(--bg1);
  z-index: 900;
  pointer-events: none;
}

/* Fixed height, and it has to stay fixed. This row used to derive its height
   from its own baseline, so the wordmark jumped the moment the typing cursor
   gave it real content. */
/* 34px is the chip's own height, which is what sets this row on every other
   tab. Fixed rather than derived, because the chip is absent during boot and
   the row would otherwise collapse to the wordmark and then grow. */
.hd {
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
/* Type comes from .wordmark in style.css, shared with every other screen. What
   stays here is the fixed height, which is layout, and load-bearing: the
   typed-out wordmark changes width character by character during boot. */
.logo {
  display: flex;
  align-items: center;
  height: 24px;
}
.cursor {
  display: inline-block;
  width: 2px;
  height: 17px;
  margin-left: 3px;
  background: var(--acc);
  animation: blink 0.7s steps(2) infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
.hd-sub {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 5px;
  min-height: 14px;
}
.sys {
  font-size: var(--fs-label);
  letter-spacing: 1.6px;
  color: var(--dim);
}
/* The accent, matching the bold label AppHeader gives every other tab: the date
   is what Home puts in that slot, and it read as a different kind of thing in
   --ink. What follows the separator stays --dim on every tab alike. */
.datechip {
  color: var(--acc);
}
.warn {
  color: var(--bad);
}
/* 72px rather than the shared 56px --row-h, to fit the 34px hypnogram with the
   same breathing room every other row has. Only this row: the rest of Home
   still runs on the token. */
.sleeprow {
  min-height: 72px;
}
/* Sits between the band and the value, so the number is read as "51, mild"
   rather than as two separate facts. */
/* The stress columns all stand on the bottom edge of their box, so a mark
   centred in the row put its baseline 10px below the baseline of the word
   beside it and the day appeared to hang. Measured, not guessed: on a 56px row
   the mark's bottom lands at 45px and the value's baseline at 35px. Re-measure
   if --row-h or --fs-value changes. The sleep mark needs none of this because
   its shape uses the full height, so its optical centre is the box's centre. */
.stressmark {
  position: relative;
  top: -10px;
}
.pipnote {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: var(--fs-label);
  letter-spacing: 0.6px;
}
.pipnote i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.pipnote span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* A separator, so the two mono strings do not read as one run-on line. */
.datechip + .sys::before {
  content: "·";
  margin-right: 10px;
  color: var(--dim);
}

.dials {
  display: flex;
  justify-content: space-around;
  gap: 6px;
  /* The dials are the focus of the screen, so they get room above and below
     rather than sitting tight against the header and the first card. */
  margin: 30px 0 20px;
}

.verdictrow {
  display: flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
}
.verdictcol {
  flex: 1;
  min-width: 0;
}
.headroom {
  margin: 0 0 8px;
  font-size: var(--fs-second);
  line-height: 1.55;
  color: var(--dim);
}
/* The chevron alone said "this opens", but not what opens. Words as well, in the
   accent so it reads as the one thing on this card you can act on. */
.more {
  margin: 0;
  font-size: var(--fs-micro);
  letter-spacing: 0.12em;
  color: var(--acc);
}
.verdictrow .chev {
  color: var(--dim);
  font-size: 15px;
  flex-shrink: 0;
}
.verdict {
  margin: 2px 0 8px;
  font-size: var(--fs-prose);
  line-height: 1.55;
  color: var(--body);
  flex: 1;
  min-width: 0;
}
.calib {
  font-size: var(--fs-label);
  letter-spacing: 1px;
  color: var(--dim);
}

.upnext {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 0 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--dim) 18%, transparent);
}
.upline {
  display: flex;
  align-items: baseline;
  gap: 9px;
}
.upacts {
  display: flex;
  gap: 8px;
}
.upacts button {
  flex: 1;
}
.upnext .t {
  font-size: var(--fs-label);
  letter-spacing: 1px;
  color: var(--dim);
  width: var(--row-label-w);
  flex-shrink: 0;
}
.upnext .meal {
  font-size: var(--fs-prose);
  color: var(--ink);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.swp,
.cfm {
  font-size: var(--fs-label);
  letter-spacing: 1.2px;
  padding: 9px 12px;
  min-height: 40px;
  border-radius: 5px;
  background: none;
  cursor: pointer;
}
.swp {
  border: 1px solid color-mix(in srgb, var(--dim) 50%, transparent);
  color: var(--dim);
}
.cfm {
  border: 1px solid var(--fam-intake);
  color: var(--fam-intake);
}
</style>
