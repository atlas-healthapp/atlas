// Atlas's own sleep score.
//
// The band already prints one, and this does not replace it: Home's dial keeps
// the band's number until this has earned it. The reason for building one at all
// is that ours can show its working and the band's never can, which is the same
// thesis RecoveryPage is built on.
//
// The weights, and why (in full in
// docs/superpowers/specs/2026-08-04-sleep-page-design.md):
//
//   Duration      40   Strongest and least contested link to outcomes.
//   Regularity    25   Windred et al. 2024: regularity predicted all-cause
//                      mortality better than duration did.
//   Continuity    25   Time awake inside the night, and how often. Efficiency
//                      was the third part and was removed once the real archive
//                      showed the band cannot measure it; see CONTINUITY_SHARE.
//   Composition   10   Deliberately small. The outcome evidence is weaker than
//                      the other three and consumer stage classification is
//                      itself noisy; weighting it heavily would be astrology
//                      with a decimal point.
//
// No HRV or resting-HR term. Recovery already scores both, and double-counting
// means one bad night hits you twice in two places with neither screen able to
// explain why.

import { sleepRegularityIndex, SRI_MIN_NIGHTS } from "@/utils/sleepRegularity";
import { stageMinutes, asleepMinutes } from "@/utils/sleepStages";
import { fmtHoursMins } from "@/utils/date";

/**
 * Reweighted 2026-08-07, and the move is off regularity rather than onto
 * duration for its own sake.
 *
 * Regularity is a property of the *week*, not of the night: it barely changed
 * night to night on the real archive except when the week's pattern shifted,
 * and with duration and continuity both effectively pinned it was supplying most
 * of the variation in a number that claims to describe one night. Today's 98 was
 * largely "your week has been regular", which is true and is not an answer to
 * "how did I sleep".
 *
 * So it drops to 15, duration takes 50 now that it varies across real nights
 * again, and continuity keeps 25 now that its thresholds let it move.
 */
export const SLEEP_WEIGHTS = {
  duration: 0.5,
  regularity: 0.15,
  continuity: 0.25,
  composition: 0.1,
};

/**
 * Full marks between these two, tailing off on both sides.
 *
 * **The upper edge has now been removed once and put back, and the reason it is
 * back is better than the reason it went.** It was dropped because wrist
 * wearables overestimate total sleep time (30-60 minutes in the validation
 * studies) and because the long-sleep epidemiology behind an oversleep penalty
 * is confounded by reverse causation: the ten-hour sleepers in those cohorts
 * were largely people already unwell. Both still hold as arguments against
 * penalising oversleep *in general*.
 *
 * What overrides them is this user's own reading of his own nights (2026-08-07):
 * a 9h+ figure here is usually a real wake followed by dozing rather than nine
 * consolidated hours, and he does not experience those nights as good ones. That
 * is direct evidence about this device on this wrist, which beats a population
 * statistic about other people.
 *
 * **The right fix is not this one**, and that is worth knowing before touching
 * it again. A consolidated ten-hour night and a broken one deserve different
 * scores, and telling them apart is continuity's job. Continuity cannot do it
 * here: measured across 16 real nights the band reports 0 awakenings on 11 of
 * them and total awake minutes between 1 and 28, so its stage summary claims
 * nearly every night was unbroken. Until fragmentation is derived from the raw
 * heart-rate and movement samples instead, duration is standing in for it. See
 * docs/backlog.md.
 */
// The guideline band itself: NSF and AASM both say 7 to 9 hours for adults. These
// two numbers are clinical and are used in three places that must agree - the
// adequacy curve, the clamp on the habitual median, and the wording of the
// duration row's reference.
export const DURATION_FULL = 7;
export const DURATION_LONG_FULL = 9;
/** Below this a night scores nothing for duration. */
const DURATION_FLOOR = 3.5;

/**
 * Duration against the guidelines' own tiers rather than one straight line.
 *
 * The NSF's adult recommendation is 7-9 hours, with 6-10 "may be appropriate"
 * and under 6 not recommended; the AASM puts its line at 7 or more. A single
 * ramp from 3.5 to 7.5 flattened all of that: it scored a 6h 37m night at 0.78,
 * which was high enough to leave the night labelled EXCELLENT once the other
 * three terms came in well, and a night that short is not excellent whatever
 * else it did.
 *
 * These are the guidelines' own boundaries, with a gradient inside each tier so
 * a night is never scored by which side of a line it fell on.
 */
