// Geometry for the mark vocabulary, kept out of the .vue files so it can be
// tested directly. Same split as body/sparkline.js: the component owns the
// SVG, this owns the arithmetic.
//
// Every function works in a 0-100 coordinate space, so the marks stretch to
// whatever width their row gives them.

import {
  STAGE_ORDER,
  STAGE_FAMILY_OPACITY,
  STAGE_ROW,
  STAGE_ROWS,
  stageMinutes,
} from "@/utils/sleepStages";

/**
 * A metric with a daily target.
 *
 * The axis stretches to whichever of value and goal is larger, so exceeding
 * the goal moves the tick left rather than running the fill off the end. That
 * is the whole reason for a tick instead of a plain progress bar: PAI at 104
 * against a threshold of 100 has to read as past its line, and a bar that
 * clips at full cannot say that.
 */
export function goalGeometry(value, goal) {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  const g = Number.isFinite(goal) && goal > 0 ? goal : 1;
  const axisMax = Math.max(g, v) || 1;
  return {
    fillPct: Math.max(0, Math.min(100, (v / axisMax) * 100)),
    tickPct: (g / axisMax) * 100,
  };
}

export const GOAL_DOTS = 10;

/**
 * A daily target counted out rather than filled in.
 *
 * Used where the target is reached in discrete goes (a glass, a meal), so
 * "three more" is real information. Continuous targets keep goalGeometry.
 *
 * The two ends are pinned rather than rounded, because rounding is dishonest
 * at exactly the points that matter: at 4% of your water round-to-nearest
 * shows an empty row indistinguishable from having drunk nothing, and at 96%
 * it shows a full one indistinguishable from done. So an empty row means
 * nothing logged, a full row means the goal is met, and every other state is
 * somewhere in between.
 *
 * Overshoot is not drawn: unlike PAI against its threshold, drinking 3L
 * against a 2.5L goal is not a finding, and the value beside the dots carries
 * the number anyway.
 */
export function dotGeometry(value, goal, count = GOAL_DOTS) {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  const g = Number.isFinite(goal) && goal > 0 ? goal : 1;
  let filled;
  if (v <= 0) filled = 0;
  else if (v >= g) filled = count;
  else filled = Math.min(count - 1, Math.max(1, Math.floor((v / g) * count)));
  return { count, filled };
}

/**
 * A metric with no target, only a personal normal.
 *
 * Replaced `baselineGeometry` on 2026-08-05. That one derived its axis from the
 * range and then padded outward from it by 60% of the range's own width, which
 * meant **every in-range reading landed near the middle of a band that always
 * occupied the middle**. Three vitals with three different stories drew three
 * identical pictures, and no amount of restyling the pill fixed that: the axis
 * was the bug.
 *
 * The axis here is the window's own spread, which does not move with today's
 * reading. An ordinary day sits mid-axis, an unusual one runs toward an end,
 * and the usual range is a segment you read position against rather than the
 * subject of the mark.
 *
 * `series` is the readings *before* today. Passing today in as well would let
 * one outlier stretch the axis it is being judged on, which is the same
 * mistake as a baseline that contains the night it is judging.
 *
 * Returns null when there is no usable range, which is the state before the
 * baseline window has filled. Callers render the bare value then: a band drawn
 * from three nights looks exactly like one drawn from thirty while meaning far
 * less, and that is worse than showing nothing.
 */
export function rangeGeometry(value, { low, high, baseline = null, series = [] } = {}) {
  if (value == null || low == null || high == null || high <= low) return null;

  const readings = (series ?? []).filter((v) => Number.isFinite(v));
  const lo = Math.min(low, value, ...readings);
  const hi = Math.max(high, value, ...readings);
  // A flat window would divide by zero, and one reading is a legitimate state.
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.04 || 1;
  const span = hi + pad - (lo - pad) || 1;
  const pos = (v) => ((v - (lo - pad)) / span) * 100;
  // Clamped so the caret and its foot stay inside the viewport at the extremes.
  const clamp = (x) => Math.max(3.2, Math.min(96.8, x));

  return {
    bandStart: pos(low),
    bandWidth: pos(high) - pos(low),
    baselineX: baseline == null ? null : clamp(pos(baseline)),
    valueX: clamp(pos(value)),
    outside: value < low || value > high,
    // One tick per prior reading, so the range is evidence rather than an
    // assertion. Deduplicated: a fortnight of identical SpO2 readings drew
    // fourteen hairlines in one place and read as a single heavy tick.
    rug: [...new Set(readings.map((v) => +clamp(pos(v)).toFixed(2)))],
  };
}

