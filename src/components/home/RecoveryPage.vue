<template>
  <!-- Why today scored what it scored. The TODAY card asserts a verdict in one
       sentence; this is the working behind it, so a surprising number can be
       checked rather than just disbelieved. Same page pattern as SleepPage. -->
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
          <div class="num">{{ result.state === "ready" ? result.score : "--" }}</div>
          <div class="scoremeta">
            <div class="band mono">{{ bandLabel }}</div>
            <p class="verdict">{{ explanation }}</p>
            <p v-if="meaning" class="meaning">{{ meaning }}</p>
          </div>
        </div>

        <!-- No score yet, so the readings that DO exist stand in for it. The
             page is otherwise a hero reading `--` above a scale that is hidden
             and terms that cannot be itemised, which says nothing about a night
             the strap measured perfectly well. -->
        <NotYet
          v-if="result.state !== 'ready'"
          class="notready"
          :readings="calibratingReadings"
          :have="result.nights ?? 0"
          :need="result.needed ?? 7"
          unit="NIGHTS"
          explain="A score is how far today sits from your own recent normal, so it needs a run of nights to compare against. Until then these are the readings themselves."
        />

        <!-- The whole scale, with today on it. A score is a position between
             thresholds, and without them 58 is a number you cannot act on: it
             does not say that 70 is the next thing worth aiming at. -->
        <div v-if="result.state === 'ready'" class="scale">
          <div class="scaletrack">
            <span
              v-for="b in scaleBands"
              :key="b.label"
              class="seg"
              :style="{ left: `${b.start}%`, width: `${b.width}%`, background: b.color }"
              :class="{ on: b.current }"
            ></span>
            <span class="pin" :style="{ left: `${result.score}%` }"></span>
          </div>
          <!-- Names, not thresholds. These were names once before and collided,
               because each was CENTRED on the boundary it marked and GOOD at 70
               sits 15% of the width from GREAT at 85. Laid out as a flex row
               instead, each label owns its own band's width and starts at its
               left edge, so nothing can run into its neighbour however narrow
               the phone. The numbers move to HOW IT IS BUILT, which states all
               four; what the strip is for is "where am I and what is next", and
               a name answers that where a threshold does not. -->
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

        <!-- Promoted out of the grey run-on under the verdict, where the one
             actionable sentence on the page was the third thing in a stack of
             asides and read as a footnote. -->
        <HomeCard
          v-if="headroomParas.length"
          :title="improveLabel"
          :color="famRecovery"
          :ink-color="famRecoveryInk"
        >
          <!-- The gap, then a paragraph per term in order of how much of the
               score it carries. Every term with points missing gets one, whether
               or not it could reach the band alone: resting heart rate usually
               cannot, and the old version withheld it entirely, so the page only
               ever discussed HRV while the points had come off both. -->
          <p v-for="(para, i) in headroomParas" :key="i" :class="i === 0 ? 'verdict lead' : 'meaning'">
            {{ para }}
          </p>
          <!-- Rare, and last: a baseline that has moved explains a run of days
               rather than this one. -->
          <p v-if="baselineLine" class="meaning">{{ baselineLine }}</p>
        </HomeCard>

        <template v-if="rows.length">
          <HomeCard
            title="WHAT WENT INTO IT"
            :meta="result.state === 'ready' ? `${result.score} / 100` : ''"
            :color="famRecovery"
            :ink-color="famRecoveryInk"
          >
            <div class="terms">
            <div v-for="r in rows" :key="r.key" class="term">
              <!-- The whole row is the summary (option E, mocked up 2026-08-07).
                   The glyph is the DOWN caret MetricPage collapses its own
                   sections with, not the › that means "goes to a page": this
                   expands in place, and a detail page never opens another detail
                   page. A `+` and a WHAT THIS IS line were both drawn; the caret
                   costs no extra line and repeats no words. -->
              <button
                class="tline tsummary"
                type="button"
                :aria-expanded="openTerm === r.key"
                @click="toggleTerm(r.key)"
              >
                <span class="tname mono">{{ r.label }}</span>
                <span class="treading">{{ readingText(r) }}</span>
                <span
                  class="chevdown"
                  :class="{ open: openTerm === r.key }"
                  aria-hidden="true"
                ></span>
              </button>
              <div class="tline sub">
                <span class="tref mono">{{ referenceText(r) }}</span>
                <span class="tpts mono">{{ r.points }} / {{ r.maxPoints }} PTS</span>
              </div>
              <!-- Filled against what the term could have contributed, not
                   against 100: a 25-point term at full strength has to look
                   full, not like a quarter of the score. -->
              <div class="tbar">
                <span
                  :style="{
                    width: `${r.maxPoints ? (r.points / r.maxPoints) * 100 : 0}%`,
                    background: barColor,
                  }"
                ></span>
              </div>
              <!-- Only on a term whose reading is genuinely outside its range.
                   See recoveryContext.js: a line on every term every day reads
                   as an accusation on a day when nothing was wrong. -->
              <div v-if="context[r.key]" class="ctxline">
                <i :style="{ background: famRecovery }"></i>
                <span class="mono" :style="{ color: famRecoveryInk }">{{ context[r.key] }}</span>
              </div>
              <div v-if="r.redistributed" class="tnote mono">
                WEIGHTED UP FROM {{ r.nominalWeight }}% · A TERM IS MISSING TODAY
              </div>

              <!-- What opens: the mark, then the description, then what this
                   term specifically would have to read. The text is the same
                   `info` string the metric page shows under WHAT THIS IS, read
                   from metricRegistry rather than written again here, so the two
                   screens cannot drift apart. -->
              <div v-if="openTerm === r.key" class="expanded">
                <RangeMark
                  v-if="termRange(r.key)"
                  :value="termRange(r.key).value"
                  :low="termRange(r.key).low"
                  :high="termRange(r.key).high"
                  :baseline="termRange(r.key).baseline"
                  :series="termRange(r.key).series"
                  :low-label="termRange(r.key).lowLabel"
                  :high-label="termRange(r.key).highLabel"
                  :color="famRecovery"
                />
                <p v-for="(para, i) in termInfo(r.key)" :key="i" class="einfo">{{ para }}</p>
                <!-- The causes are a list, so they are drawn as one. Written into
                     a sentence ("what moves it, largest first: A, then B, since
                     C") they read as an essay of subordinate clauses, which is
                     the code-comment voice leaking into copy someone reads on a
                     phone. -->
                <div v-if="termDetail(r.key)" class="edetail">
                  <div class="edetail-hd mono">{{ termDetail(r.key).label }}</div>
                  <div v-for="(item, i) in termDetail(r.key).items" :key="i" class="eitem">
                    <span class="edot" aria-hidden="true">·</span><span>{{ item }}</span>
                  </div>
                </div>
                <div v-if="termGoal(r.key)" class="etarget mono" :style="{ color: famRecoveryInk }">
                  {{ termGoal(r.key) }}
                </div>
              </div>
              </div>
            </div>
          </HomeCard>
        </template>

        <!-- Recovery is measured overnight, so what bears on it happened the day
             before. Purely descriptive: sessions as a line between two dots,
             bedtime as a dot, and nothing claiming to have caused anything. The
             judgement, where there is any, lives on the term it applies to.

             The week underneath is dimmer and unlabelled so it reads as
             background. It is there because a single day cannot show a pattern,
             and the pattern is the useful part. -->
        <HomeCard
          v-if="yesterday"
          :title="yesterdayTitle"
          :meta="contextDayLabel"
          :color="famRecovery"
          :ink-color="famRecoveryInk"
        >
          <svg class="marks" viewBox="0 0 300 58" preserveAspectRatio="none" role="img" :aria-label="yesterdayAria">
            <line x1="6" y1="30" x2="294" y2="30" stroke="var(--dim)" stroke-opacity="0.18" />
            <g v-for="(s, i) in yesterday.spans" :key="i">
              <line
                :x1="px(s.from)" y1="30" :x2="px(s.to)" y2="30"
                :stroke="famRecovery" stroke-width="2"
              />
              <circle :cx="px(s.from)" cy="30" r="4" :fill="famRecovery" />
              <circle :cx="px(s.to)" cy="30" r="4" :fill="famRecovery" />
              <!-- Two ends that cannot fit side by side become one label between
                   them, so a short session still says both its times. -->
              <text v-if="s.showMergedText" :x="px(s.mergedAt)" y="46" :text-anchor="anchorAt(px(s.mergedAt), s.mergedText)" class="mk">{{ s.mergedText }}</text>
              <text v-if="s.showStartText" :x="px(s.from)" y="46" :text-anchor="anchorAt(px(s.from), s.startText)" class="mk">{{ s.startText }}</text>
              <text v-if="s.showEndText" :x="px(s.to)" y="46" :text-anchor="anchorAt(px(s.to), s.endText)" class="mk">{{ s.endText }}</text>
            </g>
            <!-- The two ends of the waking day. Labelled rather than left as
                 bare dots: wake belongs to the night before this row and bed to
                 the night after, so unlabelled they would read as one sleep. -->
            <template v-if="yesterday.wake != null">
              <circle :cx="px(yesterday.wake)" cy="30" r="4.4" fill="var(--ink)" />
              <text :x="px(yesterday.wake)" y="17" :text-anchor="anchorAt(px(yesterday.wake), 'WOKE')" class="mk lit">WOKE</text>
              <text v-if="yesterday.showWakeText" :x="px(yesterday.wake)" y="46" :text-anchor="anchorAt(px(yesterday.wake), yesterday.wakeText)" class="mk">{{ yesterday.wakeText }}</text>
            </template>
            <template v-if="yesterday.bed != null">
              <circle :cx="px(yesterday.bed)" cy="30" r="4.4" fill="var(--ink)" />
              <text :x="px(yesterday.bed)" y="17" :text-anchor="anchorAt(px(yesterday.bed), 'BED')" class="mk lit">BED</text>
              <text v-if="yesterday.showBedText" :x="px(yesterday.bed)" y="46" :text-anchor="anchorAt(px(yesterday.bed), yesterday.bedText)" class="mk">{{ yesterday.bedText }}</text>
            </template>
            <text v-if="yesterday.showTrainingLabel" :x="px(yesterday.spans[0].from)" y="17" class="mk" :fill="famRecovery">
              TRAINING
            </text>
          </svg>

          <template v-if="week.length">
            <div class="ctxhd mono" :style="{ color: famRecoveryInk }">LAST WEEK</div>
            <svg class="marks" :viewBox="`0 0 300 ${week.length * 24 + 14}`" role="img" aria-label="The days before it, with sessions and bedtimes">
              <g v-for="(row, i) in week" :key="row.date">
                <text x="0" :y="i * 24 + 17" class="mk">{{ row.label }}</text>
                <line x1="36" :y1="i * 24 + 14" x2="294" :y2="i * 24 + 14" stroke="var(--dim)" stroke-opacity="0.12" />
                <g v-for="(s, j) in row.spans" :key="j">
                  <line
                    :x1="wx(s.from)" :y1="i * 24 + 14" :x2="wx(s.to)" :y2="i * 24 + 14"
                    :stroke="famRecovery" stroke-opacity="0.55" stroke-width="1.6"
                  />
                  <circle :cx="wx(s.from)" :cy="i * 24 + 14" r="2.6" :fill="famRecovery" fill-opacity="0.55" />
                  <circle :cx="wx(s.to)" :cy="i * 24 + 14" r="2.6" :fill="famRecovery" fill-opacity="0.55" />
                </g>
                <!-- Both ends of each day, same as the row above. Unlabelled
                     here on purpose: five pairs of WOKE/BED would be more type
                     than marks, and the row above names what a dot at each end
                     means. -->
                <circle
                  v-if="row.wake != null"
                  :cx="wx(row.wake)" :cy="i * 24 + 14" r="3.2"
                  fill="var(--dim)" fill-opacity="0.85"
                />
                <circle
                  v-if="row.bed != null"
                  :cx="wx(row.bed)" :cy="i * 24 + 14" r="3.2"
                  fill="var(--dim)" fill-opacity="0.85"
                />
              </g>
              <text
                v-for="t in AXIS_TICKS"
                :key="t.hour"
                :x="wx(t.at)"
                :y="week.length * 24 + 10"
                :text-anchor="t.anchor"
                class="mk tick"
              >
                {{ t.label }}
              </text>
            </svg>
          </template>
        </HomeCard>

        <div class="grouphd mono" :style="{ color: famRecoveryInk }">HISTORY</div>

        <!-- One bar per day, coloured by its band. The question a month of
             Recovery answers is how many good days there have been, and a run
             of colour answers it without reading a number off an axis.

             Tapping a bar moves the page to that day rather than opening
             anything: the date stepper in the header already goes there, and
             this is the same control by a faster route. -->
        <HomeCard
          title="RECOVERY OVER TIME"
          :meta="history.average != null ? `${history.average} AVG · ${history.days} DAYS` : ''"
          :color="famRecovery"
          :ink-color="famRecoveryInk"
        >
          <div v-if="history.scored" class="histwrap">
            <!-- The plot gets its own box so the trip lane can anchor to the
                 bottom of the chart rather than to the bottom of the axis row
                 underneath it. -->
            <div class="histplot" :class="{ lane: trip.active.value }">
              <TripLane :gaps="trip.gaps.value" :reach="trip.reach.value" />
              <svg
                class="histchart"
                viewBox="0 0 100 46"
                preserveAspectRatio="none"
                role="img"
                :aria-label="historyAria"
              >
                <rect
                  v-for="b in history.bars"
                  :key="b.date"
                  :x="b.x"
                  :y="b.y"
                  :width="b.width"
                  :height="b.height"
                  :fill="b.color"
                  :fill-opacity="b.date === viewDate ? 1 : 0.62"
                />
              </svg>
              <!-- Over the chart rather than in it: an SVG scaled with
                   preserveAspectRatio="none" stretches its own hit areas, so the
                   targets are plain divs at real width. -->
              <div class="hithit">
                <button
                  v-for="b in history.bars"
                  :key="b.date"
                  type="button"
                  class="hit"
                  :disabled="b.empty"
                  :aria-label="`${b.date}${b.score == null ? ', not scored' : `, ${b.score}, ${b.label}`}`"
                  @click="viewDate = b.date"
                ></button>
              </div>
            </div>
            <!-- The first bar's own date, not "30 DAYS AGO". The chart is
                 trimmed to where the scores start, so a fixed label named a day
                 that is no longer on it. -->
            <div class="histaxis mono">
              <span>{{ axisDate(history.from) }}</span>
              <span>{{ history.to === todayKey ? "TODAY" : axisDate(history.to) }}</span>
            </div>
          </div>
          <NotYet
            v-else
            :have="result.nights ?? 0"
            :need="result.needed ?? 7"
            unit="NIGHTS"
            explain="Each bar is scored against the nights before it, so the chart starts once there are enough of them behind the first day."
          />
        </HomeCard>

        <!-- Then a card per term, in the order the terms carry weight, which is
             the order WHAT WENT INTO IT lists them in: HRV, resting heart rate,
             sleep. Every one of them names its metric first, because four violet
             cards in a row under a gold one is exactly where "WHERE YOU USUALLY
             SIT" stopped saying what it was about.

             The two pictures of HRV answer different questions and neither does
             the other's job: the line says where you are and which way you are
             going, the distribution says whether this level is unusual for you.

             Both draw while the term itself is still CALIBRATING. That is
             deliberate. `levelFrom` withholds a figure until 30 nights because a
             term is a judgement about condition and a ceiling built from a
             fortnight would flatter and then sag for weeks. A chart is not a
             judgement, it is the readings with a scale on them, and withholding
             it until the gate opens would put it on screen the day it stopped
             being news. Watching the gap close is the point. -->
        <template v-if="levelLineGeo">
          <HomeCard title="HRV OVER TIME" :meta="levelMeta" :color="famBody">
            <div class="histwrap">
              <!-- Uniform scaling, unlike the bar charts on this page: the dot
                   at today would be drawn as an ellipse under
                   preserveAspectRatio="none". -->
              <svg
                class="levelchart"
                :viewBox="`0 0 ${levelLineGeo.width} ${levelLineGeo.height}`"
                role="img"
                :aria-label="levelAria"
              >
                <line
                  class="lvrule ceil"
                  :x1="levelLineGeo.plotLeft"
                  :y1="levelLineGeo.ceilingY"
                  :x2="levelLineGeo.width"
                  :y2="levelLineGeo.ceilingY"
                />
                <!-- Numbered in a gutter of their own, and today's figure is one
                     of them: a lone ceiling with nothing under it is a rule, not
                     a scale, which is what "hard to see the scale" meant. The
                     rules' NAMES are in the key below rather than on the plot -
                     YOUR BEST RECENT FORM was drawn over the line on both cards,
                     and a key is the one place a name can never collide. -->
                <text
                  v-for="l in levelLineGeo.axisLabels"
                  :key="l.key"
                  class="gut"
                  :class="{ lit: l.lit }"
                  :x="levelLineGeo.labelX"
                  :y="l.y + 3"
                  text-anchor="end"
                >
                  {{ Math.round(l.value) }}
                </text>
                <polyline class="lvline" :points="levelLineGeo.line" />
                <circle class="lvdot" :cx="levelLineGeo.today.x" :cy="levelLineGeo.today.y" r="4" />
              </svg>
              <div class="histaxis mono">
                <span>{{ axisDate(levelLineGeo.from) }}</span>
                <span>{{ axisDate(levelLineGeo.to) }}</span>
              </div>
              <div class="keyrow mono">
                <span><i class="dash"></i>YOUR BEST RECENT FORM</span>
              </div>
            </div>
          </HomeCard>

          <!-- **One mark per day** (2026-08-11, option H of four mocked up).
               It was a bar per band against a count axis, and the report on it
               was that nobody could tell what it was measuring: the bands were
               unnamed, the counts unstated, and two figures on a scale of nine
               boundaries is not an axis. Marks need no axis to be counted, and
               an empty band is plainly empty rather than a two-pixel speck.

               It also shows what the bars hid. On the real fortnight the days
               are in two clumps, a week near the ceiling and a week at the
               bottom with almost nothing between; drawn as lengths that read as
               an even spread.

               Titled DAYS AT EACH LEVEL, not WHERE YOU USUALLY SIT: the old
               name stated a conclusion, and a card has to name its own axes
               before it can claim one. -->
          <HomeCard
            v-if="ladderGeo"
            title="HRV: EVERY DAY, BY LEVEL"
            :meta="distMeta"
            :color="famBody"
          >
            <svg
              class="levelchart"
              :viewBox="`0 0 ${ladderGeo.width} ${ladderGeo.height}`"
              role="img"
              :aria-label="distAria"
            >
              <!-- The bands are cut on these, so an edge figure sits ON the line
                   between two rows rather than inside either of them. -->
              <line
                v-for="e in ladderGeo.edges"
                :key="`e${e.value}`"
                class="ladderline"
                :x1="ladderGeo.plotLeft"
                :y1="e.y"
                :x2="ladderGeo.countX - 5"
                :y2="e.y"
              />
              <text
                v-for="e in ladderGeo.edges"
                :key="`t${e.value}`"
                class="gut"
                :x="ladderGeo.labelX"
                :y="e.y + 3.4"
                text-anchor="end"
              >
                {{ Math.round(e.value) }}
              </text>
              <template v-for="r in ladderGeo.rows" :key="r.index">
                <template v-if="ladderGeo.mode === 'dots'">
                  <circle
                    v-for="(d, i) in r.dots"
                    :key="i"
                    class="lvmark"
                    :class="{ on: r.today }"
                    :cx="d.cx"
                    :cy="d.cy"
                    :r="LADDER_DOT_R"
                  />
                </template>
                <rect
                  v-else-if="r.count"
                  class="lvbar"
                  :class="{ on: r.today }"
                  :x="ladderGeo.plotLeft"
                  :y="r.barY"
                  :width="r.barWidth"
                  :height="r.barHeight"
                  rx="2"
                />
                <text
                  v-if="r.count"
                  class="gut"
                  :class="{ lit: r.today }"
                  :x="ladderGeo.countX"
                  :y="r.midY + 3.4"
                >
                  {{ r.count }}
                </text>
              </template>
            </svg>
            <div class="keyrow mono">
              <span>{{ ladderKey }}</span>
              <span class="lit">TODAY'S LEVEL IS LIT</span>
            </div>
          </HomeCard>
        </template>

        <!-- Resting heart rate, drawn like HRV because it is scored like HRV.
             The axis is flipped rather than the vocabulary: lower is better, so
             the ceiling is your lowest sustained average and it still sits at the
             top, which is what lets this card and the HRV one above it be read
             the same way.

             The third rule is the age band, and it is the only absolute
             reference anywhere in Atlas: overnight beats are the same quantity
             every published cohort counted, which is not true of the strap's HRV
             figure. It comes from ageNorms by way of the score's own
             `ageReference`, so the line the chart draws is the line the term is
             judged against, and it is absent rather than guessed at when no date
             of birth is recorded. -->
        <HomeCard
          v-if="rhrLineGeo"
          title="REST HR OVER TIME"
          :meta="rhrMeta"
          :color="famBody"
        >
          <div class="histwrap">
            <svg
              class="levelchart"
              :viewBox="`0 0 ${rhrLineGeo.width} ${rhrLineGeo.height}`"
              role="img"
              :aria-label="rhrAria"
            >
              <line
                class="lvrule ceil"
                :x1="rhrLineGeo.plotLeft"
                :y1="rhrLineGeo.ceilingY"
                :x2="rhrLineGeo.width"
                :y2="rhrLineGeo.ceilingY"
              />
              <!-- The same value gutter the HRV card carries. It was missing
                   here while the geometry was already reserving room for it, so
                   this chart had three unlabelled rules and a 34px empty margin:
                   the two cards are meant to be read the same way and only one
                   of them had a scale on it. -->
              <text
                v-for="l in rhrLineGeo.axisLabels"
                :key="l.key"
                class="gut"
                :class="{ lit: l.lit }"
                :x="rhrLineGeo.labelX"
                :y="l.y + 3"
                text-anchor="end"
              >
                {{ Math.round(l.value) }}
              </text>
              <line
                v-if="rhrLineGeo.referenceY != null"
                class="lvrule age"
                :x1="rhrLineGeo.plotLeft"
                :y1="rhrLineGeo.referenceY"
                :x2="rhrLineGeo.width"
                :y2="rhrLineGeo.referenceY"
              />
              <polyline class="lvline" :points="rhrLineGeo.line" />
              <circle class="lvdot" :cx="rhrLineGeo.today.x" :cy="rhrLineGeo.today.y" r="4" />
            </svg>
            <div class="histaxis mono">
              <span>{{ axisDate(rhrLineGeo.from) }}</span>
              <span>{{ axisDate(rhrLineGeo.to) }}</span>
            </div>
            <div class="keyrow mono">
              <span><i class="dash"></i>YOUR BEST RECENT FORM</span>
              <span v-if="ageRefLabel"><i class="dot"></i>{{ ageRefLabel }}</span>
            </div>
          </div>
        </HomeCard>

        <!-- The nights behind the sleep term. The term's own row says
             "7-NIGHT AVERAGE", which states that a week is being scored without
             showing it: this is what stops a reader assuming last night's bad
             score is sitting in Recovery at full strength. Bars rather than a
             line, because each night is a separate reading and nothing happened
             between two of them. -->
        <HomeCard v-if="sleepGeo" title="SLEEP NIGHT BY NIGHT" :meta="sleepMeta" :color="famBody">
          <div class="histwrap">
            <svg
              class="histchart"
              viewBox="0 0 100 46"
              preserveAspectRatio="none"
              role="img"
              :aria-label="sleepAria"
            >
              <rect
                v-for="b in sleepGeo.bars"
                :key="b.date"
                :x="b.x"
                :y="b.y"
                :width="b.width"
                :height="b.height"
                fill="var(--fam-body)"
                fill-opacity="0.62"
              />
              <!-- The average the term actually uses, ruled across the nights it
                   was made from. -->
              <line
                class="avgrule"
                x1="0"
                :y1="sleepGeo.averageY"
                x2="100"
                :y2="sleepGeo.averageY"
              />
            </svg>
            <div class="histaxis mono">
              <span>{{ axisDate(sleepGeo.from) }}</span>
              <span>{{ axisDate(sleepGeo.to) }}</span>
            </div>
          </div>
        </HomeCard>

        <!-- Collapsed by default. It is reference, read once and then in the
             way of the two things above it that change every day. -->
        <details class="panel built">
          <summary class="boxlabel mono">
            HOW IT IS BUILT
            <span class="chev" aria-hidden="true"></span>
          </summary>
          <dl class="facts">
            <!-- Reads live state rather than being typed out, the same rule the
                 sleep page's explainer follows: an explainer that has to be kept
                 in step by hand is one that quietly stops being true. -->
            <div>
              <dt class="mono">WHAT THIS SCORE MEANS</dt>
              <dd>
                What condition you are in, not how today compares with yesterday. Sitting
                at your best scores your best every day it stays true, rather than fading
                once the improvement stops being new.
              </dd>
            </div>
            <div>
              <dt class="mono">HRV</dt>
              <dd>{{ hrvExplainer }}</dd>
            </div>
            <div>
              <dt class="mono">RESTING HEART RATE</dt>
              <dd>{{ restingExplainer }}</dd>
            </div>
            <div>
              <dt class="mono">SLEEP</dt>
              <dd>
                Atlas's own sleep score for last night, the same number the sleep page
                shows, so the two cannot disagree. It is the one term judged against a
                target rather than against your own baseline.
              </dd>
            </div>
            <div>
              <dt class="mono">WEIGHTS</dt>
              <dd>HRV 50%, resting heart rate 25%, sleep 25%.</dd>
            </div>
            <div>
              <dt class="mono">TODAY'S SHARE</dt>
              <dd>
                Today's readings move each vital's term by up to a fifth either way. An
                ordinary day therefore scores the condition you are in; a genuinely good
                or bad reading still shifts it, by about ten points on HRV.
              </dd>
            </div>
            <!-- Added 2026-08-07 at the user's request, on both scores. A number
                 built from published work should be able to say which work. -->
            <div>
              <dt class="mono">WHY HRV LEADS</dt>
              <dd>
                Overnight HRV is the most responsive of the three to training load and
                recovery, which is why it carries half the score and is read against a
                rolling personal baseline rather than an absolute figure: the useful
                signal is the change, not the level [1]. It is log-transformed first, because HRV is
                distributed multiplicatively, so a 10 ms move means something different
                at 50 than at 120.
              </dd>
            </div>
            <div>
              <dt class="mono">WHY NOT MORE TERMS</dt>
              <dd>
                Breathing rate and skin temperature are deliberately excluded. Both are
                flat almost every day and then jump sharply, usually with illness.
                Averaged into a score they add nothing on an ordinary day and are diluted
                on the day they matter, so they belong as flags instead.
              </dd>
            </div>
            <div>
              <dt class="mono">BANDS</dt>
              <dd>
                LOW under 40, NORMAL from 40, GOOD from 60, GREAT from 80. Set from this
                score's own spread rather than picked round. They were calibrated against
                the deviation-only shape and are expected to want revisiting now the score
                measures condition: that is a known open question, not a settled figure
                here, and why climbing out of it takes beating your own recent average
                rather than merely matching it.
              </dd>
            </div>
            <div>
              <dt class="mono">MISSING READING</dt>
              <dd>Dropped and its weight shared out, never counted as zero.</dd>
            </div>
            <div>
              <dt class="mono">LEFT OUT</dt>
              <dd>Breathing rate and skin temperature. Flat most days, then a sharp jump that means illness, so they work as flags rather than as an average.</dd>
            </div>
            <div>
              <dt class="mono">REFERENCES</dt>
              <dd class="refs">
                <p>
                  [1] Plews DJ et al. Training adaptation and heart rate variability
                  in elite endurance athletes: opening the door to effective
                  monitoring. <i>Sports Medicine</i>, 2013.
                </p>
              </dd>
            </div>
          </dl>
        </details>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, onMounted, watch } from "vue";
