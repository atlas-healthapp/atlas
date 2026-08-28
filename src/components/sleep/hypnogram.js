// Geometry for the hypnogram. The component owns the SVG, this owns the
// arithmetic, same split as markGeometry.js and historyChart.js.

import { STAGE_ROW, STAGE_ROWS } from "@/utils/sleepStages";
import { charWidth } from "@/utils/labelWidth";

const MIN_MS = 60 * 1000;

/**
 * The type `.tick` is set in, in `SleepPage.vue`. Pinned by `hypnogram.test.js`
 * against the component itself, for the reason under `MIN_TICK_GAP`.
 */
export const TICK_FONT_PX = 13;
export const TICK_LETTER_SPACING = 0.5;

/** `23:00`, which is every label this axis draws once bedtime is known. */
const TICK_LABEL_CHARS = 5;

/**
 * Characters of clear space wanted between one tick label and the next.
 *
 * **Two, counted against a label width that already assumes the worst.**
 * `charWidth` deliberately sizes for a device font scale of 1.0 while this phone
 * is set to 0.85, so a label measured here is about 15% wider than the one that
 * actually renders. Asking for the four characters the axis had when it was
 * written would apply that margin twice, and it does: at four this night thins
 * to a three-hour axis, which is three labels under a whole night's sleep.
 *
 * Two here comes out as very nearly three characters of real clearance at the
 * assumed size, and about four on the phone - which is the spacing the axis was
 * drawn with in the first place.
 */
const TICK_CLEAR_CHARS = 2;

/**
 * Below this a tick label crowds its neighbour, so the axis thins out to a
 * wider step.
 *
 * **Derived rather than remembered, same defect as `dayMarkers`' CHAR_W.** This
 * was a flat 44, set when a `23:00` label was 24 units wide and four characters
 * of air stood between each pair. The type scale went up on 2026-08-27 and the
 * same label became 36 units, so 44 left barely one character between labels and
 * the hourly axis read as a solid band of digits - reported as cluttered rather
 * than as broken, which is exactly what a gap shrinking to a fifth of its
 * intended size looks like.
 *
 * Expressing it in characters is what makes it survive the next type change:
 * the axis thins to a two-hour step because the labels genuinely stopped
 * fitting, not because 2 was hardcoded.
 *
 * Note this is why the expanded hypnogram was fine while the inline one was not.
 * Both set the label at the same size in user units, and the expanded view draws
 * a wider `width`, so the same label costs proportionally less of it.
 */
const MIN_TICK_GAP = (TICK_LABEL_CHARS + TICK_CLEAR_CHARS) * charWidth(TICK_FONT_PX, TICK_LETTER_SPACING);

function clockLabel(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Hours between ticks: the smallest step whose labels still clear each other. */
function tickStepHours(perMinute) {
  for (const hours of [1, 2, 3, 4]) {
    if (hours * 60 * perMinute >= MIN_TICK_GAP) return hours;
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