/**
 * Absolute adequacy: full marks anywhere inside the guideline band.
 *
 * **This is the clinical figure, not a personal goal, and it does not move.** The
 * NSF and AASM both put the adult recommendation at 7 to 9 hours. An earlier
 * version gave full marks only from 8h, taken from this user's own
 * `GOALS.sleep`, which meant anyone habitually sleeping 7.5 hours and meeting
 * the guidelines was docked forever. That is wrong for him and unreleasable for
 * anyone else.
 *
 * What makes a 6h 36m night read badly for *this* user is the personal half
 * below, not this curve.
 */
const DURATION_CURVE = [
  [DURATION_FLOOR, 0],
  [5, 0.12],
  [6, 0.32],
  [6.5, 0.6],
  [DURATION_FULL, 1], // 7h: the guidelines' floor
  [DURATION_LONG_FULL, 1], // 9h: their ceiling
  [9.5, 0.88],
  [10, 0.72],
  [11, 0.5],
  [24, 0.4],
];

/**
 * How many nights before a personal figure is trusted at all.
 *
 * Under this, the score is the guideline band alone, which is the right answer
 * for a new user: it says nothing it cannot support and it never punishes someone
 * for a night that is normal for them.
 */
export const HABITUAL_MIN_NIGHTS = 7;

/** How many recent nights the habitual figure is taken over. */
export const HABITUAL_NIGHTS = 14;

/** Within half an hour of your usual night is your usual night. */
const HABITUAL_FULL_MARGIN = 0.5;

/** Falling this far below your usual night empties the personal half of the term. */
const HABITUAL_DEFICIT_SPAN = 2.5;

/**
 * And this far above it, which is deliberately wider.
 *
 * Both sides are penalised, because the user's point holds in both directions: if
 * your median is solidly eight hours then seven should read slightly worse than
 * eight, and so should nine, even though all three sit inside the clinical band.
 *
 * Wider above than below because the asymmetry is real. Two hours short of your
 * usual night is a deficit you feel; two hours over is mostly a lie-in, and on
 * this strap often a wake-then-doze rather than a catastrophe.
 */
const HABITUAL_SURPLUS_SPAN = 4;

/**
 * Your habitual night, **clamped into the guideline band**, or null until there
 * are enough nights to say.
 *
 * The clamp is the whole idea and it came from the user (2026-08-07). A median
 * inside 7-9h becomes the target, so a habitual seven-hour sleeper is not marked
 * down for sleeping seven hours. A median *above* nine does not become the
 * target, because then a long sleeper would be rewarded for matching a figure
 * that is itself too long: the goal there is to come down, so the target stops at
 * nine. Same at the bottom.
 *
 * Median rather than mean, so one 1h fragment of a night cannot drag it.
 */
export function habitualHours(nightlyHours) {
  const usable = (nightlyHours ?? [])
    .filter((h) => typeof h === "number" && Number.isFinite(h) && h > 0)
    .slice(-HABITUAL_NIGHTS)
    .sort((a, b) => a - b);
  if (usable.length < HABITUAL_MIN_NIGHTS) return null;
  const mid = Math.floor(usable.length / 2);
  const median = usable.length % 2 ? usable[mid] : (usable[mid - 1] + usable[mid]) / 2;
  return {
    hours: Math.max(DURATION_FULL, Math.min(DURATION_LONG_FULL, median)),
    /**
     * How much to trust it, 0..1, from the count of nights behind it.
     *
     * "Once the median is solid" was the user's condition, and a hard switch at
     * seven nights would have the score lurch overnight on the day the seventh
     * arrived. This ramps its influence from a half at the minimum to full at a
     * fortnight, so the personal half of the term fades in as the evidence for it
     * does.
     */
    confidence: Math.min(1, usable.length / HABITUAL_NIGHTS),
    nights: usable.length,
  };
}

