import { computed, unref } from "vue";
import { useTripsStore } from "@/stores/trips";
import { tripSpans, tripReach, spanBox } from "@/utils/tripSpans";

/**
 * Trip annotation for one history chart.
 *
 * Four charts draw this (the metric page, sleep's HOW LONG, recovery's 30 bars
 * and stress's fortnight) and they have four different widths, series shapes
 * and card colours. What they must not have is four opinions about what a trip
 * covers - `labelFor` reaching exactly one screen is how this ticket started,
 * and four copies of the answer is the same failure one file over.
 *
 * `days` is the chart's own series, oldest first, as `{ date, value }`. Boxes
 * come back in **percent**, because the lane is HTML laid over a chart that
 * scales with `preserveAspectRatio="none"` and would stretch anything drawn
 * inside it.
 */
export function useTripLane(days) {
  const trips = useTripsStore();

  const series = computed(() => unref(days) ?? []);
  const box = (span) => spanBox(span, series.value.length, 100);

  const gaps = computed(() =>
    tripSpans(series.value, trips.trips).map((s) => ({ ...s, box: box(s) }))
  );
  const reach = computed(() =>
    tripReach(series.value, trips.trips).map((s) => ({ ...s, box: box(s) }))
  );

  return {
    gaps,
    reach,
    /** Whether the chart needs to make room for the rule lane at all. */
    active: computed(() => reach.value.length > 0),
  };
}
