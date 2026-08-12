// Heart rate over several days: where it settled and how high it went.
//
// A mean per day is the wrong history for this metric. It mixes a night at 50
// with a session at 170 and lands near 74 almost every day, which is a row that
// says nothing - the same reason steps came off the Recovery page. What moves
// between days is the **floor and the ceiling**: a day with a hard session and
// a day without have similar averages and very different peaks, and a resting
// rate creeping up over a fortnight is the signal worth catching.
//
// So each day is a bar from its resting rate to its high, and the axis is the
// window's own spread rather than zero. Same rule as `nightlyBars`, and it
// carries the same obligation: **both ends of the axis must be printed**.

import { RESTING_PERCENTILE } from "./heartDay";
import { trimLeadingBlanks } from "@/utils/historyChart";

/**
 * Seven days, not fourteen, and **measured on the device rather than assumed**
 * (2026-08-10, over the DevTools protocol against the real archive).
 *
 * Heart rate is stored about seven times as densely as stress - 1,307 to 1,440
 * samples a day against 175 - and stress already trimmed its own window from 30
 * days to 14 to keep one fetch affordable.
 *
 * What the week actually costs: **9,785 samples in 173 ms**, once, on open and
 * behind the card's skeleton. One day on its own is 13 ms. So it does not stall,
 * and the window stays where it is.
 *
 * **The daily rollups were measured too and rejected, on correctness before
 * speed.** A rollup carries `hr` as a *mean* and `restingHr`, and nothing else
 * about the day: there is **no stored low or high**. The bar drawn here spans
 * resting to the day's ceiling, and the ceiling is the whole reason this chart
 * is a range rather than a line (a mean mixes a night at 50 with a session at
 * 170 and lands near 74 every day). Reading rollups instead would therefore not
 * be the same chart. It is not even much cheaper: seven frozen days read in
 * 6 ms, but `dailyValuesFor` recomputes **today** from raw samples across every
 * metric, which measured 89 ms on its own, so the round trip is ~95 ms against
 * 173. And it would cost the page its second job - the day chart is served out
 * of this same window, so stepping the date is free today and would go back to
 * a read and a skeleton flash per tap, which is the exact StressPage bug this
 * page was shaped to avoid.
 *
 * So the order of preference if this ever does stall: first stop paying for the
 * week before the opened day draws (already done in `HeartPage.vue`), then
 * shorten the window, and only then store a daily low and high in the rollup so
 * the range survives the move. Re-measure before any of it.
 */
export const HISTORY_DAYS = 7;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
}

/**
 * One entry per date, whether or not the band reported anything that day.
 *
 * `resting` is the tenth percentile of that day's readings, which is the
 * **fallback half** of `bodyMetrics.restingHrFor` and shares its percentile
 * constant through `RESTING_PERCENTILE`, so there is no second definition here.
 * It is deliberately not the rollup's `restingHr`, which prefers the band's own
 * figure: both ends of a bar have to be measured the same way, or a day whose
 * device resting sits above its raw floor draws a bar clipped at the bottom
 * against a top taken from the raw maximum. Measured 2026-08-10 the two agree
 * on 3 of 7 days and differ by 1-2 bpm on the rest, so the card's RESTING AVG
 * can sit a beat off the BODY row. Worth reconciling; not worth inventing a
 * third answer for.
 */
export function heartByDay(samples, dates) {
  const byDate = new Map((dates ?? []).map((d) => [d, []]));
  for (const s of samples ?? []) {
    if (!s || !Number.isFinite(s.t) || !Number.isFinite(s.v)) continue;
    const d = new Date(s.t);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    byDate.get(key)?.push(s.v);
  }

  return (dates ?? []).map((date) => {
    const values = (byDate.get(date) ?? []).sort((a, b) => a - b);
    if (!values.length) return { date, resting: null, high: null, mean: null, samples: 0 };
    return {
      date,
      resting: percentile(values, RESTING_PERCENTILE),
      high: values[values.length - 1],
      mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
      samples: values.length,
    };
  });
}

/**
 * A bar per day, spanning that day's resting rate to its high.
 *
 * Scaled to the window's own low and high with a little padding, never from
 * zero: seven days of resting rates between 48 and 53 drawn from zero are seven
 * bars of identical height.
 *
 * A day with no readings draws nothing at all rather than a zero-height bar at
 * the floor, which would read as a day spent at the bottom of the range instead
 * of a day the band was not worn.
 */
export function heartHistoryBars(days, { height = 46, gap = 0.45 } = {}) {
  // Leading blanks only, the app-wide rule. A window reaching back past the
  // start of the archive would open on days the band could not have measured,
  // which draws identically to days it was not worn.
  const list = trimLeadingBlanks(days, (d) => d.resting != null && d.high != null);
  const measured = list.filter((d) => d.resting != null && d.high != null);
  if (!measured.length) {
    return { bars: [], axisLow: null, axisHigh: null, measuredDays: 0, from: null, to: null };
  }

  const low = Math.min(...measured.map((d) => d.resting));
  const high = Math.max(...measured.map((d) => d.high));
  const axisLow = Math.max(0, Math.floor(low / 10) * 10 - 5);
  const axisHigh = Math.ceil(high / 10) * 10;
  const range = Math.max(1, axisHigh - axisLow);

  const slot = 100 / list.length;
  const width = slot * (1 - gap);
  const y = (v) => height - ((v - axisLow) / range) * height;

  const bars = list.map((d, i) => {
    const empty = d.resting == null || d.high == null;
    const top = empty ? 0 : y(d.high);
    const bottom = empty ? 0 : y(d.resting);
    return {
      date: d.date,
      x: i * slot + (slot - width) / 2,
      width,
      y: top,
      // A day whose resting and high are the same still has to draw.
      height: empty ? 0 : Math.max(1, bottom - top),
      resting: d.resting,
      high: d.high,
      mean: d.mean,
      empty,
    };
  });

  return {
    bars,
    axisLow,
    axisHigh,
    measuredDays: measured.length,
    // The steadiest thing in the window, and the number a creeping resting rate
    // shows up in first.
    restingAverage: Math.round(
      measured.reduce((sum, d) => sum + d.resting, 0) / measured.length
    ),
    from: list[0].date,
    to: list.at(-1).date,
    days: list.length,
  };
}