/**
 * Continuity, and why efficiency is not in it.
 *
 * Sleep efficiency is time asleep over time *in bed*, and the band never
 * reports time in bed: its session starts at sleep onset and ends at final
 * waking, so the stage totals sum to exactly the bedtime-to-waketime span.
 * Computing asleep/(asleep+awake) from that is arithmetically pinned near 1 - it
 * measured 95-99.8% on all 13 nights of the real archive - and it is not the
 * quantity the literature means by efficiency. It carried half of continuity's
 * weight, which made 12.5 of the score's 100 points a constant.
 *
 * WASO and awakenings survive: both are National Sleep Foundation continuity
 * indicators (Ohayon et al. 2017) and both are measurable here. Their thresholds
 * are NOT the NSF's, though, and that is the point. The NSF numbers (20 min
 * WASO, awakenings past two) come from polysomnography, while this class of
 * device underestimates WASO by 12-48 minutes against PSG. Applying a PSG
 * threshold to a device-derived reading guarantees full marks, which is exactly
 * what the archive showed. These are shifted down by roughly the published bias.
 */
// Tightened again 2026-08-07, for the same reason they were shifted once
// already, now with the archive to measure against rather than a published bias
// to estimate from. At 10/30 and 1/4 continuity scored a full 100 on 10 of 16
// real nights, so a quarter of the score was another near-constant. These numbers
// are set where the archive's own better and worse nights actually separate.
const WASO_FULL = 5;
const WASO_FLOOR = 45;
const AWAKENINGS_FULL = 0;
const AWAKENINGS_FLOOR = 3;
/**
 * An awake run shorter than this is a turn over, not an awakening.
 *
 * Three, not the NSF's five. The NSF threshold comes from polysomnography, and
 * on this device a five-minute floor discarded so much that the count read 0 on
 * 11 of 16 nights, including every long night. The user's own complaint is that
 * he notices waking up on exactly those nights, so a rule that reports none of
 * them is measuring the threshold rather than the night.
 */
const AWAKENING_MIN_MINUTES = 3;

/** How continuity splits now that efficiency is gone. */
const CONTINUITY_SHARE = { waso: 0.6, awakenings: 0.4 };

/**
 * Where the regularity term's scale comes from.
 *
 * Windred et al. 2024 measured the SRI across 60,977 UK Biobank participants:
 * median 81.0, interquartile range 73.8 to 86.3, with the excess all-cause
 * mortality concentrated in the bottom quintile (below 71.6) and the benefit
 * *plateauing* above it rather than continuing to climb. So the informative
 * range is narrow and sits in a specific place.
 *
 * Scoring sri/100 ignored both facts. It is linear where the dose-response is
 * not, and it spends most of its range on SRI values nobody records: the real
 * archive ran 76 to 87, which is the population's 25th percentile to past its
 * 75th, and the linear mapping flattened all of it into 19-22 points out of 25.
 * Anchoring on the published distribution puts the term's sensitivity where the
 * evidence says the difference actually is.
 */
const SRI_FLOOR = 71.6;
const SRI_FULL = 86.3;
/** The population median, shown so an SRI reading means something on its own. */
const SRI_TYPICAL = 81;

/** PSG reference bands, deep and REM as a share of time asleep. */
const DEEP_BAND = [0.1, 0.2];
const REM_BAND = [0.2, 0.25];

/**
 * The bands, and the ramp the page's scale strip is drawn in.
 *
 * Recovery's tokens, deliberately reused. They are a semantic ramp rather than a
 * family - bad to good - which is exactly what a score scale needs, and the two
 * scores never share a screen: Recovery has its own page, and nothing on this
 * one is green for any other reason. Minting a second red-to-green ramp would be
 * two answers to the same question, and the existing one is already measured
 * against the colour-blindness tests in families.test.js.
 */
export const SLEEP_BANDS = [
  // GREAT, not EXCELLENT. The word changed 2026-08-10 when the scale strip moved
  // from thresholds to names to match Recovery's: nine letters do not fit the 15%
  // of the track this band owns, and the two scores already share this exact
  // colour ramp deliberately, so sharing its top word costs nothing and stops the
  // same position being called two things on two screens.
  { min: 85, label: "GREAT", token: "--rec-great" },
  { min: 70, label: "GOOD", token: "--rec-good" },
  { min: 50, label: "FAIR", token: "--rec-okay" },
  { min: 0, label: "POOR", token: "--rec-low" },
];

