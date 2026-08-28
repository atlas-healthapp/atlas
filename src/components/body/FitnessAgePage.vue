<!--
  Why the fitness age is what it is.

  **Option B of three mocked up 2026-08-26: RecoveryPage's shape, not
  MetricPage's.** Fitness age is a score computed from terms, exactly like
  Recovery, and Recovery's page already established that such a thing gets a page
  about its terms. MetricPage is built for a measured number with a history, and
  it would lead with the figure the card has already given you.

  It is also where the two footnotes that came off the card on 2026-08-14 belong.
  They were removed for position, not content: four lines of qualifier under a
  three-row summary reads as hedging, where the same lines on the page you opened
  to ask "why" are the answer.

  **Everything the page states about the model is read from the model**, the same
  rule the sleep page's HOW IT IS BUILT follows, so it cannot rot. The one
  hand-maintained figure is `CALIBRATED_ON`.
-->
<template>
  <div class="page">
    <PageHeader :from="from" :context="`${Math.round(result.chronologicalAge)} YEARS OLD`" @close="$emit('close')" />

    <!-- The figure, then immediately what is holding it. A capped number that
         does not say it is capped is the page's one chance to mislead. -->
    <HomeCard title="FITNESS AGE" :color="fam">
      <div class="hero">
        <span class="n">{{ Math.round(result.fitnessAge) }}</span>
        <span class="u mono">YEARS</span>
      </div>
      <p class="verdict">{{ verdict }}</p>
      <div v-if="result.capped" class="sub mono">
        CAPPED AT {{ result.allowedGap }} YEARS · THE MODEL SAYS
        {{ result.uncappedAge.toFixed(1) }}
      </div>

      <div class="scale">
        <div class="track">
          <span class="mark you" :style="{ left: `${pct(result.fitnessAge)}%` }"></span>
          <span class="mark age" :style="{ left: `${pct(result.chronologicalAge)}%` }"></span>
        </div>
        <div class="ends mono">
          <span>{{ SCALE_MIN }}</span>
          <span>{{ SCALE_MAX }}</span>
        </div>
        <div class="legend mono">
          <span><i class="sw you"></i>YOU {{ Math.round(result.fitnessAge) }}</span>
          <span
            ><i class="sw age"></i>YOUR AGE {{ Math.round(result.chronologicalAge) }}</span
          >
        </div>
      </div>
    </HomeCard>

    <!-- The three terms, each with its reading, what it was judged against, and
         the years it contributed. The bar is centred on zero because these run
         both ways and a left-anchored fill would read as a proportion of
         something. -->
    <HomeCard title="WHAT MAKES IT" :meta="`${rows.length} INPUTS`" :color="fam">
      <div v-for="row in rows" :key="row.key" class="item">
        <span class="k mono">{{ row.label }}</span>
        <span class="y mono" :class="row.years < 0 ? 'down' : 'up'">{{ row.yearsText }}</span>
        <span class="v mono">{{ row.reading }}</span>
        <div class="bar">
          <span :class="{ over: row.years > 0 }" :style="row.barStyle"></span>
        </div>
      </div>
      <!-- The first of the two footnotes taken off the card. It only makes sense
           beside the rows it is about, which is why it could never work there. -->
      <p v-if="result.capped" class="note mono">
        THESE SUM TO {{ result.uncappedAge.toFixed(1) }}, NOT
        {{ Math.round(result.fitnessAge) }}. THE CAP HOLDS THE FIGURE WITHIN
        {{ result.allowedGap }} YEARS OF YOUR AGE.
      </p>
    </HomeCard>

    <HomeCard title="THE ESTIMATE" :color="fam">
      <p class="prose">
        Your VO2max is estimated at <strong>{{ result.vo2max.toFixed(1) }}</strong
        >, against {{ result.referenceVo2max.toFixed(1) }} for the reference person at
        your age. It is not measured: it is worked out from your resting heart rate,
        your {{ bodyWord }} and how much you train.
      </p>
      <p v-if="measuredNote" class="prose dim">{{ measuredNote }}</p>
    </HomeCard>

    <div class="grouphd mono">HISTORY</div>

    <HomeCard title="FITNESS AGE OVER TIME" :meta="`${SERIES_WEEKS} WEEKS`" :color="fam">
      <div v-if="hasSeries" class="hist">
        <div
          v-for="(p, i) in series"
          :key="p.date"
          class="col"
          :class="{ now: i === series.length - 1, gap: p.value == null }"
        >
          <span v-if="p.value != null" class="fill" :style="{ height: `${barPct(p.value)}%` }"></span>
        </div>
      </div>
      <div v-else class="prose dim">Not enough history yet to draw a line.</div>
      <div v-if="hasSeries" class="ends mono">
        <span>{{ SERIES_WEEKS }} WEEKS AGO</span>
        <span>NOW</span>
      </div>
    </HomeCard>

    <!-- **Every reference the figure rests on, named, with where it came from.**
         Asked for explicitly on 2026-08-26: a number built out of four published
         sources has to be able to say which four. Read from the model rather than
         written out, so a coefficient that moves cannot leave this page stating
         the old one. -->
    <HomeCard title="WHAT THIS IS" collapsible :color="fam">
      <p class="prose">
        Fitness age is the age at which your estimated aerobic fitness would be
        average. It is an estimate from things Atlas already knows, not a laboratory
        test, and it is only as good as the equation behind it.
      </p>

      <div class="refhd mono">JUDGED AGAINST</div>
      <div v-for="ref in references" :key="ref.label" class="ref">
        <span class="rk mono">{{ ref.label }}</span>
        <span class="rv mono">{{ ref.value }}</span>
        <span class="rs">{{ ref.note }}</span>
      </div>

      <div class="refhd mono">WHERE IT COMES FROM</div>
      <p v-for="src in SOURCES" :key="src.key" class="src">
        <span class="sk mono">{{ src.key }}</span>
        {{ src.text }}
      </p>

      <p class="prose dim">
        The reference group is Norwegian, and the choice of country is worth most of
        a decade: the American registry puts the average for men in their twenties
        around five points lower, which is roughly fifteen years of fitness age from
        the reference population alone. Norway is used because it is the group the
        equation itself was built on.
      </p>
      <p class="prose dim">
        The equation is accurate to about 5.7 points of VO2max, which through this
        conversion is roughly seventeen years. That is why the figure is capped, and
        why a single year of movement in it means very little.
      </p>
      <p class="prose dim">CALIBRATED {{ CALIBRATED_ON }}.</p>
    </HomeCard>
  </div>
