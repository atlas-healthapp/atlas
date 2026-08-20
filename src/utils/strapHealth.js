// How long the strap's battery is actually lasting.
//
// The reading Atlas already had answers "will it survive tonight", which is a
// question you ask once. What it could not answer was "is it lasting six days,
// down from nine" - whether the strap is wearing out, whether a firmware change
// cost you battery, or whether a sync every half hour is too aggressive. Atlas
// sets that interval for its own reasons, so it ought to be able to see what it
// costs.
//
// Pure and tested, like every other piece of arithmetic in this app, because the
// panel that draws it is template-shaped and cannot be.

/**
 * A rise of at least this many points between consecutive readings is a charge.
 *
 * Not any rise at all. A percentage reported by a coin-cell strap wobbles by a
 * point either way as the voltage recovers between reads, and treating that as a
 * charge would cut the discharge into dozens of two-hour fragments and report a
 * battery lasting a couple of hours.
 */
export const CHARGE_RISE = 5;

/**
 * A discharge shorter than this is not evidence about anything.
 *
 * Someone unplugging the strap to check it, or a charge that did not take,
 * leaves a stub of a few percent over an hour. Extrapolated to a full 100%, a
 * stub like that reports a wildly confident figure from almost no data.
 */
export const MIN_SEGMENT_DROP = 15;
export const MIN_SEGMENT_HOURS = 6;

/** Below this many complete discharges there is no rate worth naming. */
export const MIN_SEGMENTS = 2;

const HOUR = 60 * 60 * 1000;

/**
 * Cut the battery series into the runs between charges.
 *
 * **A charge is a jump upward, not a gap in the readings.** The strap is synced
 * every half hour at best and not at all while the phone is away from it, so a
 * six-hour hole in the middle of a discharge is ordinary and says nothing about
 * whether it was plugged in.
 *
 * `readings` are `{ t, v }` in any order; `charges` are timestamps at which the
 * band reported itself charging, which confirm a rise rather than being needed
 * to find one. The band only says "charging" while the cable is actually on, so
 * an overnight charge that finished before the next sync produces a rise with no
 * charging reading anywhere near it - which is why the rise is what defines a
 * segment and the flag is only corroboration.
 */
export function dischargeSegments(readings, charges = []) {
  const points = (readings ?? [])
    .filter((r) => r && Number.isFinite(r.t) && Number.isFinite(r.v))
    .sort((a, b) => a.t - b.t);
  if (points.length < 2) return [];

  const chargeTimes = (charges ?? [])
    .map((c) => (Number.isFinite(c) ? c : c?.t))
    .filter(Number.isFinite);

  const segments = [];
  let run = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const rose = points[i].v - points[i - 1].v >= CHARGE_RISE;
    if (rose) {
      // **A charge is one episode, however many readings it took.** This used to
      // start a new segment at every rise, so a single charge that happened to be
      // synced repeatedly became several: measured on the real archive on
      // 2026-08-19, one charge from 20% to 99% arrived as the rises 36, 50, 56,
      // 92, 93, 95, 97, 99 and was counted as eight charges with a near-zero
      // "discharge" wedged between each pair. Those junk runs then fed the
      // averaging as though they were real, which is what made the days-per-charge
      // figure meaningless.
      //
      // So walk to the top of the climb and begin the discharge there.
      //
      // **Non-decreasing, not strictly rising**, and that distinction is a bug
      // this was written with. A charge plateaus while it tops off: the real
      // series reads 92, 93, 95, 97, 97, 97, 99. Stopping at the first equal pair
      // put the peak at 97 and started the "discharge" there, which then rose to
      // 99 inside its own run - a segment with a drop of minus two, reported as a
      // discharge. Walking through the flat spots ends the charge where the
      // battery actually stops climbing.
      //
      // It also disposes of the other half of the problem for free: a strap left
      // plugged in at 99% reports 99 for an hour, and counting that hour as
      // discharge would add time against no drop, inflating the estimate - which
      // is the direction this figure was wrong in. Beginning at the LAST reading
      // of the plateau starts the clock when the battery starts falling, which is
      // when the discharge really began.
      let peak = i;
      while (peak + 1 < points.length && points[peak + 1].v >= points[peak].v) peak += 1;

      segments.push(run);
      run = [points[peak]];
      i = peak;
      continue;
    }
    run.push(points[i]);
  }
  segments.push(run);

  return segments
    .map((run) => {
      const from = run[0];
      const to = run.at(-1);
      const drop = from.v - to.v;
      const hours = (to.t - from.t) / HOUR;
      return {
        from: from.t,
        to: to.t,
        fromPct: from.v,
        toPct: to.v,
        drop,
        hours,
        readings: run.length,
        // Whether the band itself said it was charging just before this run
        // began, which is corroboration only.
        confirmed: chargeTimes.some((t) => t <= from.t && from.t - t <= 2 * HOUR),
        // A run still in progress has nothing after it. It is kept and marked
        // rather than dropped, because "5 days in and at 40%" is the most useful
        // thing on the panel while it is happening.
        complete: false,
      };
    })
    .map((seg, i, all) => ({ ...seg, complete: i < all.length - 1 }));
  // No filtering on length here. A run of one reading carries no rate, but it is
  // still a real boundary in the series, and dropping it made the count of
  // segments disagree with the number of charges the strap actually had.
  // `isUsable` is the one place that decides what can be extrapolated from, and
  // its floors on drop and hours already exclude a zero-length run.
}