/** The whole scale as segments, for the strip that places a score on it. */
export function sleepScaleBands(label) {
  const asc = [...SLEEP_BANDS].sort((a, b) => a.min - b.min);
  return asc.map((b, i) => ({
    ...b,
    start: b.min,
    width: (asc[i + 1]?.min ?? 100) - b.min,
    color: `var(${b.token})`,
    ink: `var(${b.token}-ink)`,
    current: b.label === label,
  }));
}

/**
 * The top band needs a night of at least this long, whatever else it did.
 *
 * Duration carries 40 of the 100 points, which sounds decisive and is not: a
 * 6h 37m night with perfect continuity, composition and regularity still scored
 * 87 and came out EXCELLENT. Steepening the duration curve cannot fix that,
 * because the other 60 points are enough on their own. So the floor is a rule
 * about the label rather than a weight: the AASM's line is seven hours, and a
 * night under it is not an excellent night however well the rest of it went.
 *
 * The score is deliberately NOT capped with it. The four terms have to keep
 * adding up to the number on the page, and a headline that quietly disagreed
 * with the rows underneath is the kind of thing this file exists to avoid.
 * The band moves, the arithmetic stays honest, and the sentence says why.
 */
export const TOP_BAND_MIN_HOURS = 7;

function bandBelow(label) {
  const i = SLEEP_BANDS.findIndex((b) => b.label === label);
  return (SLEEP_BANDS[i + 1] ?? SLEEP_BANDS.at(-1)).label;
}

