<template>
  <!-- A page rather than a bottom sheet. A hypnogram plus a four-row legend is
       more than a sheet can show without becoming a scrolling panel pinned to
       the bottom of the screen, and this is somewhere you went, not something
       that popped up. Same Teleport-over-the-tab-bar pattern as SettingsPage. -->
  <Teleport to="body">
    <div class="page grid-bg">
      <div class="pscroll">
        <!-- The back control names where it returns to rather than saying BACK,
             and the rest of the row carries the night being looked at. This page
             has always been able to render any date and nothing could ever ask
             it for one, so the space the old bordered pill left empty is spent
             on the thing the page could already do. -->
        <PageHeader :from="from" @close="$emit('close')">
          <template #right>
            <button
              class="stepbtn"
              type="button"
              :disabled="!prevNight"
              aria-label="The night before"
              @click="viewDate = prevNight"
            >
              ‹
            </button>
            <span class="datetext">{{ headerLabel }}</span>
            <button
              class="stepbtn"
              type="button"
              :disabled="!nextNight"
              aria-label="The night after"
              @click="viewDate = nextNight"
            >
              ›
            </button>
          </template>
        </PageHeader>

        <div v-if="!hasAnything" class="empty mono">NO SLEEP RECORDED FOR THIS NIGHT.</div>

        <template v-else>
          <!-- The score with words beside it, same shape as RecoveryPage. A
               hero of nothing but digits gives the eye nowhere to land, which is
               what made the first version of this page read as a wall. -->
          <div class="hero">
            <div class="num">{{ result.score ?? "--" }}</div>
            <div class="herometa">
              <div class="bandlabel mono">{{ result.label ?? "NOT SCORED" }}</div>
              <p v-if="costliest" class="verdict">{{ costliest }}</p>
            </div>
          </div>

          <!-- One quiet line for the facts of the night.
               The strap's own score used to ride at the end of this line, while
               ours was on probation and Home's dial still showed theirs. Both
               ended 2026-08-07: ours is now the only sleep score in the app, so a
               second number here would only ask which one to believe. Measured on
               16 real nights the two differ by up to 19 points, which is exactly
               why showing both was becoming a question rather than a footnote.
               Restoring it is one `stages.score` away if the comparison is ever
               wanted again. -->
          <div class="facts mono">
            <b>{{ fmtHoursMins(hours) }}</b>
            <span v-if="clockLine">{{ clockLine }}</span>
          </div>

          <!-- The whole scale, with tonight on it. A score is a position between
               thresholds, and 92 on its own does not say what the next one worth
               reaching is. -->
          <div v-if="result.state === 'ready'" class="scale">
            <div class="scaletrack">
              <span
                v-for="b in scaleBands"
                :key="b.label"
                class="seg"
                :class="{ on: b.current }"
                :style="{ left: `${b.start}%`, width: `${b.width}%`, background: b.color }"
              ></span>
              <span class="pin" :style="{ left: `${result.score}%` }"></span>
            </div>
            <!-- Names, not thresholds, and laid out exactly as RecoveryPage's are:
                 a flex row where each label owns its own band's width and starts at
                 its left edge, so nothing can collide however narrow the phone. The
                 two scores sat side by side saying the same thing two ways, one in
                 numbers and one in words. The numbers are still in HOW IT IS BUILT,
                 which is where a threshold is actually useful. -->
            <div class="scalelabels mono">
              <span
                v-for="b in scaleBands"
                :key="b.label"
                :style="{ width: `${b.width}%`, color: b.current ? b.ink : 'var(--dim)' }"
              >
                {{ b.label }}
              </span>
            </div>
          </div>

          <!-- A card per section, the same one Home uses. The page had every
               section sitting flat on the background with nothing but air
               between them, so nothing said where one ended; the card edge does
               that, and it makes this page the same system as the rest of the
               app rather than the exception. -->
          <HomeCard
            title="WHAT WENT INTO IT"
            :meta="`${result.score ?? '--'} / 100`"
            :color="famBody"
          >
            <div class="terms">
            <div v-for="t in terms" :key="t.key" class="term">
              <!-- The whole row opens it, with the DOWN caret MetricPage and the
                   Recovery page's terms both collapse with. Not the › chevron:
                   that means "goes to a page", and a detail page never opens
                   another detail page. -->
              <button
                class="tline tsummary"
                type="button"
                :aria-expanded="openTerm === t.key"
                @click="toggleTerm(t.key)"
              >
                <span class="tname mono">{{ t.label }}</span>
                <span class="treading">{{ t.reading }}</span>
                <span
                  class="chevdown"
                  :class="{ open: openTerm === t.key }"
                  aria-hidden="true"
                ></span>
              </button>
              <div class="tline sub">
                <span class="tref mono">{{ t.reference }}</span>
                <span class="tpts mono">{{ t.points }} / {{ t.maxPoints }} PTS</span>
              </div>
              <!-- Filled against what the term could have contributed, not
                   against 100: a 25-point term at full strength has to look
                   full, not like a quarter of the score. -->
              <span class="tbar">
                <i :style="{ width: `${(t.points / t.maxPoints) * 100}%` }"></i>
              </span>
              <div v-if="t.redistributed" class="tnote mono">
                WEIGHTED UP FROM {{ t.nominalWeight }}% · A TERM IS MISSING TONIGHT
              </div>

              <!-- Text from SLEEP_TERM_INFO, beside the labels rather than here,
                   so nothing describes a term twice. Same markup as the Recovery
                   page's expanded terms. -->
              <div v-if="openTerm === t.key && termInfo(t.key)" class="expanded">
                <p v-for="(para, i) in termInfo(t.key).paragraphs" :key="i" class="einfo">
                  {{ para }}
                </p>
                <div v-if="termInfo(t.key).detail" class="edetail">
                  <div class="edetail-hd mono">{{ termInfo(t.key).detail.label }}</div>
                  <div v-for="(item, i) in termInfo(t.key).detail.items" :key="i" class="eitem">
                    <span class="edot" aria-hidden="true">·</span><span>{{ item }}</span>
                  </div>
                </div>
              </div>
            </div>
            </div>
            <p v-if="result.terms.regularity == null" class="withheld mono">
              REGULARITY NEEDS {{ result.needed }} NIGHTS WITH A RECORDED BEDTIME. ITS WEIGHT
              IS SPREAD ACROSS THE OTHER TERMS UNTIL THEN.
            </p>
          </HomeCard>

          <HomeCard title="THE NIGHT" :color="famBody" class="nightcard">
          <!-- On the header's line, in the corner, as a mark rather than a word.
               EXPAND spelled out was the loudest thing in a card whose whole
               point is the chart under it. -->
          <button
            class="zoombtn"
            type="button"
            aria-label="Expand the hypnogram"
            @click="zoomed = true"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 3H3v6M21 9V3h-6M15 21h6v-6M3 15v6h6" />
            </svg>
          </button>
          <!-- Deep at the bottom, awake at the top, so depth is carried by
               vertical position as well as by hue. The axis is clock time now
               that the bedtime is stored, and falls back to elapsed hours for a
               night recorded before it was. -->
          <div v-if="timeline.length" class="hypnobox">
            <!-- On the chart rather than up in the header: the control belongs to
                 the thing it enlarges, and in the header it read as a page
                 action sitting next to a title. -->
            <svg class="hypno" viewBox="0 0 340 194">
              <g v-for="s in ROW_LABEL_ORDER" :key="`r-${s}`">
                <line x1="46" :y1="rowY(s)" x2="340" :y2="rowY(s)" class="grid" />
                <text x="0" :y="rowY(s) + 16" class="rowlabel">{{ STAGE_LABEL[s] }}</text>
              </g>
              <rect
                v-for="(seg, i) in hypno.segments"
                :key="i"
                :x="46 + seg.x"
                :y="seg.y"
                :width="seg.w"
                :height="seg.h"
                rx="2"
                :fill="`var(--stage-${seg.stage})`"
              />
              <text
                v-for="(t, i) in hypno.ticks"
                :key="`t-${i}`"
                :x="46 + t.x"
                y="190"
                class="tick"
                text-anchor="middle"
              >
                {{ t.label }}
              </text>
            </svg>
            <div v-if="hypno.elapsed" class="axisnote mono">
              HOURS FROM THE START OF THE NIGHT. NO BEDTIME WAS RECORDED FOR THIS ONE.
            </div>
          </div>

          <CompositionBar v-else :segments="stages" variant="stage" :height="30" />

          <div class="legend">
            <div v-for="s in STAGE_ORDER" :key="s" class="lrow">
              <i :style="{ background: `var(--stage-${s})` }"></i>
              <span class="lname mono">{{ STAGE_LABEL[s] }}</span>
              <span
                class="lbar"
                :style="{ background: `var(--stage-${s})`, width: barWidth(s) }"
              ></span>
              <span class="lval mono">
                {{ fmtHoursMins(stageMinutes(stages, s) / 60) }}
                <span class="lpct">{{ pct[s] ?? 0 }}%</span>
                <!-- How many times, not just how long: twenty minutes awake in
                     one spell and in five are different nights, and the chart
                     above is the only other place that says so. -->
                <span v-if="s === 'awake' && awakenings != null" class="lpct">
                  · {{ awakeningsText }}
                </span>
              </span>
            </div>
          </div>

          <!-- Only when there is no timeline. A left-to-right chart implies an
               ordering, and inventing one would be the single dishonest thing
               this screen could do. -->
          <div v-if="!timeline.length" class="caveat mono">
            <b>STAGE TIMINGS ARE NOT AVAILABLE FOR THIS NIGHT.</b> The strap reported four
            totals but not when each stage happened. The proportions above are real, their
            order is not.
          </div>
          </HomeCard>

          <div class="grouphd mono" :style="{ color: famBody }">HISTORY</div>

          <HomeCard
            title="WHEN YOU SLEPT"
            :meta="result.sri != null ? `${result.sri}% REGULAR` : ''"
            :color="famBody"
          >
          <!-- Time down the side, one column per night. A night is a span of the
               clock, and only this way round can a late night sit visibly BELOW
               the band the rest of the week shares. The axis is fixed at 21:00 to
               13:00 and never scaled to the week's own range, or an irregular
               week would look exactly as tidy as a regular one. -->
          <div>
            <div v-if="regularity.columns.length" class="regwrap">
              <div class="regy mono">
                <span
                  v-for="g in regularity.gridlines"
                  v-show="g.label"
                  :key="g.y"
                  :class="{ midnight: g.midnight }"
                  :style="{ top: `${(g.y / regularity.height) * 100}%` }"
                  >{{ g.label }}</span
                >
              </div>
              <!-- No aspect preservation: the clock labels beside this are placed in
                     CSS against the same 132px box, and a letterboxed viewBox puts the
                     bars on a different vertical scale from the axis naming them. -->
                <svg
                  class="reg"
                  :viewBox="`0 0 294 ${regularity.height}`"
                  preserveAspectRatio="none"
                >
                <line
                  v-for="g in regularity.gridlines"
                  :key="g.y"
                  x1="0"
                  :y1="g.y"
                  x2="294"
                  :y2="g.y"
                  class="grid"
                  :class="{ midnightline: g.midnight }"
                />
                <rect
                  v-if="regularity.band"
                  x="0"
                  :y="regularity.band.y"
                  width="294"
                  :height="regularity.band.h"
                  class="usual"
                />
                <rect
                  v-for="c in regularity.columns"
                  :key="c.date"
                  :x="c.x"
                  :y="c.y"
                  :width="c.w"
                  :height="c.h"
                  :rx="c.w / 2"
                  fill="var(--fam-body)"
                  :fill-opacity="c.today ? 1 : 0.62"
                  @click="tapped = tapped === c.date ? null : c.date"
                />
              </svg>
            </div>
            <div v-else class="empty mono">NO NIGHTS WITH A RECORDED BEDTIME YET.</div>
            <div v-if="regularity.columns.length" class="regax mono">
              <span
                v-for="c in regularity.columns"
                :key="c.date"
                :class="{ on: c.today }"
                @click="tapped = tapped === c.date ? null : c.date"
                >{{ c.letter }}</span
              >
            </div>
          </div>
          <!-- Times are not printed on every bar. Fourteen small numbers
               competing with the shape they sit on is what Zepp does; the shape
               is the finding, so a specific night's times live on the tap. -->
          <div v-if="tappedBar" class="usualline mono">
            {{ dayLabel(tappedBar.date) }} · {{ tappedBar.bedLabel }} →
            {{ tappedBar.wakeLabel }}
          </div>
          <div v-else-if="regularity.band" class="usualline mono">
            USUALLY {{ regularity.band.bedLabel }} → {{ regularity.band.wakeLabel }}
          </div>
          </HomeCard>

          <HomeCard
            title="HOW LONG"
            :color="famBody"
          >
          <!-- Stacked by stage because the composition is free here: the height is
               already the duration, and the hypnogram's own colours say what the
               night was made of at no extra cost in ink. They only say it if you
               know them, which is what the legend under the axis is for.

               The 8h goal line came off 2026-08-07. Duration is no longer scored
               against a single figure - full marks run from 7 to 9 hours and are
               additionally judged against your own median - so one rule across the
               chart was drawing a threshold the score does not use. -->
          <div>
            <div class="durplot" :class="{ lane: trip.active.value }">
              <TripLane :gaps="trip.gaps.value" :reach="trip.reach.value" />
              <svg
                v-if="duration.bars.length"
                class="chart"
                viewBox="0 0 294 110"
                preserveAspectRatio="none"
              >
                <g v-for="b in duration.bars" :key="b.date">
                  <rect
                    v-for="s in b.segments"
                    :key="s.stage"
                    :x="b.x"
                    :y="s.y"
                    :width="b.w"
                    :height="s.h"
                    :fill="`var(--stage-${s.stage})`"
                    :fill-opacity="b.last ? 1 : 0.72"
                  />
                </g>
              </svg>
              <div v-else class="empty mono">NO NIGHTS RECORDED YET.</div>
            </div>
            <!-- The first night drawn, not the window asked for: the series is
                 trimmed to where the nights start, so "14D AGO" named a night
                 that is not on the chart. -->
            <div class="axis mono">
              <span>{{ axisDate(durationEntries[0]?.date) }}</span
              ><span>LAST NIGHT</span>
            </div>
            <!-- Names for the colours the bars are stacked in. The same row the
                 expanded hypnogram uses, minus the durations: here it is a key to
                 a fortnight of nights, not a readout of one. -->
            <div class="stagekey mono">
              <span v-for="st in STAGE_ORDER" :key="st">
                <i :style="{ background: `var(--stage-${st})` }"></i>{{ STAGE_LABEL[st] }}
              </span>
            </div>
          </div>
          </HomeCard>

          <!-- The band's own average across each sleep window, which is not the
               resting heart rate BODY shows: that one is a property of the day.
               A history rather than one number, because a single night's figure
               says nothing without the nights either side of it. -->
          <HomeCard
            title="SLEEPING HEART RATE"
            :meta="lastSleepingHr != null ? `${lastSleepingHr} BPM` : ''"
            :color="famBody"
          >
          <div>
            <svg
              v-if="sleepingHr.bars.length"
              class="hrchart"
              viewBox="0 0 294 44"
              preserveAspectRatio="none"
            >
              <rect
                v-for="b in sleepingHr.bars"
                :key="b.i"
                :x="b.x"
                :y="b.y"
                :width="b.w"
                :height="b.h"
                rx="1.5"
                fill="var(--fam-body)"
                :fill-opacity="b.last ? 1 : 0.45"
              />
            </svg>
            <div v-else class="empty mono">NO SLEEPING HEART RATE RECORDED YET.</div>
            <!-- Both ends of the range are printed because the bars are scaled
                 to it rather than to zero, so their heights are relative and the
                 numbers are what make them readable. -->
            <div v-if="sleepingHr.lo != null" class="axis mono">
              <span>{{ sleepingHr.lo }}</span
              ><span>{{ durationEntries.length }} NIGHTS</span
              ><span>{{ sleepingHr.hi }}</span>
            </div>
          </div>
          </HomeCard>

          <!-- Collapsed, and last. Reference rather than news: read once, then in
               the way of everything above it that changes nightly. Same treatment
               as the Recovery page's HOW IT IS BUILT, because a score that asks to
               be trusted should be able to show where its numbers came from. -->
          <details class="panel built">
            <summary class="boxlabel mono">
              HOW IT IS BUILT
              <span class="chevdown" aria-hidden="true"></span>
            </summary>
            <dl class="builtfacts">
              <div>
                <dt class="mono">WEIGHTS</dt>
                <dd>
                  {{ weightLine }}. Regularity is deliberately the smallest of the first three: it
                  describes your week rather than this night, and it was supplying
                  most of the variation in a number that claims to be about one
                  night.
                </dd>
              </div>
              <div>
                <dt class="mono">DURATION</dt>
                <dd>
                  Two judgements, and the worse of the two is taken. First, hours
                  against the clinical range: full marks anywhere from 7 to 9 hours,
                  which is the adult recommendation from both the National Sleep
                  Foundation [1] and the AASM with the Sleep Research Society [2]. Second, hours against your
                  own recent median, so a night either side of your normal reads
                  worse than one sitting on it, even when both clear 7 hours. That
                  median is held inside 7 to 9 as well, so a habitually long sleeper
                  is never told 10 hours is their target. {{ habitualLine }}
                </dd>
              </div>
              <div>
                <dt class="mono">A LONG NIGHT</dt>
                <dd>
                  Docked, and the reasoning is specific to this strap rather than
                  general. The population evidence against long sleep is confounded,
                  and wrist wearables overestimate total sleep time by 30 to 60
                  minutes, so a general oversleep penalty would charge a night twice
                  for someone else's illness and a measurement artefact. It is here
                  because on this device a 9h+ figure usually turns out to be a real
                  waking followed by dozing. Continuity should be catching that
                  instead, and cannot yet: the band reports no awakenings at all on
                  most nights.
                </dd>
              </div>
              <div>
                <dt class="mono">CONTINUITY</dt>
                <dd>
                  Time awake after falling asleep, and how many times you surfaced
                  for more than three minutes. Both are National Sleep Foundation
                  continuity indicators [3]. The thresholds here
                  are deliberately stricter than the published ones, because those
                  come from sleep-lab polysomnography and this class of device
                  underreports waking by 12 to 48 minutes against it. Applied
                  unchanged they gave every night full marks.
                </dd>
              </div>
              <div>
                <dt class="mono">REGULARITY</dt>
                <dd>
                  A real Sleep Regularity Index: every minute of the night compared
                  with the same minute 24 hours earlier, not the spread of your
                  bedtimes. It is scored against the population distribution
                  in [4], where regularity predicted mortality more strongly than
                  duration did. {{ regularityLine }}
                </dd>
              </div>
              <div>
                <dt class="mono">COMPOSITION</dt>
                <dd>
                  Deep and REM as shares of the night, scored against reference
                  bands. Smallest weight of the four on purpose: the strap infers
                  stages from movement and heart rate rather than measuring brain
                  activity, and the shares move night to night for reasons nobody
                  can act on.
                </dd>
              </div>
              <div>
                <dt class="mono">NOT IN IT</dt>
                <dd>
                  Sleep efficiency, because the strap never reports time in bed: its
                  session starts at sleep onset, so efficiency computed from it is
                  pinned near 100% and is not the quantity the literature means. And
                  no HRV or resting heart rate, because Recovery already scores both
                  and double-counting would hit one bad night twice across two
                  screens that cannot explain each other.
                </dd>
              </div>
              <div>
                <dt class="mono">STILL ON PROBATION</dt>
                <dd>
                  {{ calibrationLine }} It is young and expected to move: enough
                  nights to catch a term that never varies, nowhere near enough to
                  trust its band boundaries.
                </dd>
              </div>
              <div>
                <dt class="mono">REFERENCES</dt>
                <dd class="refs">
                  <p>
                    [1] Hirshkowitz M et al. National Sleep Foundation's sleep time
                    duration recommendations: methodology and results summary.
                    <i>Sleep Health</i>, 2015.
                  </p>
                  <p>
                    [2] Watson NF et al. Recommended amount of sleep for a healthy
                    adult: a joint consensus statement of the American Academy of
                    Sleep Medicine and Sleep Research Society. <i>Sleep</i>, 2015.
                  </p>
                  <p>
                    [3] Ohayon M et al. National Sleep Foundation's sleep quality
                    recommendations: first report. <i>Sleep Health</i>, 2017.
                  </p>
                  <p>
                    [4] Windred DP et al. Sleep regularity is a stronger predictor
                    of mortality risk than sleep duration. <i>Sleep</i>, 2023.
                  </p>
                </dd>
              </div>
            </dl>
          </details>
        </template>
      </div>

      <!-- The hypnogram at full size. Not another page: it is the same chart
           with room to read, so it closes back to where it was rather than
           adding a step to come back from. Landscape, because a night is wide
           and the phone is not. -->
      <div v-if="zoomed" class="zoom">
        <!-- Turned a quarter turn rather than asking the phone to rotate. A
             night is wide and the phone is not, so portrait wasted most of the
             screen on empty space; rotating the surface gives the chart the
             long side. The device's own rotation lock would have made a real
             orientation change unreliable, and this needs no plugin. -->
        <div class="rotor">
          <div class="zoomhd mono">
            <span>{{ fmtHoursMins(hours) }} · {{ clockLine }}</span>
            <button class="expand mono" type="button" @click="zoomed = false">CLOSE</button>
          </div>
          <div class="zoombody">
          <svg class="zoomchart" viewBox="0 0 640 258" preserveAspectRatio="xMidYMid meet">
            <g v-for="s in ROW_LABEL_ORDER" :key="`z-${s}`">
              <line x1="52" :y1="zoomRowY(s)" x2="640" :y2="zoomRowY(s)" class="grid" />
              <text x="0" :y="zoomRowY(s) + 20" class="rowlabel">{{ STAGE_LABEL[s] }}</text>
            </g>
            <rect
              v-for="(seg, i) in zoomHypno.segments"
              :key="i"
              :x="52 + seg.x"
              :y="seg.y"
              :width="seg.w"
              :height="seg.h"
              rx="3"
              :fill="`var(--stage-${seg.stage})`"
            />
            <text
              v-for="(t, i) in zoomHypno.ticks"
              :key="`zt-${i}`"
              :x="52 + t.x"
              y="252"
              class="tick"
              text-anchor="middle"
            >
              {{ t.label }}
            </text>
          </svg>
            <div class="zoomlegend mono">
              <span v-for="st in STAGE_ORDER" :key="st">
                <i :style="{ background: `var(--stage-${st})` }"></i>{{ STAGE_LABEL[st] }}
                {{ fmtHoursMins(stageMinutes(stages, st) / 60) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { useBackClose } from "@/composables/useBackClose";
import { useCheckinStore } from "@/stores/checkin";
import { today, addDays, fmtHoursMins, fmtAxisDate as axisDate } from "@/utils/date";
import { trimLeadingBlanks } from "@/utils/historyChart";
import {
  computeSleepScore,
  sleepBreakdown,
  SLEEP_TERM_INFO,
  SLEEP_TERM_LABEL,
  SLEEP_WEIGHTS,
  habitualHours,
  HABITUAL_MIN_NIGHTS,
  costliestTermSentence,
  sleepScaleBands,
  awakeningCount,
} from "@/utils/sleepScore";
import { nightsFrom, SRI_WINDOW_DAYS } from "@/utils/sleepRegularity";
import { sleepResultFor } from "@/components/home/homeModel";
import { hypnogramGeometry } from "@/components/sleep/hypnogram";
import { regularityColumns } from "@/components/sleep/whenYouSlept";
import { stackedDurationBars } from "@/components/sleep/durationHistory";
import { rangeBars } from "@/components/sleep/nightlyBars";
import { useTripLane } from "@/composables/useTripLane";
import TripLane from "@/components/marks/TripLane.vue";
import {
  STAGE_ORDER,
  STAGE_LABEL,
  STAGE_ROW,
  stagePercentages,
  asleepMinutes,
  stageMinutes,
} from "@/utils/sleepStages";
import CompositionBar from "@/components/marks/CompositionBar.vue";
import PageHeader from "@/components/layout/PageHeader.vue";
import HomeCard from "@/components/home/HomeCard.vue";

// Every card on this page is one family, and sleep belongs to BODY. Passed
// explicitly because HomeCard defaults to the accent colour, which would put a
// cyan header over violet contents.
const famBody = "var(--fam-body)";

// One night, and the week it sits in. The page reads the store itself rather
// than being handed a night, because everything below the hero is history and a
// caller would otherwise have to assemble a fortnight to open a page.
const props = defineProps({
  date: { type: String, default: () => today() },
  /** Where the back control returns to. Named, because this page is reached
   *  from Home's dial and from BODY's row, and "BACK" tells you neither. */
  from: { type: String, default: "BACK" },
});
const emit = defineEmits(["close"]);
// Back closes the enlargement first and the page second. It used to do both at
// once, so zooming into the hypnogram and pressing back took you off the sleep
// page entirely, which is not what back on a full-screen chart means.
useBackClose(() => {
  if (zoomed.value) zoomed.value = false;
  else emit("close");
});

const checkin = useCheckinStore();

// The date being looked at, which the header can move. The prop is only the
// night it opens on.
const viewDate = ref(props.date);
watch(
  () => props.date,
  (d) => (viewDate.value = d)
);

/**
 * Stepping goes to the next night that was actually recorded, not to the next
 * calendar day. A gap is a night the band has nothing for, and walking through
 * empty pages one day at a time to get past a week away is not navigation. The
 * gaps stay visible where they belong, in the history charts.
 */
const recordedNights = computed(() =>
  checkin.entries
    .filter((e) => e.sleep != null)
    .map((e) => e.date)
    .sort()
);
const prevNight = computed(
  () => [...recordedNights.value].reverse().find((d) => d < viewDate.value) ?? null
);
const nextNight = computed(() => recordedNights.value.find((d) => d > viewDate.value) ?? null);

const entry = computed(() => checkin.entryFor(viewDate.value));
const hours = computed(() => entry.value?.sleep ?? null);
const stages = computed(() => entry.value?.sleepStages ?? null);

/** The regularity window: this night and the six before it. */
// The window itself now lives in sleepRegularity.js, since the score is shared.

const ROW_H = 44;
// Top to bottom: awake, REM, light, deep. Depth increases downward.
const ROW_LABEL_ORDER = ["awake", "rem", "light", "deep"];

const hasAnything = computed(() => hours.value != null || asleepMinutes(stages.value) > 0);
const timeline = computed(() => stages.value?.timeline ?? []);
const pct = computed(() => stagePercentages(stages.value));

const windowEntries = computed(() => {
  const from = addDays(viewDate.value, -(SRI_WINDOW_DAYS - 1));
  return checkin.entries.filter((e) => e.date >= from && e.date <= viewDate.value);
});
const nights = computed(() => nightsFrom(windowEntries.value));
// Through the shared builder, not computed here. The score depends on a window of
// nights and a habitual-hours median, and this page choosing its own meant one
// night scored differently depending on whether you looked at it here or on
// Home's dial.
const result = computed(
  () =>
    sleepResultFor({
      entries: checkin.entries,
      entry: checkin.entryFor(viewDate.value),
      todayKey: viewDate.value,
    }) ?? computeSleepScore({})
);
const terms = computed(() => sleepBreakdown(result.value));

/* ── HOW IT IS BUILT, read from the score rather than typed out ─────────────
   Every figure in that panel comes from the constants and from this user's
   actual history, so it describes the score as it is now rather than as it was
   the day the prose was written. It had "calibrated against 16 nights" baked in,
   which was true for one day.

   **If you change a term, a weight or a threshold, the panel follows only for
   the values below. Anything still written as prose in the template has to be
   changed in the same edit.** */

/** The weights, in the order they carry the score. */
const weightLine = computed(() =>
  Object.entries(SLEEP_WEIGHTS)
    .sort(([, a], [, b]) => b - a)
    .map(([key, w]) => `${SLEEP_TERM_LABEL[key].toLowerCase()} ${Math.round(w * 100)}%`)
    .join(", ")
    .replace(/^./, (c) => c.toUpperCase())
);

/** What your own median is right now, and how much of it is being trusted. */
const habitualLine = computed(() => {
  const upto = checkin.entries
    .filter((e) => e.date <= viewDate.value)
    .sort((a, b) => a.date.localeCompare(b.date));
  const hab = habitualHours(upto.map((e) => e.sleep));
  if (!hab) {
    const have = upto.filter((e) => typeof e.sleep === "number").length;
    return `Yours needs ${HABITUAL_MIN_NIGHTS} nights and has ${have}, so only the clinical range is being used so far.`;
  }
  const pct = Math.round(hab.confidence * 100);
  return `Yours currently sits at ${fmtHoursMins(hab.hours)} over ${hab.nights} nights, carrying ${pct}% of its full weight.`;
});

const regularityLine = computed(() => {
  const nightsWithBedtime = result.value.nights ?? 0;
  return result.value.terms?.regularity == null
    ? `It needs ${result.value.needed} nights with a recorded bedtime and has ${nightsWithBedtime}, so its weight is shared across the other terms for now.`
    : `Measured here over ${nightsWithBedtime} nights with a recorded bedtime, from a window of ${SRI_WINDOW_DAYS} days.`;
});

const calibrationLine = computed(() => {
  const scored = checkin.entries.filter((e) => e.sleepStages && e.sleep).length;
  return `Calibrated on ${SCORE_CALIBRATED_ON}; you now have ${scored} scored nights.`;
});

/**
 * What the score was last tuned against, by hand.
 *
 * The only figure in the panel that cannot be derived, because it is a fact about
 * a decision rather than about the data. **Update it whenever a weight, a
 * threshold or a term changes.**
 */
const SCORE_CALIBRATED_ON = "16 nights, 7 August 2026";

/** One term open at a time, matching the Recovery page's terms card. */
const openTerm = ref(null);
function toggleTerm(key) {
  openTerm.value = openTerm.value === key ? null : key;
}
// Stepping to another night would otherwise leave one night's explanation open
// under another night's numbers.
watch(viewDate, () => (openTerm.value = null));

function termInfo(key) {
  const entry = SLEEP_TERM_INFO[key];
  if (!entry) return null;
  return {
    paragraphs: (entry.info ?? "").split("\n\n").filter(Boolean),
    detail: entry.detail?.items?.length ? entry.detail : null,
  };
}
const costliest = computed(() => costliestTermSentence(result.value));

const scaleBands = computed(() => sleepScaleBands(result.value.label));

const hypno = computed(() =>
  hypnogramGeometry(timeline.value, stages.value?.bedTime ?? null, {
    width: 294,
    rowHeight: ROW_H,
  })
);
const awakenings = computed(() => awakeningCount(timeline.value));

// The same chart, laid out for the bigger box. Recomputing rather than scaling
// the small one up: at this width the ticks no longer need thinning, so the
// expanded view can carry every hour where the inline one cannot.
const zoomed = ref(false);
// Four rows plus a strip for the hour labels, in a box shaped like the rotated
// surface it sits on. Rows any taller and the chart letterboxes inside the very
// landscape it was rotated to fill.
const ZOOM_ROW_H = 56;
const zoomHypno = computed(() =>
  hypnogramGeometry(timeline.value, stages.value?.bedTime ?? null, {
    width: 588,
    rowHeight: ZOOM_ROW_H,
  })
);
function zoomRowY(stage) {
  return STAGE_ROW[stage] * ZOOM_ROW_H;
}

const tapped = ref(null);
const regularity = computed(() =>
  regularityColumns(nights.value, { width: 294, height: 132, todayKey: viewDate.value })
);

/** A fortnight is a pattern; a month of nightly bars is a smear. */
const DURATION_DAYS = 14;
const durationEntries = computed(() => {
  const byDate = new Map(checkin.entries.map((e) => [e.date, e]));
  const from = addDays(viewDate.value, -(DURATION_DAYS - 1));
  // Every date in the window, present or not. A missing night has to keep its
  // slot or every later night slides a day earlier.
  const all = Array.from({ length: DURATION_DAYS }, (_, i) => {
    const date = addDays(from, i);
    return byDate.get(date) ?? { date };
  });
  // Leading blanks only, the app-wide rule. Trimmed here rather than in each
  // chart because HOW LONG, SLEEPING HEART RATE and the trip lane are all built
  // off this one list, and trimming three times is three chances to disagree
  // about which slot is which night.
  return trimLeadingBlanks(all, (e) => e.sleep != null || e.sleepStages != null);
});
// No goal passed, so no goal line is computed. Duration stopped being scored
// against one figure on 2026-08-07: full marks run from 7 to 9 hours and are
// additionally judged against your own median, so a single rule drawn across the
// chart was a threshold the score does not use.
const duration = computed(() =>
  stackedDurationBars(durationEntries.value, null, { width: 294 })
);

// A night with no stored duration is a night the band has nothing for, which is
// the absence a trip explains. Same window the bars are drawn from, so the two
// cannot disagree about which slot is which.
const trip = useTripLane(
  computed(() => durationEntries.value.map((e) => ({ date: e.date, value: e.sleep })))
);

/** The band's own average across each night's sleep window, oldest first. */
const sleepingHrSeries = computed(() =>
  durationEntries.value.map((e) => e.sleepStages?.avgHr ?? null)
);
const sleepingHr = computed(() => rangeBars(sleepingHrSeries.value, { width: 294, height: 44 }));
const lastSleepingHr = computed(
  () => [...sleepingHrSeries.value].reverse().find((v) => v != null) ?? null
);
const tappedBar = computed(
  () => regularity.value.columns.find((c) => c.date === tapped.value) ?? null
);
const awakeningsText = computed(() =>
  awakenings.value === 1 ? "UP ONCE" : `UP ${awakenings.value} TIMES`
);

/**
 * The header says TODAY for the current date, the way Recovery and Stress
 * already do. Only the header: a column in a chart of fourteen nights wants a
 * date, so the tapped-bar line below keeps the plain label.
 */
const headerLabel = computed(() =>
  viewDate.value === today() ? "TODAY" : dayLabel(viewDate.value)
);

/** "WED 29 JUL", the same wording MetricPage's day list uses. */
function dayLabel(dateKey) {
  return new Date(`${dateKey}T00:00:00`)
    .toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })
    .replace(",", "")
    .toUpperCase();
}

