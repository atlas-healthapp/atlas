// The geometry for the cards under Recovery's HISTORY divider that are about a
// term rather than about the score: where you sit against your own ceiling, and
// the nights behind the sleep term.
//
// Option A and option D of four mocked up on 2026-08-10, and they are both here
// because they answer different questions and neither does the other's job. The
// line says *where am I and which way am I going*; the distribution says *is
// this reading unusual for me*, which is the user's own phrasing - "you were at
// your peak here but more often around this level".
//
// Resting heart rate and sleep joined them on 2026-08-10, so that every term
// feeding Recovery has a picture and the run of cards under the divider is the
// score taken apart rather than one term singled out.
//
// Pure, like every other chart's geometry in this app, because the components
// that draw them are template-shaped and there is no Vue test harness here.

import { LEVEL_WINDOW, LEVEL_FLOOR, CEILING_PERCENTILE } from "@/utils/level";

/**
 * Linear-interpolated percentile.
 *
 * A local copy on purpose. level.js keeps its own private, and importing it
 * would tie this module to one it has nothing else to do with. The percentile
 * itself is imported rather than retyped, because a chart drawing a different
 * ceiling from the one the score uses is worse than no chart.
 */
function percentileOf(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(rank);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/**
 * Trailing averages with the date each one ends on.
 *
 * `window` is the rollup shape `dailyValuesForRange` returns. Days with no
 * reading are skipped rather than interpolated, the same rule level.js follows,
 * so a window can span more calendar days than it has points - which is correct
 * for a figure about form rather than about dates.
 */
export function levelSeries(window, metric = "hrv", nights = LEVEL_WINDOW) {
  const days = (window ?? [])
    .filter((d) => {
      const v = d?.values?.[metric];
      return typeof v === "number" && Number.isFinite(v) && v > 0;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < nights) return [];

  const out = [];
  let sum = 0;
  for (let i = 0; i < days.length; i++) {
    sum += days[i].values[metric];
    if (i >= nights) sum -= days[i - nights].values[metric];
    if (i >= nights - 1) out.push({ date: days[i].date, value: sum / nights });
  }
  return out;
}

/**
 * The ceiling a series implies, by the same rule `levelFrom` uses.
 *
 * `higherIsBetter` false takes the good end of a metric that runs the other way:
 * the 10th percentile for resting heart rate rather than the 90th. It exists
 * because both charts need a ceiling before the score's own term is ready, and
 * because resting heart rate's term stops carrying one at all once a date of
 * birth is known - the age reference takes over as its spine, and that object
 * has no percentile in it.
 */
export function levelCeiling(series, { higherIsBetter = true } = {}) {
  const values = (series ?? [])
    .map((p) => p?.value)
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!values.length) return null;
  return percentileOf(values, higherIsBetter ? CEILING_PERCENTILE : 100 - CEILING_PERCENTILE);
}

/**
 * Least vertical clearance between two figures in the value gutter, in user
 * units.
 *
 * Below this the outside reference is dropped rather than drawn. On resting
 * heart rate the age band usually lands just under your own ceiling, which is
 * exactly where the ceiling's own figure already sits, and two numbers
 * overprinting each other is worse than one number missing.
 */
export const GUTTER_MIN_GAP = 13;

/** How far the gutter's figures stand off the plot they label. */
const GUTTER_STANDOFF = 6;

/**
 * The shortest the drawn scale may get, as a share of the ceiling.
 *
 * 15% is a sixth of the way to the floor, which is the point at which a fortnight
 * of ordinary variation stops filling the box. Measured against the real
 * fortnight it changes nothing: HRV spans 28 ms against a 17 ms minimum.
 */
export const MIN_SPAN_SHARE = 0.15;

/**
 * The line, with both ends of the scale on it.
 *
 * **The axis is padded past the ceiling and the floor rather than being scaled
 * to the readings.** The whole point of the chart is where the line sits between
 * two fixed rules, and an axis that hugged the data would move those rules every
 * time a reading did - which is the same mistake `RangeMark` was rebuilt to
 * escape and the reason `recoveryHistory` fixes its axis at 0-100.
 *
 * `invert` is for a metric where lower is better. It flips the axis, not the
 * meaning: the ceiling stays the end you are aiming at and stays at the top, so
 * the HRV card and the resting heart rate card draw the same picture and a
 * reader does not have to re-learn which way is good between one and the next.
 *
 * `reference` is an outside figure to rule off against - the age band for
 * resting heart rate, which is the one absolute comparison Atlas can make. It
 * **holds the axis open**: since the floor came off the extent it is often the
 * only thing below the readings, and an age band drawn off the bottom edge would
 * be the one comparison in Atlas that is not from your own history, missing.
 *
 * `gutter` reserves width down the left for the figures the rules are worth,
 * which is what makes the chart readable at all: two dashed rules with no number
 * on them say the scale exists without saying what it is. The plot starts after
 * it, so a figure and the line can never overprint - the same arrangement
 * MetricPage's labelled gridlines use, moved inside the viewBox because this
 * chart is scaled uniformly and can therefore hold its own type.
 */
export function levelLine(
  series,
  {
    ceiling,
    floor,
    width = 320,
    height = 150,
    pad = 8,
    gutter = 0,
    invert = false,
    reference = null,
    showFloor = false,
    minSpanShare = MIN_SPAN_SHARE,
  } = {}
) {
  const points = series ?? [];
  if (points.length < 2 || !ceiling || !floor) return null;

  const values = points.map((p) => p.value);
  // **The floor is out of the extent by default** (2026-08-11, option A of three
  // mocked up). It is a construction rather than a reading - the ceiling times
  // `LEVEL_FLOOR` - so it lands at 69 ms when nothing has been under 87, and at
  // 81 bpm when nothing has been over 51. Padding the axis out to reach it spent
  // most of the box on a region never visited: measured on the real fortnight,
  // resting heart rate's readings occupied 7% of the drawn height, so nearly two
  // beats of movement drew as a flat line. What stays in the extent are the
  // things the term is actually judged against, which is what keeps the axis
  // from following the readings around.
  //
  // `showFloor` puts it back for a caller that wants the distance to the floor
  // to be the subject. Nothing does today.
  const anchors = [ceiling];
  if (showFloor) anchors.push(floor);
  if (reference != null && Number.isFinite(reference)) anchors.push(reference);
  let lo = Math.min(...anchors, ...values);
  let hi = Math.max(...anchors, ...values);

  // **The scale has a shortest it may get.** With the floor out of the extent
  // the bottom of the axis follows the worst reading in the window, so a
  // fortnight that never left the ceiling would have a two-millisecond wobble
  // drawn full height - which is `RangeMark`'s old defect exactly: a mark scaled
  // to the thing it is judging shows nothing. A share of the ceiling rather than
  // a fixed figure, since it has to hold for 115 ms and for 49 bpm.
  //
  // It expands away from the GOOD end, so the ceiling keeps its place at the top
  // and the extra room appears where a bad run would go.
  const minSpan = Math.abs(ceiling) * minSpanShare;
  if (hi - lo < minSpan) {
    if (invert) hi = lo + minSpan;
    else lo = hi - minSpan;
  }
  // A tenth of the span at each end, so nothing sits on an edge. Floored in the
  // metric's own units rather than at 1, since resting heart rate's whole extent
  // can be five beats and a fixed unit of padding would be most of it.
  const room = Math.max(0.4, (hi - lo) * 0.12);
  const top = lo - room;
  const span = hi + room - top;

  const y = (v) => {
    const t = (v - top) / span;
    return pad + (invert ? t : 1 - t) * (height - pad * 2);
  };
  const x = (i) => gutter + pad + (i / (points.length - 1)) * (width - gutter - pad * 2);

  const refInside =
    reference != null &&
    Number.isFinite(reference) &&
    reference >= top &&
    reference <= top + span;

  // In priority order, then deduped, then sorted for reading. The references
  // come first because they are what the line is judged against; **today's own
  // figure comes last but it does come**, since a lone ceiling with nothing
  // under it is a rule rather than a scale, and "hard to see the scale" was the
  // report this whole pass answers.
  const wanted = [{ key: "ceiling", value: ceiling, y: y(ceiling) }];
  if (showFloor) wanted.push({ key: "floor", value: floor, y: y(floor) });
  if (refInside) wanted.push({ key: "reference", value: reference, y: y(reference) });
  const todayValue = points.at(-1).value;
  wanted.push({ key: "today", value: todayValue, y: y(todayValue), lit: true });

  const axisLabels = [];
  for (const label of wanted) {
    if (axisLabels.some((l) => Math.abs(l.y - label.y) < GUTTER_MIN_GAP)) continue;
    axisLabels.push(label);
  }
  axisLabels.sort((a, b) => a.y - b.y);

  return {
    width,
    height,
    line: points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" "),
    ceilingY: y(ceiling),
    /** Null unless drawn, so a template cannot rule off a scale that has no floor on it. */
    floorY: showFloor ? y(floor) : null,
    reference: refInside ? reference : null,
    referenceY: refInside ? y(reference) : null,
    today: { x: x(points.length - 1), y: y(todayValue), value: todayValue },
    from: points[0].date,
    to: points.at(-1).date,
    count: points.length,
    /** Where the rules and the plot begin, so nothing is drawn over the gutter. */
    plotLeft: gutter,
    /** Right edge the gutter's figures are set against. */
    labelX: Math.max(0, gutter - GUTTER_STANDOFF),
    axisLabels,
  };
}

