// Recovery over time: the score for each of the last N days, and the geometry
// for drawing them as one bar per day.
//
// Pure, and beside the component for the same reason hypnogram.js and
// stressDay.js are: the page itself is template-shaped and can only be checked
// by running it, so everything that can be arithmetic instead of markup is.
//
// Why bars coloured by band rather than one colour against threshold lines:
// the band is the whole vocabulary this score speaks in, and the question a
// month of Recovery answers is "how many good days have I had", which a
// coloured run answers without reading a number off an axis.

import { recoveryFor } from "@/components/home/homeModel";
import { recoveryColor, recoveryLabel } from "@/utils/recovery";
import { trimLeadingBlanks } from "@/utils/historyChart";
import { addDays } from "@/utils/date";

/** How many days the history chart draws. */
export const HISTORY_DAYS = 30;

/**
 * The window has to reach further back than the chart does.
 *
 * Each day is scored against the seven nights before it, so charting 30 days
 * from a 30-day window leaves the earliest week unscoreable and the chart opens
 * with a gap that is an artefact of the fetch rather than of the data.
 */
export const BASELINE_LEAD = 7;
export const WINDOW_DAYS = HISTORY_DAYS + BASELINE_LEAD;

/**
 * One score per day, oldest first.
 *
 * Every day is judged against the baseline as it stood on that day, which is
 * the same rule the page already applies to the day being viewed: a past day
 * rescored against today's baseline is a number that changes every time it is
 * looked at.
 *
 * `endKey` is the last day drawn. It is the day being viewed rather than today,
 * so stepping back moves the chart with the page instead of leaving it showing
 * a month that ends somewhere the header does not.
 */
export function recoveryScores({
  dayWindow,
  entryFor,
  endKey,
  sleepGoalHours,
  days = HISTORY_DAYS,
  // Threaded through rather than defaulted away: the sleep term is Atlas's own
  // sleep score now, and without the entries behind it every bar here would be
  // scored on the old duration-against-goal term while the hero above used the
  // new one. Two numbers for one day, on one screen.
  entries = [],
  // Threaded through for the same reason `entries` is: without it every bar
  // would be scored on the deviation-only shape while the hero above used the
  // condition one, which is two numbers for one day on one screen.
  longWindow = null,
  profile = null,
}) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(endKey, -i);
    const result = recoveryFor({
      dayWindow,
      entry: entryFor(date),
      todayKey: date,
      sleepGoalHours,
      entries,
      longWindow,
      profile,
    });
    out.push({
      date,
      score: result.state === "ready" ? result.score : null,
      label: result.state === "ready" ? recoveryLabel(result.score) : null,
    });
  }
  return out;
}

/**
 * Bars for a run of scores, in a 0-100 by `height` coordinate space.
 *
 * The axis is fixed at 0-100 rather than scaled to the window's own range,
 * unlike nightlyBars. A Recovery score already is a position between fixed
 * thresholds, so rescaling it would move the bands relative to the bars and a
 * GREAT day in a bad month would draw the same height as an OKAY one in a good
 * month.
 *
 * A day with no score draws nothing at all: Recovery withholds below seven
 * nights and redistributes a missing term rather than zeroing it, so a bar of
 * zero would assert a terrible day about a day that was never scored.
 */
export function recoveryBars(scores, { height = 46, gap = 0.28 } = {}) {
  // **The opening gap goes.** Each day is scored against the seven nights before
  // it, so a phone whose archive starts recently opens this chart with a blank
  // fortnight that is a fact about the fetch rather than about the days. Leading
  // only: an unscoreable day in the MIDDLE is a week the band was off, which is
  // worth seeing, and the right-hand end is today.
  const days = trimLeadingBlanks(scores, (d) => d.score != null);
  if (!days.length) return { bars: [], average: null, scored: 0, from: null, to: null };

  const slot = 100 / days.length;
  const width = slot * (1 - gap);

  const bars = days.map((d, i) => {
    const h = d.score == null ? 0 : (d.score / 100) * height;
    return {
      date: d.date,
      score: d.score,
      label: d.label,
      x: i * slot + (slot - width) / 2,
      width,
      y: height - h,
      height: h,
      color: recoveryColor(d.score),
      empty: d.score == null,
    };
  });

  const scored = days.filter((d) => d.score != null);
  return {
    bars,
    average: scored.length
      ? Math.round(scored.reduce((sum, d) => sum + d.score, 0) / scored.length)
      : null,
    scored: scored.length,
    // The range actually drawn, so the axis under it names the first bar rather
    // than the window that was asked for. Trimming without this is how a chart
    // ends up labelled "30 DAYS AGO" above a bar from a fortnight ago.
    from: days[0].date,
    to: days.at(-1).date,
    days: days.length,
  };
}
