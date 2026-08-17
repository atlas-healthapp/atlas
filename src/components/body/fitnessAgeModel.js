// Assembling the fitness age out of what Atlas already holds.
//
// **The point of this file is that `fitnessAge.js` stays pure.** That module is
// the arithmetic and the citations; this one knows where each number lives in
// the app, which of them is allowed to be stale and which day to leave out. The
// split matters because every one of the model's inputs has a trap attached, and
// the traps belong next to the stores rather than next to the equation.

import {
  computeFitnessAge,
  paIndexFrom,
  MIN_ACTIVITY_DAYS,
  PROVISIONAL_MIN_DAYS,
} from "@/utils/fitnessAge";
import { addDays } from "@/utils/date";

/**
 * The resting heart rate the model wants: a multi-week average, not today's.
 *
 * **Today is excluded, and that is not tidiness.** A day's resting rate is the
 * tenth percentile of its samples, so a date a few hours old carries a waking
 * figure - measured on the phone at 00:32 it read 67 against a real average near
 * 47. Recovery was scoring exactly that until 2026-08-14, and one beat is worth
 * half a year here, so letting it in would move the fitness age by ten.
 *
 * Returns the mean and the number of days behind it, since the caller has to
 * report the second whether or not it uses the first.
 */
export function restingHrAverage(dayWindow, todayKey) {
  const values = (dayWindow ?? [])
    .filter((d) => d?.date && d.date !== todayKey)
    .map((d) => d.values?.restingHr)
    .filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0);

  if (!values.length) return { value: null, days: 0 };
  return {
    value: values.reduce((sum, v) => sum + v, 0) / values.length,
    days: values.length,
  };
}

/**
 * The most recent weight, and how old it is in days.
 *
 * **Staleness is returned rather than assumed**, because weight is the only
 * input here that a human types in and therefore the only one that can quietly
 * stop arriving. Everything else comes off the strap and stops with a visible
 * gap. `computeFitnessAge` refuses a weight older than ninety days; it cannot
 * do that unless somebody counts the days, and defaulting the count to zero is
 * exactly how a March weigh-in would read as current.
 */
export function latestWeight(entries, todayKey) {
  let best = null;
  for (const entry of entries ?? []) {
    if (typeof entry?.weight !== "number" || !Number.isFinite(entry.weight)) continue;
    if (!entry.date || entry.date > todayKey) continue;
    if (!best || entry.date > best.date) best = entry;
  }
  if (!best) return { weightKg: null, weightDaysOld: null, on: null };

  // Whole days between two date keys, counted by stepping rather than by
  // subtracting timestamps, so a DST boundary inside the span cannot round the
  // answer the wrong way. Ninety iterations at most: past that it is stale
  // whatever the exact number is.
  let days = 0;
  let cursor = best.date;
  while (cursor < todayKey && days <= 400) {
    cursor = addDays(cursor, 1);
    days += 1;
  }
  return { weightKg: best.weight, weightDaysOld: days, on: best.date };
}

/**
 * How many days of session history there are to build an activity index from.
 *
 * Not the number of sessions: a window with no sessions in it is a real answer
 * of zero and is not the same thing as a window too short to have an answer.
 * That distinction is `paIndexFrom`'s and this only has to feed it honestly.
 *
 * Counted from the first day the archive has anything at all rather than from
 * the first session, because somebody who trained once a fortnight ago has a
 * fortnight of evidence, not one day of it.
 */
export function activityDaysFrom(dayWindow, todayKey) {
  const dated = (dayWindow ?? []).filter((d) => d?.date && d.date <= todayKey);
  if (!dated.length) return 0;
  const withData = dated.filter((d) => d.values && Object.values(d.values).some((v) => v != null));
  if (!withData.length) return 0;
  const first = withData.reduce((a, b) => (a.date < b.date ? a : b)).date;

  let days = 1;
  let cursor = first;
  while (cursor < todayKey && days <= 400) {
    cursor = addDays(cursor, 1);
    days += 1;
  }
  return Math.min(days, MIN_ACTIVITY_DAYS * 4);
}

/**
 * Everything the model needs, gathered from the stores.
 *
 * `sessions` must be the **resolved** list - deletions dropped, splits and
 * merges applied - for the same reason ActivityTab and RecoveryPage both read
 * through `resolveSessions`: a corrected duration applied in one place and not
 * another is how two screens disagree about a week.
 */
export function fitnessAgeInputs({
  profile,
  entries = [],
  dayWindow = [],
  sessions = [],
  todayKey,
  /** Answer on a short window, marking the result provisional. See fitnessAgeFor. */
  allowProvisional = false,
}) {
  const resting = restingHrAverage(dayWindow, todayKey);
  const weight = latestWeight(entries, todayKey);
  const activityDays = activityDaysFrom(dayWindow, todayKey);
  const pa = paIndexFrom(sessions, {
    // paIndexFrom gates on its own minimum, so it is given the real figure and
    // allowed to refuse. Clamping it up to the minimum here would buy a number
    // by lying about how much history stood behind it.
    days: Math.max(activityDays, 0),
    age: profile?.age ?? null,
    // Lowered in step with the model's own gate, or the figure is refused for
    // want of an activity index while every other input is ready to answer.
    minDays: allowProvisional ? PROVISIONAL_MIN_DAYS : MIN_ACTIVITY_DAYS,
  });

  return {
    age: profile?.age ?? null,
    sex: profile?.sex || null,
    heightCm: profile?.heightCm ?? null,
    weightKg: weight.weightKg,
    weightDaysOld: weight.weightDaysOld,
    // Atlas asks for no waist and the reference has none for women. Passed
    // explicitly so the BMI form is chosen for a stated reason rather than by
    // the field happening to be absent.
    waistCm: null,
    restingHr: resting.value,
    restingHrDays: resting.days,
    paIndex: pa.state === "ready" ? pa.value : null,
    activityDays,
    weighedOn: weight.on,
    activity: pa,
  };
}

/**
 * The figure itself, provisional while the history is short.
 *
 * **Provisional rather than withheld is the user's standing preference**, and it
 * is the same call `NotYet` was built on: showing nothing for a month teaches
 * people the screen is broken. Below seven days there is genuinely nothing to
 * say, and seven is Recovery's own floor rather than a number picked fresh here.
 */
export function fitnessAgeFor(args) {
  const inputs = fitnessAgeInputs({ ...args, allowProvisional: true });
  const result = computeFitnessAge({ ...inputs, allowProvisional: true });
  return { ...result, inputsUsed: inputs };
}
