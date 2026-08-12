<template>
  <Teleport to="body">
    <div class="page grid-bg">
      <div class="pscroll">
        <PageHeader :from="from" @close="$emit('close')">
          <template #right>
            <button
              class="stepbtn"
              type="button"
              aria-label="The day before"
              @click="viewDate = addDays(viewDate, -1)"
            >
              ‹
            </button>
            <span class="datetext">{{ dayLabel }}</span>
            <button
              class="stepbtn"
              type="button"
              :disabled="viewDate >= todayKey"
              aria-label="The day after"
              @click="viewDate = addDays(viewDate, 1)"
            >
              ›
            </button>
          </template>
        </PageHeader>

        <div class="score">
          <div class="num" :style="{ color: zoneColor }">{{ latestText }}</div>
          <div class="meta">
            <div class="band mono" :style="{ color: zoneColor }">{{ zoneLabel }}</div>
            <p class="verdict">{{ verdict }}</p>
          </div>
        </div>

        <HomeCard :title="dayLabel" :meta="reportedSpan" :color="famBody">
          <div v-if="loading" class="skel chartskel"></div>
          <div v-else-if="geo" class="chartwrap">
          <svg
            class="chart"
            :viewBox="`0 0 100 ${geo.height}`"
            preserveAspectRatio="none"
            :style="{ height: `${geo.height}px` }"
            role="img"
            :aria-label="`Stress through ${dayLabel}`"
          >
            <!-- Sessions drawn behind the line. This is the whole reason the
                 page exists rather than a chart: a rise means something once
                 you can see the climb sitting under it. -->
            <rect
              v-for="s in sessionBands"
              :key="s.startMillis"
              class="sessionband"
              :x="s.x"
              y="0"
              :width="s.width"
              :height="geo.height"
            />
            <rect
              v-for="(col, i) in geo.columns"
              :key="i"
              :x="col.x"
              :y="col.y"
              :width="col.width"
              :height="col.height"
              :fill="`var(${col.zone.token})`"
            />
          </svg>
          <!-- Labelled every three hours rather than only at the two ends. The
               ends alone said the day ran 00:07 to 23:58 and nothing about
               where in it a rise sat, which is the only question a day-shaped
               chart is asked.
               The span moved up into the card's meta instead of staying on the
               axis: it is still worth stating, because the chart is clipped to
               what was reported rather than running midnight to midnight, but
               as a label it collided with the first and last hour tick and it
               was printed 12-hour against their 24-hour. -->
          <div class="hours mono">
            <span v-for="t in ticks" :key="t.minute" :style="{ left: `${t.x}%` }">{{
              t.label
            }}</span>
          </div>
        </div>
          <div v-else class="calib mono">NOT ENOUGH READINGS FOR THIS DAY.</div>
        </HomeCard>

        <template v-if="loading || zones.measured">
          <HomeCard title="TIME IN EACH ZONE" :color="famBody">
          <div v-if="loading" class="skel zoneskel"></div>
          <template v-else>
          <div class="zbar">
            <span
              v-for="z in presentZones"
              :key="z.key"
              :style="{
                width: `${(zones.totals[z.key] / zones.measured) * 100}%`,
                background: `var(${z.token})`,
              }"
            ></span>
          </div>
          <div class="zlegend mono">
            <span v-for="z in presentZones" :key="z.key">
              <i :style="{ background: `var(${z.token})` }"></i>
              {{ z.label }} {{ fmtZoneMinutes(zones.totals[z.key]) }}
              </span>
            </div>
          </template>
          </HomeCard>
        </template>

        <!-- What was happening. Atlas holds the sessions and the sleep that the
             band's own app does not, so this is the one thing it can say that
             a stress chart on its own cannot. -->
        <HomeCard title="WHAT WAS HAPPENING" :color="famBody">
          <div v-if="sessionsLoading" class="skel ctxskel"></div>
          <div v-else-if="!context.length" class="calib mono">
            NOTHING ELSE RECORDED FOR THIS DAY.
          </div>
          <div v-for="row in context" :key="row.label" class="ctxrow">
            <span class="cl">{{ row.label }}</span>
            <span class="cv mono">{{ row.value }}</span>
          </div>
        </HomeCard>

        <HomeCard title="HOW THE DAY SPLIT" :color="famBody">
          <div v-for="row in periods" :key="row.label" class="ctxrow">
            <span class="cl">{{ row.label }}</span>
            <span class="cv mono">{{ row.value }}</span>
          </div>
        </HomeCard>

        <div class="grouphd mono" :style="{ color: famBody }">HISTORY</div>

        <!-- The fortnight version of TIME IN EACH ZONE directly above, and
             deliberately the same colours, so the two read as one idea at two
             zoom levels. Absolute minutes: a day worn four hours has to draw
             short rather than being normalised into looking like a calm day. -->
        <HomeCard
          title="STRESS OVER TIME"
          :meta="history.measuredDays ? `${HISTORY_DAYS} DAYS` : ''"
          :color="famBody"
        >
          <div v-if="history.measuredDays" class="histwrap">
            <!-- Its own box so the trip lane anchors under the columns rather
                 than under the axis row below them. -->
            <div class="histplot" :class="{ lane: trip.active.value }">
              <TripLane :gaps="trip.gaps.value" :reach="trip.reach.value" />
              <svg
                class="histchart"
                viewBox="0 0 100 46"
                preserveAspectRatio="none"
                role="img"
                :aria-label="`Time in each stress zone over the last ${HISTORY_DAYS} days`"
              >
                <template v-for="col in history.columns" :key="col.date">
                  <rect
                    v-for="seg in col.segments"
                    :key="seg.key"
                    :x="col.x"
                    :y="seg.y"
                    :width="col.width"
                    :height="seg.height"
                    :fill="`var(${seg.token})`"
                    :fill-opacity="col.date === viewDate ? 1 : 0.68"
                  />
                </template>
              </svg>
              <!-- Real-width targets over a stretched chart, the same reason
                   RecoveryPage's bars have them. -->
              <div class="hithit">
                <button
                  v-for="col in history.columns"
                  :key="col.date"
                  type="button"
                  class="hit"
                  :disabled="col.empty"
                  :aria-label="`${col.date}, ${fmtZoneMinutes(col.measured)} measured`"
                  @click="viewDate = col.date"
                ></button>
              </div>
            </div>
            <!-- Both ends of the axis printed, because the scale is the
                 window's own busiest day rather than a fixed 24 hours. -->
            <!-- The first column's own date. The chart is trimmed to where the
                 readings start, so a fixed "14 DAYS AGO" named a day that is no
                 longer drawn. -->
            <div class="histaxis mono">
              <span>{{ axisDate(history.from) }}</span>
              <span>UP TO {{ fmtZoneMinutes(history.peakMinutes) }} WORN</span>
              <span>{{ history.to === todayKey ? "TODAY" : axisDate(history.to) }}</span>
            </div>
          </div>
          <p v-else class="calib mono">NO READINGS IN THE LAST {{ HISTORY_DAYS }} DAYS.</p>
        </HomeCard>

        <!-- Reference, read once, so it sits under the history rather than
             between the day and the record of it. -->
        <details class="panel info-box">
          <summary class="boxlabel mono">
            WHAT THIS IS
            <span class="chev" aria-hidden="true"></span>
          </summary>
          <p class="info">{{ info }}</p>
        </details>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useBackClose } from "@/composables/useBackClose";
