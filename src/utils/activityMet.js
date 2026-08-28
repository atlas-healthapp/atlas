/**
 * A metabolic equivalent per activity, for the two places Atlas cannot measure.
 *
 * **This is the last resort and it is meant to be.** Measured on the real
 * archive and written up in `sessionCalories.js`: calories from heart rate land
 * within 4.2% of the band's own figure, where a MET table manages 9.1% at its
 * most flattering. So the band's figure wins wherever it exists, heart rate from
 * the archive wins next, and a MET only decides two things:
 *
 * 1. A manual session over a window with no heart-rate samples at all - the
 *    strap was off, or on a charger.
 * 2. How a split's calories divide between two parts of different activities,
 *    where it replaces "by time" as the divider. It never invents a total there;
 *    the band measured that and the parts still sum to it.
 *
 * **Matched on the name, and nothing is stored.** Session types are user-made
 * with generated ids, so there is no built-in type to hang a field off. Name
 * matching needs no migration and no editor - and an editor here would ask
 * people to know what a MET is, for a number that almost never reaches a screen.
 * A name that is not in this table has no MET and falls back, which is what
 * makes the whole thing additive: an unrecognised activity behaves exactly as it
 * does today.
 *
 * **The values are from Ainsworth et al., 2011 Compendium of Physical
 * Activities** (Med Sci Sports Exerc 43(8):1575-81), with the entry named
 * beside each so a disagreement is about the right row rather than about the
 * number. They are population averages with very large individual variation,
 * which is exactly why anything derived from them is marked and rounded coarsely
 * by `roundEstimate`.
 *
 * **Climbing is 5.8 on purpose, for both kinds.** The Compendium's 7.5 is
 * "ascending rock, high difficulty" and 5.8 is "ascending or traversing rock,
 * low-to-moderate difficulty", and the second is the honest one for a session
 * that includes the belaying. Measured against this user's own strap: a
 * 130-minute climb at 120 bpm came back from the band at 877 kcal, which is
 * about 5.6 MET at 71 kg. Picking 7.5 would have put the estimate 40% above what
 * the strap measures for the same activity. Outdoor is the same figure rather
 * than higher, on the user's own account: the approach between boulders is
 * hiking and gets logged as hiking, so what is left is the same standing about
 * and climbing that happens indoors.
 */

/** Keyed by the names in `SUGGESTED_TYPES`, which is the list this hangs off. */
export const ACTIVITY_MET = {
  // 15300 boxing, sparring. Bag work alone is 5.5; a class is nearer sparring.
  boxing: 7.8,
  // 01020 bicycling, 12-13.9 mph, leisure, moderate effort.
  cycling: 8.0,
  // 15610 soccer, casual, general.
  football: 7.0,
  // Between 02054 (multiple exercises, 8-15 reps, 3.5) and 02050 (vigorous, 6.0).
  // A gym hour is neither circuit training nor a single heavy lift.
  gym: 5.0,
  // 02040 circuit training, general, which is what a HIIT class is.
  hiit: 8.0,
  // 17080 hiking, cross country.
  hiking: 6.0,
  // 15535 rock climbing, ascending or traversing, low-to-moderate difficulty.
  "indoor climbing": 5.8,
  "outdoor climbing": 5.8,
  // Between 02068 (stationary, moderate, 4.8) and vigorous (8.5).
  rowing: 7.0,
  // 12050 running, 6 mph (10 min mile).
  running: 9.8,
  // 18240 swimming laps, freestyle, light to moderate effort.
  swimming: 5.8,
  // 15675 tennis, general.
  tennis: 7.3,
  // 17190 walking, 3.0 mph, level, moderate pace.
  walking: 3.5,
  // 02150 yoga, hatha.
  yoga: 2.5,
};

/**
 * The MET for a type name, or null when Atlas does not recognise it.
 *
 * Null rather than a default, always. A generic figure standing in for an
 * activity nobody described is the precise-looking wrong number this whole file
 * is written to avoid, and falling back to the band is a better answer than
 * guessing.
 */
export function metForTypeName(name) {
  if (typeof name !== "string") return null;
  // Case and surrounding space only. Nothing cleverer: a fuzzy match that turned
  // "Bouldering" into "Indoor Climbing" would be inventing an activity, and the
  // cost of missing is only that the band's own figure is used instead.
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  return ACTIVITY_MET[key] ?? null;
}

/**
 * How a split's calories divide between its parts, as a fraction each.
 *
 * **Time is the fallback and it is not a lesser answer**, it is the right one
 * whenever the parts cost about the same per minute - which is the boulder-day
 * case exactly, hiking at 6.0 against climbing at 5.8. The ratio only earns its
 * place when the activities genuinely differ.
 *
 * It replaces the divider, never the total. The band measured the whole and the
 * parts still sum to it, which is the property that makes this safe: nothing is
 * invented, a measured figure is only distributed differently.
 *
 * Returns null when the ratio has nothing to add - any part with no MET, or two
 * METs closer together than `MET_DIFFERENCE_FLOOR` - and the caller keeps
 * dividing by time as before.
 *
 * Written for N parts rather than two because a record can be cut more than
 * once, and a two-part version plus a general one would be two statements of the
 * same rule waiting to disagree.
 */
/**
 * How far apart two METs must be before the difference is worth acting on.
 *
 * **Equality is the wrong test and the boulder day proved it.** Hiking at 6.0
 * against climbing at 5.8 is a 3.4% difference, which is not equal and is also
 * not evidence of anything: these are population averages with very large
 * individual variation, and the Compendium lists several entries spanning a far
 * wider range for each of these activities. Moving a measured calorie total
 * around on a 3% gap between two averages is precision the source cannot carry.
 *
 * Fifteen percent clears every pairing that genuinely differs - running 9.8
 * against walking 3.5, gym 5.0 against walking - while leaving the ones that are
 * the same activity wearing two names.
 */
export const MET_DIFFERENCE_FLOOR = 0.15;

export function metFractions(parts) {
  const rows = parts ?? [];
  if (rows.length < 2) return null;
  if (!rows.every((p) => Number.isFinite(p?.seconds) && p.seconds > 0)) return null;
  if (!rows.every((p) => Number.isFinite(p?.met) && p.met > 0)) return null;
  const lowest = Math.min(...rows.map((p) => p.met));
  const highest = Math.max(...rows.map((p) => p.met));
  if ((highest - lowest) / lowest < MET_DIFFERENCE_FLOOR) return null;

  const weights = rows.map((p) => p.seconds * p.met);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) return null;
  return weights.map((w) => w / total);
}
