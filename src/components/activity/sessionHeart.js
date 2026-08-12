// The heart rate around a session, and what it says about when the session
// really ended.
//
// The band decides its own start and stop, and it stops early: it quits
// counting during the standing around. Monday 27 July was logged 18:20 to
// 19:36, and the archive shows heart rate still between 96 and 116 until about
// 20:20. The band was wrong by an hour, and nothing on screen could have told
// you that, because the only number shown was the band's own.
//
// So the sheet draws the whole evening rather than only the logged part, and
// dragging the duration moves a line across it. You stop where your heart rate
// came back down.

/**
 * How far either side of the logged session to draw.
 *
 * An hour before, not twenty minutes. The band can start recording well after
 * you did - which is the mirror of the case this chart was built for, where it
 * stopped early - and a correction can only reach as far back as the chart
 * draws. Twenty minutes was enough to see the run-up and not enough to fix it.
 */
export const PAD_BEFORE_MS = 60 * 60 * 1000;
export const PAD_AFTER_MS = 75 * 60 * 1000;

const CHART_W = 100;

/**
 * Everything needed to draw the chart and describe the chosen window.
 *
 * `samples` are `{ t, v }` in ascending time, exactly as sampleDb returns them.
 * `endMillis` is where the user has dragged the end to, which is not
 * necessarily where the band put it.
 */
export function heartGeometry(samples, { startMillis, endMillis, height = 64 } = {}) {
  const points = (samples ?? [])
    .filter((s) => s && Number.isFinite(s.t) && Number.isFinite(s.v))
    .sort((a, b) => a.t - b.t);
  if (points.length < 2) return null;

  const viewStart = points[0].t;
  const viewEnd = points[points.length - 1].t;
  const span = viewEnd - viewStart;
  if (span <= 0) return null;

  const values = points.map((p) => p.v);
  // Padded and floored so the line never touches the top or bottom edge, and so
  // a flat stretch does not fill the whole box.
  const lo = Math.min(...values) - 4;
  const hi = Math.max(...values) + 4;
  const range = Math.max(1, hi - lo);

  const x = (t) => ((t - viewStart) / span) * CHART_W;
  const y = (v) => height - ((v - lo) / range) * height;

  const inWindow = points.filter((p) => p.t >= startMillis && p.t <= endMillis);

  return {
    height,
    width: CHART_W,
    // One polyline for the whole evening. The session is marked by a band drawn
    // behind it rather than by splitting the line, because a split line implies
    // a gap in the reading and there was none.
    line: points.map((p) => `${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`).join(" "),
    bandStart: x(Math.max(startMillis, viewStart)),
    bandWidth: x(Math.min(endMillis, viewEnd)) - x(Math.max(startMillis, viewStart)),
    endX: x(Math.min(Math.max(endMillis, viewStart), viewEnd)),
    viewStart,
    viewEnd,
    lo: Math.round(lo),
    hi: Math.round(hi),
    inWindow: inWindow.length,
  };
}

/**
 * Average, peak and floor across the chosen window, from the samples
 * themselves.
 *
 * Recomputed rather than taken from the band, because the band's figures
 * describe the band's window and the whole point here is that the window
 * changed. Returns null when the window holds too little to average, which the
 * caller must show as the band's own numbers instead of inventing one.
 */
export function heartStats(samples, { startMillis, endMillis } = {}) {
  const inside = (samples ?? []).filter(
    (s) => s && s.t >= startMillis && s.t <= endMillis && Number.isFinite(s.v)
  );
  if (inside.length < 3) return null;

  const values = inside.map((s) => s.v);
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    avg: Math.round(sum / values.length),
    max: Math.max(...values),
    min: Math.min(...values),
    n: values.length,
  };
}

/**
 * Calories over a window the band did not measure.
 *
 * Pro-rata against the band's own figure and its own duration. That assumes the
 * extra time was worked at roughly the intensity of the logged part, which the
 * heart rate on the chart lets you check for yourself - and it is why the sheet
 * labels the result an estimate the moment the duration is edited. Deriving
 * calories from heart rate properly needs age and a formula Atlas does not
 * carry, and a precise-looking wrong number would be worse than an admitted
 * approximation.
 */
export function scaledCalories(bandKcal, bandSeconds, chosenSeconds) {
  if (bandKcal == null || !bandSeconds || !chosenSeconds) return null;
  if (chosenSeconds === bandSeconds) return { kcal: Math.round(bandKcal), estimated: false };
  return {
    kcal: Math.round(bandKcal * (chosenSeconds / bandSeconds)),
    estimated: true,
  };
}

/**
 * Which end of the session a tap was aimed at.
 *
 * Nearest wins, because there is no third thing it could mean and asking would
 * cost a control for a decision the position already makes. A tap before the
 * start can only be about the start, and one past the end can only be about the
 * end, so the midpoint is the only place the answer is a judgement at all.
 */
export function edgeNearest(atMillis, { startMillis, endMillis }) {
  if (atMillis == null) return null;
  if (atMillis <= startMillis) return "start";
  if (atMillis >= endMillis) return "end";
  return atMillis - startMillis < endMillis - atMillis ? "start" : "end";
}

/**
 * The time at a fraction across the chart, clamped to what is drawn.
 *
 * Used by the tap handler. Clamped rather than extrapolated: a tap past an edge
 * means "as far as I can see", not a time there is no reading for.
 */
export function timeAtFraction(geo, fraction) {
  if (!geo) return null;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round(geo.viewStart + clamped * (geo.viewEnd - geo.viewStart));
}

/** "6:20 PM", matching the rest of the tab. */
export function clockLabel(millis) {
  return new Date(millis)
    .toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
    .toUpperCase();
}
