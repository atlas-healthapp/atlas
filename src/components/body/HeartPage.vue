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

        <!-- The day's average, which is the least interesting number here and
             is said so in WHAT THIS IS. It leads because it is the one figure
             that is comparable day to day; the shape below is the point. -->
        <div class="score">
          <div class="num">{{ geo ? geo.average : "—" }}</div>
          <div class="meta">
            <div class="band mono">BPM AVERAGE</div>
            <p class="verdict">{{ verdict }}</p>
          </div>
        </div>

        <!-- Two facts, not three: a third leaves a hole in a two-column grid.
             Same rule as the metric page's pairs. -->
        <div v-if="geo" class="pairs">
          <div class="pair">
            <span class="plab mono">RESTING</span>
            <span class="pval mono">{{ geo.resting }}</span>
          </div>
          <div class="pair">
            <span class="plab mono">HIGHEST</span>
            <span class="pval mono">{{ geo.high }}</span>
          </div>
        </div>

        <!-- No meta. It carried the reading count, which nobody needs and which
             the enlarge mark then sat on top of. -->
        <HomeCard title="THROUGH THE DAY" :color="famBody" class="daycard">
          <!-- Same mark, same corner and same reasoning as the sleep page's: the
               word EXPAND was the loudest thing in a card whose point is the
               chart under it. -->
          <button
            v-if="!loading && geo"
            class="zoombtn"
            type="button"
            aria-label="Expand the heart rate chart"
            @click="zoomed = true"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 3H3v6M21 9V3h-6M15 21h6v-6M3 15v6h6" />
            </svg>
          </button>
          <div v-if="loading" class="skel chartskel"></div>
          <div v-else-if="geo" class="chartwrap">
            <svg
              class="chart"
              :viewBox="`0 0 100 ${geo.height}`"
              preserveAspectRatio="none"
              :style="{ height: `${geo.height}px` }"
              role="img"
              :aria-label="`Heart rate through ${dayLabel}`"
            >
              <!-- Sessions behind the columns. The same reason the stress page
                   draws them: a stretch sitting high means something once you
                   can see the training under it. -->
              <rect
                v-for="(s, i) in geo.sessionBands"
                :key="`s${i}`"
                class="sessionband"
                :x="s.x"
                y="0"
                :width="s.width"
                :height="geo.height"
              />
              <!-- One column per six minutes, drawn from that window's low to
                   its high. Not one per reading: the band reports about 1,400
                   times a day, which is four readings per pixel on a phone, and
                   drawn that way the day fills in as a solid block. -->
              <rect
                v-for="(col, i) in geo.columns"
                :key="i"
                :x="col.x"
                :y="col.y"
                :width="geo.width"
                :height="col.height"
                :class="{ session: col.session }"
                class="col"
              />
              <line
                x1="0"
                :y1="geo.restingY"
                x2="100"
                :y2="geo.restingY"
                class="restline"
              />
            </svg>

            <!-- Both ends of the axis, because it does not start at zero: a
                 heart rate never approaches it, and the heights are unreadable
                 without knowing what they are measured against. -->
            <div class="yends mono">
              <span>{{ geo.axisHigh }}</span>
              <span>{{ geo.axisLow }}</span>
            </div>
            <div class="restlab mono" :style="{ top: `${(geo.restingY / geo.height) * 100}%` }">
              RESTING {{ geo.resting }}
            </div>
            <div class="hours mono">
              <span v-for="t in ticks" :key="t.minute" :style="{ left: `${t.x}%` }">{{
                t.label
              }}</span>
            </div>
          </div>
          <div v-else class="empty mono">NOT ENOUGH READINGS THAT DAY.</div>
        </HomeCard>

        <div class="grouphd mono" :style="{ color: famBody }">HISTORY</div>

        <!-- Both strings kept short: the title and the meta share one row, and
             "RESTING AND RANGE" beside a three-part meta wrapped both to two
             lines. -->
        <HomeCard
          title="RANGE BY DAY"
          :meta="history.measuredDays ? `RESTING AVG ${history.restingAverage}` : ''"
          :color="famBody"
        >
          <div v-if="historyLoading" class="skel histskel"></div>
          <div v-else-if="history.measuredDays" class="histwrap">
            <div class="histplot" :class="{ lane: trip.active.value }">
              <TripLane :gaps="trip.gaps.value" :reach="trip.reach.value" />
              <svg
                class="histchart"
                viewBox="0 0 100 46"
                preserveAspectRatio="none"
                role="img"
                :aria-label="`Resting rate and daily range over ${HISTORY_DAYS} days`"
              >
                <rect
                  v-for="b in history.bars"
                  :key="b.date"
                  :x="b.x"
                  :y="b.y"
                  :width="b.width"
                  :height="b.height"
                  class="hbar"
                  :class="{ on: b.date === viewDate }"
                />
              </svg>
              <!-- Real-width targets over a stretched chart, the same reason
                   the recovery and stress history charts have them. -->
              <div class="hithit">
                <button
                  v-for="b in history.bars"
                  :key="b.date"
                  type="button"
                  class="hit"
                  :disabled="b.empty"
                  :aria-label="
                    b.empty
                      ? `${b.date}, nothing recorded`
                      : `${b.date}, resting ${b.resting}, up to ${b.high}`
                  "
                  @click="viewDate = b.date"
                ></button>
              </div>
            </div>
            <!-- The first bar's own date rather than a fixed span, since the
                 chart is trimmed to where the readings start. Both ends of the
                 value axis stay printed: it is the window's own spread, not
                 zero, which is the obligation nightlyBars carries too. -->
            <div class="histaxis mono">
              <span>{{ axisDate(history.from) }}</span>
              <span>{{ history.axisLow }}–{{ history.axisHigh }} BPM</span>
              <span>{{ history.to === todayKey ? "TODAY" : axisDate(history.to) }}</span>
            </div>
          </div>
          <div v-else class="empty mono">NOTHING RECORDED IN THE LAST {{ HISTORY_DAYS }} DAYS.</div>
        </HomeCard>

        <!-- In a card rather than as bare paragraphs on the background: prose
             is content and gets the same container treatment as everything
             else. Not collapsed the way MetricPage's is, because there is no
             forty-row day list under it competing for the fold. -->
        <HomeCard title="WHAT THIS IS" :color="famBody">
          <p v-for="(para, i) in infoParagraphs" :key="i" class="info">{{ para }}</p>
        </HomeCard>
      </div>

      <!-- The day at full size. Not another page: the same chart with room to
           read it, closing back to where it was rather than adding a step to
           come back from. Turned a quarter turn for the same reason the sleep
           page's is - a day is wide and the phone is not - and the geometry needs
           no recomputing here, because the chart already draws into a 100-wide
           viewBox with preserveAspectRatio="none" and stretches to any box. -->
      <div v-if="zoomed" class="zoom">
        <div class="rotor">
          <div class="zoomhd mono">
            <span>{{ dayLabel }}</span>
            <button class="expand mono" type="button" @click="zoomed = false">CLOSE</button>
          </div>
          <div class="zoombody">
            <div class="chartwrap zoomwrap">
              <svg
                class="chart"
                :viewBox="`0 0 100 ${geo.height}`"
                preserveAspectRatio="none"
                role="img"
                :aria-label="`Heart rate through ${dayLabel}, enlarged`"
              >
                <rect
                  v-for="(s, i) in geo.sessionBands"
                  :key="`zs${i}`"
                  class="sessionband"
                  :x="s.x"
                  y="0"
                  :width="s.width"
                  :height="geo.height"
                />
                <!-- Enlarged, the columns step back to being the spread and a
                     run line through their averages carries the shape. At row
                     width the columns are the whole chart; with the screen
                     turned sideways there is room for both, and the pair says
                     what neither does alone - where the rate went, and how much
                     it was moving while it went there. -->
                <rect
                  v-for="(col, i) in geo.columns"
                  :key="`zc${i}`"
                  :x="col.x"
                  :y="col.y"
                  :width="geo.width"
                  :height="col.height"
                  :class="{ session: col.session }"
                  class="col spread"
                />
                <polyline
                  v-for="(seg, i) in geo.runSegments"
                  :key="`zr${i}`"
                  :points="seg"
                  class="runline"
                />
                <line x1="0" :y1="geo.restingY" x2="100" :y2="geo.restingY" class="restline" />
              </svg>
              <div class="yends mono">
                <span>{{ geo.axisHigh }}</span>
                <span>{{ geo.axisLow }}</span>
              </div>
              <div class="restlab mono" :style="{ top: `${(geo.restingY / geo.height) * 100}%` }">
                RESTING {{ geo.resting }}
              </div>
              <div class="hours mono">
                <span v-for="t in ticks" :key="`zt${t.minute}`" :style="{ left: `${t.x}%` }">{{
                  t.label
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
// Heart rate through the day, on a page of its own.
//
// It earned one rather than a section on the stress page (which would put two
// metrics inside one detail page) or a card on the resting HR page (which would
// give MetricPage's today card a third content type for one metric out of
// thirteen). Both were mocked up against the real archive first.
//
// Shaped like StressPage, which is the closest existing thing: a day with a
// shape, a calendar-day stepper, and the day served out of the window the
// history section already holds so stepping does not stall.
import { computed, onMounted, ref, watch } from "vue";
import { useBackClose } from "@/composables/useBackClose";
import PageHeader from "@/components/layout/PageHeader.vue";
import HomeCard from "@/components/home/HomeCard.vue";
import TripLane from "@/components/marks/TripLane.vue";
import { useTripLane } from "@/composables/useTripLane";
import { useSessionsStore } from "@/stores/sessions";
import { resolveSessions } from "@/components/activity/resolveSessions";
import { getSamples, getWorkouts } from "@/utils/sampleDb";
import { dailyValuesForRange } from "@/utils/dailyRollup";
import { today, addDays, fmtAxisDate as axisDate } from "@/utils/date";
import { METRICS } from "@/utils/metricRegistry";
import { heartDayGeometry } from "./heartDay";
import { hourTicks } from "./dayAxis";
import { heartByDay, heartHistoryBars, HISTORY_DAYS } from "./heartHistory";

const props = defineProps({
  /** Which day to open on. The header can then move to another. */
  date: { type: String, default: () => today() },
  /** Where the back control returns to, named by whoever opened this. */
  from: { type: String, default: "BACK" },
});
const emit = defineEmits(["close"]);

/** The day at full size, over the page rather than as a page of its own. */
const zoomed = ref(false);

// Back closes the enlargement first and the page second. One press dismissing
// both would take you off a page you had only zoomed into, which is not what
// pressing back on a full-screen chart means.
useBackClose(() => {
  if (zoomed.value) zoomed.value = false;
  else emit("close");
});

const sessionStore = useSessionsStore();
const famBody = "var(--fam-body)";

const samples = ref([]);
const historySamples = ref([]);
const sessions = ref([]);
const loading = ref(true);
const historyLoading = ref(true);

// Stepping is by calendar day and bounded at today, like stress and recovery: a
// day with no readings is a day the band was not worn, and that is worth
// landing on rather than skipping.
const todayKey = today();
const viewDate = ref(props.date);
watch(
  () => props.date,
  (d) => (viewDate.value = d)
);

const dayStart = computed(() => new Date(`${viewDate.value}T00:00:00`).getTime());
const dayEnd = computed(() => dayStart.value + 24 * 60 * 60 * 1000);

const dayLabel = computed(() =>
  viewDate.value === todayKey
    ? "TODAY"
    : new Date(`${viewDate.value}T00:00:00`)
        .toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })
        .replace(",", "")
        .toUpperCase()
);

