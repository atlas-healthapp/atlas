<template>
  <div ref="scroller" class="activity grid-bg">
    <PullIndicator :pull="pull" :refreshing="refreshing" :armed="armed" :note="note" />
    <AppHeader label="FITNESS" :meta="headerMeta" />

    <!-- Today first, and everything below it is history. The same rule Home
         follows, applied one level down. Tiles rather than goal bars: steps has
         rarely reaches its goal so its bar sat permanently half empty, and PAI
         passed its threshold days ago and sat pinned full. -->
    <HomeCard title="TODAY" :color="famColor('steps')" :meta="todayMeta">
      <!-- **Both tiles open their own page.** The USUALLY line under each of
           them was the only thing anywhere in Atlas that said anything about
           steps or PAI over time, and `MetricPage` was already mounted at the
           bottom of this file, already imported, and unreachable, because
           nothing ever assigned `openMetric`. So the history existed the whole
           time and there was no door to it. `metricRegistry` already describes
           both, including the 30-day window and the rolling mean line the bar
           chart draws over the daily bars, which is the averages-over-time part.

           Buttons rather than tappable divs: they are the only thing in this
           card that navigates, and a div with a click handler is not reachable
           by keyboard or announced as a control. -->
      <div class="tiles">
        <button type="button" class="tile" @click="openMetric = METRICS.steps">
          <div class="k mono">STEPS<span class="chev" aria-hidden="true">›</span></div>
          <div class="v">{{ stepsText }}</div>
          <div class="sub mono">{{ stepsNote }}</div>
        </button>
        <button type="button" class="tile" @click="openMetric = METRICS.pai">
          <div class="k mono">PAI<span class="chev" aria-hidden="true">›</span></div>
          <div class="v">
            {{ paiText }}<small v-if="paiDelta"> {{ paiDelta }}</small>
          </div>
          <div class="sub mono">{{ paiNote }}</div>
        </button>
      </div>

      <!-- Today's sessions repeat in the list below, deliberately: a session
           list that skipped today would be missing a day whenever you scanned
           it, and that costs more than one repetition. -->
      <MetricRow
        v-for="s in todaySessions"
        :key="s.startMillis"
        :label="fmtDuration(s.activeSeconds)"
        tappable
        @click.stop="openSession = s"
      >
        <span class="pill mono" :class="{ named: sessionStore.typeNameFor(s) }">
          {{ sessionPill(s) }}
        </span>
      </MetricRow>

      <!-- The routine is a page, not a card here: nine daily habits with their
           own sequence do not fit beside a session list, and this row is the
           door. Home is where the bands are drawn. -->
      <MetricRow
        label="ROUTINE"
        :value="routine.due ? `${routine.done}/${routine.due}` : '—'"
        tappable
        goes="ROUTINE"
        @click.stop="routineOpen = true"
      >
        <RoutineDots :bands="bands" :color="famColor('habits')" />
      </MetricRow>
    </HomeCard>

    <!-- Volume next. A list of sessions looks the same whether they were four
         hard ones or four warm-ups, so the tab says how much was actually done
         before it lists anything. -->
    <HomeCard title="THIS WEEK" :color="famColor('workouts')" :meta="weekSessionMeta">
      <div class="bigstat">
        <span class="n">{{ fmtMinutes(weekMinutes) }}</span>
        <span class="l mono">ACTIVE</span>
      </div>
      <div class="weeknote mono">{{ weekMeta }}</div>
      <div class="weekchart" role="img" :aria-label="weekAria">
        <div
          v-for="(col, i) in week"
          :key="col.date"
          class="col"
          :class="{ hot: col.isToday, zero: !col.minutes }"
        >
          <div
            class="bar"
            :style="{ height: `${Math.max(heights[i] * 100, col.minutes ? 6 : 0)}%` }"
          ></div>
        </div>
      </div>
      <div class="weekaxis">
        <span v-for="col in week" :key="col.date" :class="{ on: col.isToday }">
          {{ col.label }}
        </span>
      </div>
    </HomeCard>

    <HomeCard title="THIS MONTH" :color="famColor('workouts')" :meta="fmtMinutes(month.total)">
      <div v-if="loaded && !month.rows.length" class="calib mono">NOTHING LOGGED THIS MONTH.</div>
      <div v-for="row in month.rows" :key="row.name ?? 'unnamed'" class="typerow">
        <span class="tname mono" :class="{ untyped: row.unnamed }">
          {{ row.unnamed ? "UNNAMED" : row.name }}
        </span>
        <span class="tbar">
          <i :class="{ untyped: row.unnamed }" :style="{ width: `${row.fraction * 100}%` }"></i>
        </span>
        <span class="tval mono">{{ fmtMinutes(row.minutes) }}</span>
      </div>
    </HomeCard>

    <!-- The count of unnamed sessions lives in the header, so the tab says
         there is work without turning into a chore list. An unnamed session you
         do not care about scrolls away; a card that demanded you deal with it
         never would. -->
    <HomeCard title="SESSIONS" :color="famColor('workouts')" :meta="unnamedMeta">
      <div v-if="loaded && !sessions.length" class="calib mono">
        NO SESSIONS IN THE LAST {{ WINDOW_DAYS }} DAYS.
      </div>
      <MetricRow
        v-for="s in sessions"
        :key="s.startMillis"
        :label="workoutDayLabel(s.startMillis)"
        :value="fmtDuration(s.activeSeconds)"
        tappable
        @click.stop="openSession = s"
      >
        <span class="pill mono" :class="{ named: sessionStore.typeNameFor(s) }">
          {{ sessionPill(s) }}
        </span>
      </MetricRow>
    </HomeCard>

    <RoutinePage v-if="routineOpen" from="FITNESS" @close="routineOpen = false" />
    <MetricPage v-if="openMetric" :def="openMetric" from="FITNESS" @close="openMetric = null" />
    <WorkoutDetailSheet
      v-if="openSession"
      :workout="openSession"
      :siblings="sessions"
      :band-records="rawSessions"
      @close="openSession = null"
    />
  </div>
