// What the routine says: today's state per habit, grouped into the four bands,
// and which one you are up to.
//
// Kept out of the components for the same reason homeModel.js is: the judgement
// calls here (what counts as a miss, what "next" means when the morning was
// missed, what a day before the habit existed counts as) are the part worth
// testing, and a .vue file cannot be.
//
// Replaced components/activity/habitRows.js, which ordered rows due-first for a
// flat list. Band order supersedes that: the routine is a sequence.

import { today, addDays } from "@/utils/date";
import { trimLeadingBlanks } from "@/utils/historyChart";
import { BANDS, bandOf, bandIndex, bandForHour } from "@/utils/bands";

// Matches habits.completionRate's default window, so a strip and a rate can
// never describe different stretches of time.
export const STRIP_DAYS = 30;

// Noon, matching the store, so a date string never lands on the wrong side of
// a DST boundary.
function weekday(date) {
  return new Date(date + "T12:00:00").getDay();
}

/**
 * One day of a habit's strip.
 *
 * - `hit`  - due and ticked.
 * - `miss` - due and not ticked, and the day is over.
 * - `due`  - due today and not ticked yet. **Not a miss**: the day is still
 *   running, and painting it as a failure at midnight is the same mistake
 *   streak.js exists to avoid.
 * - `off`  - the habit was not due (cadence), or did not exist yet.
 */
function stateFor(habits, habit, date, todayKey) {
  // Habits added before `created` existed have no date to compare against, so
  // they are treated as having always been there rather than as having been
  // missed every day since the app was installed.
  if (habit.created && date < habit.created) return "off";
  if (!habit.days.includes(weekday(date))) return "off";
  if (habits.isDone(habit.id, date)) return "hit";
  return date === todayKey ? "due" : "miss";
}

function windowDates(todayKey, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(addDays(todayKey, -i));
  return out;
}

/**
 * Every active habit as a row, in band order and then in the order they were
 * added.
 *
 * The order deliberately does not react to ticking: sorting done ones to the
 * bottom would move the next row under the finger that just tapped.
 */
export function habitRows(habits, todayKey = today(), days = STRIP_DAYS) {
  const dates = windowDates(todayKey, days);

  return (habits?.habits ?? [])
    .filter((h) => !h.archived)
    .map((h, order) => ({
      id: h.id,
      label: h.name.toUpperCase(),
      name: h.name,
      band: bandOf(h),
      order,
      dueToday: h.days.includes(weekday(todayKey)),
      doneToday: habits.isDone(h.id, todayKey),
      dots: dates.map((date) => ({
        date,
        state: stateFor(habits, h, date, todayKey),
      })),
    }))
    .sort((a, b) => bandIndex(a.band) - bandIndex(b.band) || a.order - b.order);
}

/**
 * The rows grouped into the four bands, every band present.
 *
 * An empty band still returns, because on Home a flat EVENING bar at 4pm is
 * exactly the thing worth seeing, and a band that vanished when it emptied
 * would take that reading with it.
 */
export function routineBands(habits, todayKey = today(), days = STRIP_DAYS) {
  const rows = habitRows(habits, todayKey, days);
  return BANDS.map((band) => {
    const inBand = rows.filter((r) => r.band === band.id);
    const due = inBand.filter((r) => r.dueToday);
    return {
      id: band.id,
      label: band.label,
      rows: inBand,
      due: due.length,
      done: due.filter((r) => r.doneToday).length,
    };
  });
}

/**
 * What the routine card says: what you are up to, and what got dropped.
 *
 * `next` is the first unticked habit **in the band the clock is in or later**.
 * Skip the shower and at four in the afternoon the card should be pointing at
 * the evening, not still asking for the shower - which is what it did, despite
 * a comment claiming otherwise, until this was made clock-aware.
 *
 * `missed` is what is still open in bands already gone. It is a count rather
 * than a row, because a day is allowed to be imperfect without the screen
 * turning into a list of failures - but silence would let two dropped habits
 * disappear behind one thin bar, so it is said out loud and quietly.
 *
 * When nothing is left in this band or later, `next` falls back to the **most
 * recent** thing still open rather than the earliest. The day is not done, and a
 * card claiming otherwise while a habit sits unticked would be lying - but at
 * ten at night, with the shower and the evening pill both outstanding, the pill
 * is the one you can still do. The earliest open habit is the least actionable
 * thing on the list.
 */
export function routineStatus(
  habits,
  todayKey = today(),
  nowBand = bandForHour(new Date().getHours()),
  days = STRIP_DAYS
) {
  const open = habitRows(habits, todayKey, days).filter(
    (r) => r.dueToday && !r.doneToday
  );
  const nowIndex = bandIndex(nowBand);
  const fromNow = open.filter((r) => bandIndex(r.band) >= nowIndex);
  const earlier = open.filter((r) => bandIndex(r.band) < nowIndex);

  const next = fromNow[0] ?? earlier.at(-1) ?? null;
  // Not double counted: if the fallback pulled a missed habit up to be `next`,
  // it is no longer one of the ones being reported as left behind.
  const missed = fromNow.length ? earlier.length : Math.max(0, earlier.length - 1);

  return { next, missed, allDone: !next };
}

/**
 * The habit you are up to. Thin wrapper over routineStatus for callers that
 * want only that, and the place the clock-awareness used to be missing.
 */
export function nextUp(habits, todayKey = today(), days = STRIP_DAYS) {
  return routineStatus(habits, todayKey, undefined, days).next;
}

/**
 * How much of the routine was kept on each of the last N days.
 *
 * The denominator is per day, not the habit count: a day only counts the habits
 * that were actually due and already existed, so adding a tenth habit today
 * does not retroactively make last week look worse.
 *
 * Today is included but excluded from the average, for the same reason today is
 * pending rather than missed on a strip: the day is not over.
 */
export function keptPerDay(habits, todayKey = today(), days = STRIP_DAYS) {
  const rows = habitRows(habits, todayKey, days);
  const dates = windowDates(todayKey, days);

  const perDay = dates.map((date, i) => {
    let due = 0;
    let done = 0;
    for (const row of rows) {
      const state = row.dots[i]?.state;
      if (state === "off") continue;
      due++;
      if (state === "hit") done++;
    }
    return { date, due, done, pct: due ? done / due : 0, isToday: date === todayKey };
  });

  const past = perDay.filter((d) => !d.isToday && d.due > 0);
  const kept = past.length
    ? Math.round((past.reduce((sum, d) => sum + d.pct, 0) / past.length) * 100)
    : null;

  // Leading blanks only, the app-wide rule. A habit added a week ago leaves the
  // first three weeks of the window with nothing due, which draws as a long run
  // of empty columns - a routine nobody kept, rather than a routine that did not
  // exist yet. A gap in the MIDDLE stays: that is a day the routine was there
  // and nothing was due, which is a fact about the week.
  const drawn = trimLeadingBlanks(perDay, (d) => d.due > 0);

  return { days: drawn, kept, from: drawn[0]?.date ?? null, to: drawn.at(-1)?.date ?? null };
}

/** Today's tally across every band: how many of the due ones are ticked. */
export function routineTally(habits, todayKey = today()) {
  const due = habits?.dueOn?.(todayKey) ?? [];
  return {
    due: due.length,
    done: due.filter((h) => habits.isDone(h.id, todayKey)).length,
  };
}
