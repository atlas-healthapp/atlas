// Folding several band records into the one session they actually were.
//
// The band sometimes splits a climb across two summaries. Combining them is
// mostly obvious and has exactly one trap, which is why this is a module of its
// own with tests rather than a few lines inside a component.

/**
 * One session from several records.
 *
 * The traps, in order of how quietly they lie:
 *
 * **Duration sums the active seconds; it does not measure the span.** The gap
 * between two halves of a split climb is the band deciding you had stopped. It
 * was not climbing, and counting it would inflate every merged session by
 * however long the band was wrong for.
 *
 * **Average heart rate is weighted by each part's active time.** A plain mean of
 * a seventy-minute half at 138 and a ten-minute half at 96 reports 117, which
 * neither half recorded and the session never averaged. The weighted figure is
 * 133.
 *
 * **Max and min are taken across the parts**, not from the longest one: a peak
 * in the short half is still the session's peak.
 *
 * Distance and altitude are summed and averaged respectively where present, and
 * left null when no part reported them - an indoor session has neither, and a
 * zero would read as a measurement.
 */
export function mergeWorkouts(records) {
  const parts = (records ?? []).filter(Boolean).sort((a, b) => a.startMillis - b.startMillis);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];

  const owner = parts[0];
  const activeSeconds = sumOf(parts, "activeSeconds");
  const weighted = weightedAverage(parts, "hrAvg", "activeSeconds");

  return {
    ...owner,
    startMillis: owner.startMillis,
    endMillis: Math.max(...parts.map((p) => p.endMillis ?? p.startMillis)),
    activeSeconds,
    caloriesKcal: sumOf(parts, "caloriesKcal"),
    hrAvg: weighted,
    hrMax: maxOf(parts, "hrMax"),
    hrMin: minOf(parts, "hrMin"),
    distanceMeters: sumOf(parts, "distanceMeters"),
    altitudeAvgMeters: weightedAverage(parts, "altitudeAvgMeters", "activeSeconds"),
    merged: true,
    mergedCount: parts.length,
    // Kept so the sheet can show what was folded in. A merge that hides its own
    // parts cannot be checked, and this one changes the duration.
    mergedParts: parts.map((p) => ({
      startMillis: p.startMillis,
      activeSeconds: p.activeSeconds ?? null,
    })),
  };
}

function present(parts, key) {
  return parts.map((p) => p[key]).filter((v) => v != null && Number.isFinite(v));
}

/** Null rather than zero when nothing reported it: zero is a measurement. */
function sumOf(parts, key) {
  const values = present(parts, key);
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0);
}

function maxOf(parts, key) {
  const values = present(parts, key);
  return values.length ? Math.max(...values) : null;
}

function minOf(parts, key) {
  const values = present(parts, key);
  return values.length ? Math.min(...values) : null;
}

/**
 * Weighted by `weightKey`, falling back to a plain mean only when no part
 * carries a weight - which is the one case where every part counts equally
 * because nothing is known about their lengths.
 */
function weightedAverage(parts, key, weightKey) {
  const usable = parts.filter(
    (p) => p[key] != null && Number.isFinite(p[key])
  );
  if (!usable.length) return null;

  const totalWeight = usable.reduce(
    (sum, p) => sum + (Number.isFinite(p[weightKey]) ? p[weightKey] : 0),
    0
  );
  if (!totalWeight) {
    return Math.round(usable.reduce((sum, p) => sum + p[key], 0) / usable.length);
  }

  const weighted = usable.reduce(
    (sum, p) => sum + p[key] * (Number.isFinite(p[weightKey]) ? p[weightKey] : 0),
    0
  );
  return Math.round(weighted / totalWeight);
}
