// Resting heart rate against typical figures for your age.
//
// **The only absolute comparison anywhere in Atlas, and the reason it can exist
// here and nowhere else.** Resting heart rate counts beats, so an overnight
// figure from a wrist strap is the same physical quantity every published cohort
// measured, and a comparison transfers honestly.
//
// HRV deliberately gets no equivalent. The band reports it as a single
// undocumented byte averaged across the night, and the published normative work
// measures different quantities entirely - five-minute supine RMSSD averages
// around 42 ms, twenty-four hour SDNN around 140, and this user's overnight
// figure sits near 92. Those share a unit and nothing else. Quoting an age
// percentile against an uncalibrated number would be the most confident-looking
// wrong thing in the app, so HRV stays anchored to the user's own ceiling in
// level.js and this file covers the half that can be done properly.
//
// **Provenance, stated plainly.** The bands below are the widely reproduced
// resting-heart-rate fitness classification by age and sex, of the kind used in
// fitness testing rather than clinical diagnosis. It is not a peer-reviewed
// percentile set, and it is coarse - ten-year age bands and seven categories.
// What it is good for is exactly what it is used for here: saying whether a
// reading is excellent, ordinary or poor for someone that age, which is a claim
// the data supports. It is not used to say anything about health.
//
// **Sex is not in the profile yet.** Female resting rates run a few beats above
// male ones across every band, so with sex unknown the midpoint of the two is
// used and the caller is told the comparison is approximate. Adding sex to the
// profile would make this exact; until then an approximate absolute reference is
// still better than the none Recovery had.

/**
 * Upper bound of each category, in beats per minute, by age band and sex.
 *
 * Read as: at or below `athlete` is athlete, at or below `excellent` is
 * excellent, and so on. Anything above the last figure is `poor`.
 */
const BANDS = {
  male: [
    { maxAge: 25, athlete: 55, excellent: 61, good: 65, aboveAverage: 69, average: 73, belowAverage: 81 },
    { maxAge: 35, athlete: 54, excellent: 61, good: 65, aboveAverage: 69, average: 74, belowAverage: 81 },
    { maxAge: 45, athlete: 56, excellent: 62, good: 66, aboveAverage: 70, average: 75, belowAverage: 82 },
    { maxAge: 55, athlete: 57, excellent: 63, good: 67, aboveAverage: 71, average: 76, belowAverage: 83 },
    { maxAge: 65, athlete: 56, excellent: 61, good: 67, aboveAverage: 71, average: 75, belowAverage: 81 },
    { maxAge: 200, athlete: 55, excellent: 61, good: 65, aboveAverage: 69, average: 73, belowAverage: 79 },
  ],
  female: [
    { maxAge: 25, athlete: 60, excellent: 65, good: 69, aboveAverage: 73, average: 78, belowAverage: 84 },
    { maxAge: 35, athlete: 59, excellent: 64, good: 68, aboveAverage: 72, average: 76, belowAverage: 82 },
    { maxAge: 45, athlete: 59, excellent: 64, good: 69, aboveAverage: 73, average: 78, belowAverage: 84 },
    { maxAge: 55, athlete: 60, excellent: 65, good: 69, aboveAverage: 73, average: 77, belowAverage: 83 },
    { maxAge: 65, athlete: 59, excellent: 64, good: 68, aboveAverage: 73, average: 77, belowAverage: 83 },
    { maxAge: 200, athlete: 59, excellent: 64, good: 68, aboveAverage: 72, average: 76, belowAverage: 84 },
  ],
};

/** Worst to best, with the share of the scale each one tops out at. */
const LADDER = [
  { key: "belowAverage", label: "BELOW AVERAGE", score: 0.25 },
  { key: "average", label: "AVERAGE", score: 0.45 },
  { key: "aboveAverage", label: "ABOVE AVERAGE", score: 0.6 },
  { key: "good", label: "GOOD", score: 0.75 },
  { key: "excellent", label: "EXCELLENT", score: 0.9 },
  { key: "athlete", label: "ATHLETE", score: 1 },
];

function rowFor(age, sex) {
  const table = BANDS[sex] ?? BANDS.male;
  return table.find((r) => age <= r.maxAge) ?? table.at(-1);
}

/** The midpoint of the two tables, for a profile with no sex recorded. */
function blendedRow(age) {
  const m = rowFor(age, "male");
  const f = rowFor(age, "female");
  const mid = (k) => (m[k] + f[k]) / 2;
  return {
    athlete: mid("athlete"),
    excellent: mid("excellent"),
    good: mid("good"),
    aboveAverage: mid("aboveAverage"),
    average: mid("average"),
    belowAverage: mid("belowAverage"),
  };
}

