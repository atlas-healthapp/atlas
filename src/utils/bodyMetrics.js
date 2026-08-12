// Pure daily-rollup maths for wearable body metrics. No I/O, no storage.
// Every rule here was verified against the user's real exported Gadgetbridge
// database on 2026-07-25 (see docs/superpowers/specs/2026-07-25-body-metrics-design.md).

const HR_MIN = 25;
const HR_MAX = 200;
const RESTING_HR_PERCENTILE = 10;

// Table, column and timestamp unit for each metric. Verified against the real
// export - do not substitute column names.
export const BODY_METRICS = {
  steps: {
    table: "HUAMI_EXTENDED_ACTIVITY_SAMPLE",
    column: "STEPS",
    tsUnit: "s",
    rollup: "sum",
  },
  // Raw HR is restingHr's fallback source, and since 2026-08-06 it is also a
  // metric in its own right with a page of its own.
  //
  // The daily figure is a **mean across everything reported**, which is a
  // genuinely weak number - it mixes a night at 50 with a session at 170 - and
  // that is exactly why the page draws the day rather than leading on it. The
  // row exists to open the page; the shape is the point.
  //
  // Days rolled up before this changed have no `hr` key, since a frozen rollup
  // is never recomputed. They read as no data rather than as zero, and the page
  // itself works from raw samples so its own charts are unaffected.
  hr: {
    table: "HUAMI_EXTENDED_ACTIVITY_SAMPLE",
    column: "HEART_RATE",
    tsUnit: "s",
    rollup: "mean",
  },
  restingHr: {
    table: "HUAMI_HEART_RATE_RESTING_SAMPLE",
    column: "HEART_RATE",
    tsUnit: "ms",
    rollup: "latest",
  },
  stress: {
    table: "HUAMI_STRESS_SAMPLE",
    column: "STRESS",
    tsUnit: "ms",
    rollup: "mean",
  },
  spo2: {
    table: "HUAMI_SPO2_SAMPLE",
    column: "SPO2",
    tsUnit: "ms",
    rollup: "mean",
  },
  hrv: {
    table: "GENERIC_HRV_VALUE_SAMPLE",
    column: "VALUE",
    tsUnit: "ms",
    rollup: "mean",
  },
  skinTemp: {
    table: "GENERIC_TEMPERATURE_SAMPLE",
    column: "TEMPERATURE",
    tsUnit: "ms",
    rollup: "mean",
  },
  respRate: {
    table: "HUAMI_SLEEP_RESPIRATORY_RATE_SAMPLE",
    column: "RATE",
    tsUnit: "ms",
    rollup: "mean",
  },
  // PAI_TOTAL is the 7-day rolling score Zepp shows as "your PAI".
  // PAI_TODAY is only that day's contribution.
  pai: {
    table: "HUAMI_PAI_SAMPLE",
    column: "PAI_TOTAL",
    tsUnit: "ms",
    rollup: "latest",
  },
};

export function percentile(values, p) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(rank);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const value = sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
  return Math.round(value * 10) / 10;
}

export function mean(values) {
  if (!values || values.length === 0) return null;
  const total = values.reduce((sum, v) => sum + v, 0);
  return Math.round((total / values.length) * 10) / 10;
}

// 255 is the device's "no reading" sentinel, not a real heart rate.
export function isValidHr(v) {
  return typeof v === "number" && v >= HR_MIN && v <= HR_MAX;
}

// Physiological limits: a value outside these bounds is not a real reading
// (e.g. a 0 spo2 is the sensor failing to get a lock, not a patient outcome),
// so it is dropped rather than stored and later averaged into a daily rollup.
// stress and pai legitimately include 0, so those are not blanket-rejected the
// way the others are.
const PLAUSIBLE_RANGE = {
  spo2: [70, 100],
  hrv: [1, 500],
  respRate: [1, 60],
  skinTemp: [20, 45],
  stress: [0, 100],
  pai: [0, 1000],
  // **0 is a real battery reading, not a sentinel**, which is why this needs its
  // own entry rather than borrowing the "value > 0" rule steps uses. A strap
  // that ran flat is exactly the event the days-per-charge figure is measuring
  // the distance to.
  strapBattery: [0, 100],
  strapCharging: [1, 1],
  // No hr/restingHr entries: both are heart rates and both defer to
  // isValidHr, which is also what the resting-HR fallback filters on. Keeping
  // a copy of those bounds here as well gave three places to drift apart.
};

// Lives here rather than in a source module because it is a fact about human
// physiology, not about where the reading came from. Every source has to apply
// the same rule, and a second copy would be a second thing to keep in step.
// Rows with no reading are not worth storing: a 255 heart rate is the device's
// "no reading" sentinel, and a zero-step minute is just an idle minute.
export function isMeaningful(metric, value) {
  if (value == null) return false;
  if (metric === "hr" || metric === "restingHr") return isValidHr(value);
  if (metric === "steps") return value > 0;
  const range = PLAUSIBLE_RANGE[metric];
  if (range) return value >= range[0] && value <= range[1];
  return true;
}

// The strap computes its own resting HR using sensor-confidence data we cannot
// see, so it is always preferred. The fallback is a low percentile rather than
// a raw minimum: a single spurious low reading distorts a minimum, and against
// the device's own values the 10th percentile scored 0.3bpm mean error where
// the raw minimum scored 7.3bpm.
export function restingHrFor(deviceValue, dayHrSamples) {
  if (deviceValue != null) return deviceValue;
  const valid = (dayHrSamples ?? []).filter(isValidHr);
  return percentile(valid, RESTING_HR_PERCENTILE);
}

// `values` must be in ascending timestamp order for "latest" to be meaningful.
export function rollupFor(kind, values) {
  if (!values || values.length === 0) return null;
  if (kind === "sum") return values.reduce((sum, v) => sum + v, 0);
  if (kind === "mean") return mean(values);
  if (kind === "latest") return values[values.length - 1];
  return null;
}
