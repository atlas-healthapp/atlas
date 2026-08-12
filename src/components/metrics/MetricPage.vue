<template>
  <!-- One metric, everything about it. Replaces the two detail sheets that
       existed before, which showed the same metric two different ways
       depending on which screen you reached it from. Same page pattern as
       SleepPage and RecoveryPage. -->
  <Teleport to="body">
    <div class="page grid-bg">
      <div class="pscroll">
        <PageHeader :from="from" :context="rangeLabel" @close="$emit('close')" />

        <!-- **Nothing below the header exists until the archive has been read.**
             Measured on the device rather than guessed at, after a first fix
             addressed only the chart and the user reported it still flashing:
             for 150ms the page rendered `-- / NO DATA / Nothing recorded today.
             / 0` over an untrimmed axis, because `dayWindow` starts empty and
             every computed on the page faithfully described that emptiness.
             Silencing them one at a time is a losing game; there is nothing
             truthful ANY of them can say before the read returns.

             The header stays, so what appears is a page opening rather than a
             blank screen: it carries the back link and the window, both of which
             are known without reading anything. -->
        <template v-if="loaded">
        <!-- Today's reading, what it is called, and why. The band word is the
             one borrowing from the sleep page that needed care: sleep has a
             score behind its label and a metric only has a comparison, so the
             vocabulary is deliberately four words wide and it is read from the
             same typicalRange the verdict sentence below it uses. Two parts of
             Home once described one reading with two different thresholds, and
             that is the defect this avoids repeating on one screen. -->
        <div class="today">
          <!-- The unit sits outside the 52px string. Sleep, Stress and Recovery
               all render a bare number at this size, and two bold letters in
               it made the metric hero a visibly different object from the
               other three. -->
          <div class="num">
            {{ heroNumber }}<u v-if="heroUnit">{{ heroUnit }}</u>
          </div>
          <div class="tmeta">
            <div class="band mono" :style="{ color: bandColour }">{{ bandWord }}</div>
            <p class="verdict">{{ verdict }}</p>
          </div>
        </div>

        <!-- What today is being judged against, as two cells rather than as a
             list of rows. The rows version separated its entries with hairlines
             and those read as more axes, sitting directly above a mark that is
             an axis and a chart that has another. Two facts, deliberately: a
             third leaves a hole in a two-column grid, and the ones that came
             out are carried by the chart card below. -->
        <div v-if="facts.length" class="pairs">
          <div v-for="f in facts" :key="f.k" class="pair">
            <div class="k mono">{{ f.k }}</div>
            <div class="v mono">{{ f.v }}</div>
          </div>
        </div>

        <!-- **Where a hand-entered metric is actually entered.** It was already
             possible and effectively unreachable: the only way in was to scroll
             past the chart and the calendar, expand a collapsed EVERY DAY
             section, find today in a ninety-row list and tap it. Reported as
             "I cannot add weight anywhere in the app", which was the right
             description of it.

             Above the mark rather than below, because on a metric with nothing
             recorded there is no mark, no chart and no hero worth reading, and
             the only thing the page can usefully offer is the way to fix that.
             The per-day rows stay where they are; this is for today, which is
             the day you almost always mean. -->
        <button v-if="def.editable" type="button" class="logtoday mono" @click="openTodayLog">
          {{ todayValue == null ? `ADD TODAY'S ${def.label}` : `UPDATE TODAY'S ${def.label}` }}
        </button>

        <!-- The page's one visual answer to "where does today sit". MetricPage
             was the only screen in the app using none of the seven marks. -->
        <div v-if="mark" class="markrow">
          <GoalBar
            v-if="mark === 'goal'"
            :value="todayValue ?? 0"
            :goal="def.goal"
            :color="colour"
          />
          <!-- The axis is the window's own spread, not the range, so an
               ordinary day sits mid-axis and an unusual one runs to an end.
               `rug` draws every prior reading under the line; turning it off
               is the plainer variant. -->
          <RangeMark
            v-else
            :value="todayValue"
            :low="range?.low ?? null"
            :high="range?.high ?? null"
            :baseline="range?.mean ?? null"
            :series="priorReadings"
            :color="colour"
            :height="24"
            :low-label="markEnds[0]"
            :high-label="markEnds[1]"
          />
          <!-- The goal bar is scaled from zero to the target, so its ends are
               the ends of the row. The range mark labels its own, under the
               band, because its axis is wider than the range. -->
          <div v-if="mark === 'goal'" class="markends mono">
            <span>{{ markEnds[0] }}</span><span>{{ markEnds[1] }}</span>
          </div>
        </div>

        <!-- What the number is made of, or what it sits against. The other four
             drill-throughs all spend most of their first screen on today; this
             page's today was one reading, so history dominated it. -->
        <HomeCard
          v-if="parts.length"
          title="WHAT WENT INTO IT"
          :meta="`${todayText} / ${display(def.goal)}`"
          :color="colour"
        >
          <div class="terms">
            <div v-for="p in parts" :key="p.key" class="term">
              <div class="tline">
                <span class="tname mono">{{ p.name }}</span>
                <span class="tval mono">{{ display(p.value) }}</span>
              </div>
              <div class="tline">
                <span class="tsub mono">{{ p.at }}</span>
                <span class="tsub mono">{{ Math.round(p.fill) }}% OF GOAL</span>
              </div>
              <span class="tbar" :style="{ background: colour }">
                <i :style="{ width: `${p.fill}%`, background: colour }"></i>
              </span>
            </div>
          </div>
        </HomeCard>

        <HomeCard
          v-else-if="compares.length"
          title="HOW IT COMPARES"
          :meta="`${todayText} TODAY`"
          :color="colour"
        >
          <div v-for="c in compares" :key="c.key" class="cmprow">
            <span class="k mono">{{ c.label }}</span>
            <span class="track" :style="{ background: colour }">
              <i
                :style="{
                  width: `${c.fill}%`,
                  background: c.delta < 0 ? 'var(--bad)' : colour,
                }"
              ></i>
            </span>
            <span class="v mono"
              >{{ display(c.value) }}<em>{{ deltaText(c.delta) }}</em></span
            >
          </div>
        </HomeCard>

        <div class="grouphd mono" :style="{ color: colour }">HISTORY</div>

        <HomeCard title="DAY BY DAY" :meta="chartMeta" :color="colour">
          <!-- What the tapped day was. Defaults to the most recent reading, so
               the line always says something and tapping moves it rather than
               revealing it: an empty readout would be a caption asking to be
               used. Same interaction as the sleep page's WHEN YOU SLEPT. -->
          <div v-if="tapped" class="readout mono">
            <span>{{ tapped.label }}</span>
            <span class="rv">{{ tapped.value }}<em v-if="tapped.note"> · {{ tapped.note }}</em></span>
          </div>
          <div class="plot" :class="{ gutter: yTicks.length, lane: trip.active.value }">
            <!-- Why a stretch of the chart is empty, drawn behind the data.
                 HTML rather than SVG text: the chart scales with
                 preserveAspectRatio="none", which would stretch a label with
                 it. Only the missing days are covered, never the whole trip -
                 see utils/tripSpans.js. -->
            <TripLane
              :gaps="trip.gaps.value"
              :reach="trip.reach.value"
              :inset-left="yTicks.length ? 30 : 0"
            />
            <span
              v-for="t in yTicks"
              :key="t.v"
              class="ylab mono"
              :style="{ top: `${t.pct}%` }"
              >{{ t.text }}</span
            >
          <svg
            v-if="def.chart === 'bar' && bar.bars.length"
            class="chart"
            :viewBox="`0 0 ${CHART_W} ${CHART_H}`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <!-- Ink, not the metric's own colour. A dashed line in the family
                 hue drawn across bars of the family hue is the one thing on the
                 chart that has to stay legible, and it was the one thing
                 camouflaged. Same rule as the sleep page's goal line. -->
            <line
              v-if="bar.targetY != null"
              x1="0"
              :y1="bar.targetY"
              :x2="CHART_W"
              :y2="bar.targetY"
              class="target"
            />
            <!-- A missed day comes up to 0.55, not 0.34. At a third opacity it
                 read as a day with nothing logged, and this codebase keeps
                 those two facts apart everywhere else. -->
            <rect
              v-for="b in bar.bars"
              :key="b.i"
              :x="b.x"
              :y="b.y"
              :width="b.w"
              :height="b.h"
              rx="1.5"
              :fill="colour"
              :fill-opacity="b.i === tappedIndex ? 1 : b.met ? 0.8 : 0.55"
            />
            <!-- The shape a fortnight of daily totals actually has, once the
                 day-to-day noise is taken out of it. -->
            <polyline
              v-if="meanLine"
              :points="meanLine"
              fill="none"
              :stroke="colour"
              stroke-width="1.6"
              stroke-opacity="0.9"
              stroke-linejoin="round"
              stroke-linecap="round"
              vector-effect="non-scaling-stroke"
            />
          </svg>

          <svg
            v-else-if="def.chart === 'line' && line"
            class="chart"
            :viewBox="`0 0 ${CHART_W} ${CHART_H}`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <!-- The usual range behind the line, so every point can be judged
                 and not just today's. The page already computes it, prints it
                 in the pairs and draws it in the mark; the chart was the one
                 place that knew and did not say. -->
            <rect
              v-if="rangeBand"
              x="0"
              :y="rangeBand.y"
              :width="CHART_W"
              :height="rangeBand.h"
              :fill="colour"
              fill-opacity="0.1"
            />
            <line
              v-for="t in yTicks"
              :key="`g-${t.v}`"
              x1="0"
              :y1="t.y"
              :x2="CHART_W"
              :y2="t.y"
              :stroke="colour"
              :stroke-opacity="t.baseline ? 0.32 : 0.14"
              stroke-width="1"
              :stroke-dasharray="t.baseline ? '3 3' : ''"
              vector-effect="non-scaling-stroke"
            />
            <line
              v-for="(x, i) in weekRules"
              :key="`w-${i}`"
              :x1="x"
              y1="0"
              :x2="x"
              :y2="CHART_H"
              :stroke="colour"
              stroke-opacity="0.12"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
            <line
              v-if="tappedPoint"
              :x1="tappedPoint.x"
              y1="0"
              :x2="tappedPoint.x"
              :y2="CHART_H"
              :stroke="colour"
              stroke-opacity="0.45"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
            <polyline
              v-for="(p, i) in line.paths"
              :key="i"
              :points="p"
              fill="none"
              :stroke="colour"
              stroke-width="1.8"
              stroke-linejoin="round"
              stroke-linecap="round"
              vector-effect="non-scaling-stroke"
            />
            <!-- A dot per reading, which is what makes a day with nothing
                 recorded a visible hole rather than a slightly longer
                 segment. -->
            <circle
              v-for="p in line.points"
              :key="`p-${p.i}`"
              :cx="p.x"
              :cy="p.y"
              :r="p.i === tappedIndex ? 3.2 : 1.7"
              :fill="p.i === tappedIndex ? colour : colour"
              :fill-opacity="p.i === tappedIndex ? 1 : 0.75"
            />
          </svg>

          <!-- Only ever reached once `loaded` is true, so this now means what it
               says: the archive was read and there is genuinely not enough in
               it. -->
          <div v-else class="empty mono">NOT ENOUGH RECORDED YET.</div>

          <!-- Real-width tap targets over a stretched chart, the same reason
               the recovery and stress history charts have them. -->
          <div v-if="hasChart" class="hits">
            <button
              v-for="d in days"
              :key="d.date"
              type="button"
              class="hit"
              :aria-label="`${dayLabel(d.date)}, ${display(d.value)}`"
              @click="tappedDate = d.date"
            ></button>
          </div>

          </div>

          <div v-if="axis" class="axis mono" :class="{ gutter: yTicks.length }">
            <span v-for="a in axis" :key="a">{{ a }}</span>
          </div>

          <!-- The three facts the chart implies but does not state, and which
               one they are depends on whether the number has a target. A metric
               with a goal is asking how often it was met; one without is asking
               what normal is. The page used to answer neither.

               In the chart's own card rather than a second one underneath: they
               are the same subject, and two cards with no air between them read
               as one card with a seam through it.

               They have moved again, up into the facts line above the divider:
               they are what today is judged against, and below the fold is the
               one place that cannot do. -->
        </HomeCard>

        <!-- A month at a glance. The chart above shows the shape; this shows
             consistency, which is a different question and the one a target
             actually poses. Without a target the square is shaded by whether
             the day sat inside your usual range. -->
        <template v-if="calendar.length">
          <HomeCard :title="`LAST ${calWeeks} WEEKS`" :meta="calMeta" :color="colour">
            <div class="cal">
              <div v-for="(week, wi) in calendar" :key="wi" class="calweek">
                <span
                  v-for="d in week"
                  :key="d.date"
                  class="calday"
                  :class="{ future: d.future }"
                  :style="d.style"
                  :title="d.trip ? `${d.date} · ${d.trip}` : d.date"
                ></span>
              </div>
            </div>
            <div class="axis mono"><span>MON</span><span>SUN</span></div>
          </HomeCard>
        </template>

        <!-- Collapsed. The chart is what the page is for; the list is the
             backup, and forty rows of it pushed everything else off the top.
             Editable metrics expand in place rather than stacking another
             sheet on top, which on a phone leaves nowhere to tap out of. -->
        <details class="panel daysbox">
          <!-- EVERY DAY, not HISTORY · EVERY DAY. The divider above already
               said HISTORY, and the word appearing twice made the card read as
               a second, competing history rather than as the granular end of
               the one the divider opened. -->
          <summary class="boxlabel mono">
            EVERY DAY
            <span class="chevdown" aria-hidden="true"></span>
          </summary>
        <div class="daylist">
          <div v-for="d in daysNewestFirst" :key="d.date" class="dayrow">
            <div
              class="dayline"
              :class="{ tappable: def.editable }"
              @click="def.editable && toggleEdit(d)"
            >
              <span class="dt mono">{{ dayLabel(d.date) }}</span>
              <span v-if="tripFor(d.date)" class="trip mono">{{ tripFor(d.date) }}</span>
              <!-- A mark per row, so scanning a month is not reading forty
                   numbers. Goal metrics fill against the target; the rest show
                   how far the day sat from the baseline, either side of a
                   centre line. -->
              <span class="mkcell">
                <span v-if="isGoal && d.value != null" class="minibar">
                  <i
                    :style="{
                      width: `${Math.min(100, (d.value / def.goal) * 100)}%`,
                      background: colour,
                      opacity: d.value >= def.goal ? 1 : 0.42,
                    }"
                  ></i>
                </span>
                <span v-else-if="!isGoal && dev[d.date] != null" class="devbar">
                  <i class="axisline"></i>
                  <i
                    class="devfill"
                    :style="devStyle(dev[d.date])"
                  ></i>
                </span>
              </span>
              <span class="dv" :class="{ none: d.value == null }">{{ display(d.value) }}</span>
              <span v-if="def.editable" class="chev" aria-hidden="true">›</span>
            </div>

            <div v-if="editing === d.date" class="editrow">
              <span v-if="def.composite" class="editnote mono">
                MANUAL EXTRA, ON TOP OF WHAT THE DIARY ALREADY COUNTED
              </span>
              <div class="stepper">
                <button
                  class="step"
                  type="button"
                  @click="editVal = Math.max(0, +(editVal - def.step).toFixed(2))"
                >
                  −
                </button>
                <div class="val mono">
                  <input
                    class="valinput"
                    type="number"
                    inputmode="decimal"
                    v-model.number="editVal"
                    @focus="$event.target.select()"
                  /><span>{{ def.unit || "" }}</span>
                </div>
                <button
                  class="step"
                  type="button"
                  @click="editVal = +(editVal + def.step).toFixed(2)"
                >
                  +
                </button>
              </div>
              <!-- The field stays decimal because the stepper is shared with
                   water, creatine and weight, where a decimal is the natural
                   unit. But 8.63 is not a duration anybody reads, so the same
                   number is echoed in hours and minutes underneath it. -->
              <span v-if="def.format === 'hours'" class="editecho mono">
                {{ fmtHoursMins(editVal) }}
              </span>
              <button class="save mono" type="button" @click="save(d.date)">SAVE</button>
            </div>
          </div>
        </div>
        </details>

        <!-- Reference, and it moved below the history rather than sitting
             between the calendar and the day list. It explains what the number
             is, which is read once; the objection it was moved up to fix was
             that it came after forty rows of history, and collapsing it answers
             that without putting a definition in the middle of the record.
             One paragraph each: the longer entries explain what actually moves
             a metric, and that is a list of causes, not a single block. -->
        <details v-if="infoParagraphs.length" class="panel infobox">
          <summary class="boxlabel mono">
            WHAT THIS IS
            <span class="chevdown" aria-hidden="true"></span>
          </summary>
          <p v-for="(para, i) in infoParagraphs" :key="i" class="info">{{ para }}</p>
          <!-- Same list, same source, as the Recovery page's term rows. A list of
               causes written into one sentence reads as an essay on a phone. -->
          <div v-if="infoDetail" class="infodetail">
            <div class="infodetail-hd mono">{{ infoDetail.label }}</div>
            <div v-for="(item, i) in infoDetail.items" :key="i" class="infoitem">
              <span class="infodot" aria-hidden="true">·</span><span>{{ item }}</span>
            </div>
          </div>
        </details>
        </template>
      </div>

      <!-- Outside the scroller so it is not clipped by it, the same place every
           other sheet in the app is mounted. -->
      <QuickLogSheet
        v-if="todayLog"
        :field="todayLog"
        @close="todayLog = null"
        @save="saveTodayLog"
      />
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useCheckinStore } from "@/stores/checkin";
import { useFoodStore } from "@/stores/food";
import { useTripsStore } from "@/stores/trips";
import { useBackClose } from "@/composables/useBackClose";
import PageHeader from "@/components/layout/PageHeader.vue";
import HomeCard from "@/components/home/HomeCard.vue";
import GoalBar from "@/components/marks/GoalBar.vue";
import RangeMark from "@/components/marks/RangeMark.vue";
import { partRows, compareRows, recentAverage, previousReading } from "./todayCard";
import { dailyValuesForRange } from "@/utils/dailyRollup";
import { today, addDays, fmtHoursMins } from "@/utils/date";
import { familyColor } from "@/utils/families";
import {
  barGeometry,
  lineGeometry,
  meanLinePoints,
  weekRuleX,
  trimLeadingBlanks,
  CHART_W,
  CHART_H,
} from "@/utils/historyChart";
import { typicalRange } from "@/utils/baseline";
import QuickLogSheet from "@/components/home/QuickLogSheet.vue";
import { useTripLane } from "@/composables/useTripLane";
import TripLane from "@/components/marks/TripLane.vue";
import { formatValue } from "@/utils/metricRegistry";
import {
  isGoalMetric,
  goalSummary,
  trendSummary,
  deviationBars,
} from "./metricSummary";

