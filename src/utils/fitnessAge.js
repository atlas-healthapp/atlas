// Fitness age: the age at which your estimated aerobic fitness would be average.
//
// **Groundwork only. Nothing imports this yet, and that is deliberate** - the
// design has not been through its `/grillme`. It exists so the interview can be
// held against real arithmetic instead of a proposal. The full survey, the
// literature review, the rejected models and the questions it is waiting on are
// in docs/backlog.md under "Biological age against actual age".
//
// **Reworked 2026-08-12 to the no-new-measurements constraint.** The first pass
// built this on waist circumference, which carries the largest single
// coefficient in the HUNT equation and which no strap can measure. The user's
// ruling: "it needs to be based on what the app has, not extra measurements."
// The BMI form of the same HUNT model is sourced now (see HUNT_MODELS), so the
// body-composition term comes from height and the weight Atlas already logs.
// **The waist form is kept and is still preferred when a waist is present**, not
// out of sentiment: BMI cannot tell muscle from fat, and `compareBodyModels`
// exists to print exactly what that costs rather than assert it is nothing.
//
// **Why it is not called biological age**, which is what was asked for. Every
// input here is cardiorespiratory. "Biological age" implies methylation clocks
// and organ ageing, none of which a wrist strap can see, and the narrower claim
// is the only one Atlas can defend for a single one of its inputs. It is also
// what NTNU, Garmin and Fitbit are all actually computing under grander labels.
//
// **Why HRV is not in it, permanently.** The band reports HRV as a single
// undocumented byte averaged over the night. Every published HRV-age model is
// fitted to a named quantity - 24-hour SDNN, five-minute supine RMSSD, raw RR
// intervals - and the decline rate with age differs by a factor of two depending
// on which one you pick. Those share a unit with the band's byte and nothing
// else. Same reasoning as ageNorms.js's header, and the user has ruled out the
// external cross-check that would settle it.
//
// **Why sleep is not in it**, though the ticket named it as an input. No
// published fitness-age or VO2max model takes sleep. The only well-evidenced
// construct that does is the AHA's Life's Essential 8, Atlas can complete four of
// its eight components, and there is no published mapping from an LE8 score to a
// number of years anyway. Putting sleep in would mean inventing a weight, which
// is the black box this ticket exists to refuse.

import { restingHrForAge } from "@/utils/ageNorms";

/**
 * Update whenever a coefficient, a reference value or a gate below moves.
 *
 * Hand-maintained on purpose, the same as sleepScore's SCORE_CALIBRATED_ON: a
 * page that states when a number was last calibrated cannot quietly rot, and
 * every other figure the page shows is read live so this is the only one that
 * can be wrong.
 */
export const CALIBRATED_ON = "2026-08-13";

/**
 * The estimating equations, both forms, all four sexes' worth of coefficients.
 *
 * Nes BM, Janszky I, Aspenes ST, Bertheussen GF, Vatten LJ, Wisloff U.
 * "Estimating VO2peak from a nonexercise prediction model: the HUNT Study,
 * Norway." Med Sci Sports Exerc 2011;43(11):2024-2030. n = 4637 healthy adults
 * with directly measured treadmill VO2peak. The waist form explains 61% of the
 * variance in men and 56% in women.
 *
 * `pa` is the HUNT physical activity index on the New scale (0-45, see
 * PA_INDEX_MAX - the coefficients were fitted on that one and not on the Kurtze
 * index this file first built), `restingHr` is bpm, and
 * `body` is the body-composition term: waist circumference in cm in the waist
 * form, kg/m^2 in the BMI form.
 *
 * **Provenance, because two of these four rows came from secondary sources and
 * the difference matters if anyone ever checks them.**
 * - waist/male: quoted directly in the Nes 2011 abstract and reproduced in
 *   dozens of places. Safe.
 * - waist/female: read off Table 1 of Harber MP et al., "Accuracy of Nonexercise
 *   Prediction Equations for Assessing Longitudinal Changes to Cardiorespiratory
 *   Fitness in Apparently Healthy Adults: BALL ST Cohort," J Am Heart Assoc
 *   2020;9:e015117 (PMC7428991), which reproduces Nes 2011 verbatim. This is the
 *   coefficient set the previous pass could not obtain and called a blocker.
 * - bmi/male and bmi/female: the HUNT1/HUNT3 non-exercise algorithm, quoted in
 *   the methods of the HUNT group's own later work (most recently the HUNT
 *   dementia paper in Age and Ageing 2026), which cites Nes BM, Vatten LJ,
 *   Nauman J, Janszky I, Wisloff U, "A simple nonexercise model of
 *   cardiorespiratory fitness predicts long-term mortality," Med Sci Sports
 *   Exerc 2014;46(6):1159-1165, and Nauman J et al., Mayo Clin Proc
 *   2017;92:218-227. **The primary paper is paywalled and these were not read
 *   off it.** What corroborates them is that the three shared terms land where
 *   the waist form's do - age -0.327 against -0.296, PA +0.257 against +0.226,
 *   resting HR -0.167 against -0.155 - which is what a refit of the same model
 *   on the same cohort with one variable swapped should look like, and is not
 *   what a transcription error looks like.
 *
 * **A published R^2 for the BMI form was not obtainable and none is quoted
 * anywhere in Atlas.** One secondary source put it at 0.59 in men against the
 * waist form's 0.61; it could not be traced to the paper, so it is written down
 * here and nowhere a user can read it. What CERG do state plainly, on the page
 * for the calculator this model powers, is that "the Fitness Calculator will be
 * about just as accurate independently of which body composition measurement is
 * used" (ntnu.edu/cerg/vo2max).
 */
export const HUNT_MODELS = {
  bmi: {
    key: "bmi",
    label: "BMI",
    unit: "",
    male: { intercept: 92.05, age: -0.327, pa: 0.257, body: -0.933, restingHr: -0.167 },
    female: { intercept: 70.77, age: -0.244, pa: 0.213, body: -0.749, restingHr: -0.107 },
  },
  waist: {
    key: "waist",
    label: "WAIST",
    unit: "CM",
    male: { intercept: 100.27, age: -0.296, pa: 0.226, body: -0.369, restingHr: -0.155 },
    female: { intercept: 74.736, age: -0.247, pa: 0.198, body: -0.259, restingHr: -0.114 },
  },
};