import { useBackClose } from "@/composables/useBackClose";
import PageHeader from "@/components/layout/PageHeader.vue";
import HomeCard from "@/components/home/HomeCard.vue";
import {
  recoveryBars,
  recoveryScores,
  HISTORY_DAYS,
  WINDOW_DAYS,
} from "@/components/home/recoveryHistory";
import {
  levelSeries,
  levelCeiling,
  levelLine,
  levelDistribution,
  levelLadder,
  LADDER_DOT_R,
  sleepBars,
  floorFor,
} from "@/components/home/levelChart";
import { LEVEL_FLOOR } from "@/utils/level";
import { today, addDays, fmtHoursMins, fmtAxisDate } from "@/utils/date";
import { useCheckinStore } from "@/stores/checkin";
import { goalOrDefault, useGoalsStore } from "@/stores/goals";
import { useLevelsStore } from "@/stores/levels";
import { BASELINE_NIGHTS } from "@/utils/baseline";
import { useProfileStore } from "@/stores/profile";
import { restingHrForAge } from "@/utils/ageNorms";
import { useSessionsStore } from "@/stores/sessions";
import { dailyValuesForRange } from "@/utils/dailyRollup";
import { getWorkouts } from "@/utils/sampleDb";
import { resolveSessions } from "@/components/activity/resolveSessions";
import { termContext } from "@/components/home/recoveryContext";
import { dayRow, weekdayLabel, labelAnchor, AXIS_TICKS } from "@/components/home/dayMarkers";
import { nightsFrom, axisMinutes, usualWindow } from "@/utils/sleepRegularity";
import {
  recoveryFor,
  sleepScoreFor,
  SLEEP_TERM_NIGHTS,
} from "@/components/home/homeModel";
import { useTripLane } from "@/composables/useTripLane";
import TripLane from "@/components/marks/TripLane.vue";
import RangeMark from "@/components/marks/RangeMark.vue";
import NotYet from "@/components/common/NotYet.vue";
import { metric, formatValue } from "@/utils/metricRegistry";
import { typicalRange } from "@/utils/baseline";
import {
  recoveryBreakdown,
  recoveryExplanation,
  bandMeaning,
  recoveryColor,
  recoveryInk,
  headroomParagraphs,
  baselineNote,
  recoveryHeadroom,
  termTarget,
  RECOVERY_BANDS,
  TERM_LABEL,
} from "@/utils/recovery";