const props = defineProps({
  def: { type: Object, required: true },
  /** Where the back control returns to, named by whoever opened this. */
  from: { type: String, default: "BACK" },
});
/** The window this page covers, which the body used to state as "LAST N DAYS". */
const rangeLabel = `LAST ${props.def.window} DAYS`;

const emit = defineEmits(["close"]);
useBackClose(() => emit("close"));

const infoParagraphs = computed(() =>
  (props.def.info ?? "")
    .split("\n\n")
    .map((p) => p.trim())
    .filter(Boolean)
);

/** The labelled list under the prose, where this metric has one. */
const infoDetail = computed(() => {
  const detail = props.def.detail;
  return detail?.items?.length ? detail : null;
});

const checkin = useCheckinStore();
const food = useFoodStore();
const trips = useTripsStore();

const colour = computed(() => familyColor(props.def.key));
const dayWindow = ref([]);
/**
 * Whether the archive has been read yet, as opposed to read and found empty.
 *
 * The two are not the same and the page was saying the second while it meant the
 * first: `dayWindow` starts empty, so for a frame or two every day looked null
 * and the chart announced NOT ENOUGH RECORDED YET about a metric with months
 * behind it. A page that opens on a wrong answer and corrects itself is worse
 * than one that opens blank, because the wrong answer is the one that gets read.
 */
