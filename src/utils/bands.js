// The four parts of a day a habit can belong to.
//
// One vocabulary, shared by the store (which stamps a default on a new habit)
// and the routine model (which groups by it). A second copy would drift, and
// the drift would be silent: a band id nothing recognises renders as an empty
// group rather than as an error.
//
// Boundaries are fixed on purpose. Making them configurable is a setting nobody
// has asked for, and these are labels for a sequence rather than alarms: nothing
// fires at 17:00, the word above the rows just changes.

export const BANDS = [
  { id: "morning", label: "MORNING", endHour: 12 },
  { id: "day", label: "DAY", endHour: 17 },
  { id: "evening", label: "EVENING", endHour: 21 },
  { id: "night", label: "NIGHT", endHour: 24 },
];

export const BAND_IDS = BANDS.map((b) => b.id);

/**
 * Where a habit with no band lands.
 *
 * DAY, because it is the one band that makes no claim about early or late: a
 * habit stored before this field existed should not be asserted to be a morning
 * one. Habits added since carry their own.
 */
export const DEFAULT_BAND = "day";

/** The band a given hour falls in, used to default a newly added habit. */
export function bandForHour(hour) {
  const h = Number.isFinite(hour) ? hour : 0;
  return (BANDS.find((b) => h < b.endHour) ?? BANDS[BANDS.length - 1]).id;
}

/** A habit's band, falling back rather than returning something unrenderable. */
export function bandOf(habit) {
  return BAND_IDS.includes(habit?.band) ? habit.band : DEFAULT_BAND;
}

/** Position in the day, so rows and bands can be ordered by it. */
export function bandIndex(id) {
  const i = BAND_IDS.indexOf(id);
  return i < 0 ? BAND_IDS.indexOf(DEFAULT_BAND) : i;
}

export function bandLabel(id) {
  return BANDS.find((b) => b.id === id)?.label ?? "";
}