/**
 * The week behind the chart, fetched once and always ending at today.
 *
 * Not at the day being viewed: the date moves synchronously and the fetch does
 * not, so a forward step would land past the end of the window still in hand -
 * the note RecoveryPage's load() carries, for the same bug.
 */
const historyDates = computed(() => {
  const out = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) out.push(addDays(todayKey, -i));
  return out;
});

/**
 * The viewed day taken from the week already in memory.
 *
 * This is what makes stepping instant, and it is the fix StressPage needed: it
 * read IndexedDB on every step, so the label moved immediately and the chart
 * arrived a beat later. Heart rate is seven times as dense, so the same read
 * would stall harder.
 */
const dayFromWindow = computed(() => {
  if (!historySamples.value.length) return null;
  if (viewDate.value < historyDates.value[0] || viewDate.value > todayKey) return null;
  return historySamples.value.filter((s) => s.t >= dayStart.value && s.t < dayEnd.value);
});

/**
 * The night-scoped resting rate for the day being viewed, from the archive.
 *
 * Read as a rollup rather than recomputed: `rollupsForDate` already scopes it to
 * the sleep window, and a second definition here is the drift this page was just
 * found to have.
 */
const restingForDay = ref(null);
async function loadResting() {
  try {
    const rows = await dailyValuesForRange(viewDate.value, viewDate.value);
    restingForDay.value = rows?.[0]?.values?.restingHr ?? null;
  } catch {
    restingForDay.value = null;
  }
}