const loaded = ref(false);

onMounted(async () => {
  const to = today();
  try {
    dayWindow.value = await dailyValuesForRange(addDays(to, -(props.def.window - 1)), to);
  } finally {
    // In `finally`, so a failed read still lets the page say what it knows
    // rather than sitting blank forever.
    loaded.value = true;
  }
});

/**
 * Oldest first, one entry per date in the window, with nulls left as nulls.
 *
 * This order is for the chart, which reads left to right. The list underneath
 * reverses it: you came to see today.
 *
 * **Trimmed to the first day that has a reading.** The window is a property of
 * how fast the number moves (14 days for sleep, 90 for weight), not of how long
 * Atlas has been collecting, so a metric that started recently spent the left
 * half of its chart on days that could never have had data. The archive begins
 * 22 July, so a 30-day window was half empty and weight's 90-day window was
 * nearly all empty.
 *
 * Only the **leading** blanks go. A gap in the middle is a day you did not
 * weigh yourself or the band was off, and the chart is built to show those; a
 * blank at the right-hand end is today, still in progress. Trimming either
 * would be hiding data rather than framing it.
 *
 * The rule was written here first and is now `trimLeadingBlanks`, shared with
 * Recovery, stress, heart rate and sleep, all of which were doing without it.
 */
const days = computed(() => {
  const to = today();
  const all = [];
  for (let i = props.def.window - 1; i >= 0; i -= 1) {
    const date = addDays(to, -i);
    all.push({ date, value: valueOn(date) });
  }
  return trimLeadingBlanks(all, (d) => d.value != null);
});

