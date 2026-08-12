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
export const CALIBRATED_ON = "2026-08-12";

/**
 * The estimating equations, both forms, all four sexes' worth of coefficients.
 *
 * Nes BM, Janszky I, Aspenes ST, Bertheussen GF, Vatten LJ, Wisloff U.
 * "Estimating VO2peak from a nonexercise prediction model: the HUNT Study,
 * Norway." Med Sci Sports Exerc 2011;43(11):2024-2030. n = 4637 healthy adults
 * with directly measured treadmill VO2peak. The waist form explains 61% of the
 * variance in men and 56% in women.
 *
 * `pa` is the HUNT physical activity index (0-15), `restingHr` is bpm, and
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
export const INPUT_REFERENCE = {
  /**
   * 7.5 on the HUNT index is the published "meets the physical activity
   * guidelines" anchor (Kurtze et al., Eur J Epidemiol 2008), and it falls out of
   * the coding exactly: 2.5 frequency x 1.00 duration x 3 intensity.
   *
   * It is a threshold, not a cohort mean, and the label must say so. Calling it
   * "average" would claim the average adult meets the guidelines, which is false
   * nearly everywhere it has been measured.
   */
  pa: { value: 7.5, label: "MEETS THE GUIDELINES" },
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
  // Strictly outside the anchors, not at them: a reading landing exactly on the
  // top anchor is the fittest age the data describes, and clamping it would
  // report 20 for a value that resolves cleanly to 25. Past the anchors the curve
  // is flat, so a figure there is genuinely unresolvable and says so.
  if (vo2max > ladder[0][1]) return { age: AGE_MIN, clamped: true };
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
 * How the HUNT index is built: frequency x duration x intensity, 0.00 to 15.00.
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
const FREQUENCY_POINTS = [
  [0, 0],
  [0.5, 0.5],
  [1, 1],
  [2.5, 2.5],
  [5, 5],
];

/** Category midpoints in minutes against their published point values. */
const DURATION_POINTS = [
  [10, 0.1],
  [23, 0.38],
  [45, 0.75],
  [75, 1.0],
];

/**
 * Intensity as a share of age-predicted maximum heart rate.
 *
 * The questionnaire's three answers are "easy, no sweat", "hard, out of breath"
 * and "near exhaustion". Those are placed on the HR scale at roughly 65, 78 and
 * 90 per cent of maximum, which is the conventional reading of them and is
 * **the softest assumption in this file** - it is the one place a published
 * category had to be mapped onto a measurement rather than reconstructed from
 * one. Worth revisiting against the user's own sessions once there are enough of
 * them to see where his easy and hard days actually sit.
 */
const INTENSITY_POINTS = [
  [0.65, 1],
  [0.78, 2],
  [0.9, 3],
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
export function paIndexFrom(sessions, { days = MIN_ACTIVITY_DAYS, age = null } = {}) {
  if (!num(days) || days < MIN_ACTIVITY_DAYS) {
    return { state: "calibrating", days: days ?? 0, needed: MIN_ACTIVITY_DAYS };
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
  const hrOf = (s) => (num(s.hrAvg) ? s.hrAvg : null);
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
    value: clamp(frequency * duration * intensity, 0, 15),
    frequency,
    duration,
    intensity,
    sessionsPerWeek: perWeek,
    medianMinutes,
    intensityShare,
    sessions: list.length,
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

  if (!num(restingHr) || restingHr < 25 || restingHr > 120) return missing("no-resting-hr");
  if (restingHrDays < MIN_RESTING_HR_DAYS) {
    return missing("calibrating-resting-hr", {
      days: restingHrDays,
      needed: MIN_RESTING_HR_DAYS,
    });
  }
  if (!num(paIndex) || paIndex < 0 || paIndex > 15) return missing("no-activity");
  if (activityDays < MIN_ACTIVITY_DAYS) {
    return missing("calibrating-activity", { days: activityDays, needed: MIN_ACTIVITY_DAYS });
  }

  const model = HUNT_MODELS[form];
  const coef = model[sex];
  const inputs = { age, pa: paIndex, body, restingHr };
  const vo2max = modelVo2max(coef, inputs);
  const fitted = ageForVo2max(vo2max, sex);
  if (!fitted) return missing("no-reference-curve");

  // The reference person: someone the same age, meeting each input's stated
  // reference. Its own fitness age is reported rather than assumed equal to the
  // chronological one, because the references are published thresholds and an
  // age-matched cohort mean, and there is no reason those should land exactly on
  // the Loe curve. Where they do not, that gap IS the cohort mismatch this whole
  // ticket is worried about, and hiding it would be the black box again.
  const reference = referenceInputs(age, sex, form);
  const referenceVo2 = modelVo2max(coef, {
    age,
    pa: reference.pa.value,
    body: reference.body.value,
    restingHr: reference.restingHr.value,
  });
  const referenceFitted = ageForVo2max(referenceVo2, sex);

  return {
    state: "ready",
    /** Which regression ran: "bmi" or "waist". The page must name it. */
    form,
    formLabel: model.label,
    vo2max,
    fitnessAge: fitted.age,
    clamped: fitted.clamped,
    chronologicalAge: age,
    /** Negative is younger. What the page leads on. */
    gap: fitted.age - age,
    /** What someone the same age meeting every reference would read. */
    referenceAge: referenceFitted?.age ?? null,
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
 * 34-year-old man, 180 cm, 50 bpm resting, PA index 7.5, waist 84 cm:
 *
 *   78 kg, BMI 24.1 -> waist form 53.2, BMI form 52.0, ~2.1 years apart
 *   88 kg, BMI 27.2 -> waist form 53.2, BMI form 49.2, ~7.5 years apart
 *
 * Same waist both times, so the second man is the same shape with ten kilos of
 * muscle on him, and the BMI form charges him five and a half years for it.
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
    /** Positive means the BMI form reads you older than the waist form does. */
    yearsDelta: withBmi.fitnessAge - withWaist.fitnessAge,
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
  // Called only for its `approximate` flag. It is always false while a sex is
  // required above; the field survives because resting heart rate is the one
  // input whose reference is owned by another file, so it is the one that can
  // become approximate again without anything here changing.
  const norm = restingHrForAge(70, age, sex);
  const average = averageRestingHrFor(age, sex);
  return {
    pa: { value: INPUT_REFERENCE.pa.value, label: INPUT_REFERENCE.pa.label },
    body: {
      key: form,
      label: HUNT_MODELS[form].label,
      unit: HUNT_MODELS[form].unit,
      value: INPUT_REFERENCE[form][sex],
      referenceLabel: INPUT_REFERENCE[form].label,
    },
    restingHr: {
      value: average,
      label: "TYPICAL FOR YOUR AGE",
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

  const vo2Gap = result.vo2max - result.referenceVo2max;
  const ageGap = (result.fitnessAge ?? 0) - (result.referenceAge ?? 0);
  // mL/kg/min per year across the span actually covered, so the rows add up. The
  // local slope is only used where the two ages coincide and the span is zero.
  const slope =
    Math.abs(ageGap) > 1e-9 && Math.abs(vo2Gap) > 1e-9
      ? vo2Gap / ageGap
      : localSlope(result.chronologicalAge, result.sex);

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