/** How many bands the distribution is cut into. */
export const DISTRIBUTION_BINS = 8;

/**
 * How often your form has landed at each level.
 *
 * Bucketed across the floor-to-ceiling scale rather than across the readings'
 * own range, so the bars mean the same thing as the score does: the leftmost bin
 * is the bottom of the scale, the rightmost is your ceiling. A reading above the
 * ceiling lands in the top bin rather than off the end, which is what being at
 * your best looks like.
 */
export function levelDistribution(series, { ceiling, floor, bins = DISTRIBUTION_BINS } = {}) {
  const points = series ?? [];
  if (!points.length || !ceiling || !floor || ceiling <= floor) return null;

  const binOf = (v) => {
    const t = (v - floor) / (ceiling - floor);
    return Math.min(bins - 1, Math.max(0, Math.floor(t * bins)));
  };

  const counts = new Array(bins).fill(0);
  for (const p of points) counts[binOf(p.value)]++;
  const max = Math.max(...counts);
  const todayBin = binOf(points.at(-1).value);

  return {
    bins: counts.map((count, i) => ({
      index: i,
      count,
      // Share of the tallest bar, so an empty bin still draws a stub rather than
      // nothing: a gap in the middle of a distribution is a fact about it.
      fill: max ? count / max : 0,
      today: i === todayBin,
      from: floor + ((ceiling - floor) * i) / bins,
      to: floor + ((ceiling - floor) * (i + 1)) / bins,
    })),
    todayBin,
    total: points.length,
    floor,
    ceiling,
  };
}