const daysNewestFirst = computed(() => [...days.value].reverse());

// Diary-backed metrics are additive: what the diary counted plus the manual
// extra. Reading only the checkin field would show a day logged entirely
// through food as empty.
//
// The sum collapses two different facts to zero, though, and they have to stay
// apart: a day you logged nothing is not a day you ate no protein. Nothing
// logged on either side reads as null, so the row says "--" and the chart
// leaves a gap rather than drawing a floor.
function valueOn(dateKey) {
  const def = props.def;
  if (def.source === "checkin") {
    const entry = checkin.entryFor(dateKey) ?? {};
    if (def.composite) {
      // Was `fibre ? fibreFor : proteinFor`, a two-way branch on a set that has
      // since become three: calories would have silently read the protein
      // total, which is the shape of bug every test passes.
      const diary = food.totalFor(dateKey, def.diaryKey ?? def.key);
      const manual = entry[def.key];
      if (!diary && manual == null) return null;
      return diary + (manual || 0);
    }
    return entry[def.key] ?? null;
  }
  return dayWindow.value.find((d) => d.date === dateKey)?.values?.[def.key] ?? null;
}

const series = computed(() => days.value.map((d) => d.value));
const bar = computed(() => barGeometry(series.value, props.def.goal));
// The usual range is pulled into the line's scale so the band drawn behind it
// cannot fall off the top or bottom of its own chart.
const line = computed(() =>
  lineGeometry(series.value, {
    include: range.value ? [range.value.low, range.value.high] : [],
  })
);
const hasChart = computed(() =>
  props.def.chart === "bar" ? bar.value.bars.length > 0 : line.value != null
);

// Boxes given in percent, not pixels, because the layer they sit in is HTML
// over the chart rather than inside its stretched viewBox.
const trip = useTripLane(computed(() => (hasChart.value ? days.value : [])));

/**
 * The seven-day trailing mean, on the bars' own axis.
 *
 * Opt-out per metric, because a metric that is already a rolling average has
 * nothing to gain from a rolling average of it: see `meanLine: false` on PAI.
 */
const meanLine = computed(() => {
  if (props.def.chart !== "bar" || props.def.meanLine === false) return "";
  if (!bar.value.bars.length) return "";
  const pts = meanLinePoints(series.value, bar.value.max);
  if (pts.length < 2) return "";
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
});

const weekRules = computed(() =>
  props.def.chart === "line" ? weekRuleX(series.value.length) : []
);

/**
 * Two or three labelled gridlines, in a left gutter beside the plot.
 *
 * Only for the line charts. A bar chart already has a labelled target line and
 * a floor at zero, so gridlines there would be a third horizontal rule saying
 * something the other two already cover.
 */
const yTicks = computed(() => {
  if (props.def.chart !== "line" || !line.value || !range.value) return [];
  const vals = [range.value.high, range.value.mean, range.value.low];
  return vals.map((v) => {
    const y = line.value.yOf(v);
    const baseline = v === range.value.mean;
    return {
      v,
      y,
      pct: (y / CHART_H) * 100,
      // Bare numbers: display() appends the unit, and "59 BPM" wrapped onto two
      // lines in a 27px gutter. The unit is stated once in the card header.
      // The baseline keeps its line but loses its label, because on a metric
      // whose range is narrow next to today's reading all three labels land
      // within a few pixels of each other.
      text: baseline ? "" : bare(v),
      baseline,
    };
  });
});

/** The usual range as a band behind the line. */
const rangeBand = computed(() => {
  if (props.def.chart !== "line" || !line.value || !range.value) return null;
  const top = line.value.yOf(range.value.high);
  const bottom = line.value.yOf(range.value.low);
  return { y: top, h: Math.max(1, bottom - top) };
});

// ── Tap to read ───────────────────────────────────────────────────────────
// Defaults to the most recent recorded day rather than to nothing, so the
// readout always says something and a tap moves it instead of revealing it.
const tappedDate = ref(null);
const tappedIndex = computed(() => {
  const list = days.value;
  const explicit = list.findIndex((d) => d.date === tappedDate.value);
  if (explicit >= 0) return explicit;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].value != null) return i;
  return -1;
});
const tappedPoint = computed(
  () => line.value?.points.find((p) => p.i === tappedIndex.value) ?? null
);
const tapped = computed(() => {
  const d = days.value[tappedIndex.value];
  if (!d) return null;
  let note = "";
  if (d.value != null) {
    if (isGoal.value) note = d.value >= props.def.goal ? "MET" : "SHORT";
    else if (range.value) {
      if (d.value < range.value.low) note = "LOW FOR YOU";
      else if (d.value > range.value.high) note = "HIGH FOR YOU";
    }
  }
  return {
    label: d.date === today() ? "TODAY" : dayLabel(d.date),
    value: display(d.value),
    note,
  };
});

