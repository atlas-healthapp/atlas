// Stress over a fortnight: one stacked column per day, showing how long was
// spent in each zone.
//
// Not a daily average, which is what the rollups already hold and would have
// been free. A mean is exactly the smoothing StressPage rejects at the day
// scale: a day with two hard sessions and a calm evening averages to the same
// number as a flat mediocre one, and stressDay.js draws columns rather than a
// line specifically so that cannot happen. Reintroducing it a zoom level out
// would make the page disagree with itself.
//
// Fourteen days rather than thirty because this needs raw samples rather than
// rollups: at roughly 300 stress readings a day that is ~4,000 rows per open
// against ~9,000, and there is already a deferred ticket about unbounded reads.

import { zoneMinutes, STRESS_ZONES } from "./stressDay";
import { trimLeadingBlanks } from "@/utils/historyChart";

export const HISTORY_DAYS = 14;

/** Local date key for a timestamp, matching the rest of the app's "sv" keys. */
function dateKeyOf(t) {
  return new Date(t).toLocaleDateString("sv");
}

/**
 * Group raw samples into days, then into zone minutes per day.
 *
 * `dates` is the run of days to draw, oldest first, and is passed in rather
 * than derived from the samples: a day the strap recorded nothing still needs
 * its slot, or the axis silently closes up and a fortnight with a gap in it
 * reads as an unbroken fortnight.
 */
export function stressByDay(samples, dates) {
  const byDate = new Map(dates.map((d) => [d, []]));
  for (const s of samples ?? []) {
    if (!s || !Number.isFinite(s.t) || !Number.isFinite(s.v)) continue;
    const bucket = byDate.get(dateKeyOf(s.t));
    if (bucket) bucket.push(s);
  }
  return dates.map((date) => ({ date, ...zoneMinutes(byDate.get(date)) }));
}

/**
 * Stacked columns, in a 0-100 by `height` coordinate space.
 *
 * Absolute minutes, never normalised to the day's own measured time. A day the
 * strap was worn for four hours would otherwise draw a full-height column and
 * be indistinguishable from a calm day worn throughout; short wear has to look
 * short. Same rule as the routine's "a day nothing was due draws nothing".
 *
 * The axis is the busiest day in the window, not 24 hours, because nobody wears
 * a strap for 24 hours and scaling to one would draw every column in the bottom
 * half. Callers must print what the top of the axis is, the way nightlyBars
 * requires both ends of its range to be shown.
 */
export function stressHistoryColumns(days, { height = 46, gap = 0.3 } = {}) {
  // Leading blanks only, the app-wide rule: a fortnight that reaches back past
  // the start of the archive would open with days the band could not have
  // measured, which reads as days it was not worn.
  const list = trimLeadingBlanks(days, (d) => d.measured > 0);
  if (!list.length) {
    return { columns: [], peakMinutes: 0, measuredDays: 0, from: null, to: null, days: 0 };
  }

  const peak = Math.max(...list.map((d) => d.measured), 0);
  const slot = 100 / list.length;
  const width = slot * (1 - gap);

  const columns = list.map((d, i) => {
    const x = i * slot + (slot - width) / 2;
    const segments = [];
    let y = height;

    // Calm at the bottom, high at the top, so a bad day grows upward. The
    // order is STRESS_ZONES' own, which is calm to high.
    for (const zone of STRESS_ZONES) {
      const minutes = d.totals?.[zone.key] ?? 0;
      if (minutes <= 0) continue;
      const h = peak > 0 ? (minutes / peak) * height : 0;
      y -= h;
      segments.push({ key: zone.key, token: zone.token, y, height: h, minutes });
    }

    return {
      date: d.date,
      x,
      width,
      segments,
      measured: d.measured,
      empty: d.measured <= 0,
    };
  });

  return {
    columns,
    peakMinutes: Math.round(peak),
    measuredDays: list.filter((d) => d.measured > 0).length,
    // What was actually drawn, so the axis under it cannot name a day that was
    // trimmed off the front.
    from: list[0].date,
    to: list.at(-1).date,
    days: list.length,
  };
}
