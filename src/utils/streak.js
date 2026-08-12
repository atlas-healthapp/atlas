// How many days running a target has been met. Pure, so the rule about what
// today counts as is testable rather than buried in a component.

import { addDays } from "@/utils/date";

// Far enough back to cover any streak worth showing, short enough that the
// walk stays cheap when a metric has never been hit.
export const MAX_LOOKBACK = 400;

// A single day is not a streak, and labelling it one makes the chip appear and
// vanish daily for no reason.
export const MIN_SHOWN = 2;

/**
 * Consecutive days ending today on which `hitOn(dateKey)` was true.
 *
 * Today is treated as pending rather than failed: a day still in progress does
 * not break a streak, it just does not extend it yet. Counting today as a miss
 * would reset every streak in the app at midnight and rebuild it each evening,
 * which is the opposite of what the number is for.
 */
export function currentStreak(todayKey, hitOn, { maxDays = MAX_LOOKBACK } = {}) {
  let cursor = hitOn(todayKey) ? todayKey : addDays(todayKey, -1);
  let days = 0;
  for (let i = 0; i < maxDays; i += 1) {
    if (!hitOn(cursor)) break;
    days += 1;
    cursor = addDays(cursor, -1);
  }
  return days;
}
