// Calories for a session the band never scored.
//
// **The band's own figure always wins where there is one.** This exists for the
// three gaps the 2026-08-12 ticket named, and the strongest of them is the case
// this was built for: a session Atlas timed itself, which has no calorie figure
// at all because Atlas cannot measure one. A number derived from a heart rate is
// a third thing - not typed, not measured - and it is honest if it is marked.
//
// ## Which estimator, and why it was measured rather than argued
//
// Run 2026-08-19 over the real archive: 20 band sessions, 14 of them 20 minutes
// or longer, each carrying a measured kcal to score against.
//
//   Keytel (heart rate), scaled by one constant   4.2% mean absolute error
//   MET table, at its most flattering             9.1%
//
// The 9.1% is a single MET fitted to the very data it was scored on, with every
// session the same activity. A table chosen in advance does worse. So heart rate
// leads and MET survives only as the fallback for a window with no samples, which
// it must, because a strap that was flat or off leaves nothing to derive from.
//
// **Keytel overestimates the band by a strikingly stable factor**: 1.28 to 1.55
// across those 14, median 1.32. Divided by one constant it lands within a few
// percent on twelve of them. That constant is what does the work, and it is
// personal - see `fitConstant`.
//
// **The honest caveat, kept in front of the code that relies on it:** Keytel's
// per-minute rate is a linear function of average heart rate once weight and age
// are fixed, so for a single person the equation adds nothing over the heart rate
// itself. It earns its place by carrying weight, age and sex, which is what makes
// the shape right for somebody who is not this author.
//
// And the reference is the band's own number, which is itself an estimate. This
// measures agreement, not truth. Agreement is the right target: an estimate that
// disagreed with the figures beside it would be a second opinion nobody asked for.

/**
 * The shortest session worth scoring at all.
 *
 * **Five minutes, not twenty, and the first version had this wrong.** It reused
 * the fit's own floor, which conflated two different questions. Excluding short
 * records from the FIT is justified by measurement: the band's 12 and 13-minute
 * records came back at ratios of 4.03 and 2.88, each reporting a heart rate its
 * own calorie figure contradicts. Refusing to ESTIMATE a short session is a
 * different and much weaker claim, because Keytel is a per-minute rate - ten
 * minutes of it is exactly as sound as forty.
 *
 * What actually makes a short session untrustworthy is having too few readings
 * to believe the average, which is a sample count and not a duration. That is
 * `MIN_SAMPLES` below, and it is the real guard.
 *
 * Five is where a session stops being a mis-tap and starts being a thing you
 * did.
 */
export const MIN_MINUTES = 5;

/**
 * Readings needed before an average heart rate is worth deriving anything from.
 *
 * **The same five `bucketSeries` withholds a half hour under**, and for the same
 * reason: the band reports about once a minute, so a window holding one or two
 * readings is the strap being handled rather than worn. A shower published a
 * half hour averaging 161 once, which is what that rule exists to stop.
 *
 * This is what a ten-minute session has to clear, and an ordinary one does
 * comfortably: ten minutes on the wrist is about ten readings.
 */
export const MIN_SAMPLES = 5;

/**
 * What a session has to be for its band figure to be worth fitting against.
 *
 * The same floor, for the same reason: two records of 12 and 13 minutes came back
 * at ratios of 4.03 and 2.88, both the first of a same-day pair, both reporting a
 * heart rate their own calorie figure contradicts. Short records are where the
 * band's own splitting is least settled.
 */
const MIN_FIT_MINUTES = 20;

/** Fewer usable sessions than this and the constant is somebody else's. */
export const MIN_FIT_SESSIONS = 3;

/**
 * The starting constant, for an archive with nothing to fit against yet.
 *
 * **A provisional figure rather than a blank**, which is the standing rule here:
 * a new user seeing nothing for weeks learns the column is broken. 1.34 is the
 * mean measured on the one real archive available, so it is one person's number
 * and is documented as such. It is still a better prior than 1.0: raw Keytel
 * measured 28-55% above the band on every single session, so shipping the
 * unscaled equation would be shipping a number known to be high.
 *
 * It is replaced by the user's own the moment there are three sessions to fit.
 */
export const DEFAULT_CONSTANT = 1.34;

/**
 * Keytel et al. (2005), kcal per minute, from heart rate.
 *
 * Published in kJ, hence the 4.184. Returns null rather than a number when an
 * input is missing: every one of these is required, and defaulting any of them
 * would be inventing a body.
 */
