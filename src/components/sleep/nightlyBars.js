// Bars for a nightly reading that has no target, scaled between its own low and
// high rather than from zero.
//
// From zero, a fortnight of sleeping heart rates between 49 and 55 draws
// fourteen bars of visibly identical height: the variation the chart exists to
// show is 11% of the ink. Scaling to the range shows it, at the cost of the
// heights no longer being proportional to the values, which is why both ends of
// the range are printed on the axis and the chart is never drawn without them.

/** The shortest a bar can be, so the lowest night is still a bar and not a gap. */
const MIN_FRACTION = 0.14;

export function rangeBars(values, { width = 294, height = 44 } = {}) {
  const nums = (values ?? []).map((v) => (Number.isFinite(v) ? v : null));
  const present = nums.filter((v) => v != null);
  if (!present.length) return { bars: [], lo: null, hi: null };

  const lo = Math.min(...present);
  const hi = Math.max(...present);
  // A flat series has no range to divide by. Draw it at full height rather than
  // dividing by zero: every night was the same, which is a true thing to show.
  const span = hi - lo;

  const slot = width / Math.max(1, nums.length);
  const gap = Math.min(3, slot * 0.28);

  const bars = [];
  nums.forEach((v, i) => {
    // A night with no reading draws nothing at all. A stub would read as a very
    // low heart rate, which is the opposite of "not measured".
    if (v == null) return;
    const fraction = span ? MIN_FRACTION + ((v - lo) / span) * (1 - MIN_FRACTION) : 1;
    const h = fraction * height;
    bars.push({
      i,
      x: i * slot + gap / 2,
      w: Math.max(1, slot - gap),
      y: height - h,
      h,
      value: v,
      last: i === nums.length - 1,
    });
  });

  return { bars, lo, hi };
}