/**
 * The reference population, and it has to be named wherever the figure is shown.
 *
 * Loe H, Rognmo O, Saltin B, Wisloff U. "Aerobic Capacity Reference Data in 3816
 * Healthy Men and Women 20-90 Years." PLoS ONE 2013;8(5):e64319. Mean VO2max by
 * decade, measured on a treadmill, Norwegian. This is the curve NTNU's own
 * fitness calculator inverts, which is where the definition of fitness age comes
 * from.
 *
 * **The choice of cohort is worth most of a decade and the page must say so.**
 * The US FRIEND registry (Kaminsky et al., 16,278 maximal treadmill tests) puts
 * the median for men 20-29 at 49.5 against Norway's 54.4. At roughly 3.5
 * mL/kg/min per decade that is a decade and a half of "fitness age" from the
 * choice of reference population alone. Norway is used here because it is the
 * cohort the estimating equation above was fitted on, and mixing a HUNT equation
 * with a FRIEND curve stacks a cohort mismatch on top of a model error.
 *
 * Anchored at decade midpoints rather than at their edges, because a value
 * labelled "20-29" describes the middle of that decade, not its start.
 */
export const REFERENCE_VO2MAX = {
  male: [
    [25, 54.4],
    [35, 49.1],
    [45, 47.2],
    [55, 42.6],
    [65, 39.2],
    [75, 35.3],
  ],
  female: [
    [25, 43.0],
    [35, 40.0],
    [45, 38.4],
    [55, 34.4],
    [65, 31.1],
    [75, 28.3],
  ],
};

/** The span the reference data covers. Outside it the curve is not evidence. */
export const AGE_MIN = 20;
export const AGE_MAX = 90;

/**
 * How far a fitness age may sit from a real one, in years.
 *
 * **A presentation limit, forced by the model's own precision.** Nes Table 3
 * reports SEE 5.70 mL/kg/min for men, and the reference curve falls by only 0.19
 * to 0.53 per year, so one standard deviation of error is worth eleven to thirty
 * years. Uncapped, this told a sedentary 32-year-old he was 55 and an unusually
 * fit one that he was 20, neither of which the estimate can support.
 *
 * 9.5 is Garmin's own floor for the same metric built on the same four inputs,
 * applied symmetrically here. Nothing upstream is altered: VO2max, the terms and
 * every itemised year are computed before this and are unaffected.
 */
export const MAX_GAP_YEARS = 6;

/**
 * The share of your own age the gap may reach before the ceiling applies.
 *
 * **A young person has less room to be younger, and a flat cap ignored that.**
 * At 9.5 years a twenty-year-old could be told they were ten, which is not a
 * fitness age, it is a different species of claim. Twenty per cent puts the
 * bound at four years for a twenty-year-old and reaches the five-year ceiling at
 * twenty-five, so it only ever binds tighter than the ceiling for the very young.
 */
export const GAP_AGE_SHARE = 0.2;

/** How far a figure at this age may sit from it, in years. */
export function maxGapYears(age) {
  return Math.min(MAX_GAP_YEARS, Math.max(0, age) * GAP_AGE_SHARE);
}

/**
 * Days of resting-heart-rate rollups before a figure is allowed at all.
 *
 * Thirty, matching level.js's LEVEL_MIN_NIGHTS, and for the same reason: a
 * number claiming to describe a body rather than a day cannot be built from a
 * fortnight. The resting HR fed in is a multi-week average, not today's reading,
 * exactly as recovery.js already feeds ageNorms.
 */
export const MIN_RESTING_HR_DAYS = 30;

/**
 * Days of session history before the activity index means anything.
 *
 * Four weeks, because the HUNT index is a description of a weekly habit and four
 * weeks is the fewest that can describe one. A fortnight containing a deload
 * would read as a different person.
 */
export const MIN_ACTIVITY_DAYS = 28;

/**
 * Days of history before a *provisional* figure may be shown at all.
 *
 * **Seven, matching Recovery's own minimum**, and matched on purpose rather than
 * chosen fresh: two screens using different floors for "enough history to say
 * anything" is the drift `metricRegistry` exists to stop, and the user's ruling
 * was to reuse Recovery's number.
 *
 * Below this the resting-heart-rate average is still moving several beats, and
 * one beat is worth half a year here, so a figure built on three days would move
 * by a decade while somebody watched it. Above it the figure is shown with its
 * caveat rather than withheld, which is the user's standing preference: a rough
 * number with the caveat beside it beats a blank month.
 */
export const PROVISIONAL_MIN_DAYS = 7;

/**
 * How old the weight behind a BMI is allowed to be.
 *
 * Ninety days, matching the history window `metricRegistry` gives weight, and
 * the gate exists because **weight is the only input here that is typed in by
 * hand and is therefore the only one that can silently stop arriving.** Every
 * other input comes off the strap and stops with a visible gap. A weight from
 * March driving a fitness age in August is a figure about a body that no longer
 * exists, and it would read as current because nothing else on the page is
 * stale.
 */
export const MAX_WEIGHT_AGE_DAYS = 90;

/**
 * The reference values each input is compared against, all cited.
 *
 * Resting heart rate is deliberately absent: it comes from ageNorms.js, which
 * already owns Atlas's opinion of what a resting rate should be for an age, and a
 * second table here is how two screens end up disagreeing about whether 50 bpm is
 * good for a 34-year-old.
 */