import PageHeader from "@/components/layout/PageHeader.vue";
import HomeCard from "@/components/home/HomeCard.vue";
import { stressByDay, stressHistoryColumns, HISTORY_DAYS } from "./stressHistory";
import { useCheckinStore } from "@/stores/checkin";
import { useSessionsStore } from "@/stores/sessions";
import { resolveSessions } from "@/components/activity/resolveSessions";
import { getSamples, getWorkouts } from "@/utils/sampleDb";
import { today, addDays, fmtHoursMins, fmtAxisDate as axisDate } from "@/utils/date";
import { METRICS } from "@/utils/metricRegistry";
import { useTripLane } from "@/composables/useTripLane";
import TripLane from "@/components/marks/TripLane.vue";
import { hourTicks } from "./dayAxis";
import {
  stressDayGeometry,
  zoneMinutes,
  zoneFor,
  averageBetween,
  longestCalm,
  fmtZoneMinutes,
  STRESS_ZONES,
} from "./stressDay";

const props = defineProps({
  /** Which day to open on. The header can then move to another. */
  date: { type: String, default: () => today() },
  /** Where the back control returns to, named by whoever opened this. */
  from: { type: String, default: "BACK" },
});
const emit = defineEmits(["close"]);
useBackClose(() => emit("close"));