</template>

<script setup>
import PullIndicator from "@/components/layout/PullIndicator.vue";
import { usePullToRefresh } from "@/composables/usePullToRefresh";
import { ref, computed, onMounted, onActivated, watch } from "vue";
import { useCheckinStore } from "@/stores/checkin";
import { useSessionsStore } from "@/stores/sessions";
import { useHabitsStore } from "@/stores/habits";
import { useHelioStore } from "@/stores/helio";
import AppHeader from "@/components/layout/AppHeader.vue";
import { dailyValuesForRange } from "@/utils/dailyRollup";
import { today, addDays } from "@/utils/date";
import { getWorkouts } from "@/utils/sampleDb";
import { familyColor } from "@/utils/families";
import { usualRange } from "@/utils/baseline";
import { formatValue, METRICS } from "@/utils/metricRegistry";
import { workoutDayLabel, workoutTimeLabel } from "./workouts";
import { resolveSessions } from "./resolveSessions";
import {
  weekColumns,
  columnHeights,
  monthTotals,
  monthStart,
  fmtMinutes,
  fmtDuration,
} from "./activityModel";
import { routineBands, routineTally, nextUp } from "@/components/routine/routineModel";
import HomeCard from "@/components/home/HomeCard.vue";
import MetricRow from "@/components/home/MetricRow.vue";
import RoutineDots from "@/components/marks/RoutineDots.vue";
import RoutinePage from "@/components/routine/RoutinePage.vue";
import { useUIStore } from "@/stores/ui";
import MetricPage from "@/components/metrics/MetricPage.vue";
import WorkoutDetailSheet from "./WorkoutDetailSheet.vue";

// 30 days, matching the window metricRegistry gives steps and PAI, and enough
// to cover a calendar month's totals on any day of it.
const WINDOW_DAYS = 31;

const checkin = useCheckinStore();
// `sessions` is already the list of workouts on screen, so the store keeps a
// distinct name rather than shadowing it.
const sessionStore = useSessionsStore();
const helio = useHelioStore();
const habits = useHabitsStore();
const ui = useUIStore();
const famColor = familyColor;

// The routine lives in localStorage, not in the sample archive, so it needs
// none of the async window loading the rest of the tab does.
const bands = computed(() => routineBands(habits, today()));
const routine = computed(() => routineTally(habits, today()));
const next = computed(() => nextUp(habits, today()));
const routineOpen = ref(false);

const scroller = ref(null);
const { pull, refreshing, armed, note } = usePullToRefresh(scroller, async () => {
  const reason = await helio.refresh({ force: true, trigger: "pull-fitness" }).catch(() => null);
  await loadWindow();
  return reason;
});