const isGoal = computed(() => isGoalMetric(props.def));

// The day list's marks, keyed by date so the template can look one up without
// re-deriving the whole series per row.
const dev = computed(() => {
  if (isGoal.value) return {};
  const t = trendSummary(series.value);
  if (!t) return {};
  const bars = deviationBars(series.value, t.baseline);
  return Object.fromEntries(days.value.map((d, i) => [d.date, bars[i]]));
});

/**
 * A deviation bar grows from the centre line, left for below the baseline and
 * right for above. Half the width is the widest departure in the window, so
 * the longest bar always reaches the edge and a quiet month still has a shape.
 */
function devStyle(fraction) {
  const width = Math.min(50, Math.abs(fraction) * 50);
  return {
    background: colour.value,
    [fraction >= 0 ? "left" : "right"]: "50%",
    width: `${width}%`,
  };
}

/**
 * Four weeks as a grid, Monday to Sunday, oldest week first.
 *
 * Squares are filled when the goal was met, or when a no-target reading sat
 * inside its usual range. A day with no reading stays empty and a day that has
 * not happened yet is fainter still: those two look identical if both are just
 * "not filled", and one of them is a miss while the other is the future.
 */
// Never more weeks than the metric's own window holds. Protein's window is 14
// days, and a four-week grid would have drawn a fortnight of squares that are
// empty because nothing was fetched for them - indistinguishable from a
// fortnight of misses.
const calWeeks = computed(() => Math.max(2, Math.min(4, Math.floor(props.def.window / 7))));

const calendar = computed(() => {
  const CAL_WEEKS = calWeeks.value;
  // The same range the band word and the verdict use, not a second opinion.
  // A day shaded IN RANGE here while the hero calls today HIGH FOR YOU on a
  // different threshold is the defect deviationBand was written to end.
  const usual = isGoal.value ? null : range.value;
  const byDate = new Map(days.value.map((d) => [d.date, d.value]));
  const todayKey = today();

  // Back to the Monday of the week four weeks ago, so every row is a real week.
  const end = new Date(`${todayKey}T00:00:00`);
  const mondayOffset = (end.getDay() + 6) % 7;
  const start = new Date(end);
  start.setDate(start.getDate() - mondayOffset - (CAL_WEEKS - 1) * 7);

  const weeks = [];
  for (let w = 0; w < CAL_WEEKS; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      const cell = new Date(start);
      cell.setDate(cell.getDate() + w * 7 + d);
      const date = cell.toLocaleDateString("sv");
      const value = byDate.get(date) ?? null;
      const future = date > todayKey;

      const recorded = !future && value != null;
      const good =
        recorded &&
        (isGoal.value
          ? value >= props.def.goal
          : usual?.low != null && value >= usual.low && value <= usual.high);

      // The chart's two marks, at square size. An absence with a reason gets
      // the neutral wash the gap band uses; a *recorded* day inside a trip
      // keeps its own shading and gains a ring, which is the calendar's version
      // of the rule under the axis. Without the second one the calendar would
      // say nothing about the only trip on this phone, every day of which was
      // recorded.
      const trip = future ? "" : tripFor(date);

      row.push({
        date,
        future,
        recorded,
        good,
        trip,
        style: {
          background: trip && !recorded ? "var(--dim)" : colour.value,
          opacity: future ? 0.05 : recorded ? (good ? 0.95 : 0.34) : trip ? 0.3 : 0.12,
          boxShadow: trip && recorded ? "inset 0 0 0 1px var(--dim)" : undefined,
        },
      });
    }
    weeks.push(row);
  }
  return weeks;
});

/**
 * Both ends of a range at the same precision.
 *
 * short() drops a trailing zero per number, so a range came out as "40.3–54":
 * two numbers written to different precision read as two different kinds of
 * measurement rather than as the ends of one span.
 */
/**
 * A bare number at the metric's own precision.
 *
 * Everything that prints a value without its unit goes through this, because
 * the alternatives disagreed: the pairs said 50-59 while the chart's gutter
 * said 49.9 and 58.9 for the same two numbers.
 */
function bare(v) {
  return v == null ? "--" : v.toFixed(props.def.format === "decimal1" ? 1 : 0);
}

function pair(lo, hi) {
  return `${bare(lo)}–${bare(hi)}`;
}

