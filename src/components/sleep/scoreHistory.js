// Atlas's own sleep score for each of the last N nights, and the geometry for
// drawing them as one bar per night.
//
// Pure and beside the component, for the same reason hypnogram.js and
// whenYouSlept.js are: the page is template-shaped and can only be checked by
// running it, so everything that can be arithmetic instead of markup is.
//
// The card this feeds exists because the page opens on a score out of 100 and
// then never mentioned it again below the HISTORY divider - four charts about
// the parts, none about the number they add up to. RecoveryPage has had the
// mirror image of this card since it was built and it is the most used thing
// on it.

import { sleepResultFor } from "@/components/home/homeModel";
import { SLEEP_BANDS } from "@/utils/sleepScore";
import { trimLeadingBlanks } from "@/utils/historyChart";
import { addDays } from "@/utils/date";

/** How many nights the chart draws. Fourteen, like every other history section
 *  on this page, so they all describe the same stretch of time. */
export const SCORE_HISTORY_NIGHTS = 14;

/** The colour a score is drawn in: the band it falls in, by its own label. */
export function sleepBandColor(label) {
  const band = SLEEP_BANDS.find((b) => b.label === label);
  return band ? `var(${band.token})` : "var(--dim)";
}

/**
 * One score per night, oldest first.
 *
 * **Each night is scored as it stood on that night**, by passing its own date as
 * `todayKey`: `sleepResultFor` bounds the regularity window at that key, so a
 * past night is never rescored against a week that had not happened yet. The
 * same rule RecoveryPage's chart runs on, and the reason a bar does not change
 * height every time the page is opened.
 *
 * A night with no score is null rather than zero. Regularity is withheld under
 * three nights and the whole result under none, and a bar of zero would assert
 * a terrible night about a night that was never scored at all.
 */
export function sleepScores({ entries, entryFor, endKey, nights = SCORE_HISTORY_NIGHTS }) {
  const out = [];
  for (let i = nights - 1; i >= 0; i--) {
    const date = addDays(endKey, -i);
    const result = sleepResultFor({ entries, entry: entryFor(date), todayKey: date });
    out.push({
      date,
      score: result?.state === "ready" ? result.score : null,
      label: result?.state === "ready" ? (result.label ?? null) : null,
    });
  }
  return out;
}

/**
 * Bars for a run of scores, in a 0-100 by `height` coordinate space.
 *
 * **The axis is fixed at 0-100, never scaled to the window's own range.** A
 * sleep score already is a position between fixed thresholds, so rescaling it
 * would move the bands relative to the bars and a GREAT night in a bad
 * fortnight would draw the same height as a FAIR one in a good fortnight. The
 * same rule RangeMark exists to state: never scale to the thing you are judging.
 */
export function sleepScoreBars(scores, { height = 46, gap = 0.28 } = {}) {
  // Leading blanks only. A phone whose archive starts recently opens with nights
  // that could not be scored, which is a fact about the fetch; a gap in the
  // MIDDLE is a week the strap was off, which is worth seeing, and the
  // right-hand end is last night.
  const nights = trimLeadingBlanks(scores, (n) => n.score != null);
  if (!nights.length) return { bars: [], average: null, scored: 0, from: null, to: null };

  const slot = 100 / nights.length;
  const width = slot * (1 - gap);

  const bars = nights.map((n, i) => {
    const h = n.score == null ? 0 : (n.score / 100) * height;
    return {
      date: n.date,
      score: n.score,
      label: n.label,
      x: i * slot + (slot - width) / 2,
      width,
      y: height - h,
      height: h,
      color: sleepBandColor(n.label),
      empty: n.score == null,
    };
  });

  const scored = nights.filter((n) => n.score != null);
  return {
    bars,
    average: scored.length
      ? Math.round(scored.reduce((sum, n) => sum + n.score, 0) / scored.length)
      : null,
    scored: scored.length,
    // The range actually drawn, so the axis names the first bar rather than the
    // window that was asked for.
    from: nights[0].date,
    to: nights.at(-1).date,
  };
}
