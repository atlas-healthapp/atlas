<template>
  <!-- Option A of three, with option E's provisional state folded in rather
       than built as a separate card: the two differ by one qualifier and a
       dimmed hero, and two components would drift the moment either changed. -->
  <HomeCard title="FITNESS AGE" :meta="meta" :color="famColor('weight')">
    <template v-if="result.state === 'ready'">
      <!-- **The way in, and only in the ready state.** Everything else on BODY
           opens something, so a card that never did read as broken; but a
           withheld figure has nothing to explain that the card is not already
           saying. A button rather than a click handler on the card, so it is
           reachable by keyboard and announces itself. -->
      <div class="hero">
        <span class="n" :class="{ soft: result.provisional }">{{ shown }}</span>
        <span v-if="qualifier" class="u mono">{{ qualifier }}</span>
      </div>

      <p class="verdict">{{ verdict }}</p>

      <!-- The age scale. `you` is where the figure sits, `me` where the reader
           actually is, and both are placed on the same track so the gap is the
           distance between two marks rather than a number to be trusted. -->
      <div class="scale">
        <div class="track">
          <span class="youmark" :style="{ left: `${pct(shownAge)}%` }"></span>
          <span
            class="agemark"
            :style="{ left: `${pct(result.chronologicalAge)}%` }"
          ></span>
        </div>
        <!-- **The ends label the track; a legend labels the marks.** The first
             version put "YOU ARE 32" in the middle cell of this row, which is
             centred by the flex layout and therefore sat at the middle of a
             scale running 20 to 80 - so a 32-year-old's mark appeared to be at
             50. The marks are not labelled in place either: six years is a
             tenth of this track, and RecoveryPage already learned that
             absolutely positioned labels on a strip collide. -->
        <div class="scalelabels mono">
          <span>{{ SCALE_MIN }}</span>
          <span>{{ SCALE_MAX }}</span>
        </div>
        <div class="legend mono">
          <span class="key"><i class="swatch you"></i>YOU {{ shown }}</span>
          <span class="key"
            ><i class="swatch age"></i>YOUR AGE
            {{ Math.round(result.chronologicalAge) }}</span
          >
        </div>
      </div>

      <div class="items">
        <div v-for="row in rows" :key="row.key" class="item">
          <span class="k mono">{{ row.label }}</span>
          <span class="v mono">{{ row.reading }}</span>
          <span class="y mono" :class="row.years < 0 ? 'down' : 'up'">{{
            row.yearsText
          }}</span>
        </div>
      </div>

      <!-- **Two footnotes lived here and both came off on the user's call
           (2026-08-14): the cap explanation and the cohort caveat.** They said
           true and load-bearing things - that the rows sum to the uncapped
           figure, and that the reference population is Norwegian - but four
           lines of qualifier under a three-row card reads as hedging, and a
           caveat nobody finishes is not a disclosure. Both belong on the
           drill-through when it exists, in the collapsed WHAT THIS IS block
           MetricPage already uses for exactly this. Do not quietly reinstate
           them here; the reason they were removed was the position, not the
           content. -->

      <!-- **One way in, and it is the row** (settled 2026-08-26 after four
           versions). A dim `WHY` under the verdict read as a footnote; a chevron
           beside the 52px hero competed with the number it was meant to serve; a
           chevron in the header with the whole card tappable was built and then
           pulled on the user's call, because two affordances on one card is one
           more than it needs and the header one had nothing to label itself with.
           A labelled row at the foot says what it opens, which is the thing none
           of the others could do. -->
      <button class="opener" type="button" @click.stop="$emit('open')">
        <span class="olabel mono">DETAILS</span>
        <span class="ocar" aria-hidden="true">&rsaquo;</span>
      </button>
    </template>

    <!-- Option D: below the floor there is genuinely nothing to say, so it
         counts down rather than showing a number that would move by a decade. -->
    <template v-else-if="waiting">
      <div class="hero"><span class="n dimmed">--</span></div>
      <p class="verdict dim">{{ waiting }}</p>
    </template>

    <template v-else>
      <div class="hero"><span class="n dimmed">--</span></div>
      <p class="verdict dim">{{ blockedText }}</p>
    </template>
  </HomeCard>
</template>

<script setup>
/**
 * Fitness age on BODY, above TODAY.
 *
 * The layout is option A of the three mocked up: **the age leads**, itemisation
 * underneath, closest to how MetricPage opens. Option E, a provisional figure
 * with its caveat rather than a blank month, is the same card with the hero
 * softened and a qualifier, because the two are one state apart.
 *
 * **This component is template-shaped and cannot be unit tested here** - there
 * is no Vue test harness in this repo. Everything with a judgement in it lives
 * in fitnessAgeModel.js and fitnessAge.js, both of which are tested; what is
 * left is layout and wording, and those can only be checked by running it.
 */