/** How wide a mark is, and how far apart the marks in a row sit. */
export const LADDER_DOT_R = 4.4;
const LADDER_DOT_PITCH = 13;
const LADDER_DOT_INSET = 9;

/**
 * The distribution as a ladder of bands with one mark per day.
 *
 * **The count is the marks**, which is the whole change (2026-08-11, option H of
 * four mocked up). The card it replaces drew a length per band against a count
 * axis, and the report on it was simply that nobody could tell what it was
 * measuring: two figures on a scale of nine boundaries, no counts, and an empty
 * band drawn as a two-pixel speck that read as dirt. Marks need no axis to be
 * counted and an empty band is plainly empty.
 *
 * **Every boundary carries a figure**, not just the two ends. Nine numbers down
 * the side is what makes the bands a scale rather than eight anonymous rows, and
 * they sit ON the lines between rows because an edge belongs to the two bands it
 * separates - printed inside one it would claim to be that band's value.
 *
 * **It falls back to bars in one piece, never per row.** Once any band holds more
 * days than fit as marks the whole ladder switches, because a card drawing some
 * rows as countable marks and others as a measured length would be two charts
 * sharing an axis. That is also the answer to the objection that eight bands is
 * a lot of machinery for fifteen days: at a year of history the marks fill each
 * row and this becomes the bar chart again with nothing to change.
 */