/**
 * The study's own average participant, per sex. **This is the reference person.**
 *
 * **Why the reference moved here from a set of published thresholds.** Fitness
 * age used to be read off Loe's decade curve: take your estimated VO2max, ask
 * which age has that as its average. Two papers, two cohorts, and it did not
 * work. Measured across 22 to 70, a man matching this study's average in every
 * respect read anywhere from 0.2 years young to 5.4 years old purely on his age,
 * because Loe's curve is published as decade means and its slope swings from
 * -0.53 to -0.19 to -0.46 while the estimating equation falls linearly at
 * -0.327. Inverting a nearly flat segment amplifies the residual between the two
 * papers, and at 40 it put the average man +4.7 before anything about him was
 * considered. With a six-year cap that leaves no room to distinguish him from a
 * sedentary one, which is exactly what two tests caught.
 *
 * So the reference is now the same equation evaluated at this cohort's own
 * average inputs. Fitness age becomes **the age at which the study's average
 * person would have your estimated VO2max**, which is self-consistent by
 * construction: an average person reads their own age at every age, and the
 * itemised years sum exactly to the gap with no shared-slope approximation.
 *
 * **Provenance.** Men's BMI, resting rate and PA index were already sourced (Nes
 * 2011 Table 1, with the PA index derived - see INPUT_REFERENCE.pa). The women's
 * row was not in this repo at all until 2026-08-14 and came from Aspenes/Nes et
 * al., "Predicting VO2peak from Submaximal- and Peak Exercise Models: The HUNT 3
 * Fitness Study, Norway", PLoS ONE 2015;10(12):e0144873 (PMC4721596), Table 2 -
 * **the same 4637 participants**, split 2266 men and 2371 women, which is what
 * makes it usable as the reference here rather than a different sample's numbers.
 * It prints height, weight, resting heart rate and measured VO2peak by sex but
 * no BMI, so BMI is computed from height and weight: the men's figure comes out
 * at 26.66 against Nes Table 1's printed 26.6, and that agreement is what makes
 * the women's 25.53 trustworthy by the same route.
 *
 * The PA index is derived for both sexes the same way, by solving the published
 * equation at these means against the measured VO2peak. For men that reproduces
 * 10.49 against the 10.5 already in use, which validates the method rather than
 * assuming it. **The derivation is circular in exactly the way this use needs**:
 * the only property required of the reference person is that they reproduce the
 * cohort's measured mean, and solving for that is how you get it.
 *
 * **Women read higher than men on the activity index (11.6 against 10.5) and
 * that is not obviously right** - HUNT's own women reported far less
 * high-intensity activity than its men. It may be the women's BMI coefficients,
 * which appear in no publication. It does not affect a woman's fitness age,
 * since she is compared with this same reference, but it does mean the two
 * sexes' activity rows are not straightforwardly comparable and the page should
 * not put them side by side as though they were.
 *
 * **No waist for women.** The source prints none, so a waist cannot be anchored
 * for them and the BMI form is used regardless. Which is what ships anyway.
 */
export const COHORT = {
  male: { age: 48.9, bmi: 26.6, waist: 94.7, restingHr: 57.4, pa: 10.5, vo2peak: 44.3 },
  female: { age: 47.9, bmi: 25.5, waist: null, restingHr: 61, pa: 11.6, vo2peak: 35.9 },
};

export const INPUT_REFERENCE = {
  /**
   * **10.5 on the New index, and it is derived rather than looked up** (corrected
   * 2026-08-13 from 7.5, which was the wrong index's guideline threshold).
   *
   * Nes 2011 never prints the cohort's mean New-index value - Table 1's 3.27 is
   * the *Kurtze* index. But the paper gives everything needed to solve for it:
   * Table 1's mean age, BMI, waist and resting HR, Table 1's measured mean
   * VO2peak, and Table 3's coefficients. Setting the equation equal to the
   * measured mean and solving for PA gives, across all four published models:
   *
   *     male waist 10.38   male bmi 10.29   female waist 10.51   female bmi 10.72
   *
   * Four independent equations agreeing inside 0.4 is not a coincidence, and at
   * 10.5 every one of them reproduces the measured cohort mean to within 0.13.
   * **That same arithmetic is what validates the BMI coefficients**, which appear
   * in no publication - the paper ran the BMI model, reported "negligible
   * alterations in R^2 and SEE", and printed only the waist equation.
   *
   * It is a cohort mean, so unlike the two thresholds below it genuinely does
   * describe the average participant, and the label says so.
   */
  pa: { value: 10.5, label: "THE STUDY'S AVERAGE" },
  /**
   * WHO waist action level 1: 94 cm for men, 80 cm for women. Also a threshold
   * rather than an average, and labelled as one.
   */
  waist: { male: 94, female: 80, label: "WHO ACTION LEVEL" },
  /**
   * The top of the WHO healthy range, 25.0 for both sexes. A threshold again,
   * and the same kind of threshold as the waist figure above, which is why the
   * two forms of the model can be read side by side without the reference person
   * changing character between them.
   */
  bmi: { male: 25, female: 25, label: "WHO HEALTHY LIMIT" },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v) => typeof v === "number" && Number.isFinite(v);

