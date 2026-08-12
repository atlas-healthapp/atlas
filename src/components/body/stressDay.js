// A day of stress readings, turned into something drawable and sayable.
//
// Stress is the only BODY metric with a shape through the day rather than one
// number for it. Everything else the strap reports is either an overnight
// figure (HRV, resting HR) or a running total (steps); stress moves hour to
// hour, which is why it gets a page of its own rather than the generic metric
// page's list of daily values.

/**
 * Zone thresholds, from Huami's own scale, which is what the band is reporting
 * against. Naming them matters more than the numbers: 51 means nothing on its
 * own, and MILD does.
 */
export const STRESS_ZONES = [
  { key: "calm", label: "CALM", max: 39, token: "--stress-calm" },
  { key: "mild", label: "MILD", max: 59, token: "--stress-mild" },
  { key: "moderate", label: "MODERATE", max: 79, token: "--stress-moderate" },
  { key: "high", label: "HIGH", max: Infinity, token: "--stress-high" },
];

export function zoneFor(value) {
  if (value == null) return null;
  return STRESS_ZONES.find((z) => value <= z.max) ?? STRESS_ZONES.at(-1);
}

/** Minutes past local midnight. */
function minuteOfDay(t) {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

const DAY_MINUTES = 1440;

/**
 * The day's line, coloured by the zone each segment sits in.
 *
 * Segments rather than one polyline, because the colour is the reading: a
 * single-hue line would need a legend to say which parts were which, and the
 * whole reason a detail page may spend hue is that it has only one metric to
 * spend it on.
 *
 * Gaps are broken rather than bridged. The band stops sampling when it is off
 * the wrist, and a straight line drawn across four hours of nothing claims a
 * calm afternoon that was never measured.
 */
export const GAP_MINUTES = 45;

export function stressDayGeometry(samples, { height = 78, ceiling = null } = {}) {
  const points = (samples ?? [])
    .filter((s) => s && Number.isFinite(s.t) && Number.isFinite(s.v))
    .sort((a, b) => a.t - b.t);
  if (points.length < 2) return null;

  // Scaled to the day's own peak with headroom, not to 100. A band that has
  // never reported above 66 would otherwise draw every day in the bottom two
  // thirds of the box and read as a broken instrument.
  const peak = ceiling ?? Math.max(40, ...points.map((p) => p.v)) * 1.15;

  // Clipped to what was actually reported rather than to midnight-to-midnight.
  // A full-day axis at 9am spent two thirds of its width on hours that have not
  // happened, which squashed the part with readings in it into the left edge.
  const firstMinute = minuteOfDay(points[0].t);
  const lastMinute = minuteOfDay(points[points.length - 1].t);
  const span = Math.max(60, lastMinute - firstMinute);

  const x = (t) => ((minuteOfDay(t) - firstMinute) / span) * 100;
  const y = (v) => height - (Math.min(v, peak) / peak) * height;

  // One column per reading, rising from the baseline.
  //
  // A continuous line claimed to know what happened between readings, and the
  // band only reports every few minutes. Columns say "these are the readings",
  // and a hole in them reads as the band being off the wrist rather than as a
  // flat calm drawn across it.
  //
  // Width comes from the median spacing rather than from dividing the axis by
  // the count: the band samples irregularly, and even columns would silently
  // stretch a sparse patch to look as dense as a busy one.
  const spacings = [];
  for (let i = 1; i < points.length; i++) {
    const gap = minuteOfDay(points[i].t) - minuteOfDay(points[i - 1].t);
    if (gap > 0 && gap <= GAP_MINUTES) spacings.push(gap);
  }
  spacings.sort((a, b) => a - b);
  const typicalGap = spacings.length ? spacings[Math.floor(spacings.length / 2)] : 7;
  const barWidth = Math.max(0.35, (typicalGap / span) * 100 * 0.82);

  // Hysteresis on the zone, not a fresh lookup per column. A reading hovering
  // either side of 40 made the chart alternate blue and green every few
  // minutes, which read as two interleaved series rather than one day near a
  // boundary. The zone only changes once a reading clears it by a margin.
  const MARGIN = 3;
  let zone = zoneFor(points[0].v);
  const columns = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const candidate = zoneFor(p.v);
    if (candidate.key !== zone.key) {
      const rising = i > 0 ? p.v > points[i - 1].v : true;
      const cleared = rising ? p.v > zone.max + MARGIN : p.v < candidate.max - MARGIN;
      if (cleared) zone = candidate;
    }

    const top = y(p.v);
    columns.push({
      x: x(p.t) - barWidth / 2,
      y: top,
      width: barWidth,
      height: Math.max(0.6, height - top),
      zone,
      value: p.v,
    });
  }

  return {
    height,
    columns,
    barWidth,
    peak: Math.round(peak),
    points: points.length,
    firstMillis: points[0].t,
    lastMillis: points[points.length - 1].t,
  };
}

/**
 * Minutes spent in each zone.
 *
 * Counted from the gaps between readings rather than by counting readings,
 * because the band samples irregularly and a dense patch would otherwise weigh
 * more than a sparse one covering the same hour. Gaps longer than GAP_MINUTES
 * are not counted at all: the band was off, and that is not calm.
 */
export function zoneMinutes(samples) {
  const points = (samples ?? [])
    .filter((s) => s && Number.isFinite(s.t) && Number.isFinite(s.v))
    .sort((a, b) => a.t - b.t);

  const totals = {};
  for (const zone of STRESS_ZONES) totals[zone.key] = 0;

  for (let i = 1; i < points.length; i++) {
    const gap = (points[i].t - points[i - 1].t) / 60000;
    if (gap <= 0 || gap > GAP_MINUTES) continue;
    totals[zoneFor(points[i].v).key] += gap;
  }

  const measured = Object.values(totals).reduce((a, b) => a + b, 0);
  return { totals, measured };
}

/** Average across a window of the day, or null when nothing was measured in it. */
export function averageBetween(samples, fromMinute, toMinute) {
  const inside = (samples ?? []).filter((s) => {
    const m = minuteOfDay(s.t);
    return m >= fromMinute && m < toMinute && Number.isFinite(s.v);
  });
  if (!inside.length) return null;
  return Math.round(inside.reduce((sum, s) => sum + s.v, 0) / inside.length);
}

/** The longest unbroken stretch spent in the calm zone, in minutes. */
export function longestCalm(samples) {
  const points = (samples ?? [])
    .filter((s) => s && Number.isFinite(s.v))
    .sort((a, b) => a.t - b.t);

  let best = 0;
  let runStart = null;
  let last = null;

  for (const p of points) {
    const calm = zoneFor(p.v).key === "calm";
    const broken = last != null && (p.t - last) / 60000 > GAP_MINUTES;
    if (!calm || broken) {
      if (runStart != null && last != null) best = Math.max(best, (last - runStart) / 60000);
      runStart = calm ? p.t : null;
    } else if (runStart == null) {
      runStart = p.t;
    }
    last = p.t;
  }
  if (runStart != null && last != null) best = Math.max(best, (last - runStart) / 60000);

  return Math.round(best);
}

export function fmtZoneMinutes(minutes) {
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole}m`;
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