const props = defineProps({
  /**
   * The score for the day being opened on, handed over by the caller purely so
   * the hero is not blank for the moment the window takes to load. It is the
   * same recoveryFor() this page computes, not a second opinion, and it is
   * ignored the instant the date moves.
   */
  result: { type: Object, required: true },
  /** Which day to open on. The header can then move to another. */
  date: { type: String, default: () => today() },
  /** Where the back control returns to, named by whoever opened this. */
  from: { type: String, default: "BACK" },
});

const emit = defineEmits(["close"]);
useBackClose(() => emit("close"));

const checkin = useCheckinStore();
// A plain reactive object, so every GOALS.x below reads live and works the
// same in the template as it does here. See stores/goals.js.
const GOALS = useGoalsStore().values;
const levels = useLevelsStore();
const profile = useProfileStore();

// The window is HISTORY_DAYS plus a week, because every day the chart draws is
// scored against the seven nights before it. Fetching only what is drawn left
// the first week of the chart unscoreable, which reads as missing data rather
// than as the edge of the window. See recoveryHistory.js.
const todayKey = today();
const viewDate = ref(props.date);
const dayWindow = ref([]);
const rawSessions = ref([]);
const sessionStore = useSessionsStore();

/** The regularity window, matching the sleep page's: this night and six before. */
const CONTEXT_NIGHTS = 7;
/** Days of day-before context: yesterday, plus the five the strip draws behind it. */
const CONTEXT_DAYS = 6;

