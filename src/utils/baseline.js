// Rolling personal baselines.
//
// Metrics like HRV and resting HR have no target. A single night's HRV tells
// you almost nothing, because night-to-night variation is large; what carries
// meaning is where tonight sits against your own recent normal. That makes a
// baseline a prerequisite for both the Recovery score and the baseline band
// mark, so it lives here rather than inside either of them.
//
// Nothing here invents data. Missing nights are skipped, not interpolated, and
// a window that has not filled yet returns null rather than a shakier answer
// that looks identical to a confident one.

/**
 * Nights of history required before a baseline means anything.
 *
 * Seven is the shortest window the HRV literature treats as usable for
 * detecting real change, and it is what Atlas shows as CALIBRATING until it
 * fills. Longer would be more stable and would delay the first score by weeks.
 */
export const BASELINE_NIGHTS = 7;

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDev(values, avg) {
  if (values.length < 2) return 0;
  // Sample standard deviation: these are a sample of your nights, not the
  // whole population of them.
  const variance =
    values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * A rolling baseline over the most recent usable values.
 *
 * `values` runs oldest to newest and must NOT include the reading being judged:
 * comparing a night against a baseline it is itself part of drags the baseline
 * toward it and flattens exactly the deviation being measured.
 *
 * `log` applies a log transform before averaging, which is the convention for
 * HRV because its distribution is skewed and raw means over-weight the high
 * nights. Resting HR is near enough symmetric to use directly.
 *
 * Returns null until the window fills.
 */
export function rollingBaseline(values, { window = BASELINE_NIGHTS, log = false } = {}) {
  const usable = (values ?? []).filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
  if (usable.length < window) return null;

  const recent = usable.slice(-window);
  const scaled = log ? recent.map(Math.log) : recent;
  const avg = mean(scaled);
  const sd = stdDev(scaled, avg);
  const back = (v) => (log ? Math.exp(v) : v);

  return {
    n: recent.length,
    mean: back(avg),
    // In log space the spread is multiplicative, so the band is asymmetric in
    // the original units. Returning both ends already converted keeps that
    // detail out of every caller.
    low: back(avg - sd),
    high: back(avg + sd),
    // Kept in the transformed space, because that is where z-scores are taken.
    scaledMean: avg,
    scaledSd: sd,
  };
}

/**
 * How far today sits from the baseline, in standard deviations.
 *
 * Returns null when there is no baseline, or when the baseline has no spread
 * at all: seven identical readings make every deviation infinite, which would
 * turn a rounding artefact into a dramatic score.
 */
export function deviation(value, baseline, { log = false } = {}) {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  if (!baseline || !baseline.scaledSd) return null;
  const scaled = log ? Math.log(value) : value;
  return (scaled - baseline.scaledMean) / baseline.scaledSd;
}

/**
 * Map a deviation onto 0..1 for scoring.
 *
 * Two standard deviations in the favourable direction saturates the term. That
 * is deliberately blunt: the difference between a very good night and an
 * extraordinary one should not swing a readiness score, whereas the difference
 * between normal and clearly-below-normal should.
 *
 * `higherIsBetter` is false for resting HR, where an elevated reading is the
 * bad direction.
 */
export function deviationToScore(z, { higherIsBetter = true } = {}) {
  if (z == null) return null;
  const directed = higherIsBetter ? z : -z;
  return Math.max(0, Math.min(1, 0.5 + directed / 4));
}

// Two-tailed t values at 95%, indexed by degrees of freedom. Only the small
// end matters: the window is seven nights, so df is six.
const T_95 = {
  2: 4.303,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  10: 2.228,
  13: 2.16,
  20: 2.086,
  30: 2.042,
};

function tValue(df) {
  if (df <= 0) return 0;
  const keys = Object.keys(T_95).map(Number);
  const exact = T_95[df];
  if (exact) return exact;
  if (df > Math.max(...keys)) return 1.96;
  return T_95[keys.find((k) => k > df)] ?? 1.96;
}

/**
 * How far outside normal a deviation is, in words the rest of the app can
 * agree on.
 *
 * This exists because two parts of Home were describing the same number with
 * different thresholds: the verdict line called an HRV dip "below your usual
 * range" while the row beside it reported the same metric as normal, because
 * one used a standard deviation and the other used the prediction interval.
 * Both statements were defensible and together they were nonsense. The band
 * boundary here is the same one typicalRange uses, so a metric described as
 * outside its range is exactly the metric that gets its own row.
 */
export function deviationBand(z, n = BASELINE_NIGHTS) {
  if (z == null) return "unknown";
  const limit = tValue(n - 1) * Math.sqrt(1 + 1 / n);
  if (z <= -limit) return "low";
  if (z >= limit) return "high";
  if (z <= -1) return "slightly-low";
  if (z >= 1) return "slightly-high";
  return "normal";
}

/**
 * The range a new reading should fall in if nothing has changed.
 *
 * This is a prediction interval, not a plain multiple of the standard
 * deviation, and the difference matters at this sample size. A band of one SD
 * flags about a third of all days; even 1.5 SD flags 21%, and with three
 * vitals being checked that surfaces something on half of all days. A screen
 * that shows an exception every second day is not showing exceptions, it is
 * listing metrics again with extra steps.
 *
 * A prediction interval accounts for two separate uncertainties: the spread of
 * the nights themselves, and the fact that seven nights is a small sample to
 * be estimating that spread from. The sqrt(1 + 1/n) term is the second one.
 * At 95% it leaves roughly one day in twenty flagging per metric, so something
 * surfaces about one day in seven overall, which is close to the 10-15%
 * deviation Whoop treats as worth mentioning.
 *
 * Returns null before the window fills, which is what makes the band render
 * nothing rather than something misleadingly precise.
 */
/** Minimum readings before quartiles describe anything. */
const USUAL_MIN_N = 5;

/**
 * The middle half of the readings: 25th to 75th percentile, plus the median.
 *
 * Different question from typicalRange, and the right one for a number that
 * varies a lot by choice rather than by physiology. typicalRange is a 95%
 * prediction interval - it is built to contain nineteen days in twenty, so on a
 * step count that swings from 950 to 5,700 it spans nearly the whole plausible
 * range and even reaches below zero. That is correct and useless: "you took
 * between none and eight thousand steps" is not a description of a normal day.
 *
 * Quartiles answer "what does an ordinary day look like" instead, they are not
 * dragged around by one enormous day, and they cannot go negative because every
 * bound is an actual reading.
 *
 * Vitals keep the prediction interval, because there the question really is
 * "is today unusual" and a false alarm one day in twenty is the point.
 */
export function usualRange(values) {
  const sorted = (values ?? []).filter((v) => v != null).sort((a, b) => a - b);
  if (sorted.length < USUAL_MIN_N) return null;

  const at = (fraction) => {
    const pos = (sorted.length - 1) * fraction;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };

  return { low: at(0.25), median: at(0.5), high: at(0.75), n: sorted.length };
}

export function typicalRange(values, options = {}) {
  const base = rollingBaseline(values, options);
  if (!base) return null;
  const { log = false } = options;
  const spread =
    base.scaledSd * tValue(base.n - 1) * Math.sqrt(1 + 1 / base.n);
  const back = (v) => (log ? Math.exp(v) : v);
  return {
    low: back(base.scaledMean - spread),
    high: back(base.scaledMean + spread),
    // The centre of the range, carried so a mark can tick it without deriving
    // a second, slightly different normal from the same numbers. Back-scaled
    // like the ends, so on a log metric this is the geometric mean rather than
    // the midpoint of two exponentiated bounds.
    mean: back(base.scaledMean),
    n: base.n,
  };
}
