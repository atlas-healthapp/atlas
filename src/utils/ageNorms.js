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

  // Walk up the ladder to the first category this reading falls inside, then
  // place it within that category's span.
  for (let i = 0; i < LADDER.length; i++) {
    const step = LADDER[i];
    const upper = row[step.key];
    if (bpm > upper) continue;
    const lower = i === 0 ? row.belowAverage + 1 : row[LADDER[i - 1].key];
    const below = i === 0 ? 0.1 : LADDER[i - 1].score;
    const span = lower - upper;
    // Nearer the top of the category scores nearer its ceiling.
    const within = span > 0 ? (lower - bpm) / span : 1;
    return {
      value: below + (step.score - below) * within,
      label: step.label,
      reference: upper,
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