/**
 * The window runs to TODAY rather than to the day being looked at, even though
 * only the days before it are ever scored against.
 *
 * Loading is async and the date moves synchronously, so for one tick the score
 * is computed against whichever window is still in hand. Stepping back lands
 * inside it and is seamless; stepping forward used to land past its end, where
 * valuesOn finds nothing and the hero dropped to "--" until the reload arrived.
 * Extending to today means every forward step is already covered, and
 * historyFor only ever reads days before the one being scored, so the extra
 * days on the end cost nothing.
 */
async function load() {
  dayWindow.value = await dailyValuesForRange(
    addDays(viewDate.value, -(WINDOW_DAYS - 1)),
    todayKey
  );

  // Six days: the one before the day being viewed, plus the five behind it that
  // the LAST WEEK strip draws. Not the whole 37-day window the scores use, since
  // nothing on this card reaches back further than the strip.
  const first = addDays(viewDate.value, -CONTEXT_DAYS);
  const last = addDays(viewDate.value, -1);
  rawSessions.value = await getWorkouts(
    new Date(`${first}T00:00:00`).getTime(),
    new Date(`${last}T23:59:59.999`).getTime()
  );
}
onMounted(load);
watch(viewDate, load);

/**
 * Recomputed for whichever day is being looked at, against the baseline as it
 * stood on that day rather than as it stands now. A past day judged against
 * today's baseline would be a number that changes every time you open it.
 */
const result = computed(() => {
  if (!dayWindow.value.length) return props.result;
  return recoveryFor({
    dayWindow: dayWindow.value,
    entry: checkin.entryFor(viewDate.value),
    todayKey: viewDate.value,
    sleepGoalHours: goalOrDefault("sleep"),
    // Every entry, not the window: the sleep score's regularity term needs the
    // nights around this one, and sleepScoreFor cuts them off at the date being
    // scored so a past day is never scored using its own future.
    entries: checkin.entries,
    longWindow: levels.window,
    profile: { age: profile.age, sex: profile.sex || null },
  });
});

/**
 * One term open at a time, the same rule the diary sheet's ingredient rows use:
 * three open at once turns a card that explains a score into a page of prose.
 */
const openTerm = ref(null);
function toggleTerm(key) {
  openTerm.value = openTerm.value === key ? null : key;
}
// A term left open while stepping to another day would be showing one day's
// number under another day's heading.
watch(viewDate, () => (openTerm.value = null));

/** The metric's own description, split into paragraphs as MetricPage does. */
function termInfo(key) {
  return (metric(key)?.info ?? "").split("\n\n").filter(Boolean);
}

/** The labelled list under it, where the metric has one. */
function termDetail(key) {
  const detail = metric(key)?.detail;
  return detail?.items?.length ? detail : null;
}

/**
 * The term's readings over the window, as a RangeMark.
 *
 * Sleep gets none: it is scored against a goal rather than a personal normal, so
 * a mark whose whole point is "where does this sit against your usual" would be
 * answering a question sleep is not asked.
 *
 * The range is built from the days BEFORE the one being viewed, matching how the
 * score itself judges the day. Including it would drag the range toward the
 * reading being judged, which is the defect `MetricPage` was fixed for.
 */
