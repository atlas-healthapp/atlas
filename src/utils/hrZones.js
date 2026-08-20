// Heart-rate zones, and where a reading sits in them.
//
// ## The maximum is Tanaka, not the archive's biggest number
//
// `208 - 0.7 x age`, from the person's date of birth, which Atlas already has.
// It updates on its own birthday and needs nothing new.
//
// **The band's own reported peaks are not usable for this and that is measured,
// not assumed.** The workout summaries on this archive claim maxima up to 203,
// while all 1,374 stored samples from the same day top out at 173 - the defect
// `splitSessions.js` partly exists because of. Zones built on 203 would sit
// about 9% high across the board and every session would read a zone low.
//
// A peak found in the STORED SAMPLES is a different matter: those are the
// readings that survived `isMeaningful`, so they are the ones with an argument
// behind them. `maxHeartRate` will take one when it beats the formula, because a
// figure you have actually hit is better evidence than a population curve, and
// refuses the summary figures entirely.
//
// ## The colours live in style.css, not here
//
// This is geometry. Which hue a zone takes is a design decision with a measured
// contrast argument behind it, and it belongs beside the other ramps.

/** Zone boundaries as a fraction of maximum, the conventional five. */
export const ZONE_FLOORS = [0.5, 0.6, 0.7, 0.8, 0.9];

/** What each zone is called. Named, because colour is never the only channel. */
export const ZONE_NAMES = ["VERY LIGHT", "LIGHT", "MODERATE", "HARD", "MAXIMUM"];

/**
 * Tanaka, Monahan and Seals (2001), which fits observed maxima better across
 * adult ages than the `220 - age` everyone quotes. At 32 it gives 186 rather
 * than 188, and the gap widens with age, which is exactly where `220 - age` is
 * known to be worst.
 */
export function formulaMax(ageYears) {
  if (!Number.isFinite(ageYears) || ageYears <= 0) return null;
  return Math.round(208 - 0.7 * ageYears);
}

/**
 * The maximum to build zones from.
 *
 * `observedPeak` must come from stored samples. Passing the band's summary
 * `hrMax` here would reintroduce exactly the figure this refuses.
 */
export function maxHeartRate({ ageYears, observedPeak = null }) {
  const formula = formulaMax(ageYears);
  if (formula == null) return Number.isFinite(observedPeak) ? observedPeak : null;
  // Only ever raised by evidence, never lowered by its absence: somebody who has
  // not yet worked hard has not disproved the formula.
  return Number.isFinite(observedPeak) && observedPeak > formula ? observedPeak : formula;
}

/**
 * The five zones as `{ name, from, to }`, lowest first.
 *
 * `from` of zone one is 50% of maximum rather than zero, because below that is
 * not a zone, it is sitting down. Every chart drawn from this must therefore
 * print both ends: an axis that does not start at zero and does not say so is
 * the defect `nightlyBars` carries a warning about.
 */
export function zones(max) {
  if (!Number.isFinite(max) || max <= 0) return [];
  return ZONE_FLOORS.map((floor, i) => ({
    name: ZONE_NAMES[i],
    from: Math.round(max * floor),
    to: i === ZONE_FLOORS.length - 1 ? max : Math.round(max * ZONE_FLOORS[i + 1]),
  }));
}

/**
 * Which zone a reading is in: 1 to 5, or null.
 *
 * **Null below the first floor rather than zone one.** A reading of 60 while
 * sitting is not "very light exercise", and calling it that would put a resting
 * heart rate on an effort scale.
 */
export function zoneOf(bpm, max) {
  if (!Number.isFinite(bpm) || !Number.isFinite(max) || max <= 0) return null;
  const fraction = bpm / max;
  if (fraction < ZONE_FLOORS[0]) return null;
  for (let i = ZONE_FLOORS.length - 1; i >= 0; i--) {
    if (fraction >= ZONE_FLOORS[i]) return i + 1;
  }
  return null;
}

/**
 * Where a reading sits along the strip, 0 to 1, for placing a caret.
 *
 * The strip spans the first floor to the maximum, so the fraction is measured
 * across that span rather than from zero. Clamped, because a reading above the
 * formula's maximum is a real event and the caret has to stay on the axis.
 */
export function zonePosition(bpm, max) {
  if (!Number.isFinite(bpm) || !Number.isFinite(max) || max <= 0) return null;
  const from = max * ZONE_FLOORS[0];
  if (max === from) return null;
  return Math.max(0, Math.min(1, (bpm - from) / (max - from)));
}