const checkin = useCheckinStore();
const sessionStore = useSessionsStore();

const samples = ref([]);
const sessions = ref([]);
const historySamples = ref([]);
const loading = ref(true);
const sessionsLoading = ref(true);

const famBody = "var(--fam-body)";

// The day being looked at, which the header can move. Stepping is by calendar
// day rather than to the next day with readings, unlike sleep: stress is
// sampled all day and a day with none is a day the band was not worn, which is
// worth landing on and seeing said.
const todayKey = today();
const viewDate = ref(props.date);
watch(
  () => props.date,
  (d) => (viewDate.value = d)
);

const dayStart = computed(() => new Date(`${viewDate.value}T00:00:00`).getTime());
const dayEnd = computed(() => dayStart.value + 24 * 60 * 60 * 1000);

/**
 * The day's readings, taken from the fortnight already in memory whenever the
 * date is inside it.
 *
 * This is what makes stepping instant. Sleep never flickered because it reads a
 * Pinia store, which is synchronous; stress read IndexedDB on every step, so
 * the date label moved immediately and the chart arrived a beat later, and no
 * amount of holding the layout open made that feel like anything but a stall.
 * The history chart already loads 14 days of samples, so for any day inside
 * that window the fetch was redundant all along.
 */
const dayFromWindow = computed(() => {
  if (!historySamples.value.length) return null;
  if (viewDate.value < historyDates.value[0] || viewDate.value > todayKey) return null;
  const from = dayStart.value;
  const to = dayEnd.value;
  return historySamples.value.filter((s) => s.t >= from && s.t < to);
});

async function load() {
  // Cleared first. Reading is async and the date label moves the instant it is
  // tapped, so holding the previous day's readings under the new day's heading
  // puts a wrong day on screen long enough to be believed, which this codebase
  // has already decided is worse than showing nothing.
  //
  // Showing nothing is not the same as showing a shorter page, though. Clearing
  // alone dropped the chart to a one-line "not enough readings", unmounted TIME
  // IN EACH ZONE entirely and emptied WHAT WAS HAPPENING, so the page collapsed
  // and sprang back on every step and the content under the finger moved twice
  // per tap. `loading` keeps each of those at its own height with nothing in it
  // until the read lands.
  const inHand = dayFromWindow.value;
  if (inHand) {
    // No clear, no skeleton, no await: the readings are already here.
    samples.value = inHand;
    loading.value = false;
  } else {
    loading.value = true;
    samples.value = [];
    try {
      samples.value = await getSamples("stress", dayStart.value, dayEnd.value);
    } catch {
      samples.value = [];
    }
  }
  // Sessions are a separate read and a separate flag, because the samples can
  // now arrive instantly while these still cannot. One flag meant the context
  // card collapsed to "nothing else recorded" for a frame on every step.
  sessionsLoading.value = true;
  sessions.value = [];
  try {
    const found = await getWorkouts(dayStart.value, dayEnd.value);
    // Through resolveSessions, not store.resolve() per record. resolve() applies
    // a record's annotations but knows nothing about deletion, merging or splits,
    // so this page went on drawing a session the user had deleted while every
    // other screen had dropped it. That is the exact drift resolveSessions was
    // extracted to stop, one file over.
    sessions.value = resolveSessions(found, sessionStore);
  } catch {
    sessions.value = [];
  }
  sessionsLoading.value = false;
  loading.value = false;
}

