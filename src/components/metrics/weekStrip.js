// The last seven days as a row you can tap, for metrics you enter by hand.
//
// **The case it exists for is "I forgot yesterday", not "take me to March".**
// Logging *today* was already one tap - `MetricPage`'s ADD TODAY'S ... button
// sits above the mark - but amending any other day meant scrolling past the
// chart and the calendar, unfolding EVERY DAY, finding the day and tapping it.
// Measured on the real archive, the creatine log had gaps on the 19th, 22nd,
// 23rd, 25th and 26th of August: every one of them inside a week of being
// noticed.
//
// A week and no further, deliberately. The calendar below already reaches the
// whole window, and a strip long enough to do the same job would be a second
// calendar drawn worse.
//
// Pure, and takes the days rather than reading a store, so the geometry is
// testable without mounting the page. The same split every other `*.js` beside a
// component in this app follows.

import { addDays } from "@/utils/date";

/** How many days the strip shows. Seven, so it reads as "this week". */
export const STRIP_DAYS = 7;

/**
 * One letter per weekday, Sunday first to match `habits.js`'s day numbering.
 *
 * Letters rather than dates: seven `19 20 21` cells at label size wrap on a
 * phone, and the letters are what people read a week in anyway. The date is
 * still available - it is what the row says once a day is selected.
 */
const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * The strip, oldest first so it reads left to right like the chart above it.
 *
 * `values` is a lookup of dateKey to reading, which is what `MetricPage`'s
 * `days` array already provides. A day with no reading comes back with
 * `value: null` rather than being dropped: an empty dot is the entire point of
 * the strip, since it is what tells you which day you missed.
 */
export function weekStrip(values, todayKey, { days = STRIP_DAYS } = {}) {
  if (!todayKey) return [];
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(todayKey, -i);
    const value = values?.[date] ?? null;
    out.push({
      date,
      value,
      // Parsed as a local date rather than through `new Date(date)`, which
      // reads a bare YYYY-MM-DD as UTC and lands on the previous day for
      // anybody west of Greenwich.
      letter: LETTERS[new Date(`${date}T00:00:00`).getDay()],
      isToday: date === todayKey,
      logged: value != null,
    });
  }
  return out;
}

/**
 * What the strip says about itself, for the line above it.
 *
 * Counts what is missing rather than what is present. "5 of 7" is a score and
 * invites a judgement the strip is not making; "2 DAYS NOT LOGGED" names the
 * thing you can act on, and says nothing at all when there is nothing to act on.
 */
export function stripNote(strip) {
  const missed = (strip ?? []).filter((d) => !d.logged && !d.isToday).length;
  if (!missed) return "";
  return missed === 1 ? "1 DAY NOT LOGGED" : `${missed} DAYS NOT LOGGED`;
}
