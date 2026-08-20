import { describe, it, expect } from "vitest";
import {
  buildSummary,
  bucketSeries,
  publishableDials,
  publishableStages,
  sleepWindowText,
  sleepBandCodes,
} from "../nativeSummary";

// The bar fills are the only maths in the summary, and they exist here rather
// than in the notification layout so there is one implementation of them. These
// cover the cases a notification renders wrong rather than not at all: a bar
// drawn empty when there is no reading reads as a day gone badly.
describe("buildSummary", () => {
  it("publishes a fill for every metric that has a reading and a goal", () => {
    const summary = buildSummary({
      steps: 4000,
      stepsGoal: 10000,
      routineDone: 2,
      routineDue: 9,
      recovery: 25,
      sleepHours: 6,
      sleepGoal: 8,
      protein: 110,
      proteinGoal: 160,
    });
    expect(summary.stepsPct).toBe(40);
    expect(summary.routinePct).toBe(22);
    expect(summary.recoveryPct).toBe(25);
    expect(summary.sleepPct).toBe(75);
    expect(summary.proteinPct).toBe(69);
  });

  it("withholds a fill rather than sending zero when the reading is missing", () => {
    const summary = buildSummary({
      steps: null,
      stepsGoal: 10000,
      sleepHours: null,
      sleepGoal: 8,
      protein: null,
      proteinGoal: 160,
      recovery: null,
    });
    expect(summary.stepsPct).toBeNull();
    expect(summary.sleepPct).toBeNull();
    expect(summary.proteinPct).toBeNull();
    expect(summary.recoveryPct).toBeNull();
  });

  it("withholds a fill when the goal is missing or zero", () => {
    expect(buildSummary({ steps: 4000, stepsGoal: null }).stepsPct).toBeNull();
    expect(buildSummary({ protein: 110, proteinGoal: 0 }).proteinPct).toBeNull();
  });

  // A day with nothing due is the routine's own "no goal" case, and a bar of
  // zero over zero would otherwise render as a goal missed.
  it("withholds the routine fill on a day with nothing due", () => {
    const summary = buildSummary({ routineDone: 0, routineDue: 0 });
    expect(summary.routinePct).toBeNull();
    expect(summary.routineDue).toBe(0);
  });

  it("clamps an overshoot to a full bar and leaves the figure alone", () => {
    const summary = buildSummary({
      sleepHours: 10,
      sleepGoal: 8,
      sleepText: "10h 00m",
      protein: 200,
      proteinGoal: 160,
      recovery: 104,
    });
    expect(summary.sleepPct).toBe(100);
    expect(summary.sleepText).toBe("10h 00m");
    expect(summary.proteinPct).toBe(100);
    expect(summary.protein).toBe(200);
    expect(summary.recoveryPct).toBe(100);
  });
});

// **The series exist so a widget can draw a shape without doing any maths.**
// Downsampling here rather than in Java is the same rule the fills follow: two
// implementations of one average is how a widget ends up disagreeing with the
// screen it mirrors.
describe("bucketSeries", () => {
  const day = new Date("2026-08-19T00:00:00").getTime();
  const at = (h, m, v) => ({ t: day + (h * 60 + m) * 60000, v });

  it("averages each half hour into one point", () => {
    const out = bucketSeries([at(0, 5, 60), at(0, 20, 70), at(1, 10, 90)], { from: day });
    expect(out[0]).toBe(65);
    expect(out[1]).toBeNull();
    expect(out[2]).toBe(90);
    expect(out).toHaveLength(48);
  });

  it("leaves a bucket null rather than zero when nothing was recorded", () => {
    // The strap comes off. A zero would draw as a heart rate of nothing, and
    // the widget's line has to break across the gap instead.
    const out = bucketSeries([at(9, 0, 55)], { from: day });
    expect(out.filter((v) => v == null)).toHaveLength(47);
    expect(out[18]).toBe(55);
  });

  it("runs a total forward when asked to accumulate", () => {
    // Steps are a count, so a widget wants the shape of the day so far, not the
    // rate. Cumulative means a flat stretch reads as sitting still.
    const out = bucketSeries([at(0, 10, 30), at(0, 40, 70), at(8, 0, 100)], {
      from: day,
      agg: "sum",
      cumulative: true,
    });
    expect(out[0]).toBe(30);
    expect(out[1]).toBe(100);
    expect(out[2]).toBe(100);
    expect(out[16]).toBe(200);
  });

  it("ignores anything outside the day it was asked for", () => {
    const out = bucketSeries([{ t: day - 60000, v: 99 }, at(0, 5, 60)], { from: day });
    expect(out[0]).toBe(60);
  });

  it("survives an empty day", () => {
    expect(bucketSeries([], { from: day }).every((v) => v == null)).toBe(true);
    expect(bucketSeries(undefined, { from: day })).toHaveLength(48);
  });
});

