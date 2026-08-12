// One metric's state for a row: today's reading, its series across a window,
// and the band it is judged against.
//
// Lived in components/body/bodyModel.js until the ACTIVITY tab split off and
// needed exactly the same maths for steps and PAI. A second copy would have
// been two answers to "is today unusual", which is the one question the band
// exists to answer.

import { typicalRange } from "@/utils/baseline";
import { METRICS } from "@/utils/metricRegistry";

/** One metric's readings across the window, oldest first, nulls preserved. */
export function seriesFor(dayWindow, key, readCheckin) {
  return (dayWindow ?? []).map((d) =>
    METRICS[key]?.source === "checkin"
      ? (readCheckin(d.date)?.[key] ?? null)
      : (d.values?.[key] ?? null)
  );
}

/**
 * A row's worth of state: today's reading, and the band it is judged against.
 *
 * The band excludes today for the same reason the Recovery baseline does: a
 * range that contains the reading being judged is dragged toward it, which
 * flattens the deviation the band exists to show.
 *
 * `range` is null until enough days have accumulated, and callers must render
 * the bare value then. A band drawn from three readings looks exactly as
 * confident as one drawn from thirty.
 */
export function rowFor(dayWindow, key, readCheckin, todayKey) {
  const def = METRICS[key];
  if (!def) return null;

  const series = seriesFor(dayWindow, key, readCheckin);
  const value =
    (dayWindow ?? []).find((d) => d.date === todayKey) &&
    (def.source === "checkin"
      ? (readCheckin(todayKey)?.[key] ?? null)
      : ((dayWindow ?? []).find((d) => d.date === todayKey)?.values?.[key] ?? null));

  const prior = (dayWindow ?? [])
    .filter((d) => d.date < todayKey)
    .map((d) =>
      def.source === "checkin" ? (readCheckin(d.date)?.[key] ?? null) : (d.values?.[key] ?? null)
    )
    .filter((v) => v != null);

  return {
    key,
    def,
    value: value === false ? null : value,
    series,
    // The readings before today, which is what the range mark scales its axis
    // to. `series` includes today and would let one outlier stretch the axis it
    // is being judged on.
    prior,
    // Goal metrics are judged against the goal, so they get no band.
    range: def.goal ? null : typicalRange(prior),
  };
}

/** How many days in the window actually carry a reading from the strap. */
export function daysWithData(dayWindow) {
  return (dayWindow ?? []).filter((d) => d.values?.steps != null).length;
}