/** A bare number for the stat strip, where the unit is already implied. */
function short(value) {
  if (value == null) return "--";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

const todayValue = computed(() => days.value.at(-1)?.value ?? null);
const todayText = computed(() => display(todayValue.value));

// The hero splits the unit off so the 52px string is digits only, matching the
// other three drill-throughs. formatValue bakes the unit in, which is right
// everywhere else on the page and wrong at this size.
const heroNumber = computed(() => {
  const text = todayText.value;
  const unit = (props.def.unit ?? "").trim();
  if (unit && text.endsWith(unit)) return text.slice(0, -unit.length).trim();
  return text;
});
// No unit against a dash: "--MS" reads as a reading in a unit nobody took.
const heroUnit = computed(() =>
  todayValue.value == null ? "" : (props.def.unit ?? "").trim()
);

function display(v) {
  return formatValue(props.def, v);
}

/** Goal metrics are judged against the goal; the rest against their own range. */
const verdict = computed(() => {
  const def = props.def;
  const v = todayValue.value;
  if (v == null) return "Nothing recorded today.";

  if (def.goal) {
    if (v >= def.goal) return `Past today's target of ${display(def.goal)}.`;
    const left = def.goal - v;
    return `${display(left)} short of today's target.`;
  }

  // No target, so the only honest comparison is against your own recent
  // readings, and only once enough of them exist to mean something.
  const usual = range.value;
  if (!usual) return "Still building up a normal range for this.";
  if (v < usual.low) return "Below your usual range for the last few weeks.";
  if (v > usual.high) return "Above your usual range for the last few weeks.";
  return "Inside your usual range for the last few weeks.";
});

/**
 * The usual range, from the readings before today.
 *
 * Today is excluded for the same reason Home's baselines exclude it: a range
 * that contains the reading being judged is dragged toward it. Everything that
 * calls a reading typical or not reads this one value, so the band word, the
 * verdict sentence and the mark cannot describe one number three ways.
 */
const range = computed(() => typicalRange(series.value.slice(0, -1).filter((v) => v != null)));

/** Four words wide, and never the only channel: the sentence beside it says
    the same thing in full. */
const bandWord = computed(() => {
  const v = todayValue.value;
  if (v == null) return "NO DATA";
  if (isGoal.value) return v >= props.def.goal ? "MET" : "SHORT";
  if (!range.value) return "CALIBRATING";
  if (v < range.value.low) return "LOW FOR YOU";
  if (v > range.value.high) return "HIGH FOR YOU";
  return "TYPICAL";
});

const bandColour = computed(() => {
  const word = bandWord.value;
  if (word === "LOW FOR YOU" || word === "HIGH FOR YOU") return "var(--bad)";
  return word === "MET" ? colour.value : "var(--dim)";
});

/**
 * What today is being judged against, as label/value pairs.
 *
 * The streak came out and has stayed out: it and the met count answer nearly
 * the same question. What is here is what the hero cannot say for itself.
 */
const facts = computed(() => {
  if (isGoal.value) {
    const s = goalSummary(series.value, props.def.goal);
    if (!s) return [];
    return [
      { k: "GOAL", v: display(props.def.goal) },
      { k: "MET", v: `${s.met} / ${s.recorded}` },
    ];
  }
  const t = trendSummary(series.value);
  if (!t) return [];
  const out = [];
  // `range`, not trendSummary's own: trendSummary includes today in the window
  // it derives a range from, so an unusual reading widens the range it is being
  // judged against. On a 70 BPM day against a 50-59 normal that printed USUAL
  // RANGE 41.1-72.6 beside a mark labelled 50 and 59, which is the same metric
  // described two ways on one screen. Everything here reads the one range.
  if (range.value) out.push({ k: "USUAL RANGE", v: pair(range.value.low, range.value.high) });
  out.push({
    k: `${props.def.window}-DAY TREND`,
    v: `${t.change < 0 ? "−" : "+"}${short(Math.abs(t.change))}`,
  });
  return out;
});

/** The readings before today, which the range mark scales its axis to. */
const priorReadings = computed(() => series.value.slice(0, -1).filter((v) => v != null));

/**
 * The today card's contents. A metric whose total is made of logged meals gets
 * its parts; everything else gets today against the references it has.
 */
const parts = computed(() =>
  props.def.composite
    ? partRows(
        // Same rename as valueOn: the store's field is `kcal`.
        food.contributionsFor(today(), props.def.diaryKey ?? props.def.key),
        props.def.goal
      )
    : []
);

const compares = computed(() => {
  if (isGoal.value || parts.value.length) return [];
  return compareRows({
    today: todayValue.value,
    yesterday: previousReading(series.value),
    weekAverage: recentAverage(priorReadings.value, 7),
    // The centre of the same range the mark and the pairs use, so the page
    // never quotes two normals.
    baseline: range.value?.mean ?? null,
  });
});

/** A signed difference, with the sign carried by a real minus rather than a hyphen. */
function deltaText(delta) {
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return "±0";
  return `${rounded < 0 ? "−" : "+"}${short(Math.abs(rounded))}`;
}

/** Which mark, or none at all before there is anything for it to say. */
const mark = computed(() => {
  if (isGoal.value) return "goal";
  return todayValue.value != null && range.value ? "baseline" : null;
});

const markEnds = computed(() =>
  isGoal.value
    ? ["0", `GOAL ${display(props.def.goal)}`]
    : [display(range.value?.low), display(range.value?.high)]
);

/** How the weeks in the grid went, in the card's own header. */
const calMeta = computed(() => {
  let good = 0;
  let recorded = 0;
  for (const week of calendar.value) {
    for (const d of week) {
      if (!d.recorded) continue;
      recorded += 1;
      if (d.good) good += 1;
    }
  }
  if (!recorded) return "";
  return `${isGoal.value ? "MET" : "IN RANGE"} ${good} OF ${recorded}`;
});

/**
 * The chart's axis, in the sleep page's two shapes rather than a third one.
 *
 * It used to print `0` at the left and `TARGET 160G` at the right, which are
 * both y-axis values sitting where an x-axis is read: it says the chart runs
 * from zero to the target. Sleep never does that. HOW LONG puts time at both
 * ends and its goal in the card header, and SLEEPING HEART RATE prints the low,
 * the span and the high, because those bars are scaled to their own range and
 * the numbers are what make the heights mean anything.
 *
 * So: bars have a target line drawn on them and take a time axis; a line is
 * scaled to itself and takes the three-part one.
 */
/**
 * Dates along the bottom, now that the values live in the gutter.
 *
 * Before the gridlines the axis had to carry the value range, which meant a
 * month of readings was labelled "30 DAYS AGO" and "TODAY" and nothing else,
 * and you could not find last Tuesday on it.
 */
const axis = computed(() => {
  // Read off `days`, not off `def.window`. The series is trimmed to the first
  // day that has a reading, so a window-derived date would label the chart with
  // a day that is not on it.
  const list = days.value;
  if (!list.length) return null;
  const first = list[0].date;
  const mid = list[Math.floor((list.length - 1) / 2)].date;

  if (props.def.chart === "line") {
    if (!line.value) return null;
    return [shortDate(first), shortDate(mid), "TODAY"];
  }
  return [shortDate(first), meanLine.value ? "7-DAY MEAN" : shortDate(mid), "TODAY"];
});

/** "5 AUG", short enough for three of them across a phone. */
function shortDate(dateKey) {
  return new Date(`${dateKey}T00:00:00`)
    .toLocaleDateString("en-AU", { day: "numeric", month: "short" })
    .toUpperCase();
}

/**
 * The goal moves here off the axis, the way sleep's does. A metric with no goal
 * puts its unit here instead, since the gutter labels are bare numbers.
 */
const chartMeta = computed(() => {
  if (isGoal.value) return `${display(props.def.goal)} GOAL`;
  const unit = (props.def.unit ?? "").trim();
  return unit ? `IN ${unit}` : "";
});

function dayLabel(dateKey) {
  const d = new Date(`${dateKey}T00:00:00`);
  return d
    .toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })
    .replace(",", "")
    .toUpperCase();
}
function tripFor(dateKey) {
  return trips.labelFor?.(dateKey) ?? "";
}

// ── Editing ───────────────────────────────────────────────────────────────
/**
 * Today's reading, entered from the top of the page.
 *
 * Reuses `QuickLogSheet` rather than growing a second stepper. That component
 * was written to be "reusable for future metrics" and had exactly one caller;
 * this is the future metric.
 */
const todayLog = ref(null);

function openTodayLog() {
  todayLog.value = {
    key: props.def.key,
    label: props.def.label,
    unit: (props.def.unit ?? "").trim(),
    step: props.def.step ?? 1,
    value: todayValue.value ?? 0,
  };
}