export function keytelPerMinute({ hr, weightKg, ageYears, sex }) {
  if (![hr, weightKg, ageYears].every((v) => Number.isFinite(v) && v > 0)) return null;
  const kj =
    sex === "female"
      ? -20.4022 + 0.4472 * hr - 0.1263 * weightKg + 0.074 * ageYears
      : -55.0969 + 0.6309 * hr + 0.1988 * weightKg + 0.2017 * ageYears;
  const perMin = kj / 4.184;
  // A resting heart rate can drive the male equation negative, which is the
  // equation being used outside the range it was fitted on rather than a body
  // burning nothing.
  return perMin > 0 ? perMin : null;
}

/**
 * The personal constant, fitted from the band's own sessions.
 *
 * **The mean of each session's own ratio, not a ratio of the totals.** Pooling
 * would let one three-hour session decide the figure for everybody, which is the
 * same reason `batteryLife` averages per-segment rates rather than the raw drops.
 *
 * Returns the default, marked provisional, until there are enough sessions.
 */
export function fitConstant(sessions, profile) {
  const ratios = [];
  for (const s of sessions ?? []) {
    const minutes = (s.activeSeconds ?? 0) / 60;
    if (minutes < MIN_FIT_MINUTES) continue;
    if (!Number.isFinite(s.caloriesKcal) || s.caloriesKcal <= 0) continue;
    const perMin = keytelPerMinute({ ...profile, hr: s.hrAvg });
    if (perMin == null) continue;
    ratios.push((perMin * minutes) / s.caloriesKcal);
  }
  if (ratios.length < MIN_FIT_SESSIONS) {
    return { constant: DEFAULT_CONSTANT, provisional: true, from: ratios.length };
  }
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return { constant: mean, provisional: false, from: ratios.length };
}

/**
 * `kcal = MET x 3.5 x kg / 200 x minutes`, the standard form.
 *
 * The fallback only. Withheld rather than guessed when the type carries no MET
 * or no weight is recorded: a body mass invented to fill a gap is the one input
 * here that would silently scale everything.
 */
export function metCalories({ met, weightKg, minutes }) {
  if (![met, weightKg, minutes].every((v) => Number.isFinite(v) && v > 0)) return null;
  return ((met * 3.5 * weightKg) / 200) * minutes;
}

/**
 * Coarse on purpose.
 *
 * MET values are population averages and the fitted constant carries a few
 * percent of its own, so `620 KCAL` claims a precision neither has. Rounded to
 * the nearest 10 up to 1000 and the nearest 50 above it, where a percent is
 * worth more than a digit.
 */
export function roundEstimate(kcal) {
  if (!Number.isFinite(kcal) || kcal <= 0) return null;
  const step = kcal >= 1000 ? 50 : 10;
  return Math.round(kcal / step) * step;
}

/**
 * What a session's calorie row should say.
 *
 * Returns `null` when nothing honest can be said, which is a real answer and the
 * one the column has shown until now. `source` travels so a screen can explain
 * itself: the two estimators fail in different ways and a reader deserves to
 * know which one they are looking at.
 */
export function estimateSessionCalories({
  hrAvg,
  hrSamples = null,
  activeSeconds,
  profile,
  constant = DEFAULT_CONSTANT,
  provisional = false,
  met = null,
}) {
  const minutes = (activeSeconds ?? 0) / 60;
  if (!Number.isFinite(minutes) || minutes < MIN_MINUTES) return null;

  // **The count gates the heart-rate route only.** A thin sample window says
  // nothing about the MET fallback, which never looked at a reading in the first
  // place, so falling through to it is right rather than giving up entirely.
  const enoughSamples = hrSamples == null || hrSamples >= MIN_SAMPLES;
  const perMin = enoughSamples ? keytelPerMinute({ ...profile, hr: hrAvg }) : null;
  if (perMin != null && Number.isFinite(constant) && constant > 0) {
    return {
      kcal: roundEstimate((perMin * minutes) / constant),
      source: "hr",
      estimated: true,
      provisional,
    };
  }

  const fromMet = metCalories({ met, weightKg: profile?.weightKg, minutes });
  if (fromMet != null) {
    // Always provisional: a MET is a population average for an activity NAME,
    // which is a weaker claim than a fitted constant on your own heart rate
    // however many sessions it was fitted from.
    return { kcal: roundEstimate(fromMet), source: "met", estimated: true, provisional: true };
  }

  return null;
}
