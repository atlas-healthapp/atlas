// Geometry for a metric's history chart. Pure, so the awkward parts are
// testable: the component owns the SVG, this owns the arithmetic.
//
// Same split as markGeometry.js and body/sparkline.js.

export const CHART_W = 310;
export const CHART_H = 110;

/**
 * Drop the empty days at the START of a series, and nothing else.
 *
 * A chart's window is a property of how fast the number moves - a fortnight for
 * sleep, ninety days for weight, thirty for Recovery - not of how long Atlas has
 * been collecting. So a window that reaches back past the beginning of the
 * archive spends its left-hand side on days that could never have had data,
 * which reads as a run of bad or missing days rather than as the edge of what is
 * known. Recovery's chart was the worst of them: every day is scored against the
 * seven nights before it, so its opening fortnight was blank on a phone whose
 * archive starts in July.
 *
 * **Only the leading blanks go.** A gap in the middle is a day you did not weigh
 * yourself or the band was off, and every one of these charts exists partly to
 * show those; a blank at the right-hand end is today, still running. Trimming
 * either would be hiding data rather than framing it, which is the line this
 * whole rule sits on.
 *
 * **A series with nothing in it at all is returned whole**, so an empty state
 * still describes the period it was asked about rather than collapsing to one
 * day.
 *
 * `hasValue` says what counts as a reading, because "empty" is different per
 * chart: a null score, no measured minutes, an entry with no sleep on it.
 *
 * Lives here rather than in any one chart's geometry because it was written
 * three times before it was shared once - MetricPage had it inline, and the
 * others simply did without.
 */
export function trimLeadingBlanks(list, hasValue) {
  const all = list ?? [];
  const first = all.findIndex((d) => hasValue(d));
  if (first <= 0) return all;
  return all.slice(first);
}

/**
 * Bars for a metric with a target.
 *
 * The axis stretches to whichever is larger, the biggest reading or the goal,
 * so a day that beat the target still fits and the target line still lands on
 * screen. Scaling to the readings alone would put the goal line off the top on
 * a bad fortnight and off the bottom on a good one.
 *
 * A missing day yields no bar at all rather than a zero-height one. Those are
 * different facts: nothing logged is not the same as a day you drank nothing,
 * and a flat row of stubs reads as the latter.
 */
export function barGeometry(values, goal, { width = CHART_W, height = CHART_H } = {}) {
  const nums = (values ?? []).map((v) => (Number.isFinite(v) ? v : null));
  const max = Math.max(goal || 0, ...nums.filter((v) => v != null), 0) || 1;
  const slot = width / Math.max(1, nums.length);
  const gap = Math.min(3, slot * 0.28);

  const bars = [];
  /**
   * Days with no reading at all, so the chart can show them.
   *
   * **A gap and a bar of zero are different facts and this only marks the gap.**
   * Nothing was drawn for either, so a fortnight with ten missing creatine days
   * looked like a fortnight of short bars, and the reader is left asking whether
   * a column is missing or whether they missed the days - which is exactly how
   * this was reported. A zero is left alone deliberately: it is a recorded fact
   * and drawing it as a stub would also stub every day a strap went unworn and
   * rolled up to zero, turning "no idea" into "you did nothing".
   */
  const gaps = [];
  nums.forEach((v, i) => {
    if (v == null) {
      // Sat on the baseline with a fixed height, so it can never be read as a
      // very small value: it does not scale with anything.
      gaps.push({
        i,
        x: i * slot + gap / 2,
        w: Math.max(1, slot - gap),
        y: height - 2,
        h: 2,
      });
      return;
    }
    if (v <= 0) return;
    const h = Math.max(1.5, (v / max) * height);
    bars.push({
      i,
      x: i * slot + gap / 2,
      w: Math.max(1, slot - gap),
      y: height - h,
      h,
      // The most recent day is highlighted; it is the one you came to see.
      last: i === nums.length - 1,
      // Whether it met the target, so the bar can say so without a legend.
      met: goal ? v >= goal : false,
      value: v,
    });
  });

  return { bars, gaps, max, targetY: goal ? height - (goal / max) * height : null };
}