async function load() {
  const inHand = dayFromWindow.value;
  if (inHand) {
    samples.value = inHand;
    loading.value = false;
  } else {
    // Cleared rather than left showing the previous day under the new day's
    // heading: a wrong day on screen long enough to be believed is worse than
    // a gap, and `loading` holds the card's height so the page does not
    // collapse and spring back on every step.
    loading.value = true;
    samples.value = [];
    try {
      samples.value = await getSamples("hr", dayStart.value, dayEnd.value);
    } catch {
      samples.value = [];
    }
    loading.value = false;
  }

  // A separate read behind no flag of its own: sessions only shade the chart,
  // so arriving a frame late changes nothing that has been read yet.
  try {
    const found = await getWorkouts(dayStart.value, dayEnd.value);
    // Through resolveSessions for the same reason the stress page now is:
    // store.resolve() applies one record's annotations but knows nothing about
    // deletion, merging or splitting, so a session you had deleted went on
    // shading this chart.
    sessions.value = resolveSessions(found, sessionStore);
  } catch {
    sessions.value = [];
  }
}

async function loadHistory() {
  historyLoading.value = true;
  const from = new Date(`${historyDates.value[0]}T00:00:00`).getTime();
  const to = new Date(`${todayKey}T00:00:00`).getTime() + 24 * 60 * 60 * 1000;
  try {
    historySamples.value = await getSamples("hr", from, to);
  } catch {
    historySamples.value = [];
  }
  historyLoading.value = false;
}