function clockOf(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "23:09 → 08:01", or nothing at all for a night with no stored bedtime. */
const clockLine = computed(() => {
  const bed = stages.value?.bedTime;
  const wake = stages.value?.wakeTime;
  if (bed == null || wake == null) return "";
  return `${clockOf(bed)} → ${clockOf(wake)}`;
});
function rowY(stage) {
  return STAGE_ROW[stage] * ROW_H;
}

function barWidth(stage) {
  return `${Math.max(3, (pct.value[stage] ?? 0) * 1.5)}px`;
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
     the inset scrolls away with the content and the header rides up under the
     status icons. */
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
  /* .page already clips (overflow: hidden), so the overscan alone hides the
     Android overlay scroll bar. See --sb-overscan in style.css. */
  margin-right: calc(-1 * var(--sb-overscan));
  padding-right: var(--sb-overscan);
}


.empty {
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--dim);
}

.hero {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.herometa {
  flex: 1;
  min-width: 0;
}
.bandlabel {
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--fam-body);
}
.verdict {
  margin: 7px 0 0;
  font-size: var(--fs-prose);
  line-height: 1.5;
  color: var(--body);
}
.facts {
  display: flex;
  align-items: baseline;
  gap: 9px;
  flex-wrap: wrap;
  margin-top: 16px;
  font-size: var(--fs-second);
  letter-spacing: 1px;
  color: var(--dim);
}
.facts b {
  font-size: 19px;
  font-weight: 600;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.sep {
  opacity: 0.5;
}

.scale {
  margin-top: 18px;
}
.scaletrack {
  position: relative;
  height: 8px;
  border-radius: 5px;
  overflow: hidden;
  background: var(--bg2);
}
.seg {
  position: absolute;
  top: 0;
  bottom: 0;
  display: block;
  /* The band you are in is the only one at full strength, so the strip reads as
     "you are here" rather than as four colours. Matches RecoveryPage exactly. */
  opacity: 0.3;
}
.seg.on {
  opacity: 1;
}
.pin {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 3px;
  border-radius: 2px;
  background: var(--ink);
  /* Ringed in the page colour, or it disappears: a near-white pin on the pale
     green at the top of the scale is invisible, and a high score is exactly
     where this page expects to land. */
  box-shadow: 0 0 0 1.5px var(--bg1);
}
.scalelabels {
  display: flex;
  margin-top: 7px;
  font-size: 10px;
  letter-spacing: 1.2px;
}
.scalelabels span {
  white-space: nowrap;
  /* GOOD and GREAT own 15% of the track each, which is where the top band's word
     had to come down from EXCELLENT to fit. Clipping is the right failure if a
     longer name is ever added, same as RecoveryPage. */
  overflow: hidden;
}

/* Four terms, each three lines deep. The gap between them has to be clearly
   bigger than the gaps inside them or the twelve lines read as one block,
   which is what made this card the busiest thing on the page. */
.terms {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-bottom: 4px;
}
.tline {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
/* A real button, not a div with a handler: the row is the control, and a div is
   unreachable by keyboard and announces nothing. Styled back to the line it
   replaced. */
.tsummary {
  width: 100%;
  padding: 0;
  background: none;
  border: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.tsummary:active .treading {
  opacity: 0.65;
}
.chevdown {
  flex: none;
  width: 8px;
  height: 8px;
  align-self: center;
  border-right: 1.5px solid var(--dim);
  border-bottom: 1.5px solid var(--dim);
  transform: rotate(45deg) translate(-2px, -2px);
  transition: transform 0.15s ease;
}
.chevdown.open {
  transform: rotate(-135deg) translate(-2px, -2px);
}
.expanded {
  margin-top: 15px;
  display: flex;
  flex-direction: column;
  gap: 13px;
}
.einfo {
  margin: 0;
  font-size: var(--fs-second);
  line-height: 1.6;
  color: var(--body);
}
.edetail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.edetail-hd {
  font-size: 9.5px;
  letter-spacing: 1.4px;
  color: var(--dim);
}
/* Grid, so a wrapped line starts under the first word rather than the marker. */
.eitem {
  display: grid;
  grid-template-columns: 10px 1fr;
  gap: 6px;
  font-size: var(--fs-second);
  line-height: 1.55;
  color: var(--body);
}
.edot {
  color: var(--dim);
}
.sub {
  margin-top: 5px;
}
/* The reference can run long (regularity's carries the population median), so
   it wraps rather than squeezing the points, which must stay on one line. */
.tref {
  min-width: 0;
}
.tpts {
  flex: none;
  white-space: nowrap;
}
.tname {
  font-size: var(--fs-label);
  letter-spacing: 1.2px;
  color: var(--ink);
}
.treading {
  font-size: var(--fs-value);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.tref,
.tpts {
  font-size: 11.5px;
  letter-spacing: 1px;
  color: var(--dim);
}
.tbar {
  display: block;
  height: 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--fam-body) 15%, transparent);
  margin-top: 10px;
  overflow: hidden;
}
.tbar i {
  display: block;
  height: 100%;
  background: var(--fam-body);
  border-radius: 4px;
}
.tnote {
  margin-top: 6px;
  font-size: 10.5px;
  letter-spacing: 1px;
  color: var(--dim);
}
.withheld {
  font-size: 11px;
  line-height: 1.7;
  color: var(--dim);
  margin: 14px 0 0;
}
.num {
  font-size: 52px;
  font-weight: 700;
  line-height: 0.9;
  color: var(--fam-body);
  font-variant-numeric: tabular-nums;
}
.dur {
  font-size: 22px;
  font-weight: 600;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.chartbox {
  border: 1px solid var(--panel-line);
  border-radius: 9px;
  padding: 12px 12px 10px;
}
.boxlabel {
  font-size: 11px;
  letter-spacing: 1.8px;
  color: var(--dim);
  margin-bottom: 10px;
}
/* A section header rather than a label inside a box, so it needs air above it:
   without the gap the terms ran straight out of the hero and the whole top of
   the page read as one block. */
.sect {
  margin-top: 26px;
  margin-bottom: 12px;
}
.hypno {
  display: block;
  width: 100%;
  /* Four 44px rows plus the axis strip the tick labels sit in. */
  height: 194px;
}
.tick {
  font-size: 9.5px;
  letter-spacing: 0.5px;
  fill: var(--dim);
  font-family: var(--font-mono);
}
/* A label, a rule, and the one number the section is about. The rule is what
   stops the value reading as part of the label. */
.sechd {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 26px 0 10px;
  font-size: 11px;
  letter-spacing: 1.8px;
  color: var(--dim);
}
.sechd i {
  flex: 1;
  height: 1px;
  background: var(--panel-line);
}
.secval {
  color: var(--fam-body);
}
/* Marks where last night stops and the multi-night charts start. */
/* Geometry is the shared .grouphd in style.css; only the family colour is the
   page's own. */
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
.hypnobox {
  position: relative;
}
/* On the card's own header line rather than over the chart: overlaying it
   covered the AWAKE row, which is mostly empty and so the row whose few
   segments matter most. */
.nightcard {
  position: relative;
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
.midnightline {
  stroke-opacity: 0.42;
}
.regy .midnight {
  color: var(--body);
}
.hrchart {
  display: block;
  width: 100%;
  height: 44px;
}

/* The expanded hypnogram: the whole screen, opaque, and closable back to where
   it was. Not another page - it is the same chart with room to read, so adding
   a step to come back from would be a second BACK for the same subject.
   --panel is a near-transparent wash meant to sit ON the page background, so an
   overlay built from it lets the page show straight through. --bg1 is what the
   page itself is painted with, and is the only token here that is opaque. */
.zoom {
  position: fixed;
  inset: 0;
  z-index: 700;
  background: var(--bg1);
  overflow: hidden;
}
/* The landscape surface: as wide as the screen is tall, turned a quarter turn
   about its own centre. Everything inside then lays out in landscape without
   knowing anything about it. */
.rotor {
  position: absolute;
  top: 50%;
  left: 50%;
  /* Short of the full screen on purpose: edge to edge the chart ran under the
     status icons and read as a page that had overflowed rather than one that
     had been laid out. */
  width: calc(100vh - 24px);
  height: calc(100vw - 24px);
  transform: translate(-50%, -50%) rotate(90deg);
  display: flex;
  flex-direction: column;
  /* The insets belong to the portrait frame, and the rotation moves them: a
     quarter turn clockwise sends this box's LEFT edge to the top of the screen,
     so that is the edge the status icons sit on, and its right edge carries the
     navigation bar. Padding them the obvious way round put the chart straight
     under the clock. */
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
  gap: 12px;
  margin-top: 12px;
}
/* Fills the rotated surface rather than keeping its aspect ratio: the point of
   expanding is minutes per pixel, and letterboxing to preserve a shape would
   give most of the gain back. */
.zoomchart {
  display: block;
  width: 100%;
  flex: 1;
  min-height: 0;
}
/* Shares the zoom legend's rules: same object, two places, so a stage colour
   cannot be named one way here and another there. */
.stagekey,
.zoomlegend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  font-size: 10.5px;
  letter-spacing: 1px;
  color: var(--dim);
}
.stagekey {
  margin-top: 8px;
}
.stagekey span,
.zoomlegend span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.stagekey i,
.zoomlegend i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.chart {
  display: block;
  width: 100%;
  height: 110px;
}
/* Positioning context for the trip lane, and room for its rule when a trip
   falls in the fortnight. */
.durplot {
  position: relative;
}
.durplot.lane {
  padding-bottom: 13px;
}
.target {
  stroke: var(--ink);
  stroke-opacity: 0.45;
  stroke-dasharray: 3 3;
  stroke-width: 1;
  /* Or the dashes stretch with the chart's non-uniform scaling and read as a
     solid rule at one end and nothing at the other. */
  vector-effect: non-scaling-stroke;
}
.regwrap {
  display: flex;
  gap: 8px;
}
/* The clock, down the left. Without it the bars float against nothing. */
.regy {
  position: relative;
  width: 36px;
  flex: none;
  font-size: 8.5px;
  letter-spacing: 0.4px;
  color: var(--dim);
}
.regy span {
  position: absolute;
  right: 0;
  transform: translateY(-50%);
}
.reg {
  display: block;
  flex: 1;
  min-width: 0;
  height: 132px;
}
.usual {
  fill: var(--fam-body);
  fill-opacity: 0.1;
  stroke: var(--fam-body);
  stroke-opacity: 0.4;
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
/* One letter per column, under the bar it belongs to. */
.regax {
  display: flex;
  margin: 6px 0 0 44px;
  font-size: 9.5px;
  letter-spacing: 1px;
  color: var(--dim);
}
.regax span {
  flex: 1;
  text-align: center;
  min-height: 22px;
}
.regax .on {
  color: var(--fam-body);
}
.usualline {
  font-size: 11px;
  letter-spacing: 1.4px;
  color: var(--dim);
  margin-top: 9px;
}
.axisnote {
  font-size: 10.5px;
  line-height: 1.6;
  letter-spacing: 0.8px;
  color: var(--dim);
  margin-top: 6px;
}
.grid {
  stroke: var(--dim);
  stroke-opacity: 0.16;
  stroke-width: 0.8;
}
.rowlabel {
  font-size: 11px;
  letter-spacing: 1px;
  fill: var(--dim);
  font-family: var(--font-mono);
}
.axis {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--dim);
  margin-top: 8px;
}

.legend {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lrow {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: var(--row-h);
}
.lrow i {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  flex-shrink: 0;
}
.lname {
  width: 74px;
  font-size: var(--fs-label);
  letter-spacing: 1.2px;
  color: var(--dim);
}
.lbar {
  height: 7px;
  border-radius: 4px;
  flex-shrink: 0;
}
.lval {
  margin-left: auto;
  font-size: var(--fs-value);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.lpct {
  color: var(--dim);
  font-size: var(--fs-second);
  margin-left: 3px;
}

.caveat {
  margin-top: 18px;
  border: 1px solid var(--panel-line);
  border-radius: 8px;
  padding: 11px 12px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--dim);
}
.caveat b {
  color: var(--body);
}

/* ── HOW IT IS BUILT ─────────────────────────────────────────────────────
   Same rules as the Recovery page's panel of the same name, so the two read
   as one object in two places rather than two designs. */
.built {
  margin-top: 26px;
}
.built summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0;
  padding: 12px 0;
  cursor: pointer;
  list-style: none;
}
.built summary::-webkit-details-marker {
  display: none;
}
.built summary:focus-visible {
  outline: 2px solid var(--acc);
  outline-offset: 3px;
}
.built[open] .chevdown {
  transform: rotate(-135deg) translate(-2px, -2px);
}
/* NOT `.facts`: this page already uses that class for the one-line night facts
   under the hero, and a `flex-direction: column` rule would have quietly broken
   it. Different job, different name. */
.builtfacts {
  margin: 0;
  padding-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.builtfacts dt {
  font-size: 11px;
  letter-spacing: 1.6px;
  color: var(--dim);
  margin-bottom: 4px;
}
.builtfacts dd {
  margin: 0;
  font-size: var(--fs-prose);
  line-height: 1.5;
  color: var(--body);
}

/* Citations, not prose: smaller, tighter, and each one its own block so a long
   title wraps without running into the next. No links, because a fabricated DOI
   is worse than none and these are findable from the citation alone. */
.refs p {
  margin: 0 0 7px;
  font-size: var(--fs-second);
  line-height: 1.45;
  color: var(--dim);
}
.refs p:last-child {
  margin-bottom: 0;
}
.refs i {
  font-style: italic;
}
</style>