export function sleepLabel(score, hours = null) {
  if (score == null) return null;
  const band = (SLEEP_BANDS.find((b) => score >= b.min) ?? SLEEP_BANDS.at(-1)).label;
  const isTop = band === SLEEP_BANDS[0].label;
  if (isTop && hours != null && hours < TOP_BAND_MIN_HOURS) return bandBelow(band);
  return band;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Linear from 0 at `floor` to 1 at `full`, in whichever direction they run. */
function ramp(value, floor, full) {
  if (floor === full) return value >= full ? 1 : 0;
  return clamp01((value - floor) / (full - floor));
}

/** Full marks inside the band, tailing off either side of it. */
function bandScore(value, [low, high], { floor, ceiling }) {
  if (value >= low && value <= high) return 1;
  if (value < low) return ramp(value, floor, low);
  return ramp(value, ceiling, high);
}

/**
 * Duration, as the worse of two judgements rather than an average of them.
 *
 *  - **Adequacy**, against the guideline band. Absolute, never moves.
 *  - **Deficit**, against your own habitual night once there are enough of them.
 *
 * `Math.min`, not a blend, because they answer different questions and a night
 * has to pass both. Blending them let a 6h 36m night average its way back up to
 * a respectable figure, which is the thing the user objected to in the first
 * place. Taking the worse of the two means:
 *
 *  - a habitual 7h sleeper who sleeps 7h scores full, since both agree;
 *  - a habitual 9h+ sleeper who sleeps 6h 36m scores badly, because the deficit
 *    is 2.4 hours even though 6h 36m is only just under the guideline;
 *  - **a long night is docked whatever the habit**, because the target is clamped
 *    at nine, so the deficit half can never excuse it and adequacy always sees it.
 *
 * @param habitual clamped median from {@link habitualHours}, or null while there
 *                 are too few nights to have one.
 */
export function durationTerm(hours, habitual = null) {
  if (hours == null) return null;
  if (hours <= DURATION_FLOOR) return 0;

  // Past the end of the curve rather than past full marks: the curve runs both
  // sides of the band, so an early return at DURATION_FULL would give a twelve
  // hour night the same score as an eight hour one.
  const adequacy =
    hours >= DURATION_CURVE.at(-1)[0]
      ? DURATION_CURVE.at(-1)[1]
      : (() => {
          const i = DURATION_CURVE.findIndex(([h]) => hours < h);
          const [loH, loV] = DURATION_CURVE[i - 1];
          const [hiH, hiV] = DURATION_CURVE[i];
          return loV + (hiV - loV) * ramp(hours, loH, hiH);
        })();

  if (habitual == null) return adequacy;

  const target = typeof habitual === "number" ? habitual : habitual.hours;
  const confidence = typeof habitual === "number" ? 1 : (habitual.confidence ?? 1);
  if (target == null) return adequacy;

  // Both sides of your usual night, not just below it. Inside the clinical band a
  // seven hour night against an eight hour habit still reads slightly worse than
  // eight, which is the point: the band says whether the night was adequate for a
  // human, this says whether it was normal for you.
  const shortBy = target - HABITUAL_FULL_MARGIN - hours;
  const overBy = hours - (target + HABITUAL_FULL_MARGIN);
  let personal = 1;
  if (shortBy > 0) personal = clamp01(1 - shortBy / HABITUAL_DEFICIT_SPAN);
  else if (overBy > 0) personal = clamp01(1 - overBy / HABITUAL_SURPLUS_SPAN);

  // Faded in with the evidence rather than switched on at the seventh night, so
  // the score does not lurch on the day the median becomes available.
  const weighted = 1 - confidence * (1 - personal);
  return Math.min(adequacy, weighted);
}

/**
 * Times woken during the night.
 *
 * A run at the very end is not an awakening, it is getting up, and counting it
 * would charge every single night one it did not have. Short runs are dropped
 * too: three minutes of "awake" between two light stages is a turn over, and the
 * band reports plenty of them.
 */
export function awakeningCount(timeline) {
  if (!timeline?.length) return null;
  return timeline.filter(
    (seg, i) =>
      seg.stage === "awake" && seg.minutes >= AWAKENING_MIN_MINUTES && i < timeline.length - 1
  ).length;
}

export function continuityTerm(stages) {
  const asleep = asleepMinutes(stages);
  if (!asleep) return null;

  const waso = stageMinutes(stages, "awake");
  const parts = [[CONTINUITY_SHARE.waso, ramp(waso, WASO_FLOOR, WASO_FULL)]];

  // No timeline means no awakening count, so that slice goes to WASO rather
  // than being assumed perfect.
  const awakenings = awakeningCount(stages?.timeline);
  if (awakenings != null) {
    parts.push([CONTINUITY_SHARE.awakenings, ramp(awakenings, AWAKENINGS_FLOOR, AWAKENINGS_FULL)]);
  }

  const weight = parts.reduce((sum, [w]) => sum + w, 0);
  return parts.reduce((sum, [w, v]) => sum + w * v, 0) / weight;
}

export function compositionTerm(stages) {
  const asleep = asleepMinutes(stages);
  if (!asleep) return null;
  const deep = bandScore(stageMinutes(stages, "deep") / asleep, DEEP_BAND, {
    floor: 0,
    ceiling: 0.35,
  });
  const rem = bandScore(stageMinutes(stages, "rem") / asleep, REM_BAND, {
    floor: 0,
    ceiling: 0.4,
  });
  return (deep + rem) / 2;
}

/**
 * Score one night.
 *
 * `nights` is the regularity window, oldest first, in the shape
 * sleepRegularity.nightsFrom returns. It should include the night being scored:
 * unlike a baseline, the SRI is a property of the week rather than a yardstick
 * the night is measured against, so leaving tonight out would score the
 * regularity of a week that did not happen.
 */
export function computeSleepScore({
  hours = null,
  stages = null,
  nights = [],
  // Passed in rather than derived from `nights`, so every screen scoring the same
  // night uses the same figure. Deriving it here from the bed-to-wake spans would
  // have given the sleep page (a 14-day window of nights) and Home (all of them) a
  // different target for one night, which is exactly the drift `metricRegistry`
  // exists to stop.
  habitual = null,
} = {}) {
  const sri = sleepRegularityIndex(nights);
  const asleep = asleepMinutes(stages);
  const waso = stageMinutes(stages, "awake");

  const terms = {
    duration: durationTerm(hours, habitual),
    regularity: sri == null ? null : ramp(sri, SRI_FLOOR, SRI_FULL),
    continuity: continuityTerm(stages),
    composition: compositionTerm(stages),
  };

  const present = Object.entries(terms).filter(([, v]) => v != null);
  if (!present.length) {
    return {
      state: "no-data",
      score: null,
      label: null,
      terms,
      sri,
      nights: nights?.length ?? 0,
      needed: SRI_MIN_NIGHTS,
    };
  }

  const totalWeight = present.reduce((sum, [key]) => sum + SLEEP_WEIGHTS[key], 0);
  const weighted = present.reduce((sum, [key, v]) => sum + SLEEP_WEIGHTS[key] * v, 0);
  const score = Math.round((weighted / totalWeight) * 100);

  return {
    state: "ready",
    score,
    label: sleepLabel(score, hours),
    // Whether the band above was withheld for length alone, so the page can
    // explain a score that otherwise sits in a higher band than its label.
    capped: sleepLabel(score) !== sleepLabel(score, hours),
    terms,
    sri,
    nights: nights?.length ?? 0,
    needed: SRI_MIN_NIGHTS,
    // The readings the terms were computed from, so the breakdown can show its
    // working without recomputing anything and risking a different answer.
    readings: {
      hours,
      asleepMinutes: asleep,
      wakeMinutes: waso,
      awakenings: awakeningCount(stages?.timeline),
      deepShare: asleep ? stageMinutes(stages, "deep") / asleep : null,
      remShare: asleep ? stageMinutes(stages, "rem") / asleep : null,
    },
  };
}

export const SLEEP_TERM_LABEL = {
  duration: "DURATION",
  regularity: "REGULARITY",
  continuity: "CONTINUITY",
  composition: "COMPOSITION",
};

/**
 * What each term is, for the rows that expand to explain themselves.
 *
 * Lives here beside the labels rather than in the page, for the same reason the
 * metric descriptions live in `metricRegistry`: one definition per thing, or two
 * screens end up describing the same term differently.
 *
 * Same shape as a registry entry (`info` paragraphs, an optional labelled
 * `detail` list) so both pages render them with the same markup. Written as
 * short sentences with the causes as an actual list: a list of causes packed
 * into one sentence reads as an essay on a phone.
 */
export const SLEEP_TERM_INFO = {
  duration: {
    // **Corrected 2026-08-27.** This said "against your 8 hour goal", which the
    // scorer explicitly refuses: `durationTerm` takes the worse of the clinical
    // 7-9h band and your own habitual median clamped into it, and the note beside
    // DURATION_FULL says outright that GOALS.sleep is not used, because an 8h
    // floor docked anyone habitually sleeping 7.5h and was unreleasable. Naming a
    // goal the calculation does not have is backlog item W13 in a second place.
    info: "How long you were actually asleep, against the 7 to 9 hour range and against your own habitual night.\n\nIt carries the most weight of the four, because a short night is a short night whatever its shape.",
    detail: {
      label: "WORTH KNOWING",
      items: [
        "This is time asleep, not time in bed. The two differ by however long you took to drop off.",
        // **Known stale, and deliberately not rewritten.** DURATION_CURVE reads
        // 9.5 -> 0.88, 10 -> 0.72, 11 -> 0.5, so a tenth hour scores about 28%
        // less than the eighth rather than the same: this describes a plateau
        // that a penalty replaced. It is left alone because the penalty itself is
        // an open decision - measured over 34 nights on 2026-08-26, length does
        // not predict brokenness and the penalty is docking the cleanest nights.
        // If the penalty goes this sentence becomes true again on its own; if it
        // stays, this has to say so plainly. Do not "fix" one without the other.
        "It stops rewarding you at the goal. A tenth hour scores the same as the eighth, which is why a long night has to earn its score on the other three terms.",
      ],
    },
  },
  regularity: {
    info: "How closely last night lined up with the nights before it, minute for minute.\n\nThis is a real regularity index, not the spread of your bedtimes: it compares every minute of the night with the same minute a day earlier. Going to bed at 23:00 every night scores high even if the lengths differ.\n\nIt needs three nights with a recorded bedtime before it can say anything, and its weight spreads across the other terms until then.",
    detail: {
      label: "WHAT MOVES IT",
      items: [
        "A late night, which costs twice: once for that night and once for the next.",
        "Sleeping in at the weekend. It reads the same as an irregular bedtime.",
        "A night the strap did not record. That night is left out rather than counted as irregular.",
      ],
    },
  },
  continuity: {
    info: "How much of the night you spent awake once you had fallen asleep, and how many times you surfaced.\n\nThis is the term that separates eight solid hours from eight broken ones, and it is where a night of waking then dozing shows up.",
    detail: {
      label: "WHAT MOVES IT",
      items: [
        "Alcohol. It gets you to sleep sooner and wakes you later in the night.",
        "A warm room, and needing the bathroom.",
        "Anything that pulls you out near morning, when sleep is lightest and hardest to get back.",
      ],
    },
  },
  composition: {
    info: "How much of the night was deep sleep and how much was REM.\n\nIt carries the least weight of the four, deliberately. The shares move around night to night for reasons nobody can act on, and a night can be well built and still score ordinarily here.",
    detail: {
      label: "WORTH KNOWING",
      items: [
        "Deep sleep comes mostly in the first half of the night, REM mostly in the second. Cutting a night short costs you REM specifically.",
        "The strap infers the stages from movement and heart rate rather than measuring them, so treat the shares as approximate.",
      ],
    },
  },
};

const pct = (share) => (share == null ? null : `${Math.round(share * 100)}%`);

/**
 * What a term's row says: the reading it was judged on, and the reference it was
 * judged against.
 *
 * Two fields rather than one, because they are two different kinds of thing and
 * a single column held both plus, for composition, neither: it read "DEEP AND
 * REM SHARE", which restates the label beside it and tells you nothing about the
 * night.
 */
function readingFor(key, result) {
  const r = result.readings ?? {};
  if (key === "duration") return r.hours == null ? "" : fmtHoursMins(r.hours);
  if (key === "regularity") return result.sri == null ? "" : `SRI ${result.sri}`;
  if (key === "continuity") return `${r.wakeMinutes ?? 0} MIN AWAKE`;
  const deep = pct(r.deepShare);
  const rem = pct(r.remShare);
  return deep && rem ? `${deep} DEEP · ${rem} REM` : "";
}

function referenceFor(key, result) {
  const r = result.readings ?? {};
  if (key === "duration") {
    if (r.hours == null) return "";
    // Three cases, not two, now that the term has a top end. "AT OR PAST 8H"
    // for an eleven-hour night would name the band it just fell out of.
    if (r.hours < DURATION_FULL) return `SHORT OF ${DURATION_FULL}H`;
    if (r.hours > DURATION_LONG_FULL) return `OVER ${DURATION_LONG_FULL}H`;
    return `${DURATION_FULL}H TO ${DURATION_LONG_FULL}H`;
  }
  if (key === "regularity") {
    // The night count alone left SRI as a bare number with nothing to read it
    // against. The population median is the anchor that makes 76 mean something.
    const nights = `ACROSS ${result.nights} ${result.nights === 1 ? "NIGHT" : "NIGHTS"}`;
    return `${nights} · TYPICAL IS ${SRI_TYPICAL}`;
  }
  if (key === "continuity") {
    // The threshold is stated because the hypnogram is directly above and draws
    // every awake segment, including the blips this deliberately does not
    // count. "UP 0 TIMES" over a chart showing three of them reads as a bug.
    if (r.awakenings == null) return "NO TIMELINE";
    const over = `OVER ${AWAKENING_MIN_MINUTES} MIN`;
    if (r.awakenings === 0) return `NO WAKINGS ${over}`;
    return `UP ${r.awakenings === 1 ? "ONCE" : `${r.awakenings} TIMES`} ${over}`;
  }
  return `DEEP ${DEEP_BAND[0] * 100}-${DEEP_BAND[1] * 100} · REM ${REM_BAND[0] * 100}-${REM_BAND[1] * 100}`;
}

/**
 * The score itemised, in the same points-out-of-possible framing RecoveryPage
 * uses. `maxPoints` uses the redistributed weight, so the rows still add up to
 * the score on a night where a term was withheld.
 */
export function sleepBreakdown(result) {
  if (!result || result.state !== "ready") return [];
  const present = Object.entries(result.terms).filter(([, v]) => v != null);
  const totalWeight = present.reduce((sum, [key]) => sum + SLEEP_WEIGHTS[key], 0);

  return present.map(([key, term]) => {
    const share = SLEEP_WEIGHTS[key] / totalWeight;
    return {
      key,
      label: SLEEP_TERM_LABEL[key],
      reading: readingFor(key, result),
      reference: referenceFor(key, result),
      term,
      points: Math.round(share * term * 100),
      maxPoints: Math.round(share * 100),
      // Nominal weight is worth showing separately: it is the fixed design of
      // the score, while maxPoints is what it became on this particular night.
      nominalWeight: Math.round(SLEEP_WEIGHTS[key] * 100),
      redistributed: share !== SLEEP_WEIGHTS[key],
    };
  });
}

/** A term is worth naming only if it gave up enough points to be worth acting on. */
const MEANINGFUL_POINTS = 4;

/**
 * What cost the night, said as a plain statement.
 *
 * **No threshold is quoted anywhere in here, on purpose** (option A of three
 * mocked up 2026-08-07). Naming one was the bug: the copy said "ran short of
 * seven and a half hours" under a nine-hour night, and even once the direction
 * was fixed, stating a boundary misdescribes a term that is a gradient. A night
 * of 9h 12m loses two points and is not worth mentioning; 10h loses fourteen.
 * Quoting "past nine hours" implies a cliff at nine that does not exist. The
 * reading is named instead, which cannot be wrong about a boundary.
 *
 * There is no "most of what was lost was ..." lead either. The term rows sit
 * directly underneath with the points on them, so the preamble was saying twice
 * what the card already showed once, in the least readable words available.
 */
const COST_WORDING = {
  duration: (r) =>
    r.hours != null && r.hours > DURATION_LONG_FULL
      ? `At ${fmtHoursMins(r.hours)} this reads long, and a long night here usually means it broke up rather than gave you more.`
      : `At ${fmtHoursMins(r.hours)} this was simply a short night.`,
  regularity: () => "Bedtimes and wake times moved around a lot this week.",
  continuity: () => "The night broke up more than usual.",
  composition: () => "Deep and REM both came in outside their usual shares.",
};

/**
 * Below this much lost in total, no term is worth blaming.
 *
 * A 94 lost six points across four terms and the page still announced "most of
 * what was lost was duration", which is arithmetically true and reads as fault-
 * finding on a night that went well. The per-term gate cannot catch that on its
 * own: four points is over the per-term threshold while being nothing at all as
 * a share of the night.
 */
/**
 * Eight, not ten, and the two points matter.
 *
 * At ten it was impossible for composition to ever be named: it is worth ten
 * points at most, so a night whose only weakness was composition always fell
 * through to "a good night on every measure". Found by generating the caption for
 * every scenario at once: a night with 2% deep and 4% REM scored 92 and reported
 * nothing wrong.
 */
const LITTLE_LOST_POINTS = 8;

/**
 * One sentence naming where the night's points went.
 *
 * Unclaimed points, not the lowest term: composition at zero costs ten points
 * and duration at half costs twenty, so the term that scored worst is not
 * necessarily the term that cost most, and cost is what answers "what held last
 * night back".
 */
export function costliestTermSentence(result) {
  const rows = sleepBreakdown(result);
  if (!rows.length) return "";
  // A capped night has one answer and it is not the arithmetic: the score is
  // high and the band was withheld anyway, which needs saying outright or the
  // page looks like it is contradicting itself.
  if (result.capped) {
    return `The night scored ${result.score}, but under ${TOP_BAND_MIN_HOURS} hours it cannot rate above ${result.label} however well the rest of it went.`;
  }
  // Nothing to explain on a night that lost almost nothing, whichever term
  // happened to lose the most of that almost-nothing.
  if (result.score != null && 100 - result.score < LITTLE_LOST_POINTS) {
    return "A good night on every measure.";
  }
  const ranked = rows
    .map((r) => ({ ...r, unclaimed: r.maxPoints - r.points }))
    .sort((a, b) => b.unclaimed - a.unclaimed);
  const top = ranked[0];
  if (!top || top.unclaimed < MEANINGFUL_POINTS) {
    return "A good night on every measure.";
  }
  return COST_WORDING[top.key](result.readings ?? {});
}