onMounted(async () => {
  // The opened day first, then the week behind it.
  //
  // This used to run the other way round, so the hero chart waited on the whole
  // seven-day fetch to save itself one read. Measured on the device that was a
  // bad trade: the week is 9,785 samples in 173 ms and one day is 1,301 in 13,
  // so the thing you opened the page for arrived about 160 ms late to spare a
  // read costing 13. Reading the day twice is the cheaper mistake.
  //
  // Nothing else changes. `load()` already falls back to its own one-day read
  // whenever the window is not in hand, the history card holds its own skeleton
  // until it is, and once it arrives every later date step is served out of it
  // for free.
  await load();
  loadHistory();
});
watch(viewDate, load);
// The resting figure is a different read from the samples, and it moves with the
// date the same way.
watch(viewDate, loadResting, { immediate: true });

const geo = computed(() =>
  heartDayGeometry(samples.value, {
    sessions: sessions.value,
    // The same figure BODY's row shows, so the two cannot differ by a beat and
    // leave the reader deciding which page to believe.
    resting: restingForDay.value,
  })
);
const ticks = computed(() => hourTicks(geo.value));


/**
 * One sentence about the day, and only what the readings support.
 *
 * No advice and no generic levers: it says where the peak was and how far above
 * resting it sat, which is the thing the shape is showing.
 */