/**
 * The fortnight behind the chart, fetched once and ending at today rather than
 * at the day being viewed.
 *
 * Two reasons it does not move with the header. It is ~4,000 raw samples, and
 * refetching that on every date step is the cost this window was already
 * trimmed from 30 days to avoid. And a history section that slides under you as
 * you step is harder to read than a fixed fortnight with your position marked
 * on it, which is what the highlighted column does.
 */
const historyDates = computed(() => {
  const out = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) out.push(addDays(todayKey, -i));
  return out;
});

async function loadHistory() {
  const from = new Date(`${historyDates.value[0]}T00:00:00`).getTime();
  const to = new Date(`${todayKey}T00:00:00`).getTime() + 24 * 60 * 60 * 1000;
  try {
    historySamples.value = await getSamples("stress", from, to);
  } catch {
    historySamples.value = [];
  }
}

/**
 * Hour labels for the day chart, with any that would sit on top of an end
 * label dropped.
 *
 * The ends are the first and last reading, so a day whose readings start at
 * 08:55 puts 09:00 five minutes along from it. Both would be drawn, and at this
 * size that is two overlapping strings rather than two labels.
 */
const EDGE_CLEARANCE_PCT = 5;
const ticks = computed(() =>
  hourTicks(geo.value).filter(
    (t) => t.x > EDGE_CLEARANCE_PCT && t.x < 100 - EDGE_CLEARANCE_PCT
  )
);

/**
 * What the chart actually covers, in the axis's own 24-hour format.
 *
 * In the card's meta rather than on the axis, where it collided with the first
 * and last hour tick.
 */
const reportedSpan = computed(() => {
  const g = geo.value;
  if (!g) return "";
  const hhmm = (t) => {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  return `${hhmm(g.firstMillis)} → ${hhmm(g.lastMillis)}`;
});

const history = computed(() =>
  stressHistoryColumns(stressByDay(historySamples.value, historyDates.value))
);

// Measured minutes, not a stress figure: a day with nothing measured is a day
// the band was off the wrist, and that is the absence a trip accounts for.
const trip = useTripLane(
  computed(() => history.value.columns.map((c) => ({ date: c.date, value: c.measured })))
);

onMounted(() => {
  load();
  loadHistory();
});
watch(viewDate, load);

const geo = computed(() => stressDayGeometry(samples.value));

// Sessions placed against the chart's own axis, which is clipped to the
// readings rather than running the full day. Deriving them from midnight
// independently would slide every band away from the line it is meant to sit
// under, by however much of the morning had no readings.
const sessionBands = computed(() => {
  const g = geo.value;
  if (!g) return [];
  const span = Math.max(1, g.lastMillis - g.firstMillis);
  const pos = (t) => ((t - g.firstMillis) / span) * 100;

  return sessions.value
    .map((s) => {
      const endMillis = s.startMillis + (s.activeSeconds ?? 0) * 1000;
      const x = pos(Math.max(s.startMillis, g.firstMillis));
      const right = pos(Math.min(endMillis, g.lastMillis));
      return {
        startMillis: s.startMillis,
        x,
        // Floored, so a twenty-minute session stays visible on a day-wide axis.
        width: Math.max(0.7, right - x),
      };
    })
    // Anything wholly outside the reported window has nowhere honest to sit.
    .filter((b) => b.x < 100 && b.x + b.width > 0);
});
const zones = computed(() => zoneMinutes(samples.value));
const presentZones = computed(() =>
  STRESS_ZONES.filter((z) => zones.value.totals[z.key] > 0)
);

const latest = computed(() => samples.value.at(-1)?.v ?? null);
const latestText = computed(() => (latest.value == null ? "--" : Math.round(latest.value)));
const zoneLabel = computed(() => zoneFor(latest.value)?.label ?? "NO READING");
const zoneColor = computed(() =>
  latest.value == null ? "var(--dim)" : `var(${zoneFor(latest.value).token})`
);

const dayLabel = computed(() =>
  viewDate.value === todayKey
    ? "TODAY"
    : new Date(`${viewDate.value}T00:00:00`)
        .toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })
        .toUpperCase()
);