async function saveTodayLog(pairs) {
  checkin.logMetric(Object.fromEntries(pairs));
  todayLog.value = null;
  // The window is read once on mount, so without this the page keeps showing
  // the reading it opened with and the entry looks to have been thrown away.
  const to = today();
  dayWindow.value = await dailyValuesForRange(addDays(to, -(props.def.window - 1)), to);
}

const editing = ref(null);
const editVal = ref(0);

function toggleEdit(day) {
  if (editing.value === day.date) {
    editing.value = null;
    return;
  }
  editing.value = day.date;
  // Composite metrics edit the manual extra alone, so the field has to start
  // from that rather than from the diary-inclusive total shown in the row.
  editVal.value = props.def.composite
    ? (checkin.entryFor(day.date)?.[props.def.key] ?? 0)
    : (day.value ?? 0);
}

function save(dateKey) {
  checkin.logMetric({ [props.def.key]: editVal.value }, dateKey);
  editing.value = null;
}
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
  /* Safe-area padding on the shell, never on the scrolling child: on the child
     the inset scrolls away and the header rides up under the status icons. */
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
  /* .page already clips, so the overscan alone hides the Android overlay
     scroll bar. See --sb-overscan in style.css. */
  margin-right: calc(-1 * var(--sb-overscan));
  padding-right: var(--sb-overscan);
}


/* The number and the words beside it, the same arrangement as the sleep and
   recovery heroes. A hero of nothing but digits gives the eye nowhere to
   land. */
/* 52px and 16px of gap, which is what the sleep and recovery heroes use. This
   was 42px in a tighter block and read as the caption to the history rather
   than as the thing the page is about. */
.today {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}
.num {
  font-size: 52px;
  font-weight: 700;
  line-height: 0.9;
  color: v-bind(colour);
  font-variant-numeric: tabular-nums;
  flex: none;
}
.num u {
  text-decoration: none;
  font-size: 20px;
  letter-spacing: 0;
  color: var(--dim);
  margin-left: 3px;
}
.tmeta {
  min-width: 0;
  padding-top: 2px;
}
/* 12px at 2px tracking, which is what Sleep, Stress and Recovery all use. */
.band {
  font-size: 12px;
  letter-spacing: 2px;
}
.verdict {
  margin: 6px 0 0;
  font-size: var(--fs-prose);
  line-height: 1.5;
  color: var(--body);
}

/* What today is judged against. Quiet on purpose: it is reference for the
   number above it, not a second reading. */
/* Two cells divided by a single vertical hairline. Horizontal rules are what
   this page is already full of: the mark's axis, the chart's target line, the
   card edges. A vertical one cannot be mistaken for any of them. */