function termRange(key) {
  if (key === "sleep") return null;
  const def = metric(key);
  if (!def) return null;

  const prior = dayWindow.value
    .filter((d) => d.date < viewDate.value)
    .map((d) => d.values?.[key])
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  const range = typicalRange(prior);
  const value = result.value?.readings?.[key];
  if (!range || value == null) return null;

  return {
    value,
    low: range.low,
    high: range.high,
    baseline: result.value?.baselines?.[key]?.mean ?? null,
    series: prior,
    lowLabel: formatValue(def, range.low),
    highLabel: formatValue(def, range.high),
  };
}

/**
 * What this term specifically would have to read for the score to reach the next
 * band, with the direction said out loud.
 *
 * Withheld rather than guessed at whenever the arithmetic cannot answer: already
 * in the top band, term missing, term already full, or a gap wider than this one
 * term can close even saturated. See termTarget.
 */
function termGoal(key) {
  const target = termTarget(result.value, key);
  const head = recoveryHeadroom(result.value);
  if (!target || !head) return "";
  const def = metric(key);
  // The registry's units carry their own leading space (" MS"), so adding one
  // here gives "115  MS".
  const unit = def?.unit ? String(def.unit).toUpperCase() : "";
  return `${head.nextLabel} WOULD WANT ${target.reading}${unit}, ${target.delta} ${target.direction.toUpperCase()} THAN TODAY`;
}

/** "TUE 4 AUG", or TODAY, the same wording the stress page uses. */
const dayLabel = computed(() =>
  viewDate.value === todayKey
    ? "TODAY"
    : new Date(`${viewDate.value}T00:00:00`)
        .toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })
        .replace(",", "")
        .toUpperCase()
);

/**
 * The score for each of the last HISTORY_DAYS days, always ending at today
 * rather than at the day being viewed.
 *
 * A history section that slides under you as you step through days is harder to
 * read than a fixed month with your position marked on it, which is what the
 * lit bar does. It also matches StressPage, whose equivalent chart is fixed for
 * the same reason plus a cost one.
 */
const history = computed(() =>
  recoveryBars(
    recoveryScores({
      dayWindow: dayWindow.value,
      entryFor: (d) => checkin.entryFor(d),
      endKey: todayKey,
      sleepGoalHours: goalOrDefault("sleep"),
      entries: checkin.entries,
      longWindow: levels.window,
      profile: { age: profile.age, sex: profile.sex || null },
    })
  )
);

// A day the strap was not worn is unscoreable, which is exactly the absence a
// trip explains. The bars already carry a null score for those.
const trip = useTripLane(
  computed(() => history.value.bars.map((b) => ({ date: b.date, value: b.score })))
);

const historyAria = computed(() =>
  history.value.average == null
    ? "No Recovery history yet"
    : `Recovery over ${history.value.days} days, averaging ${history.value.average}`
);

/* ── a card per term ─────────────────────────────────────────────────────── */

/** The line's box in user units. Scaled uniformly, so these are a shape. */
/**
 * Width reserved down the left for the figures the rules are worth.
 *
 * Two dashed rules say a scale exists without saying what it is, which is what
 * made these charts hard to read. The plot starts after the gutter so a figure
 * and the line can never overprint.
 */
const LEVEL_GUTTER = 34;
const LEVEL_W = 320;
const LEVEL_H = 150;

/** Six months of trailing seven-night HRV averages, oldest first. */
const hrvSeries = computed(() => levelSeries(levels.window, "hrv"));

/**
 * The ceiling the charts are drawn against.
 *
 * Taken off the score once the level term is ready, so the picture and the
 * number cannot disagree, and derived by the same rule from the same series
 * while it is still calibrating. Deriving it is what lets the charts draw
 * before the term does.
 */
const hrvCeiling = computed(() => {
  const level = result.value?.levels?.hrv;
  if (level?.state === "ready" && level.ceiling) return level.ceiling;
  return levelCeiling(hrvSeries.value);
});

/** Null under two points or with no ceiling, which is what gates both cards. */
const levelLineGeo = computed(() =>
  levelLine(hrvSeries.value, {
    ceiling: hrvCeiling.value,
    floor: floorFor(hrvCeiling.value),
    width: LEVEL_W,
    height: LEVEL_H,
    gutter: LEVEL_GUTTER,
  })
);

const levelDist = computed(() =>
  levelDistribution(hrvSeries.value, {
    ceiling: hrvCeiling.value,
    floor: floorFor(hrvCeiling.value),
  })
);

const ladderGeo = computed(() => levelLadder(levelDist.value));

/* ── resting heart rate ──────────────────────────────────────────────────── */

/**
 * The same picture HRV gets, because the two vitals are scored the same way.
 *
 * Both are a level with today's reading modulating it, so drawing them
 * differently would suggest a difference that is not there. The one real
 * difference is direction, and that is handled by flipping the axis rather than
 * the labels: the ceiling stays at the top on both cards, so a line climbing
 * toward it means the same thing on each.
 *
 * The age band rides on it as a third rule, and it is the reason this card is a
 * line at all rather than a second distribution. Resting heart rate is the only
 * term in Recovery with an outside reference, and once a date of birth is known
 * that reference is what the score actually uses as the term's spine - so a
 * chart drawn against the personal ceiling alone would be showing a scale the
 * score had already stopped judging by.
 */
const rhrSeries = computed(() => levelSeries(levels.window, "restingHr"));

/**
 * Taken off the score when it is there, derived by the same rule when it is not.
 *
 * The fallback is the normal path here rather than a rare one: once an age is
 * known `levels.restingHr` is the age spine, which carries a value and a weight
 * and no percentile at all.
 */
const rhrCeiling = computed(() => {
  const level = result.value?.levels?.restingHr;
  if (level?.state === "ready" && level.ceiling) return level.ceiling;
  return levelCeiling(rhrSeries.value, { higherIsBetter: false });
});

/**
 * What the age tables say about the current average, or null with no age.
 *
 * Taken off the score when it is there, and derived from the same function on
 * the same figure when it is not - the same arrangement as `hrvCeiling` above,
 * and for the same reason. The score only computes it once the level term is
 * ready at 30 nights, because a term is a judgement; a rule on a chart is not,
 * and the age bands need nothing but a reading and a date of birth. Withholding
 * it until the gate opens would put it on screen weeks after it became useful.
 */
const ageRef = computed(() => {
  if (result.value?.ageReference) return result.value.ageReference;
  const current = rhrSeries.value.at(-1)?.value;
  if (current == null || profile.age == null) return null;
  return restingHrForAge(current, profile.age, profile.sex || null);
});

const rhrLineGeo = computed(() =>
  levelLine(rhrSeries.value, {
    ceiling: rhrCeiling.value,
    floor: floorFor(rhrCeiling.value, { higherIsBetter: false }),
    // The top of the category the current average falls in, straight from
    // ageNorms by way of the score. Never re-derived here.
    reference: ageRef.value?.reference ?? null,
    invert: true,
    width: LEVEL_W,
    height: LEVEL_H,
    gutter: LEVEL_GUTTER,
  })
);

const rhrMeta = computed(() =>
  rhrCeiling.value ? `${Math.round(rhrCeiling.value)} BPM CEILING` : ""
);

/**
 * The rule's label names the band, not the number.
 *
 * Same rule the ceiling and floor follow on the HRV card: the figures live in
 * the card meta and on the axis, and a figure printed twice is two chances to
 * disagree with itself. What the rule is for is "at or below this you are
 * EXCELLENT for your age", and the name is the half of that worth reading.
 */
const ageRefLabel = computed(() => (ageRef.value ? `${ageRef.value.label} FOR YOUR AGE` : ""));

const rhrAria = computed(() => {
  const geo = rhrLineGeo.value;
  if (!geo) return "";
  const age = ageRef.value
    ? `, which is ${ageRef.value.label.toLowerCase()} for your age`
    : "";
  return (
    `Your seven-night resting heart rate average from ${geo.from} to ${geo.to}, ` +
    `now ${Math.round(geo.today.value)} beats per minute against a best of ` +
    `${Math.round(rhrCeiling.value)}${age}`
  );
});

/* ── the nights behind the sleep term ────────────────────────────────────── */

/**
 * The individual nights Recovery's sleep term averages.
 *
 * Scored night by night with `sleepScoreFor`, which is the same per-night
 * function `recentSleepScore` averages, over the same window - so these bars are
 * the numbers the term is made of rather than a second opinion about them, and
 * the rule across them is their own mean rather than a figure handed in beside
 * it. The card exists because a term reading "7-NIGHT AVERAGE" says a week is
 * being scored without ever showing that one bad night does not swing it.
 *
 * Pinned to today rather than to the viewed day, like every other card under the
 * HISTORY divider.
 */
const sleepNightScores = computed(() => {
  const out = [];
  for (let i = SLEEP_TERM_NIGHTS - 1; i >= 0; i--) {
    const date = addDays(todayKey, -i);
    const entry = checkin.entryFor(date);
    if (!entry) continue;
    const score = sleepScoreFor({ entries: checkin.entries, entry, todayKey: date });
    if (score != null) out.push({ date, score });
  }
  return out;
});

