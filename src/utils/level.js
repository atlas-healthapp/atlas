// Where you sit against your own best recent form.
//
// This is the half of Recovery that answers "what condition am I in", as
// opposed to the deviation terms in baseline.js, which answer "how does today
// compare with last week". The two are different questions and Recovery was
// being asked both at once; the decision on 2026-08-10 was that it means
// condition, with today's reading modulating it.
//
// **Why a level term has to exist at all.** Both vitals were scored only against
// a rolling seven-night baseline, so improving and then holding the improvement
// returned to the same score within a week: your baseline becomes the new level
// and today stops being remarkable. Measured, HRV around 55 and HRV around 200
// both scored 61. Being genuinely excellent scored the same as being genuinely
// mediocre, and reaching the top band durably would have required improving
// forever.
//
// **Why the ceiling is a percentile and not the maximum.** The ticket originally
// specified the highest trailing average ever seen. That only ever ratchets up,
// it is driven by whichever week was luckiest, and it never ages out - one good
// fortnight would govern the score a year later. Measured on this user's first
// seventeen nights the maximum and the 90th percentile were half a millisecond
// apart, because eleven trailing windows overlapping by six nights each are not
// eleven observations. The percentile earns its place as history accumulates,
// which is exactly when the ratchet would otherwise start to bite.
//
// **What this deliberately does not fix.** The reference is still personal, so
// being fitter than a year ago will not show: the ceiling follows you up over
// the window and level returns to the middle. That is the same treadmill on a
// six-month clock rather than a seven-day one, and it is an accepted trade. Only
// an external anchor breaks it, which is what the age-referenced resting heart
// rate in ageNorms.js is for.

/** Nights in one trailing average. Matches BASELINE_NIGHTS by design. */
export const LEVEL_WINDOW = 7;

/**
 * Days of history the ceiling is drawn from.
 *
 * Six months. Long enough that the ceiling is a property of your form rather
 * than of one good week, short enough that it follows a genuine change rather
 * than sitting on a peak you have long since left behind. For a user who trains
 * year-round this settles at the best two or three weeks in half a year, which
 * is reachable at a taper or a holiday a few times a year.
 */
export const CEILING_DAYS = 180;

/** Which percentile of the trailing averages counts as your ceiling. */
export const CEILING_PERCENTILE = 90;

/**
 * The share of the ceiling that scores zero.
 *
 * 0.60, not the 0.75 first proposed. Measured: in seventeen nights this user's
 * seven-night average never once fell below 79% of his ceiling, so a floor at
 * 75% put the entire bottom third of the scale beyond anything short of
 * illness, and ordinary training weeks were pushed to the bottom of a range they
 * belong in the middle of.
 *
 * Wants revisiting against a real distribution at the same tripwire as the band
 * boundaries. If it is ever made adaptive it MUST be clamped - a floor that
 * tracks your own worst period means getting worse lowers the bar and your level
 * recovers on its own, which is the treadmill upside down.
 */
export const LEVEL_FLOOR = 0.6;

/**
 * Nights before the level term is allowed to say anything at all.
 *
 * Below this it is withheld and its weight goes to responsiveness, which is
 * exactly today's behaviour, so a new user loses nothing and Recovery still
 * scores from night seven.
 *
 * The gate is not caution, it is arithmetic. On the first day a trailing average
 * exists it IS the ceiling, so level reads a perfect 1.00 and can only fall as
 * real history arrives. Without a gate the score opens flattering and drifts
 * down for weeks, which is precisely the reading this work exists to remove.
 */
export const LEVEL_MIN_NIGHTS = 30;

/** Nights at which the level term carries its full weight. */
export const LEVEL_FULL_NIGHTS = 120;

/**
 * How far today's reading is allowed to move the term either side of level.
 *
 * 0.4 here is +/-0.2 on the term, which on HRV is ten points of the score. An
 * ordinary day therefore scores your level exactly, rather than the half marks a
 * deviation term gives a reading sitting on its own baseline - and those half
 * marks were the whole reason consistency was being punished.
 */
export const RESPONSIVENESS_MODIFIER = 0.4;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function usable(values) {
  return (values ?? []).filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
}

