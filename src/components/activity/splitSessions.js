// Cutting one band record into the two activities it actually was.
//
// The case this exists for, measured on the real archive: 2026-08-04 came back
// as a single record 17:33-20:31 with `hrMax` 203, covering a gym session that
// ended about 20:07 and the walk home after it. Both boundaries are the band's
// and both are defensible on heart rate, but Atlas could annotate and merge and
// not split, so the walk home was stuck inside the gym session.
//
// **The aggregates are recomputed, not apportioned.** That record's 203 is not
// supported by anything: the same day's stored heart-rate samples peak at 173
// across all 1,374 of them. Handing each half a share of a figure the samples
// contradict would carry the defect into both halves, and the walk home would
// inherit a peak from a set of stairs it was nowhere near. So each part's
// average, max and min come from the samples inside its own window.
//
// The exception is **active seconds, which cannot be recomputed** and is
// apportioned by span with a flag saying so. The band's active time excludes
// the pauses it decided you had stopped for, and nothing in a heart-rate series
// says where those were - a sample every minute looks the same whether you were
// resting between climbs or standing at a crossing. Inventing a pause structure
// would be worse than dividing by time and admitting it.

/** Samples inside `[from, to)`, which is how a boundary lands in exactly one part. */
function within(samples, from, to) {
  return (samples ?? []).filter(
    (s) => s && Number.isFinite(s.t) && Number.isFinite(s.v) && s.t >= from && s.t < to
  );
}

function aggregate(samples) {
  if (!samples.length) return null;
  const values = samples.map((s) => s.v);
  return {
    hrAvg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    hrMax: Math.max(...values),
    hrMin: Math.min(...values),
    samples: values.length,
  };
}

/** Null rather than zero: a share of nothing measured is still nothing measured. */
function share(total, fraction) {
  if (total == null || !Number.isFinite(total)) return null;
  return Math.round(total * fraction);
}

/**
 * Two records from one, cut at `atMillis`.
 *
 * `hrSamples` is the day's stored heart rate as `{ t, v }`; pass an empty array
 * and every part falls back to the band's own figures, which is the honest
 * result when there is nothing to recompute from.
 *
 * Returns `null` when the cut is not strictly inside the record, since a split
 * at either end produces one real session and one empty one, and an empty
 * session is a row that says a thing happened for no time at all.
 */
export function splitWorkout(workout, atMillis, hrSamples = []) {
  if (!workout || !Number.isFinite(atMillis)) return null;
  const start = workout.startMillis;
  const end = workout.endMillis ?? workout.startMillis;
  if (!(atMillis > start && atMillis < end)) return null;

  const span = end - start;
  const parts = [
    { startMillis: start, endMillis: atMillis },
    { startMillis: atMillis, endMillis: end },
  ];

  return parts.map((part, i) => {
    const measured = aggregate(within(hrSamples, part.startMillis, part.endMillis));
    const fraction = (part.endMillis - part.startMillis) / span;

    return {
      ...workout,
      startMillis: part.startMillis,
      endMillis: part.endMillis,
      // **A part files its own annotations under its own start**, which is the
      // whole point of cutting: the gym half and the walk home get typed and
      // named separately. Inherited from a parent whose start had been corrected
      // by hand, `recordStartMillis` would send every part's lookup back to the
      // parent's annotation and both halves would come out with one type.
      recordStartMillis: part.startMillis,
      // Cleared for the same reason: a part has not had ITS start corrected, so
      // carrying the parent's original would make the sheet offer to revert to a
      // time this part never began at.
      bandStartMillis: null,

      // Apportioned, and said so. The sheet prints this as an estimate rather
      // than as something the band reported.
      activeSeconds: share(workout.activeSeconds, fraction),
      activeSecondsApportioned: workout.activeSeconds != null,
      caloriesKcal: share(workout.caloriesKcal, fraction),
      distanceMeters:
        workout.distanceMeters == null || !Number.isFinite(workout.distanceMeters)
          ? null
          : workout.distanceMeters * fraction,

      // Measured where the samples allow it, and the band's own figure kept
      // otherwise - never a share of it, which would be a heart rate nobody
      // recorded. `hrRecomputed` is what lets the sheet explain the difference
      // when a part's max comes back well under the record's.
      hrAvg: measured ? measured.hrAvg : (workout.hrAvg ?? null),
      hrMax: measured ? measured.hrMax : (workout.hrMax ?? null),
      hrMin: measured ? measured.hrMin : (workout.hrMin ?? null),
      hrRecomputed: measured != null,
      hrSampleCount: measured ? measured.samples : 0,

      // What the record said before it was cut, so a split can always be read
      // back against the thing it came from. Same reasoning as `resolve`
      // keeping `bandActiveSeconds`: an edit that hides the original is
      // indistinguishable from bad data.
      bandHrMax: workout.hrMax ?? null,
      bandActiveSeconds: workout.activeSeconds ?? null,

      split: true,
      splitIndex: i,
      splitOf: start,
      splitAt: atMillis,

      // A merged record that is then split would otherwise keep claiming to be
      // a merge, and its parts list describes spans these halves do not have.
      merged: false,
      mergedCount: undefined,
      mergedParts: undefined,
    };
  });
}

/**
 * Every session a record resolves to, given the cuts stored against it.
 *
 * Cuts are applied left to right, each one splitting the part it falls inside,
 * so several cuts on one record produce several sessions rather than only ever
 * two. Cuts outside the record are ignored rather than dropped from storage:
 * a re-synced record whose timestamps shifted should not silently lose them.
 */
export function applySplits(workout, cuts, hrSamples = []) {
  const points = [...new Set(cuts ?? [])].filter(Number.isFinite).sort((a, b) => a - b);
  if (!workout || !points.length) return workout ? [workout] : [];

  let out = [workout];
  for (const at of points) {
    const next = [];
    for (const part of out) {
      const halves = splitWorkout(part, at, hrSamples);
      if (halves) next.push(...halves);
      else next.push(part);
    }
    out = next;
  }
  return out;
}