/**
 * A run with enough of a drop, over enough time, to extrapolate from at all.
 *
 * **Says nothing about whether the run has finished.** A discharge four days in
 * and down 60 points is exactly as good a measurement of the RATE as a finished
 * one; what it cannot do is settle the figure, because it is one run. That is
 * `isUsable`'s job below.
 */
export function isMeasurable(segment) {
  return segment.drop >= MIN_SEGMENT_DROP && segment.hours >= MIN_SEGMENT_HOURS;
}

/** A measurable run that has also finished, so it can settle a rate. */
export function isUsable(segment) {
  return segment.complete && isMeasurable(segment);
}

/** Days from full to flat, at the rate a single run was going. */
function daysFor(segment) {
  return ((segment.hours / segment.drop) * 100) / 24;
}

/**
 * Days from full to flat, and what it is based on.
 *
 * **Each segment is extrapolated to a full 100% and then the segments are
 * averaged**, rather than fitting anything across the series. The series is
 * sawtoothed by design and a line through a charge is meaningless; and averaging
 * the per-segment rates rather than pooling the raw drops stops one long run
 * dominating.
 *
 * **Withheld under two complete discharges.** One is not a rate: a figure from a
 * single run would move every day until the second arrived, which is the same
 * rule the level term and the baselines already follow.
 *
 * `trend` compares the most recent usable segment with the mean of the ones
 * before it, so "six days, down from nine" is available without a second pass
 * over the data. Null until there are three, since a change needs something to
 * have changed from.
 */
export function batteryLife(readings, charges = []) {
  const segments = dischargeSegments(readings, charges);
  const usable = segments.filter(isUsable);
  const last = segments.at(-1);
  const current = last && !last.complete ? last : null;

  if (usable.length < MIN_SEGMENTS) {
    // **A provisional figure rather than nothing**, whenever any single run has
    // gone far enough to be measured - including the one still running. The
    // "withhold under two discharges" rule is about settling a rate, and a rate
    // is what moves every day until the second run arrives. "At this rate, six
    // days" is a different claim: it is a statement about the run in hand, it is
    // true, and on a strap that lasts a fortnight it is the difference between a
    // useful row and a fortnight of silence.
    const measurable = segments.filter(isMeasurable);
    const from = measurable.at(-1);
    return {
      state: from ? "provisional" : "calibrating",
      days: from ? daysFor(from) : null,
      basis: measurable.length,
      fromCurrentRun: Boolean(from && from === current),
      segments: segments.length,
      usable: usable.length,
      needed: MIN_SEGMENTS - usable.length,
      current,
      trend: null,
    };
  }

  const perSegmentDays = usable.map(daysFor);
  const mean = (list) => list.reduce((sum, v) => sum + v, 0) / list.length;

  // **Pooled, not a mean of ratios.** Averaging each run's own extrapolation
  // gives a 16% run the same say as a 70% one, and the short run is the one
  // whose figure is mostly extrapolation: at MIN_SEGMENT_DROP it is multiplied
  // by more than six before it is averaged in. Adding the evidence up first and
  // dividing once weights every run by how much of a discharge it actually
  // watched, which is what makes a fortnight-long claim defensible at all.
  //
  // Reported as too high against the vendor's own 10-day figure, and this is the
  // half of that which is arithmetic rather than physics. The other half is that
  // a cell does not discharge linearly, so a run spent entirely in the flat
  // middle of the curve still over-states the ends; nothing here can fix that,
  // which is why `basisDrop` is published for the panel to qualify the number
  // with rather than leaving it to be read as a spec.
  const totalHours = usable.reduce((sum, seg) => sum + seg.hours, 0);
  const totalDrop = usable.reduce((sum, seg) => sum + seg.drop, 0);
  const days = (totalHours / totalDrop) * 100 / 24;

  const earlier = perSegmentDays.slice(0, -1);
  const latest = perSegmentDays.at(-1);
  const trend =
    perSegmentDays.length >= 3
      ? { latest, previous: mean(earlier), change: latest - mean(earlier) }
      : null;

  return {
    state: "ready",
    days,
    basis: usable.length,
    // How much discharge the figure is actually built on, so a screen can say
    // "from 46% of discharge" rather than presenting an extrapolation as a
    // measurement.
    basisDrop: totalDrop,
    fromCurrentRun: false,
    segments: segments.length,
    usable: usable.length,
    trend,
    current,
  };
}