.pairs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
  background: var(--panel-line);
  border-radius: 8px;
  overflow: hidden;
}
.pair {
  background: var(--bg1);
  padding: 9px 12px 10px;
  min-width: 0;
}
.pair .k {
  font-size: 9.5px;
  letter-spacing: 1.4px;
  color: var(--dim);
}
.pair .v {
  font-size: 16px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The one control on this page, so it looks like one: a full-width outlined
   row in the metric's own colour rather than a link. It sits between the facts
   and the mark, which is the only place on a page with no readings that anything
   is going to be looked at. */
.logtoday {
  display: block;
  width: 100%;
  margin: 14px 0 4px;
  padding: 11px;
  background: none;
  border: 1px solid color-mix(in srgb, currentColor 55%, transparent);
  border-radius: 8px;
  color: v-bind(colour);
  font-size: 10.5px;
  letter-spacing: 1.4px;
  cursor: pointer;
}
.logtoday:active {
  background: color-mix(in srgb, currentColor 12%, transparent);
}

.markrow {
  margin-top: 18px;
}
.markends {
  display: flex;
  justify-content: space-between;
  font-size: 9.5px;
  letter-spacing: 1.2px;
  color: var(--dim);
  padding-top: 7px;
}

/* ── the today card ─────────────────────────────────────────────────── */
.terms {
  display: flex;
  flex-direction: column;
  gap: 13px;
  padding: 2px 0 5px;
}
.term .tline {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.tname {
  font-size: var(--fs-label);
  letter-spacing: 1px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tval {
  font-size: var(--fs-label);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  flex: none;
}
.tsub {
  font-size: 10px;
  letter-spacing: 1.2px;
  color: var(--dim);
}
.tbar {
  display: block;
  height: 4px;
  border-radius: 2px;
  margin-top: 6px;
  overflow: hidden;
  opacity: var(--mark-track);
}
.tbar i {
  display: block;
  height: 100%;
  border-radius: 2px;
  /* The track carries the opacity, so the fill has to put it back. */
  opacity: calc(1 / var(--mark-track));
}

.cmprow {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  border-top: 1px solid var(--panel-line);
}
.cmprow:first-of-type {
  border-top: 0;
}
.cmprow .k {
  font-size: var(--fs-micro);
  letter-spacing: 1.3px;
  color: var(--dim);
  width: 96px;
  flex: none;
}
.cmprow .track {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  opacity: var(--mark-track);
  overflow: hidden;
}
.cmprow .track i {
  display: block;
  height: 100%;
  border-radius: 2px;
  opacity: calc(1 / var(--mark-track));
}
.cmprow .v {
  font-size: var(--fs-label);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  min-width: 78px;
  text-align: right;
  flex: none;
}
.cmprow .v em {
  font-style: normal;
  color: var(--dim);
  font-size: 10px;
  margin-left: 5px;
}

/* A label that is a card's header sits at the top of the card, so the gap it
   used to need above itself is now the card's own margin. */
.panel > .boxlabel {
  margin-top: 0;
}
/* This one is not a header: it divides the chart from the facts under it,
   inside the same card, so it keeps a gap above and gets a smaller one below. */
.boxlabel {
  font-size: var(--fs-micro);
  letter-spacing: 2px;
  color: var(--dim);
  margin: 22px 0 10px;
}
/* The plot, with a left gutter for value labels. They are HTML rather than SVG
   text because the chart is stretched with preserveAspectRatio="none", which
   would squash any text drawn inside it. */
.plot {
  position: relative;
}
.plot.gutter {
  padding-left: 30px;
}
.ylab {
  position: absolute;
  left: 0;
  width: 27px;
  text-align: right;
  font-size: 9px;
  letter-spacing: 0.6px;
  color: var(--dim);
  transform: translateY(-50%);
}
.chart {
  display: block;
  width: 100%;
  height: 118px;
}

/* What the tapped day was. Above the chart rather than floating on it: a
   tooltip under a finger is a tooltip nobody can read. */
.readout {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  font-size: 10.5px;
  letter-spacing: 1.2px;
  color: var(--dim);
  padding-bottom: 8px;
}
.readout .rv {
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.readout em {
  font-style: normal;
  color: var(--dim);
}

/* Room for TripLane's rule, and only when a trip is in the window: otherwise
   every chart in the app gains 13px of nothing to serve the one page that has
   a trip on it. The lane height is TripLane's own LANE constant. */
.plot.lane {
  padding-bottom: 13px;
}
.plot.lane .hits {
  bottom: 13px;
}

/* Real-width targets over a stretched chart. */
.hits {
  position: absolute;
  inset: 0 0 0 auto;
  width: 100%;
  display: flex;
}
.plot.gutter .hits {
  left: 30px;
  width: calc(100% - 30px);
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
.axis {
  display: flex;
  justify-content: space-between;
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  color: var(--dim);
  margin-top: 9px;
}
.axis.gutter {
  margin-left: 30px;
}
.target {
  stroke: var(--ink);
  stroke-opacity: 0.45;
  stroke-width: 1;
  stroke-dasharray: 3 3;
  /* Or the dashes stretch with the chart's non-uniform scaling and read as a
     solid rule at one end and nothing at the other. */
  vector-effect: non-scaling-stroke;
}
.empty {
  font-size: var(--fs-label);
  letter-spacing: 1px;
  color: var(--dim);
  padding: 26px 0;
  text-align: center;
}

/* No surface of its own: it lives inside the HISTORY card now, and a card
   drawn inside a card is two edges saying one thing. */
.daylist {
  padding: 0;
}
.dayrow + .dayrow {
  border-top: 1px solid color-mix(in srgb, var(--dim) 14%, transparent);
}
.dayline {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: var(--row-h);
}
.tappable {
  cursor: pointer;
}
.dt {
  font-size: var(--fs-label);
  letter-spacing: 1px;
  color: var(--dim);
  flex-shrink: 0;
}
.trip {
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  color: var(--dim);
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dv {
  margin-left: auto;
  font-size: var(--fs-value);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.dv.none {
  color: var(--dim);
}
.chev {
  color: var(--dim);
  font-size: 15px;
  width: 8px;
  text-align: right;
  flex-shrink: 0;
}

.editrow {
  padding: 4px 0 14px;
}
.editnote {
  display: block;
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  color: var(--dim);
  margin-bottom: 10px;
}
/* The decimal in the field, said again the way a duration is actually read. */
.editecho {
  display: block;
  margin-top: 6px;
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  color: var(--dim);
}
.stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
}
.step {
  width: 48px;
  height: 48px;
  border: 1px solid v-bind(colour);
  border-radius: 6px;
  color: v-bind(colour);
  font-size: 24px;
}
.val {
  font-size: 26px;
  color: var(--ink);
  min-width: 96px;
  text-align: center;
}
.val span {
  font-size: var(--fs-label);
  color: var(--dim);
  margin-left: 4px;
}
.valinput {
  width: 84px;
  background: none;
  border: none;
  border-bottom: 1px solid color-mix(in srgb, var(--dim) 40%, transparent);
  color: var(--ink);
  font-size: 26px;
  font-family: var(--font-sans);
  text-align: center;
  -moz-appearance: textfield;
}
.valinput::-webkit-inner-spin-button,
.valinput::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.valinput:focus {
  outline: none;
}
.save {
  display: block;
  width: 100%;
  margin-top: 12px;
  text-align: center;
  font-size: var(--fs-label);
  letter-spacing: 2px;
  color: var(--bg1);
  background: v-bind(colour);
  border-radius: 6px;
  padding: 12px 0;
}

.cal {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.calweek {
  display: flex;
  gap: 3px;
}
.calday {
  flex: 1;
  height: 15px;
  border-radius: 2px;
}
.daysbox summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
  list-style: none;
  min-height: 44px;
  padding: 12px 0 10px;
}
.daysbox summary::-webkit-details-marker {
  display: none;
}
.daysbox summary:focus-visible {
  outline: 2px solid var(--acc);
  outline-offset: 3px;
}
.chevdown {
  width: 8px;
  height: 8px;
  border-right: 1.5px solid var(--dim);
  border-bottom: 1.5px solid var(--dim);
  transform: rotate(45deg) translate(-2px, -2px);
  transition: transform 0.15s ease;
}
.daysbox[open] .chevdown,
.infobox[open] .chevdown {
  transform: rotate(-135deg) translate(-2px, -2px);
}
/* `.panel` carries a bottom margin and `.card` a top one, so a collapsed panel
   sitting under a HomeCard had no gap at all between them and the two read as
   one container with a rule through it. */
.daysbox,
.infobox {
  margin-top: 11px;
}
.infobox summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
  list-style: none;
  min-height: 44px;
  padding: 12px 0 10px;
  margin: 0;
}
.infobox summary::-webkit-details-marker {
  display: none;
}
.infobox summary:focus-visible {
  outline: 2px solid var(--acc);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .chevdown {
    transition: none;
  }
}

/* The day list's own mark. Sits between the date and the value, which is the
   column the trip label already shares. */
.mkcell {
  flex: 1;
  min-width: 0;
  padding: 0 4px;
}
.minibar {
  display: block;
  height: 5px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--dim) 14%, transparent);
  position: relative;
}
.minibar i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 2px;
}
.devbar {
  display: block;
  position: relative;
  height: 7px;
}
.axisline {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: color-mix(in srgb, var(--dim) 34%, transparent);
}
.devfill {
  position: absolute;
  top: 1.5px;
  height: 4px;
  border-radius: 2px;
}

/* Prose belongs in a card like everything else on the page. Left bare it was
   the one block sitting straight on the background once every neighbour had a
   surface, which read as something that had been missed. */
.info {
  margin: 0;
  font-size: var(--fs-second);
  line-height: 1.65;
  color: var(--dim);
}
.info + .info {
  margin-top: 13px;
}
.infodetail {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.infodetail-hd {
  font-size: 9.5px;
  letter-spacing: 1.4px;
  color: var(--dim);
}
/* Grid, not a text indent, so a wrapped line starts under the first word rather
   than under the marker. */
.infoitem {
  display: grid;
  grid-template-columns: 10px 1fr;
  gap: 6px;
  font-size: var(--fs-second);
  line-height: 1.6;
  color: var(--dim);
}
.infodot {
  color: var(--dim);
  opacity: 0.7;
}
/* Clears the summary row it now opens under. */
.infobox .info:first-of-type {
  padding-top: 2px;
}
</style>