export function levelLadder(
  dist,
  { width = 320, rowHeight = 15, gutter = 40, countWidth = 18, top = 9 } = {}
) {
  if (!dist?.bins?.length) return null;

  const bins = dist.bins;
  const plotLeft = gutter;
  const plotRight = width - countWidth;
  const plotWidth = plotRight - plotLeft - 8;
  const peak = Math.max(...bins.map((b) => b.count));

  // How many marks a row can hold before they would run into the count.
  const capacity = Math.max(1, Math.floor((plotWidth - LADDER_DOT_INSET) / LADDER_DOT_PITCH) + 1);
  const mode = peak > capacity ? "bars" : "dots";

  // Top of the row a band is drawn in. The highest band is the top row, so the
  // scale reads the same way up as the line chart above it.
  const rowTop = (index) => top + (bins.length - 1 - index) * rowHeight;

  return {
    width,
    height: top + bins.length * rowHeight + 6,
    mode,
    capacity,
    plotLeft,
    /** Right edge the boundary figures are set against. */
    labelX: Math.max(0, gutter - GUTTER_STANDOFF),
    /** Where a row's count is printed, clear of the marks. */
    countX: plotRight + 5,
    /** The hairlines the bands are cut on, and the figure each one is worth. */
    edges: bins.map((b, i) => ({ value: b.from, y: rowTop(i) + rowHeight })).concat({
      value: bins.at(-1).to,
      y: rowTop(bins.length - 1),
    }),
    rows: bins.map((b) => {
      const y = rowTop(b.index);
      return {
        index: b.index,
        count: b.count,
        today: b.today,
        y,
        height: rowHeight,
        midY: y + rowHeight / 2,
        barY: y + 3,
        barHeight: rowHeight - 6,
        barWidth: peak ? (b.count / peak) * plotWidth : 0,
        dots: Array.from({ length: b.count }, (_, d) => ({
          cx: plotLeft + LADDER_DOT_INSET + d * LADDER_DOT_PITCH,
          cy: y + rowHeight / 2,
        })),
      };
    }),
  };
}

/**
 * The floor a ceiling implies, so a caller never re-derives it differently.
 *
 * `higherIsBetter` false takes it the other way round, which is `levelFrom`'s own
 * `floorValue` arithmetic: for resting heart rate the ceiling is the lowest
 * sustained average, so the bottom of the scale is a HIGHER figure, not a lower
 * one. Multiplying there would have put the floor below the ceiling and drawn
 * the scale upside down.
 */
export function floorFor(ceiling, { higherIsBetter = true, floorShare = LEVEL_FLOOR } = {}) {
  if (ceiling == null) return null;
  return higherIsBetter ? ceiling * floorShare : ceiling / floorShare;
}

/** Nights below this and there is no average worth drawing a rule for. */
export const SLEEP_BARS_MIN = 2;

/**
 * How near an end of the axis the average's label may come, in percent.
 *
 * The two ends of this axis are labelled 0 and 100 in the same gutter the
 * average's own label sits in, so an average within a few points of either would
 * overprint one of them. It is **withheld rather than nudged clear**: the figure
 * is already in the card's header, and a label shifted off its own rule points
 * at a night that is not the one it means.
 */
export const AVERAGE_LABEL_CLEARANCE = 9;

/**
 * The nights behind Recovery's sleep term, one bar each, with the average ruled
 * across them.
 *
 * **The axis is fixed at 0-100**, for the same reason `recoveryBars` fixes its
 * own: a sleep score already is a position between fixed thresholds, so scaling
 * the bars to the week's own spread would draw a bad week and a good week
 * identically.
 *
 * **The average is computed here from the bars rather than taken as an argument.**
 * The caller scores each night with the same per-night function
 * `recentSleepScore` averages, so the mean of the bars is the term's own figure
 * by construction - and a rule handed in separately is a second number that can
 * silently stop agreeing with the bars underneath it.
 *
 * Null under two nights: the card exists to show that one bad night does not
 * swing a week, and a single bar with a rule through it says nothing at all.
 */
export function sleepBars(nights, { height = 46, gap = 0.28 } = {}) {
  const scored = (nights ?? [])
    .filter((n) => typeof n?.score === "number" && Number.isFinite(n.score))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (scored.length < SLEEP_BARS_MIN) return null;

  const slot = 100 / scored.length;
  const width = slot * (1 - gap);
  const y = (score) => height - (Math.max(0, Math.min(100, score)) / 100) * height;

  const average = Math.round(scored.reduce((sum, n) => sum + n.score, 0) / scored.length);

  return {
    height,
    bars: scored.map((n, i) => ({
      date: n.date,
      score: n.score,
      x: i * slot + (slot - width) / 2,
      width,
      y: y(n.score),
      height: height - y(n.score),
    })),
    average,
    averageY: y(average),
    // As a share of the drawn height, because the label riding beside the rule
    // is HTML over an SVG stretched with preserveAspectRatio="none": user units
    // mean nothing outside the viewBox, percentages survive the stretch.
    averagePct: (y(average) / height) * 100,
    averageLabel:
      (y(average) / height) * 100 > AVERAGE_LABEL_CLEARANCE &&
      (y(average) / height) * 100 < 100 - AVERAGE_LABEL_CLEARANCE,
    count: scored.length,
    from: scored[0].date,
    to: scored.at(-1).date,
  };
}