/**
 * How much of the drain the sync interval could account for.
 *
 * The open question the first real data was meant to answer: Atlas syncs every
 * half hour and that is the one thing it controls. This does not attempt to
 * separate the sync's cost from the strap's own idle draw, because a single
 * interval produces a single number and there is nothing to compare it against.
 * It reports **percent per sync** so that changing the interval later gives
 * something to compare, and says so rather than implying a cause.
 */
/**
 * **Nothing renders this, and it is kept on purpose** (2026-08-18). The panel
 * showed "about 0.1% per sync, measured" and it was dropped: the figure was
 * honest and unusable, being well inside the noise of a percentage that moves in
 * whole points, and nobody decides anything from it.
 *
 * It survives because it answers a question that IS open - whether syncing every
 * thirty minutes is what puts the strap's measured life above the vendor's own
 * figure. That is the test for that ticket, not a display.
 */
export function drainPerSync(readings, charges = [], intervalMinutes = 30) {
  // Measurable rather than usable: this is a rate per sync, not a claim about
  // how long a charge lasts, so the run still in progress counts toward it and
  // the figure exists from the first real discharge rather than the second.
  const runs = dischargeSegments(readings, charges).filter(isMeasurable);
  if (!runs.length || !intervalMinutes) return null;

  const drop = runs.reduce((sum, s) => sum + s.drop, 0);
  const hours = runs.reduce((sum, s) => sum + s.hours, 0);
  const syncs = (hours * 60) / intervalMinutes;
  return syncs > 0 ? drop / syncs : null;
}

/**
 * What a number of days per charge is worth, as a word.
 *
 * **Judged against the strap's own advertised endurance rather than against
 * anything universal.** Zepp quote about 14 days for this band under ordinary
 * use, and Atlas syncs it far harder than ordinary use, so the bands are set
 * against what this strap does in this app rather than against the brochure. A
 * week is genuinely good here; three days means something is wrong, most likely
 * the sync interval or an ageing cell.
 *
 * Reuses Recovery's own band tokens, which the sleep score already does for the
 * same reason: it is a semantic ramp rather than a colour family, and the two
 * never share a screen. A second red-to-green vocabulary would be one more
 * thing to learn for no gain.
 */
export const LIFE_BANDS = [
  { min: 10, label: "GREAT", token: "--rec-great" },
  { min: 6, label: "GOOD", token: "--rec-good" },
  { min: 3.5, label: "OKAY", token: "--rec-okay" },
  { min: 0, label: "POOR", token: "--rec-low" },
];

export function lifeBand(days) {
  if (days == null || !Number.isFinite(days)) return null;
  return LIFE_BANDS.find((b) => days >= b.min) ?? LIFE_BANDS.at(-1);
}

/** "6.2 DAYS", or the honest shorter forms at either end. */
export function formatDays(days) {
  if (days == null || !Number.isFinite(days)) return "";
  if (days < 1) return `${Math.round(days * 24)} HOURS`;
  return `${days.toFixed(1)} DAYS`;
}
