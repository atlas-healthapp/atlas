// Fourteen nights of duration, stacked by stage.
//
// Stacked rather than a plain bar because the composition is free here: the
// height is already the duration, and the same three colours the hypnogram uses
// say what the night was made of at no extra cost in ink.
//
// Same scaling rule as historyChart.barGeometry: the axis stretches to whichever
// is larger, the longest night or the goal, so a night that beat the goal still
// fits and the goal line stays on screen.

import { stageMinutes } from "@/utils/sleepStages";

/** Bottom to top. Deep lowest, matching the hypnogram's depth ordering. */
const STACK_ORDER = ["deep", "light", "rem"];

export function stackedDurationBars(entries, goalHours, { width = 294, height = 110 } = {}) {
  const list = entries ?? [];
  const stagedHours = (e) =>
    STACK_ORDER.reduce((sum, s) => sum + stageMinutes(e?.sleepStages, s), 0) / 60;
  const hoursOf = (e) => stagedHours(e) || (e?.sleep ?? null);

  const max = Math.max(goalHours || 0, ...list.map((e) => hoursOf(e) ?? 0), 0) || 1;
  const slot = width / Math.max(1, list.length);
  const gap = Math.min(3, slot * 0.28);

  const bars = [];
  list.forEach((e, i) => {
    const total = hoursOf(e);
    if (total == null || total <= 0) return;

    // A night with totals but no stage split still draws, as one block of light:
    // the duration is the fact the chart is about, and withholding the bar
    // because the stages are missing would lose it.
    const staged = stagedHours(e);
    const parts = staged
      ? STACK_ORDER.map((stage) => [stage, stageMinutes(e?.sleepStages, stage) / 60])
      : [["light", total]];

    const segments = [];
    let bottom = height;
    for (const [stage, h] of parts) {
      if (h <= 0) continue;
      const px = (h / max) * height;
      bottom -= px;
      segments.push({ stage, y: bottom, h: px });
    }

    bars.push({
      date: e.date,
      x: i * slot + gap / 2,
      w: Math.max(1, slot - gap),
      total,
      segments,
      last: i === list.length - 1,
    });
  });

  return { bars, max, goalY: goalHours ? height - (goalHours / max) * height : null };
}