// The widget shows the three dials the user chose on Home rather than three
// metrics fixed in Java, so what it needs is those dials in a shape native can
// render without knowing what a CSS variable is.
describe("publishableDials", () => {
  const dials = [
    { key: "recovery", label: "RECOVERY", text: "54", pct: 54, color: "var(--rec-okay)", band: "NORMAL" },
    { key: "sleep", label: "SLEEP", text: "8h 06m", pct: 100, color: "var(--fam-body)" },
    { key: "protein", label: "PROTEIN", text: "37G", pct: 23, color: "var(--fam-intake)" },
  ];

  it("carries the label, the reading and the fill for each", () => {
    expect(publishableDials(dials)[1]).toEqual({
      key: "sleep",
      label: "SLEEP",
      text: "8h 06m",
      pct: 100,
      tone: "body",
      sub: null,
    });
  });

  it("carries the sub-line, and withholds it rather than blanking it", () => {
    // A widget has no card under the ring and no page one tap away, so the
    // sub-line is the only thing that can say whether 54 was a good morning.
    // Null rather than "" when there is none, so the figure can sit closer to
    // its bar instead of over an empty row.
    const out = publishableDials([
      { key: "recovery", label: "RECOVERY", text: "54", pct: 54, band: "NORMAL", sub: "NORMAL" },
      { key: "routine", label: "ROUTINE", text: "3/9", pct: 33 },
    ]);
    expect(out[0].sub).toBe("NORMAL");
    expect(out[1].sub).toBeNull();
  });

  it("names a tone rather than a colour", () => {
    // Native paints its own ground and follows the shade's night mode, not the
    // app's theme, so a hex from the WebView would be the wrong colour half the
    // time. A tone maps to native's own resources.
    expect(publishableDials(dials).map((d) => d.tone)).toEqual([
      "recovery-normal",
      "body",
      "intake",
    ]);
  });

  it("clamps a fill and withholds a missing one", () => {
    const out = publishableDials([
      { key: "steps", label: "STEPS", text: "12,000", pct: 150, color: "var(--fam-activity)" },
      { key: "water", label: "WATER", text: "--", pct: null, color: "var(--fam-intake)" },
    ]);
    expect(out[0].pct).toBe(100);
    expect(out[1].pct).toBeNull();
  });

  it("survives rubbish", () => {
    expect(publishableDials(null)).toEqual([]);
    expect(publishableDials([null, {}])).toEqual([]);
  });
});

// Last night, in the depth the sleep widget's tallest size draws it. The stage
// totals are the one place the stored record and the decoder disagree about a
// word, and the band codes are the one place a threshold could get copied into
// Java and then drift.
describe("the sleep payload", () => {
  it("reconciles the stored `wake` with the decoder's `awake`", () => {
    // The record's footer calls it `wake` and the timeline calls it `awake`.
    // Publishing the raw field would give the widget a fourth opinion, and a
    // night drawn 0% awake beside a bar with an awake segment in it.
    expect(publishableStages({ deep: 66, light: 283, rem: 137, wake: 5 })).toEqual({
      deep: 66,
      light: 283,
      rem: 137,
      awake: 5,
    });
  });

  it("withholds a night with no stages rather than publishing four zeros", () => {
    // Four zeros draw an empty composition bar, which says the night went badly.
    // Nothing recorded is not a bad night.
    expect(publishableStages({ deep: 0, light: 0, rem: 0, wake: 0 })).toBeNull();
    expect(publishableStages(null)).toBeNull();
  });

  it("formats the window here rather than leaving native to do it", () => {
    const bed = new Date(2026, 7, 18, 23, 13).getTime();
    const wake = new Date(2026, 7, 19, 7, 24).getTime();
    expect(sleepWindowText({ bedTime: bed, wakeTime: wake })).toBe("23:13 → 07:24");
  });

  it("withholds the window when the night has no clock positions", () => {
    // Nights committed before 2026-08-04 carry neither, and a string reading
    // "Invalid Date" is worse than no line at all.
    expect(sleepWindowText({ deep: 66 })).toBeNull();
    expect(sleepWindowText(null)).toBeNull();
  });

  it("derives each night's band from SLEEP_BANDS so no threshold reaches Java", () => {
    // 85 / 70 / 50 are sleep's own boundaries and they are not Recovery's. A
    // copy in Java could not be checked against this one, so only the answer
    // travels.
    expect(sleepBandCodes([88, 70, 69, 50, 49, null, 85])).toBe("4322104");
  });

  it("publishes no band string for a week with nothing in it", () => {
    expect(sleepBandCodes([null, null])).toBeNull();
    expect(sleepBandCodes(null)).toBeNull();
  });

  it("keeps a missing night null in the series rather than scoring it zero", () => {
    const summary = buildSummary({
      trend7: [60, null, 83],
      sleepStages: { deep: 66, light: 283, rem: 137, wake: 5 },
      sleepScore: 88,
    });
    expect(summary.trend7).toEqual([60, null, 83]);
    expect(summary.sleepScore).toBe(88);
    expect(summary.sleepStages.awake).toBe(5);
  });

  it("withholds the whole series when no night in it has a score", () => {
    // So native can tell "no week" from "a week of gaps" without walking it.
    expect(buildSummary({ trend7: [null, null] }).trend7).toBeNull();
    expect(buildSummary({}).sleepStages).toBeNull();
  });
});

