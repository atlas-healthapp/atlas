// How hard a session actually was, as a share of maximum heart rate.
//
// **The mean was the wrong estimator and the archive says so.** The fitness
// age's activity index scores intensity against ACSM's classification by
// percentage of maximum heart rate - light 57-63, moderate 64-76, vigorous
// 77-95 - and those categories describe the effort *while exercising*. A
// session's mean heart rate is not that: a 115-minute climb spends a good part
// of itself belaying, and the rests are averaged in alongside the climbing.
//
// Measured on this archive, the duration-weighted mean across every session is
// 66.8% of predicted maximum, which the New index scores at 4.13 out of 45 -
// while the sessions themselves are plainly not easy. The published scale zeroes
// below 63%, so a person whose training is genuinely vigorous in bursts can land
// on nothing at all.
//
// So this measures the working part rather than the average of work and rest.
// It is a change of estimator, not a recalibration: `INTENSITY_POINTS` in
// `fitnessAge.js` still means what ACSM says it means, and is untouched.
//
// Pure, and takes the samples rather than reading them, so it can be tested
// without a database. `fitnessAgeModel.js` does the reading, which is the same
// split that keeps `fitnessAge.js` free of stores.

/** Where the working share sits. See `workingHeartRate`. */
export const WORKING_PERCENTILE = 0.75;

/**
 * How few samples is too few to take a percentile of.
 *
 * The same reasoning as `sessionCalories`' five-sample floor: the band reports
 * about once a minute, so four readings is a session the strap barely saw, and a
 * percentile of four numbers is one of the four.
 */
export const MIN_SAMPLES = 5;

/**
 * The value at `p` through a sorted copy, interpolating between neighbours.
 *
 * Linear interpolation rather than nearest-rank, so the figure moves smoothly as
 * a session gains samples instead of stepping whenever the count crosses a
 * boundary.
 */
export function percentile(values, p) {
  const sorted = (values ?? [])
    .filter((v) => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const at = p * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/**
 * The heart rate that describes the working part of a session.
 *
 * **The 75th percentile, not the maximum and not the mean.** A maximum is one
 * reading and inherits every artefact the band produces - the archive holds a
 * workout claiming 203 against a same-day sample peak of 173, which is the
 * record `splitSessions.js` exists for. The mean includes the rests. A high
 * percentile is the level the session was worked at, and on a steady run where
 * there are no rests it lands close to the mean anyway, so nothing is distorted
 * for the sessions the old estimator handled correctly.
 *
 * Returns null rather than a guess when there are too few samples to believe.
 */
export function workingHeartRate(values) {
  const usable = (values ?? []).filter(
    (v) => typeof v === "number" && Number.isFinite(v) && v > 0
  );
  if (usable.length < MIN_SAMPLES) return null;
  return percentile(usable, WORKING_PERCENTILE);
}

/**
 * A session's working heart rate, from samples if they exist and from the band's
 * own average if they do not.
 *
 * **The fallback is not a failure state.** `downsampleOlderThan` collapses
 * samples past 90 days into 15-minute averages, which destroys the within-session
 * spread a percentile needs, so an older session genuinely has nothing better
 * than `hrAvg` to offer. It is reported rather than hidden: a window made mostly
 * of fallbacks is scored on the old, low estimator and the card should be able to
 * say so.
 */
export function sessionWorkingHr(session, samples) {
  const measured = workingHeartRate(samples);
  if (measured != null) return { hr: measured, source: "samples" };
  const avg = session?.hrAvg;
  if (typeof avg === "number" && Number.isFinite(avg) && avg > 0) {
    return { hr: avg, source: "average" };
  }
  return { hr: null, source: "none" };
}
