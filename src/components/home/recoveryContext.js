// What preceded each Recovery term, for the lines that sit under its bar.
//
// The first version of this put a line on every term every day, and the user
// read it exactly as intended and exactly wrongly: on a day scoring 55 with
// every reading inside its normal range, naming a session and a late bedtime
// reads as "these are why you are down". Nothing was down. The score was 55
// because matching your baseline is half marks, not because Wednesday went
// badly.
//
// So the gate is the point of this module, more than the wording is.
//
//   - HRV and resting HR get a line only when the reading is genuinely outside
//     its normal band. A term can give up a lot of points while sitting well
//     inside normal - HRV gave up 34 of 50 on the day this was found - so the
//     points cost is the wrong trigger and the band is the right one.
//   - Sleep has no band, since it is scored against a goal rather than against
//     a baseline, so it triggers on giving up points worth acting on.
//
// The result is that an ordinary day carries no lines at all, and the card
// underneath describes the day without anyone being accused of anything.

import { activeMinutes, durationText, clockTime } from "@/components/home/dayMarkers";

/** Points a term must have given up before its line is worth printing. */
const MEANINGFUL_POINTS = 3;
/** Minutes past the usual bedtime before "late" means anything. */
const LATE_MINUTES = 30;

/** Bands that mean "this reading is where it usually is". */
const IN_RANGE = new Set(["normal", "unknown", null, undefined]);

function trainingLine(sessions) {
  const minutes = activeMinutes(sessions);
  if (!minutes) return null;
  const last = sessions.reduce((a, b) => (b.endMillis > a.endMillis ? b : a));
  return `AFTER ${durationText(minutes)} TRAINING TO ${clockTime(last.endMillis)}`;
}

/**
 * A line per term, keyed the same way recoveryBreakdown keys its rows.
 *
 * `rows` is that breakdown, so the band and the points come from the same place
 * the page prints them and cannot disagree with what is on screen.
 */
export function termContext({ rows = [], sessions = [], bedMs = null, usualBedMinutes = null, bedMinutes = null } = {}) {
  const out = {};

  const training = trainingLine(sessions);
  for (const row of rows) {
    if (row.key === "sleep") continue;
    if (IN_RANGE.has(row.band)) continue;
    if (!training) continue;
    out[row.key] = training;
  }

  const sleep = rows.find((r) => r.key === "sleep");
  if (sleep && sleep.maxPoints - sleep.points >= MEANINGFUL_POINTS && bedMs != null) {
    const late =
      usualBedMinutes != null && bedMinutes != null ? Math.round(bedMinutes - usualBedMinutes) : null;
    out.sleep =
      late != null && late >= LATE_MINUTES
        ? `IN BED ${clockTime(bedMs)}, ${late} MIN LATE`
        : `IN BED ${clockTime(bedMs)}`;
  }

  return out;
}
