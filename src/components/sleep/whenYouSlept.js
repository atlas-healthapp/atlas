// The week's sleep windows: time down the side, one column per night.
//
// Time is the vertical axis and the nights are columns, not the other way
// round. A night is a span of the clock, and putting the clock on the y axis is
// what lets a late night sit visibly BELOW the band the rest of the week shares.
// Flipped, the same data reads as seven bars of differing length and the shape
// of the week disappears.
//
// The axis is fixed at 21:00 to 13:00 and never scaled to the week's own range,
// or an irregular week would look exactly as tidy as a regular one.

import {
  axisMinutes,
  usualWindow,
  AXIS_SPAN_MINUTES,
  AXIS_START_HOUR,
} from "@/utils/sleepRegularity";

/** Axis minutes back to a clock label. */
function clock(minutes) {
  const total = (AXIS_START_HOUR * 60 + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Every three hours, so midnight is always one of them.
 *
 * Four-hourly divided the axis exactly but stepped 21:00, 01:00, 05:00, which
 * reads as an axis that jumps backwards: the numbers fall from 21 to 1 with
 * nothing saying a day boundary was crossed. Anchoring on midnight and drawing
 * it as the one emphasised line makes the sequence legible in the only place it
 * was ambiguous.
 */
const TICK_STEP_MINUTES = 180;
/** Minutes from the 21:00 anchor to midnight. */
const MIDNIGHT_MINUTES = (24 - AXIS_START_HOUR) * 60;

/** One letter, because seven columns across a phone cannot hold three. */
function dayLetter(dateKey) {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short" })[0];
}

export function regularityColumns(
  nights,
  { width = 294, height = 132, barWidth = 12, todayKey = null } = {}
) {
  const list = nights ?? [];
  const perMinute = height / AXIS_SPAN_MINUTES;
  const slot = width / Math.max(1, list.length);

  const columns = list.map((n, i) => {
    const bed = axisMinutes(n.bedMs);
    const wake = axisMinutes(n.wakeMs);
    // A night running past either end is clamped to the axis rather than
    // dropped: it still happened, and losing the column would read as a night
    // nobody recorded.
    const from = Math.max(0, bed ?? 0);
    const to = Math.min(AXIS_SPAN_MINUTES, wake ?? AXIS_SPAN_MINUTES);
    const centre = i * slot + slot / 2;
    return {
      date: n.date,
      letter: dayLetter(n.date),
      today: n.date === todayKey,
      x: centre - barWidth / 2,
      w: barWidth,
      // Evening at the bottom, morning at the top: the bar rises out of the
      // bedtime it started from. Drawn the other way up the axis counted 21:00
      // down to 13:00, which reads as running backwards however it is labelled.
      y: height - to * perMinute,
      h: Math.max(2, (to - from) * perMinute),
      labelX: centre,
      bedLabel: clock(from),
      wakeLabel: clock(to),
    };
  });

  const usual = usualWindow(list);
  const band = usual
    ? {
        y: height - usual.wakeMinutes * perMinute,
        h: Math.max(1, (usual.wakeMinutes - usual.bedMinutes) * perMinute),
        bedLabel: clock(usual.bedMinutes),
        wakeLabel: clock(usual.wakeMinutes),
      }
    : null;

  const gridlines = [];
  for (let m = 0; m <= AXIS_SPAN_MINUTES; m += TICK_STEP_MINUTES) {
    gridlines.push({
      y: height - m * perMinute,
      label: clock(m),
      midnight: m === MIDNIGHT_MINUTES,
    });
  }
  // The step does not divide the axis, so close it off rather than leaving the
  // last hour hanging past the final rule. No label: 13:00 is the frame, not a
  // reading, and it is the one end nobody sleeps through.
  if (gridlines[gridlines.length - 1].y > 0) {
    gridlines.push({ y: 0, label: null, midnight: false });
  }

  return { columns, band, gridlines, height, width };
}