import { computed } from "vue";
import HomeCard from "@/components/home/HomeCard.vue";
import { familyColor as famColor } from "@/utils/families";
import {
  fitnessAgeBreakdown,
  MIN_RESTING_HR_DAYS,
  PROVISIONAL_MIN_DAYS,
} from "@/utils/fitnessAge";

defineEmits(["open"]);

const props = defineProps({
  /** Whatever `fitnessAgeFor` returned. */
  result: { type: Object, required: true },
});

/** The span the scale draws. Wide enough that an ordinary gap is visible on it. */
const SCALE_MIN = 20;
const SCALE_MAX = 80;

const shownAge = computed(() => props.result.fitnessAge ?? 0);
const shown = computed(() => Math.round(shownAge.value));

/** Where an age sits on the fixed scale, clamped so a mark cannot leave it. */
function pct(age) {
  const at = ((age - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
  return Math.max(1, Math.min(99, at));
}

/**
 * **The form label came off on 2026-08-27.** It sat in the header saying `BMI`,
 * which is the body form the model used - and the body row itself left the card
 * a day earlier, so the label was qualifying a row that is no longer here. A
 * header slot naming an input the card does not show reads as a category for the
 * whole card, which fitness age is not. It is still on the drill-through, beside
 * the reading it belongs to. PROVISIONAL stays: that one is about the figure in
 * the hero, which is what a header meta is for.
 */
const meta = computed(() => {
  if (props.result.state !== "ready") return "";
  return props.result.provisional ? "PROVISIONAL" : "";
});

const qualifier = computed(() => (props.result.provisional ? "SO FAR" : ""));

const verdict = computed(() => {
  const r = props.result;
  const gap = Math.abs(Math.round(r.gap ?? 0));
  const direction = (r.gap ?? 0) < 0 ? "younger" : "older";

  if (r.provisional) {
    const left = r.settlesAfterDays;
    const days = left === 1 ? "day" : "days";
    return `Built on ${r.restingHrDays} nights of the ${MIN_RESTING_HR_DAYS} it wants. It can still move: ${left} ${days} to go.`;
  }
  // An exact match is worth saying outright rather than rendering as "0 years
  // older", which reads as a rounding artifact.
  if (gap === 0)
    return "Your estimated fitness is what is average for your age.";
  // "than you" came off on 2026-08-27: it is already implied by younger, and
  // the scale directly under this marks your real age beside the figure.
  return `Your estimated fitness matches somebody ${gap} ${
    gap === 1 ? "year" : "years"
  } ${direction}.`;
});

/**
 * The card's itemised rows.
 *
 * **BODY is not among them, on the user's call (2026-08-26).** It is by far the
 * largest term - measured, -15.4 years against -2.7 and +4.9 for the other two -
 * and a single line reading `BMI 21.2 vs 26.6` invites exactly the question the
 * card has no room to answer: whether one BMI unit really is worth 2.9 years of
 * fitness age. It is not hidden, it leads the same itemisation on the
 * drill-through, where the reference, the cohort and the error bar are all beside
 * it. See `fitnessAgeBreakdown` for the arithmetic.
 */
const CARD_ROWS = ["pa", "restingHr"];

const rows = computed(() =>
  fitnessAgeBreakdown(props.result)
    .filter((row) => CARD_ROWS.includes(row.key))
    .map((row) => ({
      key: row.key,
      label: row.label,
      // Both sides of the comparison, because a reading with no reference beside
      // it cannot say which way it counted. The unit rides on the reading rather
      // than on the reference, or the row reads as two different quantities.
      reading: `${fmt(row.reading)}${row.unit ? ` ${row.unit}` : ""} vs ${fmt(
        row.referenceValue
      )}`,
      years: row.years,
      yearsText: `${row.years < 0 ? "−" : "+"}${Math.abs(row.years).toFixed(
        1
      )}`,
    }))
);

function fmt(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "--";
  return Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(1);
}

/** Counting down to the floor, which is the shape option D asked for. */
const waiting = computed(() => {
  const r = props.result;
  if (r.state !== "withheld") return "";
  if (r.reason === "calibrating-resting-hr") {
    const left = Math.max(0, PROVISIONAL_MIN_DAYS - (r.days ?? 0));
    return `Needs ${PROVISIONAL_MIN_DAYS} nights of resting heart rate before it can say anything. ${
      r.days ?? 0
    } so far.`;
  }
  if (r.reason === "calibrating-activity") {
    return `Needs ${r.needed} days of activity history. ${r.days ?? 0} so far.`;
  }
  return "";
});

/**
 * The refusals that are about a missing field rather than about time.
 *
 * Each one names the field, because "unavailable" sends somebody to Settings to
 * hunt for which of six things is missing.
 */
const blockedText = computed(() => {
  const r = props.result;
  const reasons = {
    "no-age": "Add your date of birth in Settings.",
    "no-sex":
      "Add your sex in Settings. The model has different coefficients for each.",
    "no-body": "Add your height in Settings, and log a weight.",
    "stale-weight": `The last weight is ${r.weightDaysOld} days old. Log a current one.`,
    "no-resting-hr": "No resting heart rate from the strap yet.",
    "no-activity": "No sessions with a heart rate yet.",
    "no-bmi": "That height and weight do not give a believable BMI.",
    "no-waist": "That waist measurement is outside what the model can take.",
  };
  return reasons[r.reason] ?? "Not enough to work from yet.";
});
</script>

<style scoped>
/* The card's last row. Full width and at the app's row height so it is a target
   rather than a line of text, hairline above because it is a different kind of
   thing from the readings it follows, and in the family colour so it belongs to
   this card rather than reading as a generic link. */
.opener {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: var(--row-h);
  margin-top: 10px;
  padding: 0;
  background: none;
  border: none;
  border-top: 1px solid var(--panel-line);
  text-align: left;
  cursor: pointer;
}
.olabel {
  font-size: var(--fs-label);
  letter-spacing: 1.6px;
  color: v-bind("famColor('weight')");
}
/* The same chevron the header carries and every openable row in Atlas uses. */
.ocar {
  font-size: 19px;
  line-height: 1;
  color: var(--dim);
}
/* The hero is MetricPage's shape: a bare number at 52px with the qualifier set
   out beside it at 20. Setting the qualifier inside the same string makes a
   visibly different object of the number, which is why they are two spans. */
.hero {
  display: flex;
  align-items: baseline;
  gap: 9px;
}
.n {
  font-size: 52px;
  font-weight: 700;
  line-height: 0.92;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
/* Softened rather than greyed: a provisional figure is a real reading and
   should not look like a disabled control. */
.n.soft {
  opacity: 0.72;
}
.n.dimmed {
  color: var(--dim);
}
.u {
  font-size: 20px;
  letter-spacing: 2px;
  color: var(--dim);
}
.verdict {
  font-size: 15.5px;
  line-height: 1.5;
  margin: 11px 0 0;
  color: var(--body);
}
.verdict.dim {
  color: var(--dim);
}

.scale {
  margin-top: 15px;
}
.track {
  position: relative;
  height: 5px;
  border-radius: 3px;
  background: linear-gradient(
    90deg,
    var(--rec-great),
    var(--rec-good) 32%,
    var(--rec-okay) 64%,
    var(--rec-low)
  );
  opacity: 0.85;
}
/* Standing above the line rather than sitting on it, the same reasoning as
   RangeMark's caret: a dot on a rounded track reads as a slider. */
.youmark {
  position: absolute;
  top: -7px;
  width: 2px;
  height: 19px;
  background: var(--ink);
  border-radius: 1px;
}
.agemark {
  position: absolute;
  top: -3px;
  width: 1px;
  height: 11px;
  background: color-mix(in srgb, var(--ink) 55%, transparent);
}
.scalelabels {
  display: flex;
  justify-content: space-between;
  margin-top: 7px;
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--dim);
}
.legend {
  display: flex;
  gap: 16px;
  margin-top: 6px;
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--dim);
}
.key {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
/* The same two marks as the track above, at row size, so the legend is read as
   a key rather than as decoration. */
.swatch {
  display: inline-block;
  width: 2px;
  height: 10px;
  border-radius: 1px;
}
.swatch.you {
  background: var(--ink);
}
.swatch.age {
  width: 1px;
  background: color-mix(in srgb, var(--ink) 55%, transparent);
}

.items {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
}
.item {
  display: grid;
  grid-template-columns: 74px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 9px 0;
  border-top: 1px solid var(--panel-line);
  font-size: 14px;
  letter-spacing: 0.5px;
}
.item:first-child {
  border-top: none;
}
.item .k {
  color: var(--dim);
}
.item .v {
  color: var(--body);
  font-variant-numeric: tabular-nums;
}
.item .y {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  text-align: right;
}
.y.down {
  color: var(--rec-good);
}
.y.up {
  color: var(--rec-low);
}
</style>