// The cumulative series is what the steps widget draws, and its left-hand end
// is load-bearing: it sits directly above a full-width gauge.
describe("a cumulative series", () => {
  it("starts at zero at the beginning of the day, not at nothing", () => {
    // Screenshotted on 2026-08-19: a day whose first steps arrived at half past
    // five drew its curve starting a quarter of the way across the card, while
    // the gauge under it spanned the whole width. The count was not missing
    // before the first step - it was zero.
    const from = new Date(2026, 7, 19).getTime();
    const out = bucketSeries(
      [{ t: from + 11 * 30 * 60000, v: 40 }],
      { from, buckets: 14, agg: "sum", cumulative: true }
    );
    expect(out[0]).toBe(0);
    expect(out[10]).toBe(0);
    expect(out[11]).toBe(40);
  });

  it("holds its total forward across an empty bucket", () => {
    // Sitting still is a flat line, not a hole.
    const from = new Date(2026, 7, 19).getTime();
    const out = bucketSeries(
      [{ t: from + 60000, v: 25 }],
      { from, buckets: 4, agg: "sum", cumulative: true }
    );
    expect(out).toEqual([25, 25, 25, 25]);
  });

  it("still leaves a gap in a non-cumulative series", () => {
    // A heart rate is a level, and an hour off the wrist must break the line.
    const from = new Date(2026, 7, 19).getTime();
    const out = bucketSeries([{ t: from + 60000, v: 58 }], { from, buckets: 3 });
    expect(out).toEqual([58, null, null]);
  });
});

// The case that reached the home screen: a strap taken off for a shower left one
// reading in a half hour, and the widget published it as that half hour's mean.
describe("a bucket with too few readings", () => {
  const from = new Date(2026, 7, 19).getTime();
  const at = (minutes, v) => ({ t: from + minutes * 60000, v });

  it("is withheld rather than averaged", () => {
    // 161 was a wrist sensor being handled, not a heart rate. One sample is not
    // a half hour, and published as one it stretched the widget's axis to
    // 44-161 and flattened the rest of the day.
    const worn = Array.from({ length: 30 }, (_, i) => at(i, 60));
    const out = bucketSeries([...worn, at(45, 161)], {
      from,
      buckets: 3,
      minSamples: 5,
    });
    expect(out[0]).toBe(60);
    expect(out[1]).toBeNull();
  });

  it("keeps a bucket that has enough to mean something", () => {
    const some = Array.from({ length: 6 }, (_, i) => at(i, 70));
    expect(bucketSeries(some, { from, buckets: 2, minSamples: 5 })[0]).toBe(70);
  });

  it("never withholds from a count, which averages nothing", () => {
    // One step sample is one step sample. The rule is about means.
    const out = bucketSeries([{ t: from + 60000, v: 12 }], {
      from,
      buckets: 2,
      agg: "sum",
      cumulative: true,
      minSamples: 5,
    });
    expect(out).toEqual([12, 12]);
  });
});
