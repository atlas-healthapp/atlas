/**
 * The strap's alarm, in Atlas's vocabulary rather than the protocol's.
 *
 * Two different week conventions meet here, which is the whole reason this is a
 * module with a test rather than an inline expression. Atlas counts weekdays the
 * way `Date.getDay()` does, **Sunday as 0**, which is what the food schedule and
 * the habit definitions store. The band's repeat byte counts from **Monday as
 * the low bit**. Getting that wrong does not fail loudly: it sets the alarm on
 * the wrong days, one out, and the first evidence is a Sunday it should not have
 * gone off on.
 */

/** Monday is the low bit through to Sunday at 0x40. */
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

/** No repeat: the band fires once and stops. */
export const REPEAT_ONCE = 0;

export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [1, 2, 3, 4, 5];

/**
 * @param days weekdays as `Date.getDay()` numbers, Sunday 0. Empty means a
 *             one-off.
 */
export function repeatMask(days) {
  if (!Array.isArray(days) || !days.length) return REPEAT_ONCE;
  let mask = 0;
  for (let bit = 0; bit < MONDAY_FIRST.length; bit++) {
    if (days.includes(MONDAY_FIRST[bit])) mask |= 1 << bit;
  }
  return mask;
}

/** The inverse, so a stored alarm can light its own day chips. */
export function daysFromMask(mask) {
  const days = [];
  for (let bit = 0; bit < MONDAY_FIRST.length; bit++) {
    if (mask & (1 << bit)) days.push(MONDAY_FIRST[bit]);
  }
  return days;
}

/** Zero-padded, so a column of times does not jump between 9 and 10. */
export function formatTime(hour, minute) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Which days, in words.
 *
 * "ONCE" is load-bearing rather than tidy: a one-off that has already fired is
 * still shown, because nothing here can read the band back to discover it is
 * spent. Naming it ONCE is what stops it reading as an alarm still set for
 * tomorrow.
 */
export function describeDays(days) {
  const list = days ?? [];
  if (!list.length) return "ONCE";
  if (list.length === 7) return "EVERY DAY";
  if (list.length === 5 && WEEKDAYS.every((d) => list.includes(d))) return "WEEKDAYS";
  const names = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  // Listed Monday-first to match the day letters, not in the order they were
  // tapped, or the same set reads differently depending on how it was entered.
  return MONDAY_FIRST.filter((d) => list.includes(d))
    .map((d) => names[d])
    .join(" ");
}

/** The whole thing on one line, for a status slot. */
export function describeAlarm(alarm) {
  if (!alarm) return "NOT SET";
  const time = formatTime(alarm.hour, alarm.minute);
  if (!alarm.enabled) return `${time} · OFF`;
  return `${time} · ${describeDays(alarm.days)}`;
}