/**
 * A total made of named parts, laid out left to right in depth order.
 *
 * `variant` decides whether the parts are shades of one family colour (Home,
 * where the BODY card must read as a single idea) or named stage hues (the
 * sleep sheet, where nothing competes with sleep). Awake leaves the family hue
 * entirely in the single-colour variant, because it is not a kind of sleep.
 */
export function compositionSegments(segments, { color, variant = "family" } = {}) {
  const total = STAGE_ORDER.reduce((sum, key) => sum + stageMinutes(segments, key), 0);
  if (!total) return [];

  let x = 0;
  const out = [];
  for (const key of STAGE_ORDER) {
    const minutes = stageMinutes(segments, key);
    if (!minutes) continue;
    const width = (minutes / total) * 100;
    out.push({
      key,
      x,
      // The gap is what separates one stage from the next, and it does more of
      // that work than the tone step does: one family hue only has about 0.4 to
      // 1.0 of usable range on a dark ground, so four shades of it land too
      // close to read. Floored so a one-minute sliver of deep sleep never
      // vanishes into the gap meant to bound it.
      width: Math.max(0.8, width - 1.6),
      fill:
        variant === "stage"
          ? `var(--stage-${key})`
          : key === "awake"
            ? "var(--dim)"
            : color,
      opacity: variant === "stage" ? 1 : STAGE_FAMILY_OPACITY[key],
    });
    x += width;
  }
  return out;
}

/**
 * The night's actual shape: one block per stage change, positioned by depth.
 *
 * This is a different mark from the bar above, not a variant of it, because it
 * answers a different question. A composition bar says how much of each stage
 * there was; this says what the night did - whether it settled early, and
 * whether it kept breaking up. At row size the second question is the one worth
 * the space, and the proportions are already on the sleep page with room for
 * labels beside them.
 *
 * Rows run awake at the top to deep at the bottom, the same direction the sleep
 * page's chart runs, so the row is a true preview of the page it opens rather
 * than a second summary in a different language.
 *
 * `row` and `rows` are returned rather than pixel positions: the caller owns the
 * height, and this stays a pure function of the timeline.
 */
/**
 * `variant` decides what colour means inside the mark.
 *
 * `family` keeps the whole shape in the BODY hue and separates the stages by
 * vertical position and tone, which is what a card carrying four domains at once
 * needs: hue is already spoken for by the family.
 *
 * `stage` uses the four sleep-stage colours the sleep page draws with, so the
 * row on Home and the hypnogram it opens are the same picture. The app-wide rule
 * that colour means *family* is scoped to where families compete, and it was the
 * user's call that recognising the night matters more here than the legend does.
 */
export function hypnogramSegments(timeline, { color, variant = "family" } = {}) {
  const segments = (timeline ?? []).filter(
    (s) => s && s.minutes > 0 && STAGE_ROW[s.stage] != null
  );
  if (!segments.length) return [];

  const end = Math.max(...segments.map((s) => (s.startMinute ?? 0) + s.minutes));
  if (!end) return [];

  return segments.map((s) => ({
    stage: s.stage,
    x: ((s.startMinute ?? 0) / end) * 100,
    // Floored: a one-minute wake in the middle of the night is exactly the
    // detail this chart exists to show, and it is 0.16% of a ten-hour night.
    width: Math.max(0.35, (s.minutes / end) * 100),
    row: STAGE_ROW[s.stage],
    rows: STAGE_ROWS,
    fill:
      variant === "stage"
        ? `var(--stage-${s.stage})`
        : s.stage === "awake"
          ? "var(--dim)"
          : color,
    // Full strength on the stage variant: the hues already separate the rows, and
    // dimming them would make the four colours read as four shades of one.
    opacity: variant === "stage" ? 1 : STAGE_FAMILY_OPACITY[s.stage],
  }));
}
