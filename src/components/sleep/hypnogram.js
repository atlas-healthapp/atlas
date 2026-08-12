// Geometry for the hypnogram. The component owns the SVG, this owns the
// arithmetic, same split as markGeometry.js and historyChart.js.

import { STAGE_ROW, STAGE_ROWS } from "@/utils/sleepStages";

const MIN_MS = 60 * 1000;
/** Below this a tick label runs into its neighbour, so the axis thins out. */
const MIN_TICK_GAP_PX = 44;

function clockLabel(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Hours between ticks: the smallest step whose labels still clear each other. */
function tickStepHours(perMinute) {
  for (const hours of [1, 2, 3, 4]) {
    if (hours * 60 * perMinute >= MIN_TICK_GAP_PX) return hours;
  }
  return 4;
}

/**
 * Segments and axis ticks for one night.
 *
 * `bedMs` turns the axis from elapsed time into clock time, which is the whole
 * reason bedtimes are now stored. Without one the axis counts hours from the
 * start of the night, exactly as this chart did before: a night with no recorded
 * bedtime gets an honest elapsed axis rather than an invented clock.
 */
export function hypnogramGeometry(timeline, bedMs, { width = 294, rowHeight = 44 } = {}) {
  const segs = timeline ?? [];
  if (!segs.length) {
    return { segments: [], ticks: [], elapsed: bedMs == null, spanMinutes: 0, rows: STAGE_ROWS };
  }

  const spanMinutes = segs.reduce((sum, s) => sum + s.minutes, 0) || 1;
  const perMinute = width / spanMinutes;

  let cursor = 0;
  const segments = segs.map((s) => {
    const x = cursor * perMinute;
    cursor += s.minutes;
    return {
      stage: s.stage,
      x,
      // A hairline minimum, or a two-minute stage vanishes entirely. The 0.6
      // trim keeps neighbouring blocks visually separate without a stroke.
      w: Math.max(1.5, s.minutes * perMinute - 0.6),
      y: STAGE_ROW[s.stage] * rowHeight + 3,
      h: rowHeight - 6,
    };
  });

  const stepHours = tickStepHours(perMinute);
  const ticks = [];
  if (bedMs == null) {
    for (let h = 0; h * 60 <= spanMinutes; h += stepHours) {
      ticks.push({ x: h * 60 * perMinute, label: `${h}H` });
    }
  } else {
    // Whole hours only. A tick at 23:09 because that is when you went to bed
    // makes every other tick unreadable, so the first one is the hour after.
    const first = new Date(bedMs);
    first.setMinutes(0, 0, 0);
    if (first.getTime() < bedMs) first.setHours(first.getHours() + 1);
    const stepMs = stepHours * 60 * MIN_MS;
    for (let t = first.getTime(); t <= bedMs + spanMinutes * MIN_MS; t += stepMs) {
      ticks.push({ x: ((t - bedMs) / MIN_MS) * perMinute, label: clockLabel(t) });
    }
  }

  return { segments, ticks, elapsed: bedMs == null, spanMinutes, rows: STAGE_ROWS };
}