/**
 * Where a resting heart rate sits for someone that age, 0..1 with a name.
 *
 * Interpolated within a category rather than stepped, so a beat of improvement
 * shows as a beat rather than as nothing until it crosses a boundary. Below the
 * athlete threshold it saturates: the difference between 48 and 42 is real but
 * it is not something a readiness score should keep rewarding.
 *
 * Returns null with no age, which is what makes the caller fall back to the
 * personal comparison rather than invent an absolute one.
 */
export function restingHrForAge(bpm, age, sex = null) {
  if (bpm == null || !Number.isFinite(bpm) || bpm <= 0) return null;
  if (age == null || !Number.isFinite(age) || age < 10 || age > 120) return null;

  const row = sex ? rowFor(age, sex) : blendedRow(age);
  const approximate = !sex;

  // At or under the athlete bound is full marks.
  if (bpm <= row.athlete) {
    return { value: 1, label: "ATHLETE", reference: row.athlete, approximate };
  }
  // Above the worst bound scores the bottom of the scale, floored rather than
  // zeroed: a high resting rate is a poor reading, not the absence of one.
  if (bpm > row.belowAverage) {
    return { value: 0.1, label: "POOR", reference: row.belowAverage, approximate };
  }

  // **Walked best to worst, and the direction is the whole correctness of it.**
  // Every figure in `row` is an upper bound, and the better the category the
  // tighter that bound, so the category a reading belongs to is the BEST one it
  // still fits under. Walking worst-first and taking the first fit let
  // `belowAverage` - the loosest bound of the six - swallow every reading from
  // the athlete threshold up to it. Measured on 2026-08-13: a 32-year-old man at
  // 58, 62, 66, 70 and 74 bpm was told BELOW AVERAGE at all five, and the score
  // climbed to 3.7 on a function documented as returning 0..1.
  //
  // **Five tests covered this and not one could see it**, which is worth more
  // than the fix. Two asserted values at 44 and 95 bpm, both served by the early
  // returns above, so they never reach this loop. One asserted the score rises as
  // the rate falls, which the broken version also did. The male/female pair and
  // the blended-midpoint test compared two readings that both went through the
  // same wrong branch, so their relationship held. Nothing asserted a label in
  // the middle of the range, and nothing asserted the documented upper bound.
  // LADDER runs worst to best, so a HIGHER index is a better category with a
  // tighter bound. Walking it downwards visits best first.
  for (let i = LADDER.length - 1; i >= 0; i--) {
    const step = LADDER[i];
    const worstBpm = row[step.key];
    if (bpm > worstBpm) continue;

    // This band runs from just inside the next-better category's bound up to its
    // own. For AVERAGE on a 32-year-old man that is 70..74, ABOVE AVERAGE's
    // bound being 69.
    const better = LADDER[i + 1];
    const bestBpm = (better ? row[better.key] : 0) + 1;
    // A reading at the worst end of a band scores what the band below it tops
    // out at; at the best end it scores this band's own figure.
    const worseScore = LADDER[i - 1]?.score ?? 0.1;
    const span = worstBpm - bestBpm;
    // Clamped. An unclamped fraction is what turned a 0..1 score into 3.7 once
    // the wrong category had been picked, and with the walk fixed the reading is
    // inside the span by construction - so this is belt as well as braces.
    const within = span > 0 ? Math.min(1, Math.max(0, (worstBpm - bpm) / span)) : 1;
    return {
      value: worseScore + (step.score - worseScore) * within,
      label: step.label,
      reference: worstBpm,
      approximate,
    };
  }
  return { value: 0.1, label: "POOR", reference: row.belowAverage, approximate };
}

/**
 * The reading that would reach the next category up, for the page's copy.
 *
 * Whole beats, because resting heart rate moves across a few of them and a
 * fractional target is precision the reading has not got.
 */
export function nextRestingHrTarget(bpm, age, sex = null) {
  const now = restingHrForAge(bpm, age, sex);
  if (!now || now.label === "ATHLETE") return null;
  const row = sex ? rowFor(age, sex) : blendedRow(age);
  const better = [...LADDER]
    .map((s) => ({ ...s, bound: Math.floor(row[s.key]) }))
    .filter((s) => s.bound < bpm)
    .sort((a, b) => b.bound - a.bound)[0];
  return better ? { reading: better.bound, label: better.label } : null;
}
