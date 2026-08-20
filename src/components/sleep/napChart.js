// Where a nap sat in the day, one column per day.
//
// The list under this chart already says how long each nap was and when it
// started, so a chart of durations would only redraw the numbers beside it.
// What the list cannot show is the pattern: that the naps cluster in the late
// afternoon, or that four of them are evening dozes. So this is a clock axis,
// the daytime counterpart to WHEN YOU SLEPT's 21:00 to 13:00 - the two halves
// of the same 24 hours, drawn in the same language.
//
// **The axis is 09:00 to midnight because that is exactly the window a nap can
// occupy**: `isDaytimeSleep` requires a bed hour at or after 09:00 and the same
// calendar day at both ends. So nothing can fall off an end by construction,
// which matters because dayMarkers' rule is that a mark outside the axis is
// dropped rather than clamped - and dropping a nap from the nap chart would be
// the chart failing at its only job.

export const NAP_AXIS_START_HOUR = 9;
export const NAP_AXIS_END_HOUR = 24;
const AXIS_MINUTES = (NAP_AXIS_END_HOUR - NAP_AXIS_START_HOUR) * 60;

/** The shortest a nap can draw, so a 16-minute one is a mark and not a hairline. */
const MIN_HEIGHT_FRACTION = 0.05;

/**
 * Where the hour labels go. Every three hours was drawn once and the six labels
 * collided outright in the chart's own height - this is a short chart under a
 * list, not the half-screen one WHEN YOU SLEPT gets.
 */
const TICK_HOURS = [9, 15, 21, 24];

/** The weekday initial, so a column can be found without counting along. */
const dayLetter = (dateKey) =>
  new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-GB", { weekday: "narrow" });

const minutesFromAxis = (ms) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() - NAP_AXIS_START_HOUR * 60;
};

/**
 * Columns for a run of days, in a 100 by `height` coordinate space.
 *
 * `days` are `{ date, naps }` oldest first, with naps in the stored shape
 * (epoch ms and minutes). A day with no naps keeps its column: the gaps are
 * what make this a pattern rather than a list, and a chart that dropped the
 * empty days would draw five naps as five days in a row.
 */
export function napColumns(days, { height = 66, gap = 0.34 } = {}) {
  const list = days ?? [];
  const slot = 100 / Math.max(1, list.length);
  const width = slot * (1 - gap);
  const y = (minutes) => (minutes / AXIS_MINUTES) * height;

  const columns = list.map((day, i) => ({
    date: day.date,
    day: dayLetter(day.date),
    x: i * slot + (slot - width) / 2,
    width,
    marks: (day.naps ?? [])
      .filter((nap) => nap?.bedTime != null)
      .map((nap) => {
        const start = minutesFromAxis(nap.bedTime);
        const minutes = nap.minutes ?? 0;
        const h = Math.max(y(minutes), height * MIN_HEIGHT_FRACTION);
        return {
          y: y(Math.max(start, 0)),
          height: h,
          minutes,
          bedTime: nap.bedTime,
        };
      })
      // Sorted so a day with two naps draws them in the order they happened,
      // which is also the order the rows beneath the chart are in.
      .sort((a, b) => a.bedTime - b.bedTime),
  }));

  return {
    columns,
    ticks: TICK_HOURS.map((hour) => ({
      y: y((hour - NAP_AXIS_START_HOUR) * 60),
      // Midnight as 00:00 rather than 24:00, which is what a clock says.
      label: `${String(hour % 24).padStart(2, "0")}:00`,
    })),
    napDays: columns.filter((c) => c.marks.length).length,
    naps: columns.reduce((sum, c) => sum + c.marks.length, 0),
  };
}
