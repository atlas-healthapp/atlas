// Builds the `points` attribute for a <polyline> trend hint. Deliberately tiny:
// this is a shape suggesting direction, not a chart. Trends owns real charts.
export function sparklinePoints(values, width, height) {
  const present = [];
  values.forEach((v, i) => {
    // null means the device recorded nothing that day. Plotting it as zero
    // would invent a reading, so gaps are skipped entirely.
    if (v != null) present.push({ i, v });
  });
  if (present.length < 2) return "";

  const nums = present.map((p) => p.v);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min;
  const lastIndex = values.length - 1;

  return present
    .map((p) => {
      const x = (p.i / lastIndex) * width;
      // A flat series has no range to scale against, so centre it rather than
      // dividing by zero.
      const y = span === 0 ? height / 2 : height - ((p.v - min) / span) * height;
      return `${Math.round(x)},${Math.round(y)}`;
    })
    .join(" ");
}
