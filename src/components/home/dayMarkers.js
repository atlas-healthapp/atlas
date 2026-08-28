import { charWidth } from "@/utils/labelWidth";

// Where a day's sessions and its bedtime sit on a shared clock axis.
//
// Pure geometry, because the component that draws it is template-shaped and
// there is no Vue test harness here: anything with arithmetic in it has to live
// somewhere a test can reach.
//
// The axis runs 06:00 to 02:00 rather than midnight to midnight. A day that
// ends at 23:59 puts every bedtime hard against the right edge and cuts off the
// ones past midnight entirely, and those are exactly the late nights worth
// seeing. Starting at 06:00 costs nothing: the band records almost nothing
// before then that is not sleep, and sleep has its own row.

/** The axis, in hours from the row's own midnight. 26 is 02:00 the next day. */
export const AXIS_FROM = 6;
export const AXIS_TO = 26;

const HOUR_MS = 60 * 60 * 1000;

function midnightOf(dateKey) {
  return new Date(`${dateKey}T00:00:00`).getTime();
}

/**
 * Hours past the row's midnight, so 00:53 the following morning reads 24.88
 * rather than wrapping to 0.88 and landing at breakfast.
 */
export function hoursFrom(dateKey, ms) {
  if (ms == null) return null;
  return (ms - midnightOf(dateKey)) / HOUR_MS;
}

/**
 * A position on the axis, 0..1, or null when the moment falls outside it.
 *
 * Null rather than clamped: a mark pinned to the edge claims a time it does not
 * have, and on this chart the edge is where the interesting values are.
 */
export function axisFraction(hours) {
  if (hours == null) return null;
  if (hours < AXIS_FROM || hours > AXIS_TO) return null;
  return (hours - AXIS_FROM) / (AXIS_TO - AXIS_FROM);
}

const pad = (n) => String(n).padStart(2, "0");