const openMetric = ref(null);
const openSession = ref(null);
const dayWindow = ref([]);
// Straight off the device, before any correction. Everything on screen reads
// the resolved list instead, or an edited duration would show in the session
// row and not in the week chart above it.
const rawSessions = ref([]);

/**
 * What the sessions actually were: deletions dropped, split records folded
 * back together, durations corrected.
 *
 * Done once, here, because every card on the tab consumes it. Applying any of
 * it per-card is how the week chart and the session list end up disagreeing
 * about the same day.
 */
const sessions = computed(() => resolveSessions(rawSessions.value, sessionStore));

/**
 * Has the archive answered yet?
 *
 * **A card saying NOTHING LOGGED before the read comes back is a lie, not a
 * blank.** Reported 2026-08-19: tapping a widget cold-starts the app, the reads
 * queue behind the sync the launch kicks off, and both cards below spent that
 * whole sync claiming a month with sessions in it was empty. The tiles above
 * show `--` while they wait, which is honest; a sentence is not.
 *
 * Set in a `finally` for the same reason Home's `dataReady` is: a read that
 * throws must still release it, or the cards never say anything again.
 */
const loaded = ref(false);

async function loadWindow() {
  const to = today();
  const from = addDays(to, -(WINDOW_DAYS - 1));
  try {
    dayWindow.value = await dailyValuesForRange(from, to);

    // A month can start before the 31-day window on the last day of a long
    // month, so the session query reaches back to whichever is earlier.
    const earliest = monthStart(to) < from ? monthStart(to) : from;
    const fromMillis = new Date(`${earliest}T00:00:00`).getTime();
    const toMillis = new Date(`${to}T23:59:59.999`).getTime();
    const found = await getWorkouts(fromMillis, toMillis);
    rawSessions.value = [...found].sort((a, b) => b.startMillis - a.startMillis);
  } finally {
    loaded.value = true;
  }
}

// onMounted alone is not enough: App.vue wraps the tabs in KeepAlive, so this
// mounts once per app run and would otherwise show whatever the numbers were
// the first time FITNESS was opened.
onMounted(loadWindow);
onActivated(loadWindow);

/** Arriving from the steps widget, which is what FITNESS owns. */
function claimWidgetTarget() {
  if (ui.claimOpen("steps")) openMetric.value = METRICS.steps;
}
onMounted(claimWidgetTarget);
onActivated(claimWidgetTarget);
// A sync can finish while this tab is already visible. SettingsPage is a
// sibling overlay outside the KeepAlive block, so tapping SYNC NOW there never
// activates this component and neither hook above fires.
watch(() => helio.lastSyncAt, loadWindow);

// The ACTIVITY sheet itself now lives in CreateSheets, beside the tab bar, so
// the tab underneath does not have to change to show it. A manual session is
// stored in Pinia rather than IndexedDB, and `sessions` is computed through
// `resolveSessions` which reads the store, so one saved while this tab was not
// even on screen is already in the list by the time you arrive. The day
// window's own totals still come from a fetch, so a reload is worth doing when
// the tab is shown.
watch(
  () => ui.createSheet,
  (sheet, was) => {
    if (sheet == null && was === "add-activity") loadWindow();
  }
);

const todayKey = computed(() => today());

const week = computed(() => weekColumns(sessions.value, todayKey.value));
const heights = computed(() => columnHeights(week.value));
const weekMinutes = computed(() => week.value.reduce((sum, c) => sum + c.minutes, 0));
const weekSessionCount = computed(
  () => week.value.filter((c) => c.minutes > 0).length
);
const weekMeta = computed(() =>
  weekSessionCount.value === 1 ? "1 ACTIVE DAY" : `${weekSessionCount.value} ACTIVE DAYS`
);
// The card says THIS WEEK, so it counts this week. headerMeta counts the whole
// 31-day window the tab loads, which is a different number and was reading as
// the week's.
const weekSessionMeta = computed(() => {
  const dates = new Set(week.value.map((c) => c.date));
  const n = sessions.value.filter((s) =>
    dates.has(new Date(s.startMillis).toLocaleDateString("sv"))
  ).length;
  return n === 1 ? "1 SESSION" : `${n} SESSIONS`;
});
const weekAria = computed(() =>
  week.value.map((c) => `${c.label} ${Math.round(c.minutes)} minutes`).join(", ")
);

const month = computed(() =>
  monthTotals(sessions.value, monthStart(todayKey.value), (s) =>
    sessionStore.typeNameFor(s)
  )
);

