/**
 * Today's steps against the shape your own days usually make.
 *
 * **Why this exists.** The steps page led with a total against a goal and
 * nothing else, so 1,456 against 8,000 read as 18% of a bad day. Measured on the
 * real archive it was the opposite: the median by that hour was 519, and the
 * author's step days are heavily back-loaded - the median only reaches 1,694 by
 * 17:00 and 3,701 by 21:00. A total with no sense of the hour cannot tell those
 * two days apart, and the page had no way to say which one you were having.
 *
 * **The band reports steps as interval counts, not as a running total**, which
 * is what makes this cheap: a day's curve is the running sum of its own samples,
 * and the usual band is the same sum over the days before it, read at the same
 * hour. Nothing new is stored and nothing is fetched that the page did not
 * already have.
 *
 * Everything here is pure. The component supplies the samples and the day
 * boundaries; DST and local midnight are `localDayBounds`' job, not this file's.
 */

/** Hour boundaries the curve is sampled at, midnight to midnight inclusive. */
export const HOURS = 24;

/**
 * How many prior days before a usual band means anything.
 *
 * Seven, matching Recovery's floor rather than a number picked fresh: below it
 * the median of the days is mostly the day being judged against itself, which is
 * the same defect `NotYet` was written for.
 */
export const MIN_USUAL_DAYS = 7;

/** How many days back the band is built from, once there are enough. */
export const USUAL_DAYS = 14;

const HOUR_MS = 3600000;

/**
 * One day's running total at each hour boundary.
 *
 * Returns 25 numbers, index 0 being midnight (always 0) and index 24 being the
 * whole day. A sample landing exactly on an hour counts toward that hour, which
 * matches how the band stamps an interval: at its end.
 */
export function curveFor(samples, dayStartMs) {
  const out = new Array(HOURS + 1).fill(0);
  if (!Array.isArray(samples)) return out;
  for (const s of samples) {
    const t = s?.t;
    const v = s?.v;
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    const hour = Math.floor((t - dayStartMs) / HOUR_MS) + 1;
    if (hour < 1 || hour > HOURS) continue;
    out[hour] += v;
  }
  for (let i = 1; i <= HOURS; i++) out[i] += out[i - 1];
  return out;
}

/**
 * The hour the day has reached, as an index into a curve.
 *
 * Clamped to the whole day so a stale clock cannot index past the end, and
 * floored at 0 so a `now` before the day started reads as the start of it.
 */
export function hoursElapsed(nowMs, dayStartMs) {
  const h = Math.floor((nowMs - dayStartMs) / HOUR_MS);
  return Math.max(0, Math.min(HOURS, h));
}

/**
 * The curve, truncated at the hour the day has actually reached.
 *
 * Past that hour the entries are null rather than repeated: a flat line running
 * on to midnight claims readings the day has not produced, and drawn against a
 * rising median it would read as having stopped moving.
 */
export function curveSoFar(curve, atHour) {
  return curve.map((v, i) => (i <= atHour ? v : null));
}

/**
 * The 25th, 50th and 75th of the prior days, at each hour.
 *
 * **A day with no samples at all is dropped, never counted as zero.** That is a
 * day the strap was not worn, and folding it in as a flat zero drags every
 * percentile down and makes an ordinary day look exceptional. A day that has
 * samples summing to nothing is a different thing and is kept.
 */
export function usualBand(dayCurves) {
  const kept = (dayCurves ?? []).filter((c) => Array.isArray(c) && c[HOURS] > 0);
  if (kept.length < MIN_USUAL_DAYS) return null;

  const at = (hour, q) => {
    const vals = kept.map((c) => c[hour] ?? 0).sort((a, b) => a - b);
    return vals[Math.min(vals.length - 1, Math.floor(vals.length * q))];
  };

  const p25 = [];
  const p50 = [];
  const p75 = [];
  for (let h = 0; h <= HOURS; h++) {
    p25.push(at(h, 0.25));
    p50.push(at(h, 0.5));
    p75.push(at(h, 0.75));
  }
  return { p25, p50, p75, days: kept.length };
}

/**
 * Where the day lands if the rest of it looks like a median one.
 *
 * **Added on at the median's own shape, never extrapolated from the current
 * pace.** A straight line through 1,456 steps at 15:30 promises 2,250 by
 * midnight, which is a day nobody walks: the median gains 3,600 in those same
 * hours because the evening is when the walking happens. Never below the total
 * already banked, since steps do not come off.
 */
export function projectFinish(todayTotal, p50, atHour) {
  if (!Array.isArray(p50) || !Number.isFinite(todayTotal)) return null;
  const remaining = (p50[HOURS] ?? 0) - (p50[atHour] ?? 0);
  return Math.max(todayTotal, todayTotal + Math.max(0, remaining));
}

/**
 * Everything the chart and the sentence both read, computed once.
 *
 * One model rather than two, for the same reason `sleepResultFor` is one
 * function: a chart and a line that each did their own arithmetic would
 * eventually disagree about the same day, and the disagreement would be silent.
 */
export function intradayModel({ todaySamples, priorCurves, nowMs, dayStartMs, goal = null }) {
  const curve = curveFor(todaySamples, dayStartMs);
  const atHour = hoursElapsed(nowMs, dayStartMs);
  const band = usualBand(priorCurves);
  const total = curve[HOURS];
  const usualNow = band ? band.p50[atHour] : null;

  return {
    curve,
    soFar: curveSoFar(curve, atHour),
    atHour,
    total,
    band,
    usualNow,
    projected: band ? projectFinish(total, band.p50, atHour) : null,
    goal,
    /**
     * The axis has to include the target, or it cannot be judged against.
     *
     * With 6% of headroom above whatever is tallest. Without it the goal line
     * lands exactly on the top edge of the plot, where it reads as a rule under
     * the card's header rather than as a line on the chart.
     */
    top: (Math.max(goal ?? 0, total, band ? band.p75[HOURS] : 0) || 1) * 1.06,
  };
}