/** 24-hour clock time from epoch ms, matching every other time in Atlas. */
export function clockTime(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The type `.mk` is set in, in `RecoveryPage.vue`. `dayMarkers.test.js` reads
 * that rule out of the component and fails if these drift from it, which is the
 * check that did not exist when the pair below last went stale.
 */
export const MK_FONT_PX = 11;
export const MK_LETTER_SPACING = 0.8;

/**
 * How wide one character of `.mk` is, in the chart's own viewBox units.
 *
 * **Derived, because remembering it is what broke.** This read 5.9 for months,
 * which was right for the 8.5px the label was set in when the chart was written
 * and wrong from the moment the type scale went up on 2026-08-27. Nothing said
 * so: `placeLabels` went on declaring pairs clear that were overlapping by a
 * quarter of their width, and the first anyone knew was a session's time printed
 * across a bedtime on the phone.
 *
 * Approximate is still fine - a unit either way changes nothing about which
 * labels survive - but it has to be approximately the CURRENT type, and the only
 * way to keep that true is to compute it from the size rather than store the
 * answer.
 */
const CHAR_W = charWidth(MK_FONT_PX, MK_LETTER_SPACING);

/** The drawable span, x=6 to x=294 in a 300-unit viewBox. */
const AXIS_UNITS = 288;
/** Where that span starts, and the box it sits in. The component no longer
 *  computes either: it draws every label at `labelX()`, so there is one
 *  statement of where a label goes rather than two that can disagree. */
const AXIS_X0 = 6;
const VIEW_W = 300;

/**
 * Least clear space between two labels, in viewBox units.
 *
 * One character. Touching is not overlapping, but `18:50→20:4901:30` is what
 * touching looks like on a phone, and it is no more readable than an overlap.
 */
const LABEL_GAP = CHAR_W;

/**
 * Where a label will actually be drawn, as `{ from, to }` in viewBox units.
 *
 * **This exists because collision and edge-fitting were solved separately and
 * disagreed about the answer.** `placeLabels` reserved space for every label as
 * if it sat centred on its own mark, while the edge rule moved the ones near the
 * ends - so a label was cleared in one position and drawn in another.
 *
 * Measured on the real archive for 2026-08-28: a bedtime of 01:30 sits at 97.5%
 * of the axis, so `01:30` was displaced 20 units left and occupied 246.8 to
 * 286.8 rather than the 266.8 to 306.8 it was cleared against. The session label
 * beside it ran to 248.8. Two units of overlap, and on the phone the card read
 * `18:50→20:4901:30`.
 *
 * So position is decided in ONE place, `labelPlacement`, and both the collision
 * test and the component's own `x` read it from there.
 */
export function labelExtent(at, text, opts) {
  const { from, to, x, mark, shifted } = labelPlacement(at, text, opts);
  return { from, to, x, mark, shifted };
}

/**
 * Which labels can be drawn without running into each other.
 *
 * `candidates` are `{ at, text }` **in priority order**, `at` being a 0..1 axis
 * fraction. Each is kept only if it clears everything already kept by half the
 * two labels' widths, and **dropped outright otherwise** - never shrunk, moved
 * or clipped. That is the same rule `axisFraction` already applies to a mark
 * outside the axis, and for the same reason: a label nudged aside to fit is a
 * label pointing at a time that is not where it says it is.
 *
 * Priority rather than position, because on a collision it matters which one
 * survives. The two ends of the waking day frame the row and are labelled above
 * as well, so they win; a session's start beats its own end, since when you
 * began is the fact the row is about.
 */
/** How far apart two labels' centres must sit, as a fraction of the axis. */
export function gapNeeded(a, b) {
  return ((a?.length ?? 0) * CHAR_W + (b?.length ?? 0) * CHAR_W) / 2 / AXIS_UNITS;
}

/**
 * Where a label has to sit so it stays inside the drawing, given the mark it
 * belongs to.
 *
 * **`placeLabels` solves labels colliding with each other; this solves a label
 * colliding with the edge.** Both ends of the waking day are drawn on their own
 * mark, and the first mark of the day sits at the very start of the axis: a
 * 06:01 wake put WOKE and its time centred on x=6 in a 300-wide box, so both
 * hung off the left and the card clipped them to "OKE" and ":01".
 *
 * **Moved by the least amount that keeps it inside, rather than re-anchored.**
 * This used to return a `text-anchor`, flipping an edge label to `start` or
 * `end`, which displaces it by *half its own width* however little was actually
 * needed. Measured on 2026-08-28: a 01:30 bedtime at 97.5% of the axis needed
 * 8.8 units of room and was given 20, so the label sat visibly left of the dot
 * it named and ate the space its neighbour needed. Reported as both halves of
 * that - the session's times could not fit beside it, and the bedtime was not
 * under its own mark.
 *
 * A clamp keeps the label as close to its mark as the box allows, which is what
 * the anchoring was reaching for: the earlier note here said a label has to keep
 * pointing at its own mark, and this points at it strictly better.
 */
export function labelPlacement(at, text, { width = VIEW_W, pad = 2 } = {}) {
  const mark = AXIS_X0 + at * AXIS_UNITS;
  const half = ((text?.length ?? 0) * CHAR_W) / 2;
  let x = mark;
  if (x - half < pad) x = pad + half;
  if (x + half > width - pad) x = width - pad - half;
  return { x, mark, from: x - half, to: x + half, shifted: Math.abs(x - mark) > 0.01 };
}

/** Just the x a label should be drawn at, for the component's template. */
export function labelX(at, text, opts) {
  return labelPlacement(at, text, opts).x;
}

export function placeLabels(candidates = [], opts = {}) {
  const kept = [];
  return candidates.map((c) => {
    // **A candidate may offer several ways of saying itself, best first.** Each
    // carries its own position, because a shorter wording usually points
    // somewhere else: `18:50→20:49` belongs midway between the two ends it
    // names, and the `18:50` it falls back to belongs on the start it names.
    //
    // Dropping is the last resort rather than the first. On the day this was
    // found the merged label could not clear a 01:30 bedtime, and the choice was
    // between saying nothing at all about the session and saying when it began.
    // The note above already called throwing away a fact the row exists to carry
    // the wrong answer.
    const options = c.options ?? [{ text: c.text, at: c.at }];
    for (const option of options) {
      if (option.at == null || !option.text) continue;
      const ext = labelExtent(option.at, option.text, opts);
      // Real intervals, not the distance between two centres. That distance is
      // only a proxy for overlap while every label is centred, and `labelExtent`
      // exists precisely because they are not.
      const clears = kept.every((k) => ext.from >= k.to + LABEL_GAP || ext.to <= k.from - LABEL_GAP);
      if (clears) {
        kept.push(ext);
        return { ...c, show: true, text: option.text, at: option.at };
      }
    }
    const first = options[0] ?? {};
    return { ...c, show: false, text: first.text ?? null, at: first.at ?? null };
  });
}

/**
 * One row: the sessions that ran on `date`, when you got up that morning, and
 * the bedtime of the night that STARTED on it.
 *
 * The two join differently and that is the subtle part. A night is stored on the
 * date it *ends*, so Wednesday's row takes its WAKE from Wednesday's own entry
 * and its BED from Thursday's. Taking both from one entry is how a row ends up
 * quietly a day out at one end.
 *
 * The row is therefore the waking day, opening and closing marks included, and
 * neither sleep itself is drawn. Wake belongs to the night before the row and
 * bed to the night after it, so a reader who takes them as sleep marks is
 * looking at two different nights; labelling them WOKE and BED is what keeps
 * that from happening.
 *
 * A mark with no position on the axis is dropped rather than clamped, same
 * reasoning as axisFraction.
 */
export function dayRow({ date, sessions = [], bedMs = null, wakeMs = null } = {}) {
  const spans = [];
  for (const s of sessions) {
    const from = axisFraction(hoursFrom(date, s.startMillis));
    const to = axisFraction(hoursFrom(date, s.endMillis));
    if (from == null || to == null) continue;
    spans.push({
      from,
      to,
      startMillis: s.startMillis,
      endMillis: s.endMillis,
      startText: clockTime(s.startMillis),
      endText: clockTime(s.endMillis),
      activeSeconds: s.activeSeconds ?? null,
    });
  }

  const bed = axisFraction(hoursFrom(date, bedMs));
  const wake = axisFraction(hoursFrom(date, wakeMs));
  const ordered = spans.sort((a, b) => a.from - b.from);

  const bedText = bed == null ? null : clockTime(bedMs);
  const wakeText = wake == null ? null : clockTime(wakeMs);

  // The clock times, all on one line under the axis. A short session put its own
  // start and end within a few units of each other and the two printed on top of
  // one another.
  //
  // **Merged rather than dropped.** Two ends that will not fit side by side
  // become one label between them, `18:20→18:32`, so a short session still says
  // both of its times. Dropping one was the first attempt and it threw away a
  // fact the row exists to carry. Dropping survives only as the last resort in
  // placeLabels, for a merged label that still cannot clear wake or bed.
  const merged = ordered.map(
    (s) => s.to - s.from < gapNeeded(s.startText, s.endText)
  );

  const times = placeLabels([
    { id: "wake", at: wake, text: wakeText },
    { id: "bed", at: bed, text: bedText },
    ...ordered.flatMap((s, i) =>
      merged[i]
        ? [
            {
              id: `s${i}both`,
              options: [
                { text: `${s.startText}→${s.endText}`, at: (s.from + s.to) / 2 },
                // What is left when both ends will not fit beside a bedtime.
                // The start rather than the end, for the reason priority order
                // already gives: when you began is the fact the row is about.
                { text: s.startText, at: s.from },
              ],
            },
          ]
        : [
            { id: `s${i}from`, at: s.from, text: s.startText },
            { id: `s${i}to`, at: s.to, text: s.endText },
          ]
    ),
  ]);
  const shown = new Set(times.filter((t) => t.show).map((t) => t.id));
  const chosen = new Map(times.map((t) => [t.id, t]));

  // The words above the axis are their own line and collide separately. WOKE and
  // BED are drawn by their own template blocks, so only TRAINING needs deciding.
  const words = placeLabels([
    { id: "wake", at: wake, text: "WOKE" },
    { id: "bed", at: bed, text: "BED" },
    { id: "training", at: ordered[0]?.from ?? null, text: "TRAINING" },
  ]);

  return {
    date,
    spans: ordered.map((s, i) => ({
      ...s,
      showStartText: shown.has(`s${i}from`),
      showEndText: shown.has(`s${i}to`),
      // One label covering both ends, drawn midway, when they cannot fit apart -
      // or just the start, on its own mark, when even that will not fit. Taken
      // from what `placeLabels` actually chose rather than recomputed, so the
      // text and the position it is drawn at cannot disagree.
      mergedText: merged[i] ? (chosen.get(`s${i}both`)?.text ?? null) : null,
      mergedAt: merged[i] ? (chosen.get(`s${i}both`)?.at ?? null) : null,
      showMergedText: shown.has(`s${i}both`),
    })),
    bed,
    bedText,
    showBedText: shown.has("bed"),
    wake,
    wakeText,
    showWakeText: shown.has("wake"),
    showTrainingLabel: words.find((w) => w.id === "training")?.show ?? false,
  };
}

/** Short weekday for a row label: MON, TUE. */
export function weekdayLabel(date) {
  return new Date(`${date}T00:00:00`)
    .toLocaleDateString("en-AU", { weekday: "short" })
    .toUpperCase();
}

/**
 * The axis ticks, as fractions with their labels.
 *
 * Three, not a full ruler. The chart is about where things sat relative to each
 * other, and a tick every two hours turns six sparse rows into graph paper.
 */
export const AXIS_TICKS = [6, 16, 26].map((h, i, all) => ({
  hour: h,
  at: axisFraction(h),
  label: h === 26 ? "02" : pad(h % 24),
  // The ends have to anchor inward or they hang off the viewBox and get
  // clipped: the last tick rendered as "0" before this.
  anchor: i === 0 ? "start" : i === all.length - 1 ? "end" : "middle",
}));

/**
 * Total active minutes across a day's sessions.
 *
 * Sums active seconds rather than measuring start to end, the rule
 * mergeSessions.js runs on: the gap between two halves is the band deciding you
 * had stopped, and counting it would inflate every split session.
 */
export function activeMinutes(sessions = []) {
  const total = sessions.reduce((sum, s) => sum + (s.activeSeconds ?? 0), 0);
  return total ? Math.round(total / 60) : 0;
}

/** "3H 19M", or "45M" under the hour. */
export function durationText(minutes) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}M`;
  return m ? `${h}H ${m}M` : `${h}H`;
}