const unnamedMeta = computed(() => {
  const count = sessionStore.unnamedCount(sessions.value);
  return count ? `${count} UNNAMED` : "";
});

const headerMeta = computed(() =>
  sessions.value.length === 1 ? "1 SESSION" : `${sessions.value.length} SESSIONS`
);

// Sessions that started today, for the TODAY card. Read off the same resolved
// list as everything else, so a corrected duration shows here too.
const todaySessions = computed(() =>
  sessions.value.filter(
    (s) => new Date(s.startMillis).toLocaleDateString("sv") === todayKey.value
  )
);
const todayMeta = computed(() => {
  const n = todaySessions.value.length;
  if (!n) return "";
  return n === 1 ? "1 SESSION" : `${n} SESSIONS`;
});

// The type takes the line once there is one. A named session's calories are
// still in the detail sheet, and what it was matters more than what it burned.
// Average HR was here originally and was the item being cut off mid-word.
function sessionPill(s) {
  const name = sessionStore.typeNameFor(s);
  if (name) return `${name.toUpperCase()} · ${workoutTimeLabel(s.startMillis)}`;
  const parts = [workoutTimeLabel(s.startMillis)];
  if (s.caloriesKcal != null) parts.push(`${Math.round(s.caloriesKcal)} KCAL`);
  return parts.join(" · ");
}

function valuesFor(key) {
  return dayWindow.value.map((d) => d.values?.[key] ?? null);
}
function todayValue(key) {
  return dayWindow.value.find((d) => d.date === todayKey.value)?.values?.[key] ?? null;
}

const stepsToday = computed(() => todayValue("steps"));
const stepsText = computed(() => formatValue(METRICS.steps, stepsToday.value));
const stepsNote = computed(() => {
  const prior = dayWindow.value
    .filter((d) => d.date < todayKey.value)
    .map((d) => d.values?.steps ?? null)
    .filter((v) => v != null);
  // The middle half of your days, not a 95% prediction interval. The interval
  // is built to contain nineteen days in twenty, which on a count that swings
  // from 950 to 5,700 spanned zero to eight thousand: true, and no description
  // of an ordinary day.
  const range = usualRange(prior);
  if (!range) return "BUILDING A RANGE";
  const fmt = (v) => Math.round(v).toLocaleString("en-AU");
  return `USUALLY ${fmt(range.low)}–${fmt(range.high)}`;
});

const paiToday = computed(() => todayValue("pai"));
const paiText = computed(() =>
  paiToday.value == null ? "--" : String(Math.round(paiToday.value))
);
const paiDelta = computed(() => {
  const series = valuesFor("pai").filter((v) => v != null);
  if (series.length < 2 || paiToday.value == null) return "";
  const change = Math.round(paiToday.value - series[series.length - 2]);
  if (!change) return "";
  return change > 0 ? `▲ ${change}` : `▼ ${Math.abs(change)}`;
});
// PAI is a threshold to cross, not a bar to fill, so what matters is how long
// it has been over rather than how far.
const paiNote = computed(() => {
  if (paiToday.value == null) return "NO READING TODAY";
  const goal = METRICS.pai.goal;
  if (paiToday.value < goal) return `${Math.round(goal - paiToday.value)} UNDER ${goal}`;
  let days = 0;
  for (const d of [...dayWindow.value].reverse()) {
    const v = d.values?.pai;
    if (v == null || v < goal) break;
    days += 1;
  }
  return days > 1 ? `OVER ${goal} FOR ${days}D` : `OVER ${goal}`;
});
</script>