const sleepGeo = computed(() => sleepBars(sleepNightScores.value));

/**
 * The night count only when it is short of the full week.
 *
 * The term's own row already says 7-NIGHT AVERAGE, and the bars are countable,
 * so on an ordinary week the count buys nothing and costs the header the width
 * it needs to stay on one line. A missing night is worth the words.
 */
const sleepMeta = computed(() => {
  const geo = sleepGeo.value;
  if (!geo) return "";
  return geo.count < SLEEP_TERM_NIGHTS
    ? `${geo.average} AVG · ${geo.count} NIGHTS`
    : `${geo.average} AVG`;
});

const sleepAria = computed(() => {
  const geo = sleepGeo.value;
  if (!geo) return "";
  return (
    `Sleep score for each of the last ${geo.count} nights, from ${geo.from} to ${geo.to}, ` +
    `averaging ${geo.average}`
  );
});

/** "10 AUG". Both ends of the line's axis, so the span is never assumed. */
const axisDate = fmtAxisDate;

const levelMeta = computed(() =>
  hrvCeiling.value ? `${Math.round(hrvCeiling.value)} MS CEILING` : ""
);
const levelAria = computed(() => {
  const geo = levelLineGeo.value;
  if (!geo) return "";
  return (
    `Your seven-night HRV average from ${geo.from} to ${geo.to}, ` +
    `now ${Math.round(geo.today.value)} against a ceiling of ${Math.round(hrvCeiling.value)}`
  );
});

/**
 * What a mark on the ladder is, which is the sentence the old card never had.
 *
 * It changes with the fallback, because at a year of history the marks give way
 * to bars and a key still claiming one mark is one day would be wrong.
 */
const ladderKey = computed(() =>
  ladderGeo.value?.mode === "dots" ? "ONE MARK IS ONE DAY" : "BAR LENGTH IS DAYS AT THAT LEVEL"
);
// The unit rides in the meta, because the gutter is now nine bare figures and
// putting MS on each would be nine repetitions of one fact.
const distMeta = computed(() =>
  levelDist.value ? `${levelDist.value.total} DAYS · MS` : ""
);
const distAria = computed(() => {
  const dist = levelDist.value;
  if (!dist) return "";
  return (
    `How often your seven-night HRV average has landed at each level between ` +
    `${Math.round(dist.floor)} and ${Math.round(dist.ceiling)} milliseconds. ` +
    `You are currently in band ${dist.todayBin + 1} of ${dist.bins.length}`
  );
});

/**
 * What the day before the scored night looked like.
 *
 * The bedtime read here is the one belonging to the night being scored, which
 * is stored on the viewed date's entry rather than the previous day's: a night
 * belongs to the morning it ends on. Reading it off the day before would report
 * the bedtime of the night before that one.
 */
/** Every session that ran on a given date, corrections applied. */
function sessionsOn(dateKey) {
  const from = new Date(`${dateKey}T00:00:00`).getTime();
  const to = new Date(`${dateKey}T23:59:59.999`).getTime();
  return resolveSessions(rawSessions.value, sessionStore).filter(
    (s) => s.startMillis >= from && s.startMillis <= to
  );
}

/**
 * The bedtime of the night that STARTED on a date.
 *
 * A night is stored on the date it ends, so the bedtime belonging to Wednesday's
 * row lives on Thursday's entry. Reading it off Wednesday's would draw the night
 * before and put every row one day out.
 */
function bedTimeStartingOn(dateKey) {
  return checkin.entryFor(addDays(dateKey, 1))?.sleepStages?.bedTime ?? null;
}

const beforeDate = computed(() => addDays(viewDate.value, -1));

const yesterday = computed(() => {
  if (result.value.state !== "ready") return null;
  const d = beforeDate.value;
  return dayRow({
    date: d,
    sessions: sessionsOn(d),
    bedMs: bedTimeStartingOn(d),
    // From the row's OWN entry, unlike the bedtime: a night is stored on the
    // date it ends, so the morning you got up on Wednesday is on Wednesday.
    wakeMs: checkin.entryFor(d)?.sleepStages?.wakeTime ?? null,
  });
});

/** The five days behind it, oldest first, so the lit day reads as the newest. */
const week = computed(() => {
  if (result.value.state !== "ready") return [];
  const rows = [];
  // From the oldest day the fetch covers up to the day before yesterday. Two,
  // not one: yesterday has its own chart above and repeating it here would draw
  // the same day twice at two different sizes.
  for (let back = CONTEXT_DAYS; back >= 2; back--) {
    const d = addDays(viewDate.value, -back);
    rows.push({
      ...dayRow({
        date: d,
        sessions: sessionsOn(d),
        bedMs: bedTimeStartingOn(d),
        wakeMs: checkin.entryFor(d)?.sleepStages?.wakeTime ?? null,
      }),
      label: weekdayLabel(d),
    });
  }
  return rows;
});

/**
 * "YESTERDAY" only when that is true.
 *
 * The header has a date stepper, so on any past day the day before it is not
 * yesterday. The date sits in the meta slot either way, but a title that lies is
 * worse than one that is merely duller.
 */
const yesterdayTitle = computed(() =>
  viewDate.value === todayKey ? "YESTERDAY" : "THE DAY BEFORE"
);

const yesterdayAria = computed(() => {
  const y = yesterday.value;
  if (!y) return "";
  const parts = [];
  if (y.wakeText) parts.push(`woke ${y.wakeText}`);
  parts.push(...y.spans.map((s) => `training ${s.startText} to ${s.endText}`));
  if (y.bedText) parts.push(`in bed ${y.bedText}`);
  return parts.length ? parts.join(", ") : "Nothing recorded";
});

/** The date the card is about, so it is never ambiguous which day is meant. */
const contextDayLabel = computed(() =>
  new Date(`${beforeDate.value}T00:00:00`)
    .toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })
    .replace(",", "")
    .toUpperCase()
);

/** Lines under the terms, gated so an in-range reading is never editorialised. */
const context = computed(() => {
  if (result.value.state !== "ready") return {};
  const from = addDays(viewDate.value, -(CONTEXT_NIGHTS - 1));
  const nights = nightsFrom(
    checkin.entries.filter((e) => e.date >= from && e.date <= viewDate.value)
  );
  const bedMs = checkin.entryFor(viewDate.value)?.sleepStages?.bedTime ?? null;

  return termContext({
    rows: rows.value,
    sessions: sessionsOn(beforeDate.value),
    bedMs,
    bedMinutes: axisMinutes(bedMs),
    usualBedMinutes: usualWindow(nights)?.bedMinutes ?? null,
  });
});

/** Marker x positions. The single-day chart insets 6px; the week clears its labels. */
const px = (fraction) => 6 + fraction * 288;
// Keeps a label inside the 300-unit box it is drawn in. The first mark of the
// waking day sits at x=6, so a centred WOKE hung off the left edge and the card
// clipped it.
const anchorAt = (x, text) => labelAnchor(x, text, { width: 300 });
const wx = (fraction) => 36 + fraction * 258;

const rows = computed(() => recoveryBreakdown(result.value));

/**
 * Last night's three inputs, for the state where there is no score to show.
 *
 * Formatted here rather than in `NotYet`, which knows nothing about metrics -
 * and through `formatValue`, so these read identically to the same three
 * numbers everywhere else in the app rather than being a fourth formatter.
 */
const calibratingReadings = computed(() => {
  const r = result.value?.readings ?? {};
  return [
    { label: "HRV", value: r.hrv == null ? null : formatValue("hrv", r.hrv) },
    {
      label: "RESTING HR",
      value: r.restingHr == null ? null : formatValue("restingHr", r.restingHr),
    },
    { label: "SLEEP", value: r.sleep == null ? null : formatValue("sleep", r.sleep) },
  ];
});
const explanation = computed(() => recoveryExplanation(result.value));
const bandLabel = computed(() => {
  if (result.value.state === "calibrating") {
    return `CALIBRATING · ${result.value.nights}/${result.value.needed} NIGHTS`;
  }
  return result.value.state === "ready" ? result.value.label : "NO DATA";
});
const meaning = computed(() =>
  result.value.state === "ready" ? bandMeaning(result.value.label) : ""
);
// The band's own colour, so the page agrees with the dial that opened it.
const bandColor = computed(() => recoveryInk(result.value.score));
const barColor = computed(() => recoveryColor(result.value.score));

// The card headers take Recovery's own gold rather than the day's band colour:
// a card is one family, and the band already has the hero, the scale and every
// bar in the history chart to say it in. Ink is the darker token, because a
// header is small text and gold misses 4.5:1 on both light themes.
const famRecovery = "var(--fam-recovery)";
const famRecoveryInk = "var(--fam-recovery-ink)";

// The per-term cards are about HRV, resting heart rate and sleep, all three of
// which are BODY, so they take BODY's violet rather than Recovery's gold: a card
// is one family and none of them is about the score, they are about the readings
// the score is built from. Violet has no separate ink token because it clears
// 4.5:1 as a label on all four themes.
const famBody = "var(--fam-body)";