// Morning, afternoon and evening rather than hourly: the band samples too
// irregularly for an hourly average to be honest, and three periods is what
// anybody would describe a day in anyway.
const periods = computed(() => {
  const rows = [
    ["Overnight", 0, 360],
    ["Morning", 360, 720],
    ["Afternoon", 720, 1080],
    ["Evening", 1080, 1440],
  ];
  const out = rows
    .map(([label, from, to]) => {
      const avg = averageBetween(samples.value, from, to);
      return avg == null ? null : { label, value: `${avg} avg · ${zoneFor(avg).label}` };
    })
    .filter(Boolean);

  const calm = longestCalm(samples.value);
  if (calm > 0) out.push({ label: "Longest calm stretch", value: fmtZoneMinutes(calm) });
  return out;
});

const context = computed(() => {
  const out = [];
  for (const s of sessions.value) {
    out.push({
      label: sessionStore.typeNameFor(s) ?? "Unnamed session",
      value: `${clock(s.startMillis)} – ${clock(s.startMillis + (s.activeSeconds ?? 0) * 1000)}`,
    });
  }
  const entry = checkin.entryFor(viewDate.value);
  if (entry?.sleep) {
    const score = entry.sleepStages?.score;
    out.push({
      label: "Night before",
      value: score ? `${fmtHoursMins(entry.sleep)} · score ${score}` : fmtHoursMins(entry.sleep),
    });
  }
  return out;
});

function clock(millis) {
  return new Date(millis)
    .toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
    .toUpperCase();
}

const verdict = computed(() => {
  if (!geo.value) return "The band has not reported enough readings for this day.";
  const afternoon = averageBetween(samples.value, 720, 1080);
  const overnight = averageBetween(samples.value, 0, 360);
  if (afternoon != null && overnight != null && afternoon - overnight > 20) {
    return "Calm overnight, and well up through the afternoon.";
  }
  if (afternoon != null && overnight != null && afternoon - overnight < 5) {
    return "Much the same all day, without a clear peak.";
  }
  return "A normal shape: low overnight, rising into the day.";
});

const info = METRICS.stress.info;
</script>

<style scoped>

.page {
  position: fixed;
  inset: 0;
  z-index: 600;
  display: flex;
  flex-direction: column;
  background: var(--bg1);
  color: var(--body);
  font-family: var(--font-sans);
  padding: calc(12px + env(safe-area-inset-top)) 18px
    calc(20px + env(safe-area-inset-bottom));
  overflow: hidden;
  animation: pagein 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes pagein {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .page {
    animation: none;
  }
}
.pscroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-right: calc(-1 * var(--sb-overscan));
  padding-right: var(--sb-overscan);
}
.score {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 22px;
  /* Two lines of verdict, so a day whose sentence is one line does not shift
     everything below it up while stepping through dates. */
  min-height: 62px;
}
.num {
  font-size: 52px;
  font-weight: 700;
  line-height: 0.9;
  font-variant-numeric: tabular-nums;
}
.meta {
  flex: 1;
  min-width: 0;
}
.band {
  font-size: 12px;
  letter-spacing: 2px;
}
.verdict {
  margin: 7px 0 0;
  font-size: var(--fs-prose);
  line-height: 1.5;
  color: var(--body);
}
/* A label that is a card's header sits at the top of the card, so the gap it
   used to need above itself is now the card's own margin. */