const verdict = computed(() => {
  if (loading.value) return "Reading the day.";
  const g = geo.value;
  if (!g) return "The band reported too little that day to draw.";

  const peak = g.columns.reduce((best, c) => (best == null || c.high > best.high ? c : best), null);
  const when = peak ? clock(peak.minute) : null;
  // **The peak and when it happened, and nothing after it.** This used to end
  // "2.8× where it rested", a multiple chosen over a percentage because a peak
  // is routinely more than twice resting. Taken off on the user's call
  // (2026-08-19): the ratio is arithmetic the reader can do from two numbers
  // already on the page, and it read as the line straining to add something.
  // The peak and its hour are what the shape is showing.
  return when ? `Peaked at ${g.high} around ${when}.` : `Peaked at ${g.high}.`;
});

function clock(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

const history = computed(() =>
  heartHistoryBars(heartByDay(historySamples.value, historyDates.value))
);

const trip = useTripLane(
  computed(() => history.value.bars.map((b) => ({ date: b.date, value: b.empty ? null : b.high })))
);

const infoParagraphs = computed(() => (METRICS.hr.info ?? "").split("\n\n"));
</script>

<style scoped>
/* A drill-through is a fixed overlay, and `.page` is **not** a global rule -
   every page declares its own copy, so omitting it here left this one laid out
   in normal flow underneath Home, pushing content past the bottom nav. Found on
   the device; it builds and tests clean either way, which is the template-shaped
   failure this codebase keeps warning about.
   Kept byte-identical to StressPage's rather than improvised. The duplication
   itself is real - PageHeader was extracted for exactly this reason and `.page`
   was not - but unifying it is a change to six pages, not a bug fix. */
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
  /* The Android WebView draws overlay scroll bars in the compositor and they
     cannot be styled away, so the scroller overscans past the box that clips
     it. Anything positioned absolutely inside has to subtract it too. */
  margin-right: calc(-1 * var(--sb-overscan));
  padding-right: var(--sb-overscan);
}

.score {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 4px 0 18px;
}
.num {
  font-size: 52px;
  line-height: 0.94;
  font-weight: 600;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  color: var(--fam-body);
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-top: 4px;
}
.band {
  font-size: var(--fs-label);
  letter-spacing: 0.09em;
  color: var(--fam-body);
  font-weight: 600;
}
.verdict {
  margin: 0;
  font-size: var(--fs-second);
  color: var(--body);
  line-height: 1.35;
}