</template>

<script setup>
import { computed } from "vue";
import PageHeader from "@/components/layout/PageHeader.vue";
import HomeCard from "@/components/home/HomeCard.vue";
import { familyColor } from "@/utils/families";
import {
  fitnessAgeBreakdown,
  CALIBRATED_ON,
  COHORT,
  HUNT_MODELS,
} from "@/utils/fitnessAge";
import { SERIES_WEEKS } from "./fitnessAgeModel";

const props = defineProps({
  /** A `ready` result from `fitnessAgeFor`. The card does not open otherwise. */
  result: { type: Object, required: true },
  /** Weekly points from `fitnessAgeSeries`. */
  series: { type: Array, default: () => [] },
  from: { type: String, default: "BODY" },
});
defineEmits(["close"]);

const fam = familyColor("weight");

// The same axis the card uses, so the two marks mean the same thing on both.
const SCALE_MIN = 20;
const SCALE_MAX = 80;
const pct = (v) =>
  Math.max(0, Math.min(100, ((v - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100));

const verdict = computed(() => {
  const gap = props.result.chronologicalAge - props.result.fitnessAge;
  const years = Math.abs(Math.round(gap));
  if (years < 1) return "Your estimated fitness is about average for your age.";
  const who = Math.round(props.result.fitnessAge);
  return gap > 0
    ? `Your estimated fitness matches an average ${who}-year-old.`
    : `Your estimated fitness matches an average ${who}-year-old, which is older than you are.`;
});

const rows = computed(() => {
  const list = fitnessAgeBreakdown(props.result);
  const widest = Math.max(...list.map((r) => Math.abs(r.years)), 1);
  return list.map((row) => {
    const width = (Math.abs(row.years) / widest) * 50;
    return {
      key: row.key,
      label: row.label,
      reading: `${fmt(row.reading)}${row.unit ? ` ${row.unit}` : ""} · ${row.referenceLabel} ${fmt(row.referenceValue)}`,
      years: row.years,
      yearsText: `${row.years < 0 ? "−" : "+"}${Math.abs(row.years).toFixed(1)}y`,
      // Centred on the middle: younger runs left, older runs right, so the
      // direction is read before the number is.
      barStyle:
        row.years < 0
          ? { right: "50%", width: `${width}%` }
          : { left: "50%", width: `${width}%` },
    };
  });
});

function fmt(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "--";
  return Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(1);
}

/**
 * Whether the activity figure came from real samples or from the band's session
 * averages. Said only when it matters, which is when some of it did not.
 */
const measuredNote = computed(() => {
  const activity = props.result.inputsUsed?.activity;
  if (!activity || activity.sessions == null || activity.measuredSessions == null) return "";
  const fell = activity.sessions - activity.measuredSessions;
  if (fell <= 0) return "";
  return `${fell} of ${activity.sessions} sessions are older than the readings Atlas keeps at full detail, so their intensity comes from the band's own average rather than from the samples.`;
});

/** BMI is an acronym; the waist form is a phrase. Only one of them lowercases. */
const bodyWord = computed(() =>
  props.result.form === "waist" ? "waist measurement" : "BMI"
);

/**
 * Two points is not a line.
 *
 * A chart drawn from one week renders a single bar against an empty track, which
 * reads as a broken chart rather than as a short history - the same reason
 * `RangeMark` renders nothing until its window fills.
 */
const MIN_SERIES_POINTS = 3;
const hasSeries = computed(
  () => props.series.filter((p) => p.value != null).length >= MIN_SERIES_POINTS
);

// Scaled to the series' own spread rather than to the age axis: twelve weeks of
// a capped figure move by a year or two, and drawn from 20 that is twelve
// identical bars.
const bounds = computed(() => {
  const vals = props.series.map((p) => p.value).filter((v) => v != null);
  if (!vals.length) return { lo: 0, hi: 1 };
  const lo = Math.min(...vals), hi = Math.max(...vals);
  // A flat series still needs a height, or every bar renders at zero.
  return hi - lo < 1 ? { lo: lo - 1, hi: hi + 1 } : { lo, hi };
});
const barPct = (v) => {
  const { lo, hi } = bounds.value;
  // Inverted: a LOWER fitness age is better, so a taller bar has to mean younger.
  return Math.max(6, ((hi - v) / (hi - lo)) * 100);
};

/** The reference person, read off the result so it cannot state a stale figure. */
const references = computed(() => {
  const r = props.result.reference ?? {};
  const cohort = COHORT[props.result.sex] ?? {};
  return [
    {
      label: "BODY",
      value: `${fmt(r.body?.value)}${r.body?.unit ? ` ${r.body.unit}` : ""}`,
      note: `${r.body?.referenceLabel ?? ""}, measured as ${bodyWord.value}.`,
    },
    {
      label: "RESTING HEART RATE",
      value: `${fmt(r.restingHr?.value)} BPM`,
      note: r.restingHr?.label ?? "",
    },
    {
      label: "ACTIVITY",
      value: `${fmt(r.pa?.value)} OF 45`,
      note: `${r.pa?.label ?? ""}, on the study's own activity index.`,
    },
    {
      label: "THE GROUP ITSELF",
      value: `${cohort.age?.toFixed?.(1) ?? "--"} YEARS`,
      note: "The average participant's age. The reference above is the group's overall average, not an average person of your age.",
    },
  ];
});

/**
 * Where each number came from. Hand-written because a citation is not derivable,
 * but the coefficients they describe are read live above, so a source that stops
 * matching the model is visible rather than silent.
 */
const SOURCES = [
  {
    key: "THE EQUATION",
    text: `Nes BM et al., "Estimating VO2peak from a nonexercise prediction model: the HUNT Study, Norway." Med Sci Sports Exerc 2011;43(11):2024-2030. 4,637 healthy adults with treadmill-measured VO2peak. The ${HUNT_MODELS.bmi.label.toLowerCase()} form is the same model refitted, quoted in the HUNT group's later work.`,
  },
  {
    key: "THE REFERENCE GROUP",
    text: 'The same study\'s own averages, Table 1. The activity figure is solved from the published means rather than looked up, because the paper prints a different index.',
  },
  {
    key: "AVERAGE FITNESS BY AGE",
    text: 'Loe H et al., "Aerobic Capacity Reference Data in 3816 Healthy Men and Women 20-90 Years." PLoS ONE 2013;8(5):e64319. Shown for context; the years conversion uses the equation itself.',
  },
  {
    key: "MAXIMUM HEART RATE",
    text: 'Nes BM et al., "Age-predicted maximal heart rate in healthy subjects: The HUNT Fitness Study." Scand J Med Sci Sports 2013;23(6):697-704. 211 minus 0.64 times your age, predicted rather than observed.',
  },
  {
    key: "EXERCISE INTENSITY",
    text: "The American College of Sports Medicine's classification by share of maximum heart rate: light 57-63%, moderate 64-76%, vigorous 77-95%.",
  },
];
</script>

<style scoped>
.hero {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.hero .n {
  font-size: 52px;
  line-height: 1;
  font-weight: 500;
  letter-spacing: -1px;
  color: var(--ink);
}
/* Outside the 52px string, the same rule MetricPage's hero follows: a unit set
   at that size is a visibly different object from the number. */
.hero .u {
  font-size: 20px;
  letter-spacing: 1.5px;
  color: var(--dim);
}
.verdict {
  margin: 8px 0 0;
  font-size: var(--fs-body);
  line-height: 1.45;
  color: var(--body);
}
.sub {
  margin-top: 6px;
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  color: var(--dim);
}
.scale {
  margin-top: 14px;
}
.track {
  position: relative;
  height: 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--dim) 22%, transparent);
}
.mark {
  position: absolute;
  top: -4px;
  width: 2px;
  height: 14px;
  border-radius: 1px;
}
.mark.you {
  background: v-bind(fam);
}
.mark.age {
  background: var(--dim);
}
.ends {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  color: var(--dim);
}
.legend {
  display: flex;
  gap: 14px;
  margin-top: 7px;
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  color: var(--dim);
}
.sw {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin-right: 5px;
}
.sw.you {
  background: v-bind(fam);
}
.sw.age {
  background: var(--dim);
}

.item {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 10px;
  padding: 10px 0;
  border-top: 1px solid var(--panel-line);
}
.item:first-of-type {
  border-top: none;
  padding-top: 2px;
}
.item .k {
  font-size: var(--fs-label);
  letter-spacing: 1.4px;
  color: var(--ink);
}
.item .y {
  font-size: var(--fs-body);
  text-align: right;
}
.item .y.down {
  color: var(--good);
}
.item .y.up {
  color: var(--bad);
}
.item .v {
  grid-column: 1 / 2;
  font-size: var(--fs-micro);
  letter-spacing: 1.1px;
  color: var(--dim);
}
.bar {
  grid-column: 1 / 3;
  position: relative;
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--dim) 20%, transparent);
  margin-top: 7px;
}
.bar span {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  background: v-bind(fam);
}
.bar span.over {
  background: var(--bad);
}
.note {
  margin: 12px 0 0;
  font-size: var(--fs-micro);
  line-height: 1.6;
  letter-spacing: 1.1px;
  color: var(--dim);
}
.prose {
  margin: 0 0 10px;
  font-size: var(--fs-body);
  line-height: 1.5;
  color: var(--body);
}
.prose:last-child {
  margin-bottom: 0;
}
.prose.dim {
  color: var(--dim);
  font-size: var(--fs-micro);
  line-height: 1.6;
  letter-spacing: 0.2px;
}