/**
 * A line for a metric judged against itself rather than a target.
 *
 * Gaps break the line instead of being interpolated across. A straight segment
 * drawn over a fortnight you did not weigh yourself is an invention, and it
 * looks exactly like a fortnight of steady weight.
 *
 * Returns null below two readings, because one point is not a trend and a
 * single dot floating mid-chart implies a scale it does not have.
 */
export function lineGeometry(
  values,
  { width = CHART_W, height = CHART_H, pad = 6, include = [] } = {}
) {
  const pts = (values ?? [])
    .map((v, i) => ({ i, v: Number.isFinite(v) ? v : null }))
    .filter((p) => p.v != null);
  if (pts.length < 2) return null;

  const vals = pts.map((p) => p.v);
  // `include` pulls extra values into the scale without plotting them, so a
  // usual range drawn behind the line cannot fall off the top or bottom of the
  // chart it is meant to be the background of.
  const extra = (include ?? []).filter((v) => Number.isFinite(v));
  const lo = Math.min(...vals, ...extra);
  const hi = Math.max(...vals, ...extra);
  // A flat series has no range to divide by; give it one so it draws mid-height
  // rather than dividing by zero.
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  const n = Math.max(1, (values ?? []).length - 1);

  const x = (i) => (i / n) * width;
  const y = (v) => pad + (1 - (v - lo) / span) * (height - pad * 2);

  const segments = [];
  let run = [];
  let prev = -Infinity;
  for (const p of pts) {
    // Any skipped day ends the run; the next reading starts a new one.
    if (p.i !== prev + 1 && run.length) {
      segments.push(run);
      run = [];
    }
    run.push({ x: x(p.i), y: y(p.v) });
    prev = p.i;
  }
  if (run.length) segments.push(run);

  const last = pts[pts.length - 1];
  return {
    // Runs of one point would draw nothing, so they are dropped from the path
    // and only the endpoint dot survives.
    paths: segments
      .filter((s) => s.length > 1)
      .map((s) => s.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")),
    // One entry per reading, for a dot each and for the tap targets. A day
    // with nothing recorded is absent here rather than present at zero, which
    // is what makes the hole in the line visible instead of implied.
    points: pts.map((p) => ({ i: p.i, x: x(p.i), y: y(p.v), v: p.v })),
    endX: x(last.i),
    endY: y(last.v),
    /** Where a value sits vertically, for gridlines and the range behind. */
    yOf: y,
    lo,
    hi,
  };
}

/**
 * A trailing mean, one entry per day.
 *
 * Over a fortnight of daily totals the bars are mostly noise: what you want to
 * know is whether the level is moving, and a seven-day window is the shortest
 * one that cancels the weekly rhythm of eating differently at weekends.
 *
 * Trailing rather than centred, because a centred window would need days after
 * the one it describes and the last three would have to be drawn from fewer
 * readings than the rest without saying so.
 */
export function rollingMean(values, window = 7) {
  const list = values ?? [];
  return list.map((_, i) => {
    const slice = list.slice(Math.max(0, i - window + 1), i + 1).filter((v) => v != null);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

/**
 * The rolling mean as points on the same scale a bar chart is drawn at.
 *
 * `max` is barGeometry's own axis maximum, passed in rather than recomputed:
 * a line drawn against a second scale would sit at the wrong height over its
 * own bars, which is the kind of error that looks like a data problem.
 */
export function meanLinePoints(values, max, { window = 7, width = CHART_W, height = CHART_H } = {}) {
  const list = values ?? [];
  if (!list.length || !max) return [];
  const slot = width / list.length;
  return rollingMean(list, window)
    .map((m, i) => (m == null ? null : { i, x: i * slot + slot / 2, y: height - (m / max) * height, v: m }))
    .filter(Boolean);
}

/**
 * Where to draw a rule every seven days, newest-aligned.
 *
 * Counted back from the last day rather than forward from the first, so the
 * rules land on week boundaries relative to today. Forward from the start put
 * them on arbitrary days whenever the window was not a multiple of seven.
 */
export function weekRuleX(count, width = CHART_W) {
  const out = [];
  for (let i = count - 1 - 7; i > 0; i -= 7) out.push((i / Math.max(1, count - 1)) * width);
  return out;
}