.pairs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--panel-line);
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 14px;
}
.pair {
  background: var(--panel);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.plab {
  font-size: var(--fs-micro);
  letter-spacing: 0.08em;
  color: var(--dim);
}
.pval {
  font-size: var(--fs-value);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.chartwrap {
  position: relative;
  padding-right: 30px;
}
.chart {
  display: block;
  width: 100%;
}
.col {
  fill: var(--fam-body);
  fill-opacity: 0.82;
}
.col.session {
  fill: var(--fam-activity);
  fill-opacity: 0.95;
}
.sessionband {
  fill: var(--fam-activity);
  opacity: 0.09;
}
.restline {
  stroke: var(--dim);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  stroke-opacity: 0.75;
  /* Or the dashes stretch with the chart's non-uniform scaling and read as a
     solid rule at one end and nothing at the other. */
  vector-effect: non-scaling-stroke;
}
.yends {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 16px;
  width: 28px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: right;
  font-size: 9px;
  letter-spacing: 0.6px;
  color: var(--dim);
}
/* On the left, not beside the value axis on the right: the resting line sits
   low in the plot, which is exactly where the last hour label and the axis
   floor already are, and all three landed on top of each other. */
.restlab {
  position: absolute;
  left: 0;
  transform: translateY(-125%);
  font-size: 9px;
  letter-spacing: 0.6px;
  color: var(--dim);
  background: var(--panel);
  padding: 0 3px;
}
.hours {
  position: relative;
  height: 14px;
  margin-top: 2px;
}
.hours span {
  position: absolute;
  transform: translateX(-50%);
  font-size: 9px;
  letter-spacing: 0.6px;
  color: var(--dim);
}

.histwrap {
  padding-top: 4px;
}
.histplot {
  position: relative;
}
.histplot.lane {
  padding-bottom: 13px;
}
.histplot.lane .hithit {
  bottom: 13px;
}
.histchart {
  display: block;
  width: 100%;
  height: 46px;
}
.hbar {
  fill: var(--fam-body);
  fill-opacity: 0.62;
}
.hbar.on {
  fill-opacity: 1;
}
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
.hit:focus-visible {
  outline: 2px solid var(--acc);
  outline-offset: -2px;
}
.histaxis {
  display: flex;
  justify-content: space-between;
  font-size: 9.5px;
  letter-spacing: 1.2px;
  color: var(--dim);
  padding-top: 6px;
}

.empty {
  font-size: var(--fs-label);
  color: var(--dim);
  padding: 10px 0;
}
.skel {
  border-radius: 8px;
  background: color-mix(in srgb, var(--dim) 10%, transparent);
}
.chartskel {
  height: 112px;
}
.histskel {
  height: 52px;
}

.info {
  margin: 0;
  font-size: var(--fs-second);
  color: var(--body);
  line-height: 1.45;
}

/* ── the day at full size ────────────────────────────────────────────────
   Lifted wholesale from SleepPage's hypnogram zoom rather than reinvented, so
   the two enlargements behave identically. The comments there explain the two
   non-obvious parts: the rotation, and why the safe-area insets go on the
   opposite edges from the ones you would expect. */
.daycard {
  position: relative;
}
.daycard :deep(.card-hd) {
  /* Clear of the enlarge mark in the corner. */
  padding-right: 34px;
}
.zoombtn {
  position: absolute;
  top: 4px;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  background: none;
  color: var(--dim);
  cursor: pointer;
}
.zoombtn svg {
  width: 15px;
  height: 15px;
}
.zoom {
  position: fixed;
  inset: 0;
  z-index: 700;
  background: var(--bg1);
  overflow: hidden;
}
.rotor {
  position: absolute;
  top: 50%;
  left: 50%;
  width: calc(100vh - 24px);
  height: calc(100vw - 24px);
  transform: translate(-50%, -50%) rotate(90deg);
  display: flex;
  flex-direction: column;
  /* A quarter turn clockwise sends this box's left edge to the top of the
     screen, so that edge carries the status icons and the right one the
     navigation bar. Padding them the obvious way round put the chart under
     the clock. */
  padding-left: max(20px, env(safe-area-inset-top));
  padding-right: max(20px, env(safe-area-inset-bottom));
  padding-top: 18px;
  padding-bottom: 18px;
}
.zoomhd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11.5px;
  letter-spacing: 1.4px;
  color: var(--dim);
  flex: none;
}
.zoombody {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 12px;
}
/* The chart stretches to whatever it is given, so the enlargement is a matter
   of the box rather than of new geometry. */
.zoomwrap {
  flex: 1;
  min-height: 0;
}
.zoomwrap .chart {
  width: 100%;
  height: 100%;
}
/* The columns become the background here, so the line reads as the subject. */
.zoomwrap .col.spread {
  opacity: 0.34;
}
.runline {
  fill: none;
  stroke: var(--fam-body);
  /* preserveAspectRatio="none" stretches the geometry, so a stroke width in
     viewBox units would come out thick horizontally and thin vertically.
     Non-scaling-stroke keeps it an even hairline whatever the box does. */
  vector-effect: non-scaling-stroke;
  stroke-width: 1.6;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.expand {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 1.6px;
  color: var(--dim);
  background: none;
  border: 1px solid color-mix(in srgb, var(--dim) 45%, transparent);
  border-radius: 5px;
  padding: 7px 10px;
  min-height: 32px;
  cursor: pointer;
}
</style>