/** Linear interpolation across a ladder of [x, y] pairs, flat outside its ends. */
function interpolate(ladder, x) {
  if (!ladder?.length) return null;
  if (x <= ladder[0][0]) return ladder[0][1];
  if (x >= ladder.at(-1)[0]) return ladder.at(-1)[1];
  for (let i = 1; i < ladder.length; i++) {
    const [x0, y0] = ladder[i - 1];
    const [x1, y1] = ladder[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return ladder.at(-1)[1];
}

/** kg/m^2 from the two fields the profile and the check-in already hold. */
export function bmiFrom(weightKg, heightCm) {
  if (!num(weightKg) || !num(heightCm) || heightCm <= 0) return null;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** The cohort's mean VO2max for someone that age and sex, mL/kg/min. */
export function referenceVo2max(age, sex) {
  const ladder = REFERENCE_VO2MAX[sex];
  if (!ladder || !num(age)) return null;
  return interpolate(ladder, clamp(age, AGE_MIN, AGE_MAX));
}

/**
 * The age whose cohort mean equals this VO2max: the definition of fitness age.
 *
 * Reported clamped, with a flag, rather than extrapolated past the reference
 * data. A 21-year-old's VO2max extrapolated backwards names an age the cohort
 * never measured, and the breakdown below cannot sum to a clamped gap - which is
 * why the flag exists rather than being silently swallowed.
 */
export function ageForVo2max(vo2max, sex) {
  const ladder = REFERENCE_VO2MAX[sex];
  if (!ladder || !num(vo2max)) return null;
  // The curve falls with age, so it has to be walked from the fit end down.
  //
  // **Above the top anchor the curve is extended, not clamped.** It used to
  // return AGE_MIN outright, which meant 0.1 mL/kg/min above the 20-29 mean
  // bought five whole years: a reading of 54.5 against an anchor of 54.4
  // reported 20 rather than the 24.8 it resolves to. That is where this model's
  // silliest numbers came from, and no amount of capping downstream fixes it,
  // because the cliff is in the lookup.
  //
  // Extended along the 25-to-35 segment's own slope, which is the published
  // trend rather than an invention, and floored at AGE_MIN. The floor is not
  // arbitrary: the reference is decade *means* anchored at midpoints, so
  // extending to 20 implies a mean of about 57 for a twenty-year-old, which is
  // a real figure for this cohort. Carrying on below that would not be, since
  // aerobic capacity peaks in the early twenties and stops falling rather than
  // continuing to climb, so a fifteen-year-old's mean is not 60.
  //
  // Anything past the floor is genuinely unresolvable and still says so.
  if (vo2max > ladder[0][1]) {
    const [a0, v0] = ladder[0];
    const [a1, v1] = ladder[1];
    const perYear = (v0 - v1) / (a1 - a0);
    const extended = a0 - (vo2max - v0) / perYear;
    if (extended < AGE_MIN) return { age: AGE_MIN, clamped: true };
    return { age: extended, clamped: false, extrapolated: true };
  }
  if (vo2max < ladder.at(-1)[1]) return { age: AGE_MAX, clamped: true };
  for (let i = 1; i < ladder.length; i++) {
    const [a0, v0] = ladder[i - 1];
    const [a1, v1] = ladder[i];
    if (vo2max >= v1) {
      return { age: a0 + ((a1 - a0) * (v0 - vo2max)) / (v0 - v1), clamped: false };
    }
  }
  return { age: AGE_MAX, clamped: true };
}

// ---------------------------------------------------------------------------
// The physical activity index, reconstructed rather than proxied.
// ---------------------------------------------------------------------------

/**
 * How the HUNT index is built: frequency x duration x intensity, 0.00 to 45.00.
 *
 * **Nes 2011 Table 4 publishes TWO indexes side by side and this is the second
 * one** (corrected 2026-08-13; Atlas had built the first). The left column is
 * Kurtze et al.'s older index, which maxes at 5 x 3 x 1 = 15. The right column is
 * the index the authors developed for this paper, maxing at 3 x 10 x 1.5 = 45,
 * and it is the one the coefficients were fitted on - Table 4 gives it the better
 * correlation with measured VO2peak (R 0.44 against 0.38 in men, 0.39 against
 * 0.34 in women). Feeding a Kurtze-scale value into a New-index coefficient
 * under-credited activity by about 1.7 mL/kg/min, which the reference curve's
 * ~0.35 per year slope turned into roughly five years of apparent age on every
 * user.
 *
 * **The intensity column has a cliff and it is deliberate.** "Take it easy"
 * scores 0, which zeroes the whole product whatever the frequency and duration.
 * That is the paper's own finding, quoted: VO2peak "was similar if subjects
 * reported to exercise at low intensity, independent of frequency and duration".
 *
 * **This is a reconstruction of the published input, not a stand-in for it.**
 * The index is literally that product, and Atlas holds all three quantities per
 * session as measurements rather than as a recollection of the last year.
 *
 * **Why not PAI, which Atlas already stores.** PAI is the same group's work on
 * the same cohort and is explicitly described as exchanging the self-reported
 * frequency, duration and intensity for measured heart rate, so it is the better
 * construct. But **there is no published crosswalk from a PAI score to a HUNT PA
 * index**, and inventing one would put a made-up conversion at the centre of a
 * figure whose whole point is that nothing in it is made up. PAI belongs on the
 * page beside this as a corroborating reading with its own citation (>=100 per
 * week is where the mortality benefit plateaus), which needs no conversion.
 *
 * The ladders below interpolate between the published response categories rather
 * than stepping, the same choice ageNorms.js makes within a category: a session a
 * week more should show as a session a week more, not as nothing until a boundary
 * is crossed and then everything at once.
 */
/** The New index's ceiling: 3 frequency x 10 intensity x 1.5 duration. */
export const PA_INDEX_MAX = 45;

const FREQUENCY_POINTS = [
  // never / less than once a week both score 0 on the New index.
  [0, 0],
  [0.5, 0],
  [1, 1],
  [2.5, 2],
  [5, 3],
];

/** Category midpoints in minutes against their New-index point values. */
const DURATION_POINTS = [
  [10, 1],
  [23, 1],
  [45, 1.5],
  [75, 1.5],
];

/**
 * Intensity as a share of age-predicted maximum heart rate.
 *
 * **The one place a published category has to be mapped onto a measurement**, and
 * now the highest-stakes assumption in the file rather than merely the softest:
 * the New index scores "take it easy" as 0 and that zeroes the entire product, so
 * this mapping decides between full credit and none.
 *
 * The three answers are "take it easy, no sweat", "heavy breath and sweat" and
 * "push near exhaustion". They are placed against ACSM's intensity
 * classifications by percentage of maximum heart rate - light 57-63, moderate
 * 64-76, vigorous 77-95, near-maximal >=96 - so "no sweat" tops out at light,
 * "heavy breath and sweat" spans moderate to vigorous, and "near exhaustion"
 * sits at the top.
 *
 * **Known to be unfair to a session with rests in it.** Atlas has only the
 * session's mean heart rate, and a 47-minute climb spends a good part of itself
 * belaying: measured on this archive the author's sessions average **66.8%** of
 * predicted maximum once weighted by how long each ran, which scores his training
 * at 4.13 out of 45 while the sessions themselves are plainly not easy. (An
 * earlier note here said 63.5%; that was the unweighted mean and did not match
 * what the code below computes.) Mean HR across a session is not the question the
 * questionnaire asks. Time-above-a-threshold from the archive's own samples is the
 * obvious better answer and is open work - see docs/backlog.md.
 */
const INTENSITY_POINTS = [
  [0.63, 0],
  [0.79, 5],
  [0.93, 10],
];

/**
 * Age-predicted maximum heart rate, HUNT's own formula.
 *
 * Nes BM, Janszky I, Wisloff U, Stoylen A, Karlsen T. "Age-predicted maximal
 * heart rate in healthy subjects: The HUNT Fitness Study." Scand J Med Sci Sports
 * 2013;23(6):697-704. HRmax = 211 - 0.64 * age.
 *
 * Deliberately the HUNT figure rather than 220 - age: the estimating equation and
 * the reference curve are both HUNT, and mixing in a formula from another cohort
 * for the one quantity that is not measured would be gratuitous.
 *
 * **And deliberately predicted rather than observed.** The archive's highest
 * `hrMax` is a defect, not a maximum: 2026-08-04 arrived claiming 203 against a
 * same-day sample peak of 173, which is the record `splitSessions.js` was written
 * for. Intensity is a share of this number, so an observed maximum would put the
 * worst outlier in the archive at the centre of the index.
 */
export function predictedHrMax(age) {
  return num(age) ? 211 - 0.64 * age : null;
}

/**
 * Rebuild the HUNT physical activity index from a window of sessions.
 *
 * `sessions` is the resolved list (deletions dropped, splits and merges already
 * applied), each carrying `activeSeconds` and `hrAvg`. It must be the resolved
 * list and not raw device records, for the same reason ActivityTab and
 * RecoveryPage both read through `resolveSessions`: a corrected duration applied
 * in one place and not another is how two screens disagree about a week.
 *
 * **`hrAvg` is the field name, not `avgHr`.** The first pass read `avgHr`, which
 * exists nowhere in this codebase - `mergeSessions` writes `hrAvg`, `splitStats`
 * writes `hrAvg` and the store's manual sessions write `hrAvg: null`. Every real
 * session would have come back with no heart rate and the index would have
 * withheld itself forever, which is the failure mode that passes every test
 * because the tests made up their own sessions.
 *
 * Returns null rather than zero on too little history. **A window with no
 * sessions in it is a real answer of 0** and is not the same thing as a window
 * that is too short to have an answer, which is why the day count is the gate
 * rather than the session count.
 */
export function paIndexFrom(
  sessions,
  {
    days = MIN_ACTIVITY_DAYS,
    age = null,
    /**
     * The shortest window this will answer for at all.
     *
     * Lowered to PROVISIONAL_MIN_DAYS by the card, which shows a rough figure
     * with its caveat rather than a blank month. It is an argument rather than a
     * second constant so there is still exactly one definition of a settled
     * window, and so a caller has to ask for the looser one on purpose.
     */
    minDays = MIN_ACTIVITY_DAYS,
  } = {}
) {
  if (!num(days) || days < minDays) {
    return { state: "calibrating", days: days ?? 0, needed: minDays, settledAt: MIN_ACTIVITY_DAYS };
  }

  const list = (sessions ?? []).filter((s) => num(s?.activeSeconds) && s.activeSeconds > 0);
  const weeks = days / 7;
  const perWeek = list.length / weeks;

  // Median rather than mean, so one very long ride does not become the typical
  // session. Same reasoning as habitualHours in sleepScore.js.
  const minutes = list.map((s) => s.activeSeconds / 60).sort((a, b) => a - b);
  const mid = Math.floor(minutes.length / 2);
  const medianMinutes = !minutes.length
    ? 0
    : minutes.length % 2
      ? minutes[mid]
      : (minutes[mid - 1] + minutes[mid]) / 2;

  const hrMax = predictedHrMax(age);
  // **`hrWorking` first, and it is not the same quantity as `hrAvg`.** The
  // scale below is ACSM's, which classifies the effort *while exercising*, and a
  // session mean averages the climbing in with the belaying. `sessionIntensity.js`
  // computes the working figure from the stored samples; `fitnessAgeModel.js`
  // attaches it, because reading them belongs next to the stores. A session past
  // the 90-day downsample has no spread left to take a percentile of and falls
  // back here, which is the old estimator and is counted by the caller.
  const hrOf = (s) => (num(s.hrWorking) ? s.hrWorking : num(s.hrAvg) ? s.hrAvg : null);
  const withHr = list.filter((s) => hrOf(s) > 0);
  // Weighted by how long each session lasted: an hour at threshold describes the
  // habit more than a ten-minute walk does, and an unweighted mean lets the
  // shortest sessions vote hardest.
  const totalSeconds = withHr.reduce((sum, s) => sum + s.activeSeconds, 0);
  const meanHr = totalSeconds
    ? withHr.reduce((sum, s) => sum + hrOf(s) * s.activeSeconds, 0) / totalSeconds
    : null;
  const intensityShare = meanHr && hrMax ? meanHr / hrMax : null;

  const frequency = interpolate(FREQUENCY_POINTS, perWeek);
  const duration = interpolate(DURATION_POINTS, medianMinutes);
  // No heart rate anywhere in the window leaves intensity unknowable. It is NOT
  // assumed easy: a whole window of sessions the strap did not record is a gap in
  // the evidence, and scoring it as light exercise would invent a reading.
  const intensity = intensityShare == null ? null : interpolate(INTENSITY_POINTS, intensityShare);

  if (!list.length) {
    // A genuinely empty window: the index is 0 and that is a finding, not a gap.
    return {
      state: "ready",
      value: 0,
      frequency: 0,
      duration: 0,
      intensity: null,
      sessionsPerWeek: 0,
      medianMinutes: 0,
      intensityShare: null,
      sessions: 0,
      days,
    };
  }

  if (intensity == null) {
    return { state: "no-intensity", sessions: list.length, days };
  }

  return {
    state: "ready",
    // 0..45, the New index's range: 3 frequency x 10 intensity x 1.5 duration.
    value: clamp(frequency * duration * intensity, 0, PA_INDEX_MAX),
    frequency,
    duration,
    intensity,
    sessionsPerWeek: perWeek,
    medianMinutes,
    intensityShare,
    sessions: list.length,
    // How many of the scored sessions had a working figure from real samples
    // rather than falling back to the band's average. A window made mostly of
    // fallbacks is scored on the old, low estimator and the page can say so.
    measuredSessions: withHr.filter((s) => num(s.hrWorking)).length,
    days,
  };
}

// ---------------------------------------------------------------------------
// The figure itself.
// ---------------------------------------------------------------------------

/** The equation, with nothing withheld and nothing checked. Internal. */
function modelVo2max(coef, { age, pa, body, restingHr }) {
  return (
    coef.intercept + coef.age * age + coef.pa * pa + coef.body * body + coef.restingHr * restingHr
  );
}

/** Plausibility bounds per body-composition form, so a typo cannot score. */
const BODY_BOUNDS = { waist: [40, 200], bmi: [12, 60] };

/**
 * Estimated VO2max and the fitness age it implies.
 *
 * `restingHr` must be a multi-week average and not today's reading. It is the
 * same figure Recovery already feeds to ageNorms (`levels.restingHr.current`),
 * and passing a single night would make a fitness age move several years because
 * of one bad sleep.
 *
 * **Body composition takes whichever form it can, and says which it took.** A
 * waist wins when one is given, because BMI cannot tell muscle from fat and the
 * waist form is the one whose R^2 is published. Otherwise height and weight give
 * BMI. **This is not a redistribution and never becomes one**: each form is a
 * separate regression that somebody fitted, and dropping the body term from
 * either would change the equation into one nobody fitted. That rule holds
 * inside Recovery because its terms are commensurable scores that can share
 * weight; these are physically different quantities in one fitted model.
 *
 * **Every refusal below returns a state rather than a number.**
 */
export function computeFitnessAge({
  age = null,
  sex = null,
  heightCm = null,
  weightKg = null,
  /**
   * How stale the weight is, in days. Required whenever the BMI form is used,
   * and there is no default: a missing staleness is not a fresh weight, and
   * defaulting it to zero is exactly how a figure built on a March weigh-in
   * would read as current. See MAX_WEIGHT_AGE_DAYS.
   */
  weightDaysOld = null,
  waistCm = null,
  restingHr = null,
  restingHrDays = 0,
  paIndex = null,
  activityDays = 0,
  /**
   * Show a figure once there are PROVISIONAL_MIN_DAYS of history rather than
   * the full gates, marking it `provisional`.
   *
   * **Off by default, so nothing shows a rough number by accident.** The card
   * opts in; the gates stay the definition of a settled figure.
   */
  allowProvisional = false,
} = {}) {
  const missing = (reason, extra = {}) => ({ state: "withheld", reason, ...extra });

  if (!num(age) || age < AGE_MIN || age > AGE_MAX) return missing("no-age");
  // Not a default and not the blended midpoint ageNorms falls back to: that
  // blend is defensible for placing one reading in a category and is not
  // defensible for choosing between two regressions ten mL/kg/min apart.
  if (sex !== "male" && sex !== "female") return missing("no-sex", { sex });

  const bmi = bmiFrom(weightKg, heightCm);
  let form = null;
  let body = null;

  if (num(waistCm)) {
    form = "waist";
    body = waistCm;
  } else if (bmi != null) {
    if (!num(weightDaysOld) || weightDaysOld > MAX_WEIGHT_AGE_DAYS) {
      return missing("stale-weight", { weightDaysOld, allowed: MAX_WEIGHT_AGE_DAYS });
    }
    form = "bmi";
    body = bmi;
  } else {
    // Nothing to stand the body-composition term on. Named for what is missing
    // rather than for waist alone, because height is the one field of the three
    // that Atlas has never had anywhere.
    return missing("no-body", { hasHeight: num(heightCm), hasWeight: num(weightKg) });
  }

  const [lo, hi] = BODY_BOUNDS[form];
  if (body < lo || body > hi) return missing(`no-${form}`, { value: body });

  const restingHrFloor = allowProvisional ? PROVISIONAL_MIN_DAYS : MIN_RESTING_HR_DAYS;
  const activityFloor = allowProvisional ? PROVISIONAL_MIN_DAYS : MIN_ACTIVITY_DAYS;

  if (!num(restingHr) || restingHr < 25 || restingHr > 120) return missing("no-resting-hr");
  if (restingHrDays < restingHrFloor) {
    return missing("calibrating-resting-hr", {
      days: restingHrDays,
      // The floor that actually applied, not the settled one, or a card would
      // count down to a number it was never waiting for.
      needed: restingHrFloor,
      settledAt: MIN_RESTING_HR_DAYS,
    });
  }
  // 45, not 15: the New index's range. A 15 here silently rejected every genuinely
  // active user once the index was corrected, which reads as "no activity data".
  if (!num(paIndex) || paIndex < 0 || paIndex > PA_INDEX_MAX) return missing("no-activity");
  if (activityDays < activityFloor) {
    return missing("calibrating-activity", {
      days: activityDays,
      needed: activityFloor,
      settledAt: MIN_ACTIVITY_DAYS,
    });
  }

  const model = HUNT_MODELS[form];
  const coef = model[sex];
  const inputs = { age, pa: paIndex, body, restingHr };
  const vo2max = modelVo2max(coef, inputs);

  // The reference person: this cohort's average, at YOUR age. Its own fitness
  // age is its chronological age by construction, which is the whole point of
  // anchoring here rather than on a second paper's curve.
  const reference = referenceInputs(age, sex, form);
  const referenceVo2 = modelVo2max(coef, {
    age,
    pa: reference.pa.value,
    body: reference.body.value,
    restingHr: reference.restingHr.value,
  });

  // **The age at which the average person would have your VO2max.**
  //
  // The equation is linear in age, so this inverts exactly: every mL/kg/min you
  // are above the average person of your age is worth `1 / -coef.age` years,
  // and each input's contribution is `coef_k * (yours - theirs) / -coef.age`.
  // Those sum to the gap with no residual and no shared-slope approximation,
  // which is what the itemisation on the page depends on.
  //
  // **It extrapolates past the cohort's own age range and that is why the cap
  // below exists.** A fit 40-year-old comes out at 15.7 raw, meaning the
  // equation says his VO2max matches the average 15-year-old's - which the study
  // never measured, since nobody in it was under 20. The number below the cap is
  // still the honest output of the model; the cap is what stops it being printed.
  // Divided by the age coefficient itself, which is negative: more VO2max than
  // the average person of your age therefore reads YOUNGER. Negating it here
  // inverts the whole metric, and does so quietly, since every other property
  // still holds and only the direction is wrong.
  const fittedAge = age + (vo2max - referenceVo2) / coef.age;

  // **The gap is capped, and the model's own spread demands it.**
  //
  // Nes Table 3 puts the standard error of estimate at 5.70 mL/kg/min for men,
  // which through the inversion above is seventeen years. The inputs are steep
  // too: one BMI unit is 2.9 years and one beat of resting heart rate is half a
  // year, so somebody two BMI units leaner than average is already six years
  // younger before anything else is counted. Uncapped, a fit 40-year-old prints
  // 15.7 and a sedentary one prints 60.8.
  //
  // The cap is a presentation limit and nothing upstream is touched: VO2max, the
  // reference and every itemised year are computed before it. **The cost is
  // saturation** - a good many people land exactly on it - and that is accepted
  // rather than hidden, which is why `capped` is reported.
  // **Bounded by the cap alone, not also by the reference range.** AGE_MIN used
  // to floor this, which made sense while the figure was read off a curve that
  // stopped at 20. It does not now: measured, a fit twenty-year-old and an
  // average one both printed exactly 20, because the floor bit before the cap
  // did, and the metric said nothing about the difference between them. The cap
  // is the honest bound and it already scales with age, so a twenty-year-old
  // cannot read below 16.
  const allowed = maxGapYears(age);
  const capped = clamp(fittedAge, age - allowed, age + allowed);

  return {
    state: "ready",
    /** Which regression ran: "bmi" or "waist". The page must name it. */
    form,
    formLabel: model.label,
    vo2max,
    fitnessAge: capped,
    /**
     * True when the figure sits outside the ages the cohort actually contained.
     *
     * Nobody in the study was under 20 or over 90, so a figure past either end
     * is the linear age term running off the data rather than a measurement. It
     * is reported rather than clamped away, because the cap below is what
     * decides what gets printed and this says whether the honest answer was even
     * inside the evidence.
     */
    clamped: fittedAge < AGE_MIN || fittedAge > AGE_MAX,
    /** True when the presentation cap bit. Distinct from `clamped`. */
    capped: Math.abs(capped - fittedAge) > 1e-9,
    /** How far the cap allowed the figure to move, in years, at this age. */
    allowedGap: allowed,
    /**
     * True while the figure is built on less history than it wants.
     *
     * It is a real number and it can still move, which is the whole bargain the
     * user asked for: a rough figure with its caveat beside it rather than a
     * blank month. The card must say so wherever it shows one.
     */
    provisional: restingHrDays < MIN_RESTING_HR_DAYS || activityDays < MIN_ACTIVITY_DAYS,
    /** When the figure stops being provisional, so a card can name the date. */
    settlesAfterDays: Math.max(
      MIN_RESTING_HR_DAYS - restingHrDays,
      MIN_ACTIVITY_DAYS - activityDays,
      0
    ),
    /** What the model said before the cap, for a page that wants to explain it. */
    uncappedAge: fittedAge,
    chronologicalAge: age,
    /** Negative is younger. What the page leads on. */
    gap: capped - age,
    /**
     * The reference person's own fitness age, which is their chronological age.
     *
     * Kept in the result because every screen and test that reads it predates
     * the anchoring, and because stating it is how a reader can tell the
     * reference is the average person rather than a threshold nobody meets.
     */
    referenceAge: age,
    referenceVo2max: referenceVo2,
    /** The cohort's own mean for this age, for a page that wants to state it. */
    cohortVo2max: referenceVo2max(age, sex),
    inputs,
    bmi,
    waistCm: num(waistCm) ? waistCm : null,
    weightDaysOld,
    reference,
    coefficients: coef,
    sex,
    /** True where any reference had to be approximated, so the page can say so. */
    approximate: reference.restingHr.approximate,
    restingHrDays,
    activityDays,
  };
}

/**
 * What the body-composition form is worth, when both readings exist.
 *
 * **This is the honest answer to "what does dropping waist cost", and it is
 * computed rather than asserted.** The two forms stay close for someone whose
 * BMI reflects their body fat and diverge for someone carrying muscle, because
 * BMI cannot tell the two apart and a waist can. Worked through for a
 * 34-year-old man, 180 cm, 50 bpm resting, waist 84 cm, and a PA index of 10.5,
 * the study's own average. Uncapped, because that is what the choice of form is
 * worth to the model and both forms saturate the six-year cap readily:
 *
 *   78 kg, BMI 24.1 -> 16.8 on waist, 23.0 on BMI:  6.2 years apart
 *   88 kg, BMI 27.2 -> 16.8 on waist, 31.8 on BMI: 15.0 years apart
 *
 * Same waist both times, so the second man is the same shape with ten kilos of
 * muscle on him, and the BMI form charges him nearly nine years for it.
 * That is the cost of the constraint, and it falls entirely on people who lift.
 *
 * Returns null unless both are available, and it never feeds the headline
 * figure - `computeFitnessAge` picks one form and stands behind it. This is for
 * a page that wants to show the reader what the choice cost them.
 */
export function compareBodyModels(profile) {
  const withWaist = computeFitnessAge(profile);
  const withBmi = computeFitnessAge({ ...profile, waistCm: null });
  if (withWaist.state !== "ready" || withBmi.state !== "ready") return null;
  if (withWaist.form !== "waist" || withBmi.form !== "bmi") return null;
  return {
    waist: withWaist,
    bmi: withBmi,
    vo2Delta: withBmi.vo2max - withWaist.vo2max,
    /**
     * Positive means the BMI form reads you older than the waist form does.
     *
     * **Measured on the uncapped figures.** This exists to price what dropping
     * the waist costs, which is a property of the model rather than of what gets
     * printed, and both forms readily saturate the same cap - at which point the
     * printed difference is zero and the honest answer is several years.
     */
    yearsDelta: withBmi.uncappedAge - withWaist.uncappedAge,
  };
}

/**
 * What each input is compared against.
 *
 * Resting heart rate comes through ageNorms.js rather than from a table here.
 * That file already interpolates within a category and already knows the
 * comparison is approximate without a sex on the profile, and a second opinion
 * about what is normal for an age is the drift metricRegistry exists to stop.
 */
function referenceInputs(age, sex, form) {
  const cohort = COHORT[sex];
  // Called only for its `approximate` flag. It is always false while a sex is
  // required above; the field survives because resting heart rate is the one
  // input whose reference is owned by another file, so it is the one that can
  // become approximate again without anything here changing.
  const norm = restingHrForAge(70, age, sex);
  // **The reference person does not change with age, and that is the point.**
  // Every one of these is the cohort's overall mean, so the only thing that
  // moves with age is the equation's own age term. That is what makes an average
  // person read their own age at every age, which the previous reference - a WHO
  // BMI threshold, an age-matched resting rate and a cohort activity mean, three
  // different kinds of figure describing nobody in particular - could not do.
  return {
    pa: { value: cohort.pa, label: INPUT_REFERENCE.pa.label },
    body: {
      key: form,
      label: HUNT_MODELS[form].label,
      unit: HUNT_MODELS[form].unit,
      value: cohort[form],
      referenceLabel: "THE STUDY'S AVERAGE",
    },
    restingHr: {
      value: cohort.restingHr,
      label: "THE STUDY'S AVERAGE",
      approximate: norm?.approximate ?? true,
    },
  };
}

/**
 * The score that sits in the middle of ageNorms' AVERAGE category.
 *
 * That ladder tops AVERAGE out at 0.45 and the category below it at 0.25, so its
 * middle is 0.35. Written as a constant rather than inline because it is the one
 * number here that depends on ageNorms' internals, and it should be the first
 * thing checked if that ladder is ever reweighted.
 */
const AVERAGE_BAND_MIDPOINT = 0.35;

/**
 * The resting heart rate that reads as typical for an age.
 *
 * **Found by searching ageNorms rather than by holding a copy of its bounds.**
 * That file already owns Atlas's opinion of what a resting rate means for an
 * age; a second table here would be a second opinion, which is exactly the drift
 * metricRegistry exists to stop. The cost is a binary search, which is forty
 * cheap calls once per computation.
 */
function averageRestingHrFor(age, sex) {
  let lo = 25;
  let hi = 120;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const scored = restingHrForAge(mid, age, sex);
    if (!scored) return 70;
    // Scores fall as the rate rises, so a score above target means look higher.
    if (scored.value > AVERAGE_BAND_MIDPOINT) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10) / 10;
}

/**
 * The figure itemised: each input, its reading, the reference it was judged
 * against, and what it is worth in years.
 *
 * Same shape and the same job as `recoveryBreakdown()`, with years in place of
 * points out of possible, and with the same rule that the rows have to add up to
 * the headline or the page is showing its working and its working is wrong.
 *
 * **The arithmetic is exact, and that is the main reason to prefer this model
 * over every alternative surveyed.** The equation is linear in each input, so
 * each input's effect in mL/kg/min is `coefficient * (reading - reference)` and
 * those sum with no residual. Converting to years uses one shared slope, taken
 * from the reference curve across the interval actually spanned, so the years
 * sum exactly to `fitnessAge - referenceAge` rather than approximately.
 *
 * Positive years read older. An input sitting exactly on its reference is worth
 * zero years, which is the right and readable behaviour: an ordinary reading
 * should not push a figure in either direction.
 */
export function fitnessAgeBreakdown(result) {
  if (!result || result.state !== "ready") return [];

  const { coefficients: coef, inputs, reference } = result;
  const deltas = {
    pa: coef.pa * (inputs.pa - reference.pa.value),
    body: coef.body * (inputs.body - reference.body.value),
    restingHr: coef.restingHr * (inputs.restingHr - reference.restingHr.value),
  };

  // The equation's own age coefficient, which is the exact conversion now that
  // the reference is the same equation rather than another paper's curve. It
  // used to be a slope derived from the span between two ages, which was an
  // approximation dressed up to make the rows add up; this needs no such trick,
  // because each row IS `coef_k * delta_k / -coef.age` and they sum to the gap
  // identically. Negated so that being better than average reads as fewer years.
  const slope = coef.age;

  const rows = [
    {
      key: "pa",
      label: "ACTIVITY",
      unit: "",
      reading: inputs.pa,
      referenceValue: reference.pa.value,
      referenceLabel: reference.pa.label,
      coefficient: coef.pa,
      vo2Delta: deltas.pa,
    },
    {
      key: "body",
      label: reference.body.label,
      unit: reference.body.unit,
      reading: inputs.body,
      referenceValue: reference.body.value,
      referenceLabel: reference.body.referenceLabel,
      coefficient: coef.body,
      vo2Delta: deltas.body,
    },
    {
      key: "restingHr",
      label: "REST HR",
      unit: "BPM",
      reading: inputs.restingHr,
      referenceValue: reference.restingHr.value,
      referenceLabel: reference.restingHr.label,
      coefficient: coef.restingHr,
      vo2Delta: deltas.restingHr,
      approximate: reference.restingHr.approximate,
    },
  ];

  return (
    rows
      .map((row) => ({ ...row, years: slope ? row.vo2Delta / slope : null }))
      // Largest effect first, the way headroomParagraphs orders by weight: the
      // input that moved the figure most is the one a reader is asking about.
      .sort((a, b) => Math.abs(b.years ?? 0) - Math.abs(a.years ?? 0))
  );
}

/** The reference curve's gradient in mL/kg/min per year around an age. */
export function localSlope(age, sex) {
  const a = referenceVo2max(clamp(age - 0.5, AGE_MIN, AGE_MAX), sex);
  const b = referenceVo2max(clamp(age + 0.5, AGE_MIN, AGE_MAX), sex);
  if (a == null || b == null) return null;
  const delta = b - a;
  return Math.abs(delta) < 1e-9 ? null : delta;
}