.panel > .boxlabel {
  margin-top: 0;
}
.boxlabel {
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--dim);
  margin: 24px 0 10px;
}
.chartwrap {
  margin-bottom: 4px;
}
.chart {
  display: block;
  width: 100%;
}
.sessionband {
  fill: color-mix(in srgb, var(--fam-activity) 15%, transparent);
}
.axis {
  display: flex;
  justify-content: space-between;
  font-size: 9.5px;
  letter-spacing: 0.6px;
  color: var(--dim);
  margin-top: 5px;
}
/* Absolute rather than a flex row, because these are positions on the axis
   rather than evenly spaced items: 09:00 has to sit where nine o'clock is. */
.hours {
  position: relative;
  height: 13px;
  margin-top: 5px;
  font-size: 9.5px;
  letter-spacing: 0.6px;
  color: var(--dim);
}
.hours span {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}
.zbar {
  display: flex;
  gap: 1px;
  height: 9px;
  border-radius: 3px;
  overflow: hidden;
}
.zlegend {
  display: flex;
  flex-wrap: wrap;
  gap: 13px;
  margin-top: 10px;
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--dim);
}
.zlegend i {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 2px;
  margin-right: 6px;
  vertical-align: middle;
}
.ctxrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 46px;
  border-top: 1px solid color-mix(in srgb, var(--dim) 12%, transparent);
  font-size: 14px;
}
.ctxrow:first-of-type {
  border-top: 0;
}
.cv {
  font-size: 12.5px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.calib {
  font-size: var(--fs-label);
  letter-spacing: 1px;
  color: var(--dim);
  padding: 4px 0 6px;
}
/* In a card like everything else. Left bare it was the one block sitting
   straight on the background once every neighbour had a surface. */
.info {
  margin: 0;
  font-size: var(--fs-second);
  line-height: 1.65;
  color: var(--dim);
}

/* Height held open while the day's read is in flight. Deliberately inert: a
   shimmer on a load this short reads as another thing flickering, which is the
   complaint this is fixing. */
.skel {
  background: color-mix(in srgb, var(--dim) 9%, transparent);
  border-radius: 6px;
}
.chartskel {
  height: 96px;
  margin: 2px 0 6px;
}
.zoneskel {
  height: 40px;
  margin: 2px 0 4px;
}
.ctxskel {
  height: 92px;
  margin: 2px 0 4px;
}

/* ── stress over time ───────────────────────────────────────────────── */
.histwrap {
  padding-top: 4px;
}
.histplot {
  position: relative;
}
/* Room for TripLane's rule, only when a trip falls in the fortnight. */
.histplot.lane {
  padding-bottom: 13px;
}
.histplot.lane .hithit {
  bottom: 13px;
}
.histchart {
  display: block;
  width: 100%;
  height: 60px;
}
/* Real-width targets over a stretched chart: preserveAspectRatio="none" scales
   the SVG's own hit areas with it, so a column that looks tappable is not. */
.hithit {
  position: absolute;
  inset: 0;
  display: flex;
}
.hit {
  flex: 1;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.hit:disabled {
  cursor: default;
}
.hit:focus-visible {
  outline: 2px solid var(--acc);
  outline-offset: -2px;
}
.histaxis {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 9.5px;
  letter-spacing: 1.2px;
  color: var(--dim);
  padding-top: 6px;
}

/* ── the collapsed explainer ────────────────────────────────────────── */
.info-box {
  margin-top: 11px;
}
.info-box summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0;
  padding: 6px 0;
  cursor: pointer;
  list-style: none;
  min-height: 44px;
}
.info-box summary::-webkit-details-marker {
  display: none;
}
.info-box summary:focus-visible {
  outline: 2px solid var(--acc);
  outline-offset: 3px;
}
.chev {
  width: 8px;
  height: 8px;
  border-right: 1.5px solid var(--dim);
  border-bottom: 1.5px solid var(--dim);
  transform: rotate(45deg) translate(-2px, -2px);
  transition: transform 0.15s ease;
}
.info-box[open] .chev {
  transform: rotate(-135deg) translate(-2px, -2px);
}
@media (prefers-reduced-motion: reduce) {
  .chev {
    transition: none;
  }
}
</style>