<style scoped>
.activity {
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
  /* **Tracking is for short labels, not for a line.** At 0.8px this string paid
     about 20px of its width in gaps between letters, and after the type scale
     went up on 2026-08-27 that was the difference between "OUTDOOR CLIMBING ·
     12:33 PM" fitting and the clock being ellipsed mid-time. Same reasoning as
     ProfileChip's near-zero tracking: mono tracking that suits a four-letter
     label works against a twenty-six character one. The longest type names can
     still truncate, and the ellipsis is the right answer when they do. */
  letter-spacing: 0.3px;
  color: var(--dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* A named session's line is the answer to what the tab was asking, so it stops
   being secondary text. */
.pill.named {
  color: var(--fam-activity);
}
.calib {
  font-size: var(--fs-label);
  letter-spacing: 1px;
  color: var(--dim);
  padding: 6px 0 10px;
}

.weeknote {
  font-size: var(--fs-micro);
  letter-spacing: 1.6px;
  color: var(--dim);
  margin-top: 2px;
}
.bigstat {
  display: flex;
  align-items: baseline;
  gap: 9px;
  margin: 2px 0 2px;
}
.bigstat .n {
  font-size: 32px;
  font-weight: 300;
  color: var(--ink);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.bigstat .l {
  font-size: var(--fs-micro);
  letter-spacing: 1.4px;
  color: var(--dim);
}

.weekchart {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 74px;
  margin: 8px 0 5px;
}
.weekchart .col {
  flex: 1;
  display: flex;
  align-items: flex-end;
  height: 100%;
}
.weekchart .bar {
  width: 100%;
  background: color-mix(in srgb, var(--fam-activity) 32%, transparent);
  border-radius: 2px 2px 0 0;
}
.weekchart .col.hot .bar {
  background: var(--fam-activity);
}
/* A rest day is drawn as a floor rather than left blank: an empty column and a
   column that has not loaded look identical otherwise. */
.weekchart .col.zero .bar {
  height: 2px;
  background: color-mix(in srgb, var(--dim) 22%, transparent);
}
.weekaxis {
  display: flex;
  gap: 6px;
  padding-bottom: 4px;
}
.weekaxis span {
  flex: 1;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 0.6px;
  color: var(--dim);
}
.weekaxis span.on {
  color: var(--fam-activity);
}

.typerow {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
}
/* Wide enough for "Outdoor Climbing", which is the longest of the seeded types
   and was truncating to "Outdoor Climbi…". The value column gives up the space:
   it only ever holds something like "1h 19m". */
.typerow .tname {
  width: 132px;
  flex: none;
  font-size: var(--fs-label);
  letter-spacing: 0.8px;
  color: var(--body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.typerow .tname.untyped {
  color: var(--dim);
}
.typerow .tbar {
  flex: 1;
  height: 8px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--fam-activity) 14%, transparent);
  position: relative;
  min-width: 0;
}
.typerow .tbar i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 2px;
  background: var(--fam-activity);
}
/* Hatched, so unnamed time reads as time not yet accounted for rather than as
   another category. */
.typerow .tbar i.untyped {
  background: repeating-linear-gradient(
    -45deg,
    color-mix(in srgb, var(--dim) 55%, transparent) 0 3px,
    transparent 3px 6px
  );
}
.typerow .tval {
  width: 54px;
  text-align: right;
  font-size: var(--fs-label);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

/* **Brought into line with the diary's macro tiles** (2026-08-26, reported as
   wanting to be bigger and to look more like FOOD's). The two were the same idea
   drawn at different sizes: this one set its figures at 21px against the diary's
   27 and its labels at a hardcoded 10.5px against the type scale's own token, so
   the same kind of number read as less important on this tab than on that one.
   Everything here now matches `DiaryView`'s `.tiles`, including the surface -
   these sat on `--bg1`, which recessed them into the page rather than letting
   them sit on the card they belong to. */
.tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: color-mix(in srgb, var(--dim) 14%, transparent);
  border-radius: 7px;
  overflow: hidden;
  margin: 2px 0 6px;
}
/* A button now, so the browser's own button styling has to be undone before the
   tile looks like a tile again. Left-aligned and full width, or the figures stop
   lining up with the labels above them. */
.tile {
  background: var(--panel);
  padding: 10px 12px 11px;
  min-height: 78px;
  display: block;
  width: 100%;
  border: none;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
/* The chevron rides on the label rather than in a corner of its own, so the
   affordance sits on the first thing read. A tile is a box of type with no row
   shape to it, so without one there was nothing at all to say it opens
   something - which is exactly how it went unnoticed that it did not. */
.tile .k {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: var(--fs-label);
  letter-spacing: 1.2px;
  color: var(--fam-activity);
}
.tile .chev {
  font-size: 16px;
  line-height: 1;
  letter-spacing: 0;
  opacity: 0.75;
}
.tile .v {
  font-size: 27px;
  line-height: 1.2;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  margin: 3px 0 4px;
}
/* The PAI delta rides inside the figure, so it takes the label size rather than
   the figure's: at 11px against 21px it read as a footnote stuck to a number,
   and against 27px it would have disappeared. */
.tile .v small {
  font-size: var(--fs-label);
  letter-spacing: 0.5px;
  color: var(--dim);
}
.tile .sub {
  font-size: var(--fs-label);
  letter-spacing: 1px;
  color: var(--dim);
}
</style>
