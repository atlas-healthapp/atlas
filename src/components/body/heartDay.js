// A day of heart rate, turned into something drawable.
//
// Stress got columns because the band reports it every few minutes and a line
// would claim to know what happened between readings. Heart rate has the same
// argument and one extra problem: **the band reports it about seven times as
// often**. Measured on the real archive, 4 August holds 1,374 heart-rate
// samples against 208 stress samples for the same day.
//
// Feeding that into `stressDay.js`'s geometry unchanged puts four readings on
// every pixel of a phone-width plot: each column clamps to its minimum width,
// they overlap five deep, and the day fills in as a solid block. So the
// readings are bucketed, and each column is drawn from its bucket's **low to
// its high** rather than as a single value. That keeps the spread visible,
// which is the part of a heart-rate day worth seeing - the difference between
// an hour at 60 and an hour swinging between 52 and 96 is invisible in a mean
// and obvious in a range.
//
// The axis does not start at zero. A heart rate never approaches it, and an
// axis from zero spends two thirds of its height on values a living person
// cannot produce. This is the same reasoning `nightlyBars` uses, and it carries
// the same obligation: **both ends of the axis must be printed** wherever this
// is drawn, or the heights are unreadable.

/** Minutes past local midnight. */
function minuteOfDay(t) {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

/** Six minutes: 240 columns across a full day, which is the density stress already draws at. */
export const BUCKET_MINUTES = 6;

/**
 * The percentile taken as the day's resting reference.
 *
 * Not the minimum: one dropped reading would set the line, and a line the day
 * touches exactly once is not a reference. The tenth percentile is what
 * `bodyMetrics` already uses to derive resting heart rate from raw samples, so
 * this agrees with the number BODY shows rather than offering a second opinion.
 */
export const RESTING_PERCENTILE = 10;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
}

/**
 * Columns for one day, plus what the page says about it.
 *
 * `sessions` are optional `{ startMillis, endMillis }` used only to shade where
 * training was; they never change a column's height or the axis.
 *
 * Returns null under two readings, since one point has no spread to draw and no
 * axis to draw it against.
 */
/** How many empty buckets end a run-line segment rather than being bridged. */
const RUN_GAP_BUCKETS = 2;

/**
 * The columns' averages as one or more polyline point strings.
 *
 * Broken rather than interpolated across a gap, the same rule `historyChart`'s
 * line follows: a straight segment drawn over an hour the strap did not report
 * looks exactly like an hour of steady heart rate.
 */
export function runSegments(columns = [], bucket = BUCKET_MINUTES) {
  const out = [];
  let current = [];
  let previousMinute = null;

  for (const col of columns) {
    if (previousMinute != null && col.minute - previousMinute > bucket * RUN_GAP_BUCKETS) {
      if (current.length > 1) out.push(current.join(" "));
      current = [];
    }
    current.push(`${col.centreX.toFixed(2)},${col.meanY.toFixed(2)}`);
    previousMinute = col.minute;
  }
  if (current.length > 1) out.push(current.join(" "));
  return out;
}

export function heartDayGeometry(samples, { height = 96, sessions = [], bucket = BUCKET_MINUTES } = {}) {
  const points = (samples ?? [])
    .filter((s) => s && Number.isFinite(s.t) && Number.isFinite(s.v))
    .sort((a, b) => a.t - b.t);
  if (points.length < 2) return null;

  // Clipped to what was actually reported rather than midnight to midnight, the
  // same reason stress does it: a full-day axis at 9am spends two thirds of its
  // width on hours that have not happened.
  const firstMinute = minuteOfDay(points[0].t);
  const lastMinute = minuteOfDay(points[points.length - 1].t);
  const span = Math.max(60, lastMinute - firstMinute);

  const values = points.map((p) => p.v);
  const low = Math.min(...values);
  const high = Math.max(...values);
  // Rounded outward to tens so the printed ends of the axis are readable
  // numbers rather than whatever the day happened to touch.
  const axisLow = Math.max(0, Math.floor(low / 10) * 10 - 5);
  const axisHigh = Math.ceil(high / 10) * 10;
  const range = Math.max(1, axisHigh - axisLow);

  const x = (minute) => ((minute - firstMinute) / span) * 100;
  const y = (v) => height - ((v - axisLow) / range) * height;

  const buckets = new Map();
  for (const p of points) {
    const key = Math.floor(minuteOfDay(p.t) / bucket);
    const b = buckets.get(key);
    if (b) {
      b.min = Math.min(b.min, p.v);
      b.max = Math.max(b.max, p.v);
      b.sum += p.v;
      b.n++;
    } else {
      buckets.set(key, { min: p.v, max: p.v, sum: p.v, n: 1, t: p.t });
    }
  }

  const width = Math.max(0.4, (bucket / span) * 100 * 0.8);
  const inSession = (t) =>
    (sessions ?? []).some(
      (s) => s && t >= s.startMillis && t <= (s.endMillis ?? s.startMillis)
    );

  const columns = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, b]) => {
      const top = y(b.max);
      const bottom = y(b.min);
      return {
        minute: key * bucket,
        x: x(key * bucket) - width / 2,
        y: top,
        // A bucket whose readings were all identical still has to draw
        // something, or a perfectly steady stretch reads as a gap.
        height: Math.max(0.9, bottom - top),
        low: b.min,
        high: b.max,
        mean: Math.round(b.sum / b.n),
        // Where that bucket's average sits, so a run line can be drawn through
        // the middle of the spread without the page deriving a second opinion
        // about the scale.
        meanY: y(Math.round(b.sum / b.n)),
        centreX: x(key * bucket),
        session: inSession(b.t),
      };
    });

  const sorted = [...values].sort((a, b) => a - b);
  const resting = percentile(sorted, RESTING_PERCENTILE);

  return {
    height,
    width,
    columns,
    // The same day as a run line: one point per bucket at that bucket's average,
    // broken wherever the strap stopped reporting. Only the enlarged view draws
    // it - at row width the columns already fill every pixel and a line through
    // them adds nothing - but a gap bridged by a straight segment would claim a
    // heart rate for minutes that have none, so the break is part of the
    // geometry rather than a drawing detail.
    runSegments: runSegments(columns, bucket),
    axisLow,
    axisHigh,
    low,
    high,
    resting,
    restingY: y(resting),
    average: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    samples: points.length,
    firstMillis: points[0].t,
    lastMillis: points[points.length - 1].t,
    // Session shading in the same coordinate space, so the page does not
    // compute a second opinion about where a session sat on the axis.
    sessionBands: (sessions ?? [])
      .filter((s) => s && Number.isFinite(s.startMillis))
      .map((s) => {
        const from = Math.max(firstMinute, minuteOfDay(s.startMillis));
        const to = Math.min(lastMinute, minuteOfDay(s.endMillis ?? s.startMillis));
        return to <= from ? null : { x: x(from), width: x(to) - x(from) };
      })
      .filter(Boolean),
  };
}

// hourTicks lives in ./dayAxis, shared with the stress page: both draw one day
// clipped to what was reported, and both label it the same way.
