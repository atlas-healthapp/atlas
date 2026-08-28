/**
 * The shape of TODAY SO FAR, as paths.
 *
 * Pure, and separated from the component for the reason every other chart in
 * this app is: a `.vue` file cannot be tested here, and the parts of a chart
 * worth testing are the ones that decide where a line goes. `intradaySteps.js`
 * owns the numbers; this owns where they land in a box.
 */

import { HOURS } from "@/utils/intradaySteps";

/** Hours that get a tick and a label. Four marks, not two ends. */
export const TICK_HOURS = [0, 6, 12, 18, 24];

/**
 * Everything the chart draws, for a model and a box.
 *
 * **Both ends are inset.** The projected finish is a dot sitting on the last
 * hour, and drawn at the box's own edge half of it falls outside the frame.
 *
 * `padBottom` leaves the axis its labels. Nothing is drawn below it, so a
 * caller can size the box by how much chart it wants rather than by working
 * backwards from the text under it.
 */
export function stepsChart(model, { width = 100, height = 60, padBottom = 10, inset = 1.2 } = {}) {
  const top = model?.top || 1;
  const x = (h) => inset + (h / HOURS) * (width - inset * 2);
  const y = (v) => {
    const clamped = Math.max(0, Math.min(v ?? 0, top));
    return height - padBottom - (clamped / top) * (height - padBottom);
  };

  const line = (values) => {
    let d = "";
    for (let h = 0; h <= HOURS; h++) {
      const v = values?.[h];
      if (v == null) continue;
      d += `${d ? "L" : "M"}${x(h).toFixed(2)},${y(v).toFixed(2)}`;
    }
    return d;
  };

  const band = model?.band;
  let bandPath = "";
  if (band) {
    for (let h = 0; h <= HOURS; h++) bandPath += `${h ? "L" : "M"}${x(h).toFixed(2)},${y(band.p75[h]).toFixed(2)}`;
    for (let h = HOURS; h >= 0; h--) bandPath += `L${x(h).toFixed(2)},${y(band.p25[h]).toFixed(2)}`;
    bandPath += "Z";
  }

  // The rest of the day at the shape a median day makes from here, never a
  // straight line through the current pace: measured, that promised 2,250 by
  // midnight on a day whose median gains 3,600 in the same hours, because the
  // evening is when the walking happens.
  let projection = "";
  if (band && model.atHour < HOURS) {
    const from = model.curve[model.atHour];
    for (let h = model.atHour; h <= HOURS; h++) {
      const v = from + Math.max(0, band.p50[h] - band.p50[model.atHour]);
      projection += `${h === model.atHour ? "M" : "L"}${x(h).toFixed(2)},${y(v).toFixed(2)}`;
    }
  }

  return {
    band: bandPath,
    median: band ? line(band.p50) : "",
    today: line(model?.soFar),
    projection,
    // A target off the top of the frame cannot be judged against, which is why
    // the model's `top` already includes it. Withheld entirely with no goal.
    goalY: model?.goal ? y(model.goal) : null,
    now: { x: x(model?.atHour ?? 0), y: y(model?.curve?.[model?.atHour ?? 0] ?? 0) },
    end:
      band && model.projected != null
        ? { x: x(HOURS), y: y(model.projected) }
        : null,
    ticks: TICK_HOURS.map((h) => ({ h, x: x(h), label: String(h).padStart(2, "0") })),
    axisY: height - padBottom,
  };
}