// Bands are stored high to low with a floor each; the scale needs them low to
// high with a width, and the top one runs to 100.
const scaleBands = computed(() => {
  const asc = [...RECOVERY_BANDS].sort((a, b) => a.min - b.min);
  return asc.map((b, i) => {
    const end = asc[i + 1]?.min ?? 100;
    return {
      ...b,
      start: b.min,
      width: end - b.min,
      color: `var(${b.token})`,
      ink: `var(${b.token}-ink)`,
      current: b.label === result.value.label,
    };
  });
});

const improveLabel = computed(() => {
  const head = recoveryHeadroom(result.value);
  return head ? `TO REACH ${head.nextLabel}` : "NOTHING ABOVE THIS";
});

/**
 * Where the points actually went. The bars below already encode this, but a bar
 * at 60% next to a bar at 55% does not announce which one cost more, and that
 * is the question someone opening this page is asking.
 */
/**
 * The gap and a paragraph per term, ordered by how much of the score it carries.
 *
 * Replaced two earlier attempts at one line: a single-term "what could close it"
 * sentence that had to withhold resting heart rate whenever it could not finish
 * the job alone, and a "points still on the table" list that read as a
 * spreadsheet header.
 */
/**
 * The gap, the training note when there was one and the day is down, then a
 * paragraph per term.
 *
 * `trainedYesterday` reads the same resolved sessions the YESTERDAY chart draws,
 * so it is a real rule over real data rather than a note about one day.
 */
const headroomParas = computed(() =>
  headroomParagraphs(result.value, { trainedYesterday: sessionsOn(beforeDate.value).length > 0 })
);

/**
 * What HRV and resting heart rate are currently being judged against, in words,
 * read from the score itself.
 *
 * The level term is withheld until there is enough history for a ceiling to mean
 * anything, and that state lasts weeks - so the page has to say which shape the
 * score is currently in, or a reader is told about a comparison that is not
 * being made yet.
 */
const hrvExplainer = computed(() => {
  const level = result.value?.levels?.hrv;
  if (!level || level.state !== "ready") {
    const left = Math.max(0, (level?.needed ?? 30) - (level?.nights ?? 0));
    return (
      `Judged for now against your own last ${BASELINE_NIGHTS} nights. ` +
      `Once there are ${left} more nights, it is judged against your own best recent form ` +
      `instead - the 90th percentile of your seven-night averages over six months - so ` +
      `holding an improvement keeps its score instead of fading.`
    );
  }
  const pct = Math.round(level.ratio * 100);
  // The floor lives here now and nowhere else. It came off both charts on
  // 2026-08-11 because it is the ceiling times 0.6 rather than a figure anything
  // ever recorded, so ruling it spent most of the box on a region never visited.
  // It is still in the arithmetic, which is what this section is for.
  return (
    `Judged against your own best recent form: the 90th percentile of your seven-night ` +
    `averages over six months, currently ${Math.round(level.ceiling)} MS. ` +
    `You are averaging ${Math.round(level.current)} MS, which is ${pct}% of it. ` +
    `The bottom of the scale is ${Math.round(level.ceiling * LEVEL_FLOOR)} MS, at 60% of ` +
    `your ceiling, which is where the term scores nothing; it is not drawn on the chart ` +
    `because nothing has ever been near it. ` +
    `There is no population comparison, because the strap's HRV figure is not the same ` +
    `quantity the published norms measure.`
  );
});

const restingExplainer = computed(() => {
  const age = profile.age;
  const ref = result.value?.ageReference;
  if (age == null) {
    return (
      `Judged against your own recent form. Add your date of birth in settings and it ` +
      `can also be compared with typical figures for your age, which is the one ` +
      `genuinely absolute comparison Atlas can make.`
    );
  }
  if (!ref) {
    return (
      `Judged against your own last ${BASELINE_NIGHTS} nights for now. Once there is ` +
      `enough history it is compared with typical resting rates for your age as well.`
    );
  }
  return (
    `Compared with typical resting rates for age ${age}: your recent average reads ` +
    `${ref.label.toLowerCase()}.` +
    (ref.approximate
      ? " Approximate, because resting rates differ by sex and Atlas does not hold yours."
      : "")
  );
});

/**
 * Only when the baseline itself has moved, AND there is a gap it helps explain.
 *
 * It exists to account for a run of ordinary days scoring under the middle. On a
 * day already in the top band there is nothing to account for, and printing it
 * under "Nothing scores higher than this" read as the page arguing with itself.
 */
const baselineLine = computed(() =>
  recoveryHeadroom(result.value) ? baselineNote(result.value) : ""
);

function readingText(r) {
  if (r.reading == null) return "--";
  // Sleep's reading is the SCORE, not the hours. The term stopped being duration
  // against a goal when it moved onto Atlas's own sleep score, but this row went
  // on printing hours beside "GOAL 8h 0m" - so a 9h 19m night read as comfortably
  // past its target while being docked points, which explained nothing.
  // Out of 100 on the reading's own line, not underneath it. A bare 75 above a
  // separate "OUT OF 100" reads as two facts; "75 / 100" is one.
  if (r.key === "sleep") return `${Math.round((r.term ?? 0) * 100)} / 100`;
  return `${Math.round(r.reading)}${r.unit ? ` ${r.unit}` : ""}`;
}

/** What the reading was judged against, and by how much it differed. */
function referenceText(r) {
  // Says outright that it is a week, not last night. The term moved to a
  // seven-night average when the score became one about condition, and a reader
  // comparing it with the dial on Home would otherwise see two different sleep
  // numbers with nothing to say why.
  if (r.key === "sleep") {
    const nights = result.value?.sleepNights ?? 0;
    const last = result.value?.lastNightScore;
    if (!nights) return r.reading == null ? "" : `SLEPT ${fmtHoursMins(r.reading)}`;
    // Just the window. This shares its row with "35 / 50 PTS", and anything
    // longer wrapped onto a second line and broke the alignment down the whole
    // column. Last night's own score is one tap away in the expansion, and on
    // Home's dial, which is where a nightly number belongs anyway.
    return `${nights}-NIGHT AVERAGE`;
  }
  if (r.baseline == null) return "NO BASELINE YET";
  const base = `BASELINE ${Math.round(r.baseline)}${r.unit ? ` ${r.unit}` : ""}`;
  if (r.reading == null || !r.baseline) return base;
  const pct = Math.round(((r.reading - r.baseline) / r.baseline) * 100);
  return `${base} · ${pct >= 0 ? "+" : ""}${pct}%`;
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
  /* .page already clips, so the overscan alone hides the Android overlay
     scroll bar. See --sb-overscan in style.css. */
  margin-right: calc(-1 * var(--sb-overscan));
  padding-right: var(--sb-overscan);
}


.score {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 24px;
}
.num {
  font-size: 52px;
  font-weight: 700;
  line-height: 0.9;
  color: v-bind(bandColor);
  font-variant-numeric: tabular-nums;
}
.scoremeta {
  flex: 1;
  min-width: 0;
}
.band {
  font-size: 12px;
  letter-spacing: 2px;
  color: v-bind(bandColor);
}
.verdict {
  margin: 7px 0 0;
  font-size: var(--fs-prose);
  line-height: 1.55;
  color: var(--body);
}
.meaning {
  margin: 8px 0 0;
  font-size: var(--fs-second);
  line-height: 1.6;
  color: var(--dim);
}

.boxlabel {
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--dim);
  margin: 24px 0 12px;
}
.boxlabel:first-of-type {
  margin-top: 0;
}
/* A label that is a card's header sits at the top of the card, so the gap it
   used to need above itself is now the card's own margin. */
.panel > .boxlabel {
  margin-top: 0;
}

/* ── the band scale ─────────────────────────────────────────────────── */
.scale {
  margin: 0 0 22px;
}
.scaletrack {
  position: relative;
  height: 7px;
  border-radius: 4px;
  overflow: hidden;
}
.seg {
  position: absolute;
  top: 0;
  bottom: 0;
  opacity: 0.3;
}
/* The band you are in is the only one at full strength, so the scale reads as
   "you are here" rather than as a four-colour decoration. */
.seg.on {
  opacity: 1;
}
.pin {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  margin-left: -1px;
  background: var(--ink);
  border-radius: 1px;
}
/* A flex row whose cells match the segments above them, so each name sits at the
   start of the band it names. The absolute, boundary-centred version this
   replaced is what made names impossible here. */
.scalelabels {
  display: flex;
  margin-top: 7px;
  font-size: 10px;
  letter-spacing: 1.2px;
}
.scalelabels span {
  white-space: nowrap;
  /* GOOD and GREAT get 15% of the track each. At the narrowest phone width that
     is about 45px against roughly 32px of text, so there is room, but clipping
     is the right failure if a longer band name is ever added. */
  overflow: hidden;
}