/**
 * Every trailing average of `window` consecutive readings, oldest first.
 *
 * Gaps are closed up rather than interpolated: a night the strap was not worn is
 * not a reading, and averaging across it would invent one. The cost is that a
 * window can span more calendar days than it has readings, which is the right
 * trade for a figure meant to describe form rather than a date range.
 */
export function trailingAverages(values, window = LEVEL_WINDOW) {
  const ok = usable(values);
  if (ok.length < window) return [];
  const out = [];
  let sum = 0;
  for (let i = 0; i < ok.length; i++) {
    sum += ok[i];
    if (i >= window) sum -= ok[i - window];
    if (i >= window - 1) out.push(sum / window);
  }
  return out;
}

/** Linear-interpolated percentile of an unsorted list. */
function percentileOf(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(rank);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/**
 * Your ceiling and where you currently sit against it.
 *
 * `higherIsBetter` false inverts the whole thing for resting heart rate, where
 * the ceiling is the *lowest* sustained average and being above it is the bad
 * direction. Expressed as a ratio either way, so one scale serves both.
 *
 * Returns null while there is not enough history to mean anything, which is what
 * makes the caller withhold the term rather than show a confident-looking figure
 * derived from a fortnight.
 */
export function levelFrom(values, { higherIsBetter = true, floor = LEVEL_FLOOR } = {}) {
  const ok = usable(values);
  const averages = trailingAverages(ok);
  if (ok.length < LEVEL_MIN_NIGHTS || !averages.length) {
    return { state: "calibrating", nights: ok.length, needed: LEVEL_MIN_NIGHTS };
  }

  // The ceiling is the good end of the distribution whichever way the metric
  // runs: the 90th percentile for HRV, the 10th for resting heart rate.
  const ceiling = percentileOf(averages, higherIsBetter ? CEILING_PERCENTILE : 100 - CEILING_PERCENTILE);
  const current = averages[averages.length - 1];
  if (!ceiling || !current) return { state: "calibrating", nights: ok.length, needed: LEVEL_MIN_NIGHTS };

  // Above your own ceiling is possible and simply means you are at your best;
  // the ratio is clamped so it cannot score over full marks.
  const ratio = higherIsBetter ? current / ceiling : ceiling / current;
  const value = clamp01((ratio - floor) / (1 - floor));

  return {
    state: "ready",
    value,
    current,
    ceiling,
    ratio,
    floorValue: higherIsBetter ? ceiling * floor : ceiling / floor,
    nights: ok.length,
    windows: averages.length,
    weight: levelWeight(ok.length),
  };
}

/**
 * How much of its full say the level term has yet, 0..1.
 *
 * Faded in rather than switched on, the same pattern sleepScore.js uses for
 * habitual hours. The ceiling firms up gradually as windows accumulate, so the
 * confidence placed in it should too - and a cliff at night 30 would move every
 * score in one day for no reason anybody could see.
 */
export function levelWeight(nights) {
  if (nights < LEVEL_MIN_NIGHTS) return 0;
  if (nights >= LEVEL_FULL_NIGHTS) return 1;
  return (nights - LEVEL_MIN_NIGHTS) / (LEVEL_FULL_NIGHTS - LEVEL_MIN_NIGHTS);
}

/**
 * One vital's term: your level, moved by how today compares with your recent
 * self.
 *
 * `responsiveness` is the existing 0..1 deviation score, where 0.5 means "on
 * your own baseline". Subtracting that 0.5 is what turns it from the score into
 * a modifier, and it is the whole point: an ordinary day now scores your level
 * rather than half marks.
 *
 * While level is still calibrating, or faded only partly in, the term falls back
 * toward responsiveness alone - which is exactly the behaviour that shipped
 * before this, so nothing regresses for a new user.
 */
export function conditionTerm(level, responsiveness, { modifier = RESPONSIVENESS_MODIFIER } = {}) {
  if (responsiveness == null) return null;
  if (!level || level.state !== "ready" || !level.weight) return clamp01(responsiveness);

  const spine = clamp01(level.value + (responsiveness - 0.5) * modifier);
  // Blended by evidence rather than switched: at half weight the term is half
  // way between the old shape and the new one.
  return clamp01(spine * level.weight + responsiveness * (1 - level.weight));
}
