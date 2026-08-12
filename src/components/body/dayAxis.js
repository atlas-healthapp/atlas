// Clock labels along a day chart's x axis.
//
// Shared by the stress and heart-rate pages, which both draw one day clipped to
// what the band actually reported rather than midnight to midnight. Two copies
// of this would drift the moment one of them changed its spacing, and the two
// charts sit one tap apart.
//
// Ticks land on the hour, not at even fractions of the plot: a label reading
// 09:00 is a time you can find in your own day, and one reading 09:47 because
// that is a third of the way across is not.

/** Minutes past local midnight. */
function minuteOfDay(t) {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * `geometry` needs only `firstMillis` and `lastMillis`, which both day
 * geometries already return.
 *
 * `everyHours` is how often to label. Three across a full waking day is about
 * six labels, which is what fits a phone without them touching.
 */
export function hourTicks(geometry, { everyHours = 3 } = {}) {
  if (!geometry || !Number.isFinite(geometry.firstMillis)) return [];

  const firstMinute = minuteOfDay(geometry.firstMillis);
  const lastMinute = minuteOfDay(geometry.lastMillis);
  const span = Math.max(60, lastMinute - firstMinute);
  const step = everyHours * 60;

  const out = [];
  for (let m = Math.ceil(firstMinute / step) * step; m <= lastMinute; m += step) {
    out.push({
      minute: m,
      x: ((m - firstMinute) / span) * 100,
      label: `${String(Math.floor(m / 60)).padStart(2, "0")}:00`,
    });
  }
  return out;
}