.hist {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 60px;
}
.col {
  flex: 1;
  display: flex;
  align-items: flex-end;
  height: 100%;
}
.col .fill {
  width: 100%;
  border-radius: 1px;
  background: color-mix(in srgb, v-bind(fam) 55%, transparent);
}
.col.now .fill {
  background: v-bind(fam);
}

.refhd {
  margin: 14px 0 8px;
  font-size: var(--fs-micro);
  letter-spacing: 2px;
  color: var(--dim);
}
.ref {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 10px;
  padding: 8px 0;
  border-top: 1px solid var(--panel-line);
}
.ref .rk {
  font-size: var(--fs-label);
  letter-spacing: 1.4px;
  color: var(--ink);
}
.ref .rv {
  font-size: var(--fs-label);
  letter-spacing: 1.1px;
  color: var(--ink);
  text-align: right;
}
.ref .rs {
  grid-column: 1 / 3;
  font-size: var(--fs-micro);
  line-height: 1.5;
  color: var(--dim);
}
.src {
  margin: 0 0 10px;
  font-size: var(--fs-micro);
  line-height: 1.6;
  color: var(--dim);
}
.src .sk {
  display: block;
  letter-spacing: 1.6px;
  color: var(--body);
  margin-bottom: 2px;
}
</style>
