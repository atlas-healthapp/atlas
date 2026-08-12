// Sleep regularity: how alike consecutive 24-hour periods are, and where the
// user's usual window sits.
//
// The Sleep Regularity Index is not bedtime variance. It is the chance that any
// two moments 24 hours apart were in the same state, asleep or awake, which is
// the measure Windred et al. (2024) found predicted all-cause mortality better
// than duration did. Variance of bedtime cannot see a night cut short or a long
// lie-in; the SRI sees both, because it compares every minute of the day.
//
// Everything here works in "axis minutes": minutes past 21:00 on the evening a
// night belongs to. Clock time is useless for both the maths and the chart,
// because 23:50 and 00:10 are twenty minutes apart and 1430 apart as numbers.

/** The regularity chart's axis, and the frame every time here is expressed in. */
export const AXIS_START_HOUR = 21;
export const AXIS_END_HOUR = 13;
export const AXIS_SPAN_MINUTES = (24 - AXIS_START_HOUR + AXIS_END_HOUR) * 60;

/**
 * Under three nights the SRI is withheld and its weight redistributed, never
 * scored as zero. Two nights compare exactly one pair of days, so a single late
 * night would read as a chronically irregular sleeper.
 */
export const SRI_MIN_NIGHTS = 3;

/**
 * How many days of nights the index is taken over.
 *
 * Moved here from inside SleepPage on 2026-08-07, because it stopped being that
 * page's business: Home's dial and Recovery's sleep term now compute the same
 * score, and a window chosen per screen means one night scores differently
 * depending on where you look at it. Regularity is a property of a window, so the
 * window has to be part of the shared definition.
 */
export const SRI_WINDOW_DAYS = 7;

const MIN_MS = 60 * 1000;
const DAY_MINUTES = 24 * 60;

/**
 * Minutes past the 21:00 anchor of the night a time belongs to, or null if it
 * falls outside the 21:00 to 13:00 axis (an afternoon nap, most likely).
 */
export function axisMinutes(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  const hour = d.getHours();
  const minutes = hour * 60 + d.getMinutes();
  const fromAnchor =
    hour >= AXIS_START_HOUR
      ? minutes - AXIS_START_HOUR * 60
      : minutes + (24 - AXIS_START_HOUR) * 60;
  return fromAnchor >= 0 && fromAnchor <= AXIS_SPAN_MINUTES ? fromAnchor : null;
}

/**
 * Checkin entries reduced to the nights that carry a clock position.
 *
 * A night with no stored bedtime is dropped rather than placed. Those are the
 * nights committed before bedtimes were kept, and inventing a position for one
 * would make a night nobody can vouch for count against the regularity of every
 * night around it.
 */
export function nightsFrom(entries) {
  return (entries ?? [])
    .map((e) => ({
      date: e.date,
      bedMs: e.sleepStages?.bedTime ?? null,
      wakeMs: e.sleepStages?.wakeTime ?? null,
    }))
    .filter((n) => n.bedMs != null && n.wakeMs != null && n.wakeMs > n.bedMs)
    .sort((a, b) => a.bedMs - b.bedMs);
}

/**
 * The SRI over the nights given, 0..100.
 *
 * Every minute of the span is marked asleep or awake from the sleep intervals,
 * then compared with the same minute a day earlier. Minutes outside any night
 * count as awake, which is the standard consumer approximation: the band is not
 * asked about daytime naps and this does not claim to know about them.
 *
 * The published formula is 200 * agreement - 100, which runs to -100 for a
 * completely inverted schedule. Clamped at zero, because every other score in
 * the app is 0..100 and a negative one would draw a bar backwards.
 */
export function sleepRegularityIndex(nights) {
  const list = (nights ?? []).filter((n) => n.bedMs != null && n.wakeMs != null);
  if (list.length < SRI_MIN_NIGHTS) return null;

  const start = Math.floor(list[0].bedMs / MIN_MS);
  const end = Math.ceil(list[list.length - 1].wakeMs / MIN_MS);
  const total = end - start;
  if (total <= DAY_MINUTES) return null;

  const asleep = new Uint8Array(total);
  for (const n of list) {
    const from = Math.max(0, Math.floor(n.bedMs / MIN_MS) - start);
    const to = Math.min(total, Math.ceil(n.wakeMs / MIN_MS) - start);
    asleep.fill(1, from, to);
  }

  let agree = 0;
  const pairs = total - DAY_MINUTES;
  for (let i = 0; i < pairs; i++) {
    if (asleep[i] === asleep[i + DAY_MINUTES]) agree++;
  }

  return Math.max(0, Math.round(200 * (agree / pairs) - 100));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * The window the user usually sleeps in, as axis minutes.
 *
 * Median rather than mean, so one holiday night does not drag the band the rest
 * of the week is judged against. Same device RangeMark uses elsewhere: a late
 * night should read as outside your normal, not merely as further right than its
 * neighbours.
 */
export function usualWindow(nights) {
  const beds = [];
  const wakes = [];
  for (const n of nights ?? []) {
    const bed = axisMinutes(n.bedMs);
    const wake = axisMinutes(n.wakeMs);
    if (bed != null && wake != null) {
      beds.push(bed);
      wakes.push(wake);
    }
  }
  if (!beds.length) return null;
  return { bedMinutes: median(beds), wakeMinutes: median(wakes) };
}
