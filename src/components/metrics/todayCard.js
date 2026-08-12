// What a metric page says about today, beyond the number itself.
//
// The other four drill-throughs all spend most of their first screen on the
// day being viewed and only then break into history. MetricPage could not: its
// today is one reading and everything else it holds is a record of other days,
// so the top was a number, a sentence and a line, and history dominated.
//
// Two contents, one position, chosen by whether the reading has parts:
//
//   parts     protein and fibre are built out of confirmed meals, and the app
//             already stores each one's own macro snapshot. So the card is
//             sleep's WHAT WENT INTO IT with grams instead of points.
//   compares  everything else is a single reading with nothing inside it, so
//             the card answers the next question instead: how does today sit
//             against yesterday, the week, and the baseline.
//
// The page shape stays the same across all thirteen metrics either way, which
// is the point: one card in one place, filled by whatever the metric can
// actually support.

/** Rows for a metric whose total is made of logged entries. */
export function partRows(contributions, goal) {
  const rows = (contributions ?? []).filter((c) => c && c.grams > 0);
  if (!rows.length) return [];
  return rows.map((c) => ({
    key: `${c.at}-${c.name}`,
    name: c.name,
    at: c.at,
    value: Math.round(c.grams),
    // Filled against the goal rather than against the day's total, so a bar
    // says how much of the target this meal covered. Against the total, a
    // single logged meal on an empty day would draw full width and read as a
    // day already handled.
    fill: goal ? Math.min(100, (c.grams / goal) * 100) : 0,
  }));
}

/**
 * Rows for a metric with no parts: today against the references it has.
 *
 * A reference with nothing behind it is dropped rather than shown as a dash.
 * Yesterday is missing whenever the strap was off, and a row reading "-- (--)"
 * is worse than a card with two rows in it.
 */
export function compareRows({ today, yesterday, weekAverage, baseline }) {
  if (today == null) return [];
  const candidates = [
    { key: "yesterday", label: "YESTERDAY", value: yesterday },
    { key: "week", label: "7-DAY AVG", value: weekAverage },
    { key: "baseline", label: "BASELINE", value: baseline },
  ].filter((r) => r.value != null);
  if (!candidates.length) return [];

  const rows = candidates.map((r) => ({ ...r, delta: today - r.value }));
  // Bars are scaled to the widest gap on the card, not to the reading, because
  // the gaps are small next to the values: HRV moving 45 to 47 is a real
  // change and 2 against a 47-wide axis is invisible.
  const widest = Math.max(...rows.map((r) => Math.abs(r.delta)), Number.EPSILON);
  return rows.map((r) => ({ ...r, fill: (Math.abs(r.delta) / widest) * 100 }));
}

/** The mean of the last `days` recorded readings, or null before any exist. */
export function recentAverage(series, days = 7) {
  const seen = (series ?? []).slice(-days).filter((v) => v != null);
  if (!seen.length) return null;
  return seen.reduce((a, b) => a + b, 0) / seen.length;
}

/** The most recent recorded reading before today, or null. */
export function previousReading(series) {
  const before = (series ?? []).slice(0, -1);
  for (let i = before.length - 1; i >= 0; i--) {
    if (before[i] != null) return before[i];
  }
  return null;
}
