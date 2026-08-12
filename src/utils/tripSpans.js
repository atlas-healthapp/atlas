// Where a labelled trip actually explains something.
//
// A trip is a date range you were away, and its whole job is to answer "why is
// there nothing here". So it is drawn over the days that are **missing**, not
// over the range: a fortnight in Bali with the band worn for four of those days
// has four days of perfectly good readings in the middle of it, and tinting
// those claims something about the data that is not true.
//
// One implementation for every history chart. `trips.labelFor` reached exactly
// one screen before this (a day-row tag on MetricPage) while Settings promised
// it explained gaps in the charts, and five charts each deciding for themselves
// what "a gap" means is the drift `metricRegistry` exists to stop.

/**
 * A day counts as missing when its value is falsy.
 *
 * This is the same "absent" convention `barGeometry` already draws by (it skips
 * `null` and `<= 0` alike) and the same one MetricPage's day list prints a trip
 * label for. None of the thirteen metrics has a meaningful zero: nobody weighs
 * nothing, and a resting heart rate of 0 is a sentinel, not a reading.
 */
function isMissing(value) {
  return !value;
}

/**
 * Runs of consecutive missing days that a trip covers.
 *
 * `days` is the chart's own series, oldest first, as `{ date, value }`. `trips`
 * is the store's array. Returns `{ tripId, label, from, to, count }` with `from`
 * and `to` as **inclusive indexes into `days`**, so a chart can map them through
 * its own x scale rather than this file knowing anything about pixels.
 *
 * A present day inside the range splits the span in two rather than being
 * swallowed by it, which is the "annotate the gap, not the range" rule doing its
 * work: two short absences read as two absences.
 */
export function tripSpans(days, trips) {
  const series = days ?? [];
  const out = [];

  for (const trip of trips ?? []) {
    if (!trip?.start || !trip?.end) continue;

    let from = null;
    for (let i = 0; i < series.length; i++) {
      const day = series[i];
      // Date strings are YYYY-MM-DD, so lexicographic comparison is correct.
      // Same test `trips.labelFor` makes.
      const inside =
        day?.date != null && day.date >= trip.start && day.date <= trip.end && isMissing(day.value);

      if (inside) {
        if (from == null) from = i;
        continue;
      }
      if (from != null) {
        out.push({ tripId: trip.id, label: trip.label, from, to: i - 1, count: i - from });
        from = null;
      }
    }
    if (from != null) {
      out.push({
        tripId: trip.id,
        label: trip.label,
        from,
        to: series.length - 1,
        count: series.length - from,
      });
    }
  }

  return out.sort((a, b) => a.from - b.from);
}

/**
 * Every day of a trip that falls in the window, whether or not it has a reading.
 *
 * The other half of the treatment, and the half that earns its keep on real
 * data: the one trip actually logged on this phone (Gold Coast, 1-3 August) has
 * readings on all three days, so `tripSpans` says nothing about it at all.
 * Those days are not a hole, they are a **movement** - resting HR 48 to 53 and
 * HRV 96 to 85 across them - and an annotation that can only mark emptiness
 * cannot point at that.
 *
 * So the two marks say two different things and both are needed: this one says
 * *you were away*, and `tripSpans` says *and nothing was recorded*.
 *
 * One entry per trip: a trip is a continuous range, so unlike the gap spans it
 * never splits.
 */
export function tripReach(days, trips) {
  const series = days ?? [];
  const out = [];

  for (const trip of trips ?? []) {
    if (!trip?.start || !trip?.end) continue;
    let from = null;
    let to = null;
    for (let i = 0; i < series.length; i++) {
      const date = series[i]?.date;
      if (date != null && date >= trip.start && date <= trip.end) {
        if (from == null) from = i;
        to = i;
      }
    }
    if (from != null) out.push({ tripId: trip.id, label: trip.label, from, to });
  }

  return out.sort((a, b) => a.from - b.from);
}

/**
 * A span's box in a chart's own coordinates.
 *
 * Kept beside `tripSpans` rather than in each chart, because the five charts
 * that draw these have three different widths and would otherwise each derive
 * the slot width themselves. Matches `barGeometry`'s `slot = width / count`
 * exactly, so a span lines up with the empty slots it is explaining.
 */
export function spanBox(span, count, width) {
  const slot = width / Math.max(1, count);
  return { x: span.from * slot, width: Math.max(slot, (span.to - span.from + 1) * slot) };
}

/**
 * Roughly how wide a character of the lane's 9px mono label is, in pixels.
 *
 * Approximate on purpose, the same way dayMarkers' is: this decides whether two
 * labels may sit near each other, and being a pixel out changes nothing, while
 * measuring text properly would mean rendering it first.
 */
const TRIP_CHAR_PX = 5.6;

/**
 * Which trip labels can be drawn without running into each other.
 *
 * A rule's label is deliberately allowed to overflow a short rule - three days
 * of a ninety-day window is a 3% mark, narrower than the word it carries - which
 * was fine while there was one trip and collides the moment there are two near
 * each other.
 *
 * **The label is dropped, not the rule.** The rule is the fact (you were away);
 * the label is the name of it. Losing the name of one trip is a smaller loss
 * than two names printed on top of each other, which costs you both.
 *
 * Earlier trips win, because the lane reads left to right and a reader who has
 * followed it that far has already placed the first one.
 */
export function placeTripLabels(reach, { chartPx = 330 } = {}) {
  const kept = [];
  return (reach ?? []).map((r) => {
    const startPct = r.box?.x ?? 0;
    const widthPct = ((r.label?.length ?? 0) * TRIP_CHAR_PX * 100) / chartPx;
    const endPct = startPct + widthPct;
    const clears = kept.every((k) => startPct >= k.end || endPct <= k.start);
    if (clears) kept.push({ start: startPct, end: endPct });
    return { ...r, showLabel: clears };
  });
}
