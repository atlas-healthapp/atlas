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
 * Roughly how wide one character of `.mk` is, in the chart's own viewBox units.
 *
 * 8.5px mono at 0.8px letter-spacing, measured against the 300-unit viewBox the
 * chart draws in. Approximate on purpose: this decides whether two labels are
 * allowed to sit near each other, and being a unit out changes nothing, while
 * measuring text properly would mean rendering it first.
 */
const CHAR_W = 5.9;

/** The drawable span, x=6 to x=294 in a 300-unit viewBox. */
const AXIS_UNITS = 288;

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
 * Which way a label at `x` has to hang so it stays inside the drawing.
 *
 * **`placeLabels` solves labels colliding with each other; this solves a label
 * colliding with the edge**, which is a different problem and was unsolved. Both
 * ends of the waking day are drawn centred on their own mark, and the first mark
 * of the day sits at the very start of the axis: a 06:01 wake put WOKE and its
 * time centred on x=6 in a 300-wide box, so both hung off the left and the card
 * clipped them to "OKE" and ":01".
 *
 * Anchoring rather than nudging the position, because the label has to keep
 * pointing at its own mark. `dayAxis`'s hour ticks already do exactly this for
 * the same reason; this is that rule made available to everything else.
 */
export function labelAnchor(x, text, { width = 300, pad = 2 } = {}) {
  const half = ((text?.length ?? 0) * CHAR_W) / 2;
  if (x - half < pad) return "start";
  if (x + half > width - pad) return "end";
  return "middle";
}

export function placeLabels(candidates = []) {
  const kept = [];
  return candidates.map((c) => {
    if (c.at == null || !c.text) return { ...c, show: false };
    const halfWidth = (c.text.length * CHAR_W) / 2;
    const clears = kept.every((k) => {
      const need = (halfWidth + (k.text.length * CHAR_W) / 2) / AXIS_UNITS;
      return Math.abs(k.at - c.at) >= need;
    });
    if (clears) kept.push(c);
    return { ...c, show: clears };
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
              at: (s.from + s.to) / 2,
              text: `${s.startText}→${s.endText}`,
            },
          ]
        : [
            { id: `s${i}from`, at: s.from, text: s.startText },
            { id: `s${i}to`, at: s.to, text: s.endText },
          ]
    ),
  ]);
  const shown = new Set(times.filter((t) => t.show).map((t) => t.id));

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
      // One label covering both ends, drawn midway, when they cannot fit apart.
      mergedText: merged[i] ? `${s.startText}→${s.endText}` : null,
      mergedAt: merged[i] ? (s.from + s.to) / 2 : null,
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