/* A card like everything else on the page. It used to be the one thing here
   with an accent bar and no surface, which read as an aside rather than as the
   one actionable thing on the page. The band colour stays on its label. */
/* The first line inside a card sits against the card's own header gap. */
.lead {
  margin-top: 0;
}

/* ── recovery over time ─────────────────────────────────────────────── */
.histwrap {
  padding-top: 4px;
}
.histplot {
  position: relative;
}
/* Room for TripLane's rule, only when a trip falls in the window. */
.histplot.lane {
  padding-bottom: 13px;
}
.histplot.lane .hithit {
  bottom: 13px;
}
.histchart {
  display: block;
  width: 100%;
  height: 62px;
}
/* Real-width targets over a stretched chart. preserveAspectRatio="none" scales
   the SVG's own hit areas with it, so a rect that looks 8px wide is not. */
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
  font-size: 9.5px;
  letter-spacing: 1.2px;
  color: var(--dim);
  padding-top: 6px;
}
/* The rules' names, under the chart rather than on it.
   YOUR BEST RECENT FORM was drawn inside the plot at the ceiling, which is where
   the line runs on both cards - on resting heart rate it hugs the ceiling all
   the way across, so no position inside the box was ever clear. A key cannot
   collide with anything, and it names all three rules in the space the one
   colliding label used. */
.keyrow {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 14px;
  font-size: 9px;
  letter-spacing: 1.1px;
  color: var(--dim);
  padding-top: 8px;
}
.keyrow span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.keyrow span.lit {
  color: var(--fam-body);
}
/* A rule of the same pattern the chart draws, so the key is read off the picture
   rather than off the wording. */
.keyrow i {
  display: inline-block;
  width: 16px;
  height: 0;
  border-top: 1px solid currentColor;
  opacity: 0.8;
}
.keyrow i.dash {
  border-top-style: dashed;
}
.keyrow i.dot {
  border-top-style: dotted;
}

/* ── where you sit against your own ceiling ─────────────────────────── */
.levelchart {
  display: block;
  width: 100%;
  height: auto;
}
/* Takes the score's own gold, since it stands where the scale strip would be
   and that strip is the only other thing in this block carrying colour. */
.notready {
  margin-top: 16px;
  color: var(--fam-recovery);
}
/* Dashed, because neither rule is a reading: they are the two ends of the scale
   the line is judged against, and a solid rule in the same box as a solid line
   reads as a second series. */
/* The value gutter. Set in the mono face at the size every other axis figure
   in the app uses, so a reader recognises it as an axis rather than as a note. */
.gut {
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.4px;
  fill: var(--dim);
}
/* Today's own figure, in the family colour: everything else in the gutter is a
   reference, and this is the reading being judged against them. */
.gut.lit {
  fill: var(--fam-body);
}
.lvrule {
  stroke: var(--dim);
  stroke-dasharray: 3 4;
}
.lvrule.ceil {
  stroke-opacity: 0.75;
}
/* Fainter: the floor is the end of the scale you are never aiming at, and drawn
   at equal weight it competes with the thing you are. */
/* Only drawn by a caller passing `showFloor`, which nothing does: the floor is
   the ceiling times 0.6 rather than anything ever recorded, and ruling it left
   most of the box on a region never visited. It survives in the arithmetic and
   in HOW IT IS BUILT. */
.lvrule.floor {
  stroke-opacity: 0.35;
}
/* Dotted rather than dashed, so the one rule that comes from outside your own
   history is not drawn identically to the two that come from inside it. */
.lvrule.age {
  stroke-dasharray: 1 3;
  stroke-opacity: 0.55;
}
.lvline {
  fill: none;
  stroke: var(--fam-body);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.lvdot {
  fill: var(--fam-body);
}

/* Solid, unlike the level charts' rules: there is no line in this box for it to
   be confused with, only bars, and a dash pattern in an SVG scaled with
   preserveAspectRatio="none" comes out three times longer across than it was
   drawn. */
.avgrule {
  stroke: var(--ink);
  stroke-width: 0.8;
  stroke-opacity: 0.75;
}

/* The hairlines the bands are cut on. Faint, because they are boundaries rather
   than readings, and the figures beside them carry the weight. */
.ladderline {
  stroke: var(--panel-line);
  stroke-width: 1;
}
/* A day. Held at 0.55 rather than the 0.3 a bar was drawn at: a bar is read as a
   length and can afford to be faint, a mark has to be counted. */
.lvmark {
  fill: var(--dim);
  fill-opacity: 0.55;
}
.lvmark.on {
  fill: var(--fam-body);
  fill-opacity: 1;
}
/* The fallback, for a history long enough that the marks would run into the
   count. Never mixed with marks in one card - see levelLadder. */
.lvbar {
  fill: var(--dim);
  fill-opacity: 0.42;
}
.lvbar.on {
  fill: var(--fam-body);
  fill-opacity: 1;
}

.calib {
  font-size: var(--fs-label);
  letter-spacing: 1px;
  color: var(--dim);
  margin: 4px 0 6px;
  opacity: 0.8;
}

/* ── the collapsed explainer ────────────────────────────────────────── */
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
  min-height: 44px;
}
.built summary::-webkit-details-marker {
  display: none;
}
.built summary:focus-visible {
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
.built[open] .chev {
  transform: rotate(-135deg) translate(-2px, -2px);
}
@media (prefers-reduced-motion: reduce) {
  .chev {
    transition: none;
  }
}
.built .facts {
  padding-top: 6px;
}

.terms {
  display: flex;
  flex-direction: column;
  /* Space, not hairlines. Rules between the terms were tried on MetricPage and
     read as more axes stacked above a mark that is itself an axis, so the gap
     does the separating and each term stays one object. */
  gap: 26px;
}
.tline {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.tname {
  font-size: var(--fs-label);
  letter-spacing: 1.4px;
  color: var(--dim);
}
.treading {
  font-size: var(--fs-value);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.tline.sub {
  margin-top: 6px;
}
/* The row is the control, so it has to be a real button: a div with a click
   handler is unreachable by keyboard and announces nothing. Stripped back to
   looking exactly like the line it replaced. */
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
/* Copied from MetricPage's collapse glyph rather than invented, because it is
   the same gesture. Points DOWN, which is what separates it from the › that
   means "goes to a page" everywhere else in Atlas. */
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
.etarget {
  font-size: var(--fs-micro);
  letter-spacing: 0.06em;
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
/* Grid rather than a text indent, so a wrapped second line lines up under the
   first word instead of under the marker. */
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
.tref,
.tpts {
  font-size: var(--fs-second);
  letter-spacing: 0.8px;
  color: var(--dim);
  font-variant-numeric: tabular-nums;
}
.marks {
  width: 100%;
  height: auto;
  display: block;
}
/* Marker labels. A class rather than attributes on every text node, which is
   how the same size ended up written eleven times in the first draft. */
.mk {
  font-family: var(--font-mono);
  font-size: 8.5px;
  letter-spacing: 0.8px;
  fill: var(--dim);
}
.mk.lit {
  fill: var(--ink);
}
.mk.tick {
  fill-opacity: 0.45;
}
/* The same treatment HomeCard gives its own title, so the two halves of this
   card read as two sections of one thing rather than as a heading over a
   footnote. No rule between them: the gap does that job, and a hairline made
   the week look like a separate card that had lost its own header. */
.ctxhd {
  font-size: var(--fs-cardhd);
  letter-spacing: 1.8px;
  margin: 14px 0 6px;
}
/* A margin note against the term it belongs to, not another row: the rule down
   its left is what stops it reading as one more line of data. */
.ctxline {
  display: flex;
  gap: 9px;
  align-items: center;
  margin-top: 12px;
}
.ctxline i {
  display: block;
  width: 3px;
  align-self: stretch;
  opacity: 0.75;
  border-radius: 2px;
}
.ctxline span {
  font-size: var(--fs-second);
  letter-spacing: 0.9px;
  line-height: 1.45;
}
.tbar {
  margin-top: 11px;
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, v-bind(barColor) 18%, transparent);
  overflow: hidden;
}
.tbar span {
  display: block;
  height: 100%;
  border-radius: 2px;
}
.tnote {
  margin-top: 6px;
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--dim);
}

/* A definition list, not paragraphs. Each of these is a single fact about how
   the number works, and prose buried them in connective tissue. */
.facts {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.facts dt {
  font-size: 11px;
  letter-spacing: 1.6px;
  color: var(--dim);
  margin-bottom: 4px;
}
.facts dd {
  margin: 0;
  font-size: var(--fs-prose);
  line-height: 1.5;
  color: var(--body);
}

/* Citations rather than prose. No links: a fabricated DOI is worse than none, and
   these are findable from the citation alone. */
.refs p {
  margin: 0;
  font-size: var(--fs-second);
  line-height: 1.45;
  color: var(--dim);
}
.refs i {
  font-style: italic;
}
</style>
