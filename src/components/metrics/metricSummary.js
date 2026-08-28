// The three facts a metric page leads with, which depend entirely on whether
// the number has a target.
//
// One page was serving both kinds with one layout, and a list of dates and
// values was the only thing true of both - which is why it read as a
// spreadsheet. A metric with a goal is asking "did I hit it, how often"; a
// metric without one is asking "is this drifting, was today odd". Those are
// different questions and they deserve different answers.

import { rollingBaseline, typicalRange } from "@/utils/baseline";

/** Whether this metric is judged against a target or against its own history. */
export function isGoalMetric(def) {
  return def?.goal != null;
}

/**
 * Whether a goal bar can say anything this metric has not already said.
 *
 * **A mark is drawn when it adds something the figure did not.** For a metric
 * whose every reading is either nothing or exactly the target, a bar has two
 * states, empty and full, and the hero above it already said which one you are
 * in. Measured on the real archive: 24 logged creatine days, every one of them
 * 5 g or 0 - so the page was printing the same 5 g three times, in the hero, on
 * the bar's tick and in the GOAL pair, and the bar was the copy that carried
 * least.
 *
 * **A rule, not a special case for creatine.** Somebody who splits a dose logs
 * 2.5 g, that lands strictly between nothing and the target, and their bar comes
 * back on its own with no setting to find. The same holds for any metric that
 * turns out to be taken-or-not in practice.
 *
 * Days with no reading are not evidence either way and are ignored; a metric
 * with no goal, or with no readings at all, is not binary.
 */
export function isBinaryAgainstGoal(values, goal) {
  if (!goal) return false;
  const recorded = (values ?? []).filter((v) => v != null);
  if (!recorded.length) return false;
  return recorded.every((v) => v === 0 || v === goal);
}

/**
 * How the target went: how often it was met, the run, and the average.
 *
 * `values` is oldest-first with nulls for days that have none. A day with no
 * reading is not a miss - it is a day the question was not asked - so it counts
 * toward neither, and the denominator says how many days actually had one.
 */
export function goalSummary(values, goal) {
  const days = values ?? [];
  const recorded = days.filter((v) => v != null);
  if (!recorded.length || !goal) return null;

  const met = recorded.filter((v) => v >= goal).length;

  // Today counts as pending rather than failed, the same rule utils/streak.js
  // applies: an unfinished day treated as a miss resets the run every midnight
  // and rebuilds it each evening.
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const v = days[i];
    if (i === days.length - 1 && (v == null || v < goal)) continue;
    if (v == null || v < goal) break;
    streak += 1;
  }

  let best = 0;
  let run = 0;
  for (const v of days) {
    if (v != null && v >= goal) best = Math.max(best, ++run);
    else run = 0;
  }

  return {
    met,
    recorded: recorded.length,
    streak,
    best,
    average: recorded.reduce((a, b) => a + b, 0) / recorded.length,
  };
}

/**
 * What normal looks like: the baseline, the usual range, and which way it is
 * going.
 *
 * The range is the same `typicalRange` Home's baseline band uses, so the page
 * can back up the claim the row made rather than offering a second opinion.
 *
 * The trend is the difference between the first and second half of the window,
 * not a fitted slope: on a metric measured a handful of times a fortnight a
 * regression line is a precise answer to a question the data cannot support.
 */
export function trendSummary(values) {
  const days = values ?? [];
  const recorded = days.filter((v) => v != null);
  if (recorded.length < 3) return null;

  const base = rollingBaseline(recorded, { window: recorded.length });
  const range = typicalRange(recorded);

  const half = Math.floor(recorded.length / 2);
  const older = recorded.slice(0, half);
  const newer = recorded.slice(-half);
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;

  return {
    baseline: base ? base.scaledMean : mean(recorded),
    low: range?.low ?? null,
    high: range?.high ?? null,
    change: mean(newer) - mean(older),
    n: recorded.length,
  };
}

/**
 * A day's distance from the baseline, as a fraction of the window's own widest
 * departure, signed.
 *
 * Scaled to the window rather than to the range, so the day list has a shape
 * even when every reading sat comfortably inside normal - which is most of
 * them, and which is exactly when a bar scaled to the range would be a row of
 * nothing.
 */
export function deviationBars(values, baseline) {
  const days = values ?? [];
  const widest = Math.max(
    ...days.filter((v) => v != null).map((v) => Math.abs(v - baseline)),
    Number.EPSILON
  );
  return days.map((v) => (v == null ? null : (v - baseline) / widest));
}

/**
 * How a goal metric has gone over a stretch of days.
 *
 * Asked for as "my weekly average, and how successful I am, and 30 days too".
 * Separate from `goalSummary` above, which describes the charted window: these
 * periods are fixed lengths that do not move with `def.window`, so protein can
 * report 30 days while its chart stays at the 14 the metric is read over.
 *
 * **A period with no readings returns null rather than zeros.** An average of
 * nothing is not 0g, and a met rate of 0 of 0 reads as total failure.
 *
 * @param values oldest to newest, nulls for days with no reading
 */
export function periodStats(values, goal) {
  const recorded = (values ?? []).filter((v) => v != null);
  if (!recorded.length) return null;
  const average = recorded.reduce((a, b) => a + b, 0) / recorded.length;
  return {
    average,
    recorded: recorded.length,
    // Withheld rather than zero when the goal is switched off: a met count
    // against no target is a count of nothing.
    met: goal ? recorded.filter((v) => v >= goal).length : null,
  };
}
