// The Recovery score: one number for "how ready is my body today".
//
// This is Atlas's first computed metric rather than a reading, which is why it
// gets its own colour and why it does not belong to a metric family. It is
// built from the published readiness literature, not reverse-engineered from
// Zepp: Zepp's own Readiness (since replaced by HybridCharge) uses sleeping
// HRV, sleeping resting HR, breathing and temperature, but its weighting has
// never been published and cannot be reproduced.
//
// The shape, and why:
//
//   HRV deviation      50%   The dominant signal in the literature. Judged
//                            against your own rolling baseline, never as an
//                            absolute number, because absolute HRV varies
//                            enormously between people and means little.
//   Resting HR         25%   The confirmer. Moves opposite to HRV when the
//                            reading is real rather than noise.
//   Sleep              25%   Duration against goal, adjusted by how much of it
//                            was restorative.
//
// Respiratory rate and skin temperature are deliberately excluded. They are
// bimodal: flat almost always, then a sharp excursion that means something
// specific, usually illness. Averaged into a score they contribute nothing on
// a normal day and get diluted on the day they matter. They belong as flags.

import {
  BASELINE_NIGHTS,
  rollingBaseline,
  deviation,
  deviationToScore,
  deviationBand,
} from "@/utils/baseline";
import { conditionTerm } from "@/utils/level";
import { restingHrForAge } from "@/utils/ageNorms";

/**
 * How far the HRV baseline has to move before it is worth mentioning.
 *
 * Ten per cent, because below that the sentence would appear on ordinary weeks
 * and a note that shows every day explains nothing. The archive's real shift
 * when this was built was 15% over a week.
 */
const BASELINE_SHIFT_NOTABLE = 0.1;

export const RECOVERY_WEIGHTS = { hrv: 0.5, restingHr: 0.25, sleep: 0.25 };

/** Share of sleep that counts as restorative before the quality term saturates. */
const RESTORATIVE_TARGET = 0.4;

/** How much of the sleep term is duration versus composition. */
const DURATION_SHARE = 0.7;

// The middle band has now been named three times, and the first two failed the
// same way. "MODERATE" read as a mark out of ten. "OKAY" read as a shrug. Both
// describe how well you did; the band is about *where the reading sits*, and a
// day with every reading exactly on its baseline and a full night's sleep
// scores 63 - measured, not assumed. So the word has to name that position
// rather than rate it, which is what NORMAL does and the other two did not.
//
// Each band carries its own colour token. Recovery is a score, not a domain,
// so unlike the family colours this one is allowed to mean "how is it going":
// there is only ever one Recovery on screen, so nothing can be confused with it.
// Four bands, because three made amber carry the word GOOD, and amber does not
// mean good to anyone. Green is where good starts.
//
// The boundaries are set from the score's own distribution rather than picked
// round: scores land at roughly 61 +/- 14, which puts GREAT at about one day in
// twenty, GOOD at one in five, and LOW at one in five. Rare enough that GREAT
// means something, common enough that it is reachable.
// Lowered 2026-08-07, measured rather than guessed, then GREAT set by the user's
// own judgement of what the word should mean.
//
// The originals were 85 / 70 / 50, from a design assumption of scores landing
// around 61. The first ten scoreable days came in at a mean of 49.3 with a maximum
// of 73, so GOOD was nearly out of reach and GREAT completely so. NORMAL and GOOD
// therefore came down to fit the real distribution. GOOD landed on 58 from that
// arithmetic and was rounded to 60 by the user: a boundary nobody can remember is
// a boundary that gets misquoted, and no day in the archive sits between them.
//
// **GREAT is deliberately still above everything in that archive.** It was tried
// at 70, which made the best day so far read GREAT, and the user's call was that
// 73 is a good day rather than a great one. So the word keeps its meaning and the
// band stays out of reach until the readings genuinely improve.
//
// These are the FLOOR. The adaptive half, which additionally requires a day to
// stand out against your own recent scores, is a separate check on top - see
// docs/backlog.md. Without it, lowering NORMAL and GOOD would make them ordinary
// the moment a training block ends and every reading rebounds.
export const RECOVERY_BANDS = [
  { min: 80, label: "GREAT", token: "--rec-great" },
  { min: 60, label: "GOOD", token: "--rec-good" },
  { min: 40, label: "NORMAL", token: "--rec-okay" },
  { min: 0, label: "LOW", token: "--rec-low" },
];

function bandFor(score) {
  return RECOVERY_BANDS.find((b) => score >= b.min) ?? RECOVERY_BANDS.at(-1);
}

export function recoveryLabel(score) {
  return bandFor(score).label;
}

/** The colour for a score, as a CSS var reference. */
export function recoveryColor(score) {
  return score == null ? "var(--dim)" : `var(${bandFor(score).token})`;
}

/** The darker token the same band uses for text on the light themes. */
export function recoveryInk(score) {
  return score == null ? "var(--dim)" : `var(${bandFor(score).token}-ink)`;
}

/**
 * What a band actually means, in a sentence.
 *
 * Needed because the score is relative to your own baseline, and the labels
 * read as absolute. A day where every reading is normal lands in the middle by
 * construction, not because anything is wrong, and "MODERATE" beside
 * "everything sits inside your usual ranges" looks like a contradiction until
 * that is said out loud.
 */
export function bandMeaning(label) {
  // "About one day in twenty" came off GREAT when the floors were lowered on
  // 2026-08-07. It was a claim about frequency that the new boundaries make false,
  // and it will move again when the adaptive check lands, so the wording no longer
  // makes a claim the bands have to keep.
  // All four say what the reading IS and then what that leaves you with, and the
  // second half is deliberately descriptive rather than instructive. "A day to
  // use" told you what to do with your own day, which is not this score's job -
  // and the same objection applies to anything of that shape.
  //
  // They escalate on one axis, how much is in hand: nothing asking for attention,
  // then more than usual, then everything where you want it.
  if (label === "GREAT") {
    return "About as good as your readings get. Everything is where you want it.";
  }
  if (label === "GOOD") {
    return "Better placed than your own normal. You have more in hand than usual.";
  }
  if (label === "LOW") return "Worse than your normal. Treat it as a lighter day.";
  return "Where most of your days land. Nothing is asking for attention.";
}

/**
 * Sleep's contribution, 0..1.
 *
 * Duration carries most of it, because a short night is a short night whatever
 * its composition. Quality is the share of sleep spent in deep or REM, the two
 * restorative stages, and saturates at 40%: beyond that the extra is not
 * evidence of better recovery, just of a longer night.
 *
 * Falls back to duration alone when stage data is missing, which is every
 * night synced before stage decoding landed.
 */
export function sleepTerm(hours, goalHours, stages, sleepScore = null) {
  // Atlas's own sleep score when there is one (2026-08-07, user's call).
  //
  // It replaced duration-against-goal because that carried almost no
  // information about this user: he clears the 8 hour goal on nine nights in
  // ten, so the duration part sat pinned at maximum and sleep contributed a
  // near-constant 25 points to every Recovery score. The sleep score at least
  // weighs regularity and continuity, which do move night to night.
  //
  // Known and accepted: the sleep score has the same pinning inside its own
  // duration term, so this is an improvement rather than a fix. See
  // docs/backlog.md - it is on probation and expected to be recalibrated.
  if (sleepScore != null && Number.isFinite(sleepScore)) {
    return Math.max(0, Math.min(1, sleepScore / 100));
  }

  // The fallback is the original duration-and-composition term, and it still
  // matters: the sleep score withholds itself under three nights of bedtimes,
  // and a night with no stage data cannot be scored at all. Returning null
  // there would drop sleep out of Recovery entirely and silently redistribute
  // its weight onto HRV.
  if (hours == null || !goalHours) return null;
  const duration = Math.max(0, Math.min(1, hours / goalHours));

  const asleep = (stages?.deep ?? 0) + (stages?.light ?? 0) + (stages?.rem ?? 0);
  if (!asleep) return duration;

  const restorative = ((stages.deep ?? 0) + (stages.rem ?? 0)) / asleep;
  const quality = Math.max(0, Math.min(1, restorative / RESTORATIVE_TARGET));
  return DURATION_SHARE * duration + (1 - DURATION_SHARE) * quality;
}

/**
 * Compute today's Recovery score.
 *
 * `history` runs oldest to newest and must exclude today, since a baseline
 * that contains the night being judged cannot measure deviation from it.
 *
 * Returns a calibrating result rather than a provisional number until the
 * baseline window fills. A number derived from two nights looks exactly as
 * confident as one derived from thirty, and would swing hard as the window
 * settled. Atlas would rather say it does not know yet.
 */
/**
 * Recovery as a CONDITION score (2026-08-10).
 *
 * `levels` carries what level.js worked out over a six-month window, and
 * `profile` the age and sex that let resting heart rate be judged against
 * something other than yourself. Both are optional: without them every term
 * falls back to the deviation-only shape that shipped before this, which is what
 * a new user sees for their first month.
 *
 * **What changed and why.** Every term was previously judged against the user's
 * own last seven nights, so a reading sitting on its own baseline earned exactly
 * half marks - which meant holding an improvement returned you to the same score
 * within a week and being consistently excellent was indistinguishable from
 * being consistently average. Level is now the spine of each vital term and
 * today's reading only modulates it, so an ordinary day at your best scores your
 * best rather than half.
 */
export function computeRecovery({
  today = {},
  history = {},
  sleepGoalHours,
  levels = null,
  profile = null,
} = {}) {
  const hrvBaseline = rollingBaseline(history.hrv, { log: true });
  const rhrBaseline = rollingBaseline(history.restingHr);

  // The same baseline as it stood a week earlier, computed by dropping the most
  // recent week off the same series. Callers already pass the whole history and
  // rollingBaseline takes the last seven itself, so this needs no new data.
  //
  // It exists because a moving baseline is invisible from inside the score and
  // explains a run of low days on its own. While HRV falls, every reading is
  // judged against an average built from higher days that have not aged out
  // yet, so ordinary days score under the middle for as long as the drop lasts.
  // Reported so the page can say that, NOT as a health signal: the decline this
  // was built against turned out to be a training block, and calling that a
  // warning is a rejected ticket in docs/backlog.md.
  const hrvBaselineBefore = rollingBaseline((history.hrv ?? []).slice(0, -BASELINE_NIGHTS), {
    log: true,
  });

  const usableNights = (history.hrv ?? []).filter(
    (v) => typeof v === "number" && Number.isFinite(v) && v > 0
  ).length;

  if (!hrvBaseline) {
    return {
      state: "calibrating",
      score: null,
      label: null,
      nights: usableNights,
      needed: BASELINE_NIGHTS,
      terms: {},
      // Carried even though there is no score, so a screen short of history can
      // show what it DOES have instead of a placeholder. Withholding the score
      // is right - a baseline built from two nights is largely the night being
      // judged - but withholding last night's HRV as well says "no data" about
      // a night that was measured perfectly well.
      readings: { hrv: today.hrv, restingHr: today.restingHr, sleep: today.sleep },
    };
  }

  const hrvZ = deviation(today.hrv, hrvBaseline, { log: true });
  const rhrZ = deviation(today.restingHr, rhrBaseline);

  // Today against your recent self, which is now a modifier rather than the
  // whole term.
  const hrvResponse = deviationToScore(hrvZ);
  const rhrResponse = deviationToScore(rhrZ, { higherIsBetter: false });

  // Resting heart rate's spine is your RECENT AVERAGE against the age norms, not
  // today's reading: today already has its say through the modifier, and using it
  // twice would count one good night twice over.
  const rhrAge =
    profile?.age != null && levels?.restingHr?.state === "ready"
      ? restingHrForAge(levels.restingHr.current, profile.age, profile.sex ?? null)
      : null;

  // Age first, your own best second, deviation last. Each rung is used only when
  // the one above it has nothing to say, so the score degrades honestly rather
  // than silently changing meaning.
  const rhrSpine = rhrAge
    ? { state: "ready", value: rhrAge.value, weight: levels.restingHr.weight }
    : levels?.restingHr;

  const terms = {
    hrv: conditionTerm(levels?.hrv, hrvResponse),
    restingHr: conditionTerm(rhrSpine, rhrResponse),
    // The score is passed in rather than computed here, so this module never
    // imports sleepScore.js: that one already reaches for Recovery's own band
    // tokens, and the pair importing each other is a cycle.
    sleep: sleepTerm(today.sleep, sleepGoalHours, today.sleepStages, today.sleepScore ?? null),

  };

  // A term with no reading behind it is dropped and its weight redistributed,
  // rather than counted as zero. A missing resting HR is not a resting HR of
  // nought, and treating it as one would read as a catastrophic day.
  const present = Object.entries(terms).filter(([, v]) => v != null);
  if (!present.length) {
    return {
      state: "no-data",
      score: null,
      label: null,
      nights: usableNights,
      needed: BASELINE_NIGHTS,
      terms,
      readings: { hrv: today.hrv, restingHr: today.restingHr, sleep: today.sleep },
    };
  }

  const totalWeight = present.reduce((sum, [key]) => sum + RECOVERY_WEIGHTS[key], 0);
  const weighted = present.reduce(
    (sum, [key, value]) => sum + RECOVERY_WEIGHTS[key] * value,
    0
  );
  const score = Math.round((weighted / totalWeight) * 100);

  return {
    state: "ready",
    score,
    label: recoveryLabel(score),
    nights: usableNights,
    needed: BASELINE_NIGHTS,
    // Kept so a surprising score can be explained rather than just disbelieved.
    terms,
    deviations: { hrv: hrvZ, restingHr: rhrZ },
    baselines: { hrv: hrvBaseline, restingHr: rhrBaseline },
    // What each term was actually judged against, so the page can say so rather
    // than the reader having to infer it from a number that changed shape.
    levels: { hrv: levels?.hrv ?? null, restingHr: rhrSpine ?? null },
    ageReference: rhrAge,
    responses: { hrv: hrvResponse, restingHr: rhrResponse },
    hrvBaselineBefore,
    // The readings the terms were computed from, so the breakdown can show its
    // working without recomputing anything and risking a different answer.
    readings: { hrv: today.hrv, restingHr: today.restingHr, sleep: today.sleep },
    // How many nights the sleep term averaged, and what last night alone scored,
    // so a page can say which of the two it is showing.
    sleepNights: today.sleepNights ?? 0,
    lastNightScore: today.lastNightScore ?? null,
    sleepGoalHours,
  };
}

/** A term is worth naming as a lever only if it would move the score usefully. */
const MEANINGFUL_POINTS = 3;

/**
 * How far last night has to sit from the week before it is named separately.
 *
 * Inside this the week's own figure has already described the night, and a
 * second number differing by a point or two only invites the question of which
 * one is real.
 */
const LAST_NIGHT_WORTH_NAMING = 3;

/**
 * The terms as they are spoken, bare, so the sentence can put its own article in
 * front. TERM_LABEL's "REST HR" is right above a row and wrong in a sentence.
 */
const TERM_PROSE = {
  hrv: "HRV",
  restingHr: "resting heart rate",
  sleep: "sleep",
};

/**
 * The article each term takes, because it cannot be derived from the spelling.
 * HRV is read "aitch-arr-vee", so it takes "an" despite starting with a
 * consonant, and a rule based on the first letter produced "a HRV".
 */
const TERM_ARTICLE = {
  hrv: "An",
  restingHr: "A",
  sleep: "A",
};

const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Beyond three hours, "sleep more" stops being a suggestion and becomes a joke. */
const MAX_SUGGESTED_MINUTES = 180;

/**
 * Past this, the gap is named as "a longer night" rather than in minutes.
 *
 * An hour and a half is roughly where a figure stops being something you could
 * aim at. "About 45 minutes more" is a decision you can make tonight; "about
 * 2h 45m more" is the same arithmetic carried past the point of usefulness.
 */
const ACTIONABLE_SLEEP_MINUTES = 90;

/**
 * What it would take to reach the next band up.
 *
 * Points rather than advice: the gap and each term's unclaimed points are both
 * arithmetic off a score with known weights.
 *
 * Sleep is singled out rather than simply reporting whichever term has the most
 * unclaimed points. That naive version always answers "HRV", because HRV
 * carries double the weight and so holds the most slack even when it is sitting
 * exactly at baseline, and "improve your HRV" is not something anyone can act
 * on tonight. Sleep is the only term with a lever attached.
 */
export function recoveryHeadroom(result) {
  if (!result || result.state !== "ready") return null;

  // Bands run high to low, so the next one up is the last whose floor is above
  // today's score.
  const next = [...RECOVERY_BANDS].reverse().find((b) => b.min > result.score);
  if (!next) return null;

  const rows = recoveryBreakdown(result).map((r) => ({
    ...r,
    unclaimed: r.maxPoints - r.points,
  }));

  return {
    nextLabel: next.label,
    pointsNeeded: next.min - result.score,
    sleep: rows.find((r) => r.key === "sleep") ?? null,
    rows,
  };
}

/** Where a reading stops being "about normal" and starts having held the day back. */
const HELD_BACK_Z = 1;

/** Below this a term's shortfall is rounding, not something to list. */
const LISTABLE_POINTS = 2;

/**
 * Every term's shortfall, largest first, as one line.
 *
 * This exists because naming a single term that could close the gap on its own
 * answers the wrong question. Resting heart rate is very often unable to reach
 * the next band alone (it saturates two standard deviations out, which on a real
 * day was 3.7% short of enough) and so was withheld entirely, leaving a page that
 * only ever discussed HRV. But the points came off *both*, and "what went where"
 * is answerable for every term on every day.
 *
 * **Deliberately neutral about blame.** "HRV cost you 14" reads as a fault, and
 * on this scoring shape it usually is not one: a reading sitting exactly on its
 * baseline earns exactly half its points by construction, so an ordinary day has
 * points outstanding everywhere. That is what HOW IT IS BUILT explains, and this
 * line only states the arithmetic.
 */
export function pointsOnTableLine(result) {
  const rows = recoveryBreakdown(result);
  if (!rows.length) return "";
  const short = rows
    .map((r) => ({ label: r.label, lost: Math.round(r.maxPoints - r.points) }))
    .filter((r) => r.lost >= LISTABLE_POINTS)
    .sort((a, b) => b.lost - a.lost);
  if (!short.length) return "";
  // Written as a sentence about the readings, not a label with a list bolted on.
  // "Points still on the table: hrv 14, rest hr 11" was accurate and sounded like
  // a spreadsheet header.
  const [first, ...rest] = short;
  const name = (r) => TERM_PROSE[keyFor(rows, r.label)] ?? r.label.toLowerCase();
  const tail = rest.length
    ? `, ${rest.map((r) => `${name(r)} ${r.lost}`).join(" and ")}`
    : "";
  return `${capitalise(name(first))} is ${first.lost} points off its best${tail}.`;
}

/** The breakdown rows carry labels; this gets back to the key they came from. */
function keyFor(rows, label) {
  return rows.find((r) => r.label === label)?.key;
}

/**
 * The term that actually held today back, or null on a day where nothing did.
 *
 * **Ranked by how far a reading sits from its own normal, not by points given
 * up**, and the difference is not academic. On this scoring shape a reading
 * exactly on baseline earns exactly half its points, so an ordinary day leaves
 * HRV holding 25 unclaimed points against resting HR's 12.5 purely because HRV
 * carries double the weight. Ranking by unclaimed points therefore named HRV on
 * nearly every day, whatever the readings said - measured on a real day where
 * HRV gave up 34 of its 50 while sitting comfortably inside normal.
 *
 * That is the same error `recoveryContext.js` exists to prevent, one function
 * over, and it is why this now shares that gate: a term has to be genuinely on
 * the bad side of its own range to be named. Sleep is judged against its goal
 * rather than a baseline, so it qualifies by being short of it.
 *
 * Returns null when nothing is down, which is most days, and a page must leave
 * that empty rather than filling it with the least-good term.
 */
export function biggestOpportunity(result) {
  const head = recoveryHeadroom(result);
  if (!head) return null;

  const candidates = head.rows
    .map((row) => {
      if (row.key === "sleep") {
        // No baseline to be outside of. Short of the goal is the equivalent, and
        // the points it cost stand in for how short.
        const short = row.unclaimed >= MEANINGFUL_POINTS;
        return short ? { row, severity: row.unclaimed / (row.maxPoints || 1) } : null;
      }
      const spec = DEVIATION_TERMS[row.key];
      const z = result.deviations?.[row.key];
      if (!spec || z == null) return null;
      // Directed, so a resting HR *below* baseline is not mistaken for a problem.
      const directed = spec.higherIsBetter ? z : -z;
      return directed <= -HELD_BACK_Z ? { row, severity: Math.abs(directed) } : null;
    })
    .filter(Boolean);

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.severity - a.severity);
  return candidates[0].row;
}

/**
 * One sentence on the gap, in terms of something you can do about it.
 *
 * "The rest is HRV and resting heart rate" was accurate and useless: it named
 * the arithmetic instead of the action. Where sleep is short, the gap converts
 * into minutes of sleep, because the sleep term's slope against duration is
 * known. Where it is not, the honest answer is that today's number is a
 * readout and there is nothing to do tonight, which is worth saying plainly
 * rather than dressing up.
 */
export function headroomSentence(result, sleepGoalHours) {
  // No score means no gap to talk about. Without this, a calibrating day read
  // "Nothing scores higher than this" directly under "Learning your baseline",
  // which is both wrong and smug.
  if (!result || result.state !== "ready") return "";

  const head = recoveryHeadroom(result);
  if (!head) return "Nothing scores higher than this.";

  const goal = sleepGoalHours ?? result.sleepGoalHours;
  const gap = `${head.pointsNeeded} ${head.pointsNeeded === 1 ? "point" : "points"} to ${head.nextLabel}.`;

  const sleepShort = head.sleep && head.sleep.unclaimed >= MEANINGFUL_POINTS && goal;

  if (sleepShort) {
    // Under the goal, the duration part of the sleep term rises linearly, so
    // the points a stretch of sleep is worth is a straight conversion.
    const pointsPerHour = (head.sleep.maxPoints * DURATION_SHARE) / goal;
    const minutes = Math.ceil((head.pointsNeeded / pointsPerHour) * 60);
    // A figure only while it is a figure you could act on. "About 2h 45m more
    // sleep would cover it" is precise about something nobody can aim at, and
    // reads as arithmetic rather than as an answer. Under an hour and a half it
    // is a real suggestion, so it keeps the number, rounded to the quarter hour
    // because a minute-exact figure implies a precision the score has not got.
    if (minutes > 0 && minutes <= ACTIONABLE_SLEEP_MINUTES) {
      const rounded = Math.max(15, Math.round(minutes / 15) * 15);
      const text =
        rounded >= 60
          ? `${Math.floor(rounded / 60)}h${rounded % 60 ? ` ${rounded % 60}m` : ""}`
          : `${rounded} minutes`;
      return `${gap} About ${text} more sleep would cover it.`;
    }
    if (minutes > 0 && minutes <= MAX_SUGGESTED_MINUTES) {
      return `${gap} A longer night would cover it.`;
    }
    // The gap is real but bigger than a longer night can close on its own.
    // Saying "nothing tonight changes it" here would be flatly wrong, since
    // sleep is exactly what is short.
    return `${gap} A longer night is most of it, though not all: the rest is HRV and resting heart rate.`;
  }

  // What would actually be enough, in the readings' own units and with the
  // direction said out loud.
  //
  // This line has been through five wordings and every earlier one failed in a
  // way worth remembering. "Nothing tonight changes it" read as "nothing you do
  // matters". A list of general levers was true of every day and so said nothing
  // about this one. "HRV and resting heart rate hold the rest" was accurate and
  // left no way to know what would be enough, which is what prompted "how would
  // it even be possible to reach GOOD". Then "HRV about 25% above your baseline"
  // answered that in a unit nobody holds in their head, against a baseline the
  // sentence never states, and it named HRV only because HRV was the only term
  // the code could invert.
  //
  // So: the reading, its direction, and only terms that can genuinely get there.
  const targets = ["hrv", "restingHr"]
    .map((key) => ({ key, target: termTarget(result, key) }))
    .filter((t) => t.target);

  if (targets.length) {
    const [lead] = targets;
    const move = lead.target.direction === "higher" ? "up" : "down";
    return (
      `${gap} ${TERM_ARTICLE[lead.key] ?? "A"} ${TERM_PROSE[lead.key] ?? lead.key} ` +
      `of about ${lead.target.reading} would have got there, ${move} from ` +
      `tonight's ${Math.round(result.readings[lead.key])}.`
    );
  }

  // Nothing can close it alone. Said plainly, because the alternative is a
  // sentence implying one good reading would do it when the arithmetic says no
  // single reading can.
  return `${gap} No single reading closes it: it would take more than one of them moving.`;
}

/**
 * The gap, then a short paragraph per term, largest contributor first.
 *
 * Option C of three, chosen 2026-08-07 after four rejected wordings. **The rule
 * that fixes them all: state the real reading as its own finished sentence, then
 * begin the hypothetical separately.** Every failed version put the actual reading
 * and the target figure in one clause ("115 MS tonight, up from 102"), which reads
 * as a claim about tonight and contradicts itself. `/impeccable clarify` names
 * this exactly: "Ambiguity: multiple interpretations possible."
 *
 * A term is described whether or not it could reach the band on its own. The old
 * version listed only terms that could, so resting heart rate - which saturates
 * two standard deviations out and on a real day fell 3.7% short of enough - was
 * never mentioned at all, on days its points were plainly missing too.
 *
 * @returns paragraphs, already ordered. Empty while calibrating.
 */
export function headroomParagraphs(result, { trainedYesterday = false } = {}) {
  if (!result || result.state !== "ready") return [];
  const head = recoveryHeadroom(result);
  if (!head) return ["Nothing scores higher than this."];

  const out = [
    `${head.pointsNeeded} ${head.pointsNeeded === 1 ? "point" : "points"} to ${head.nextLabel}.`,
  ];

  // Only on a day that is actually down, and framed as the cause rather than as
  // instruction. On a GOOD day after training the same fact is trivia, and the
  // lighter-day steer is already carried by LOW's own band line.
  if (trainedYesterday && scoreIsDown(result)) {
    out.push("You trained the day before, which is the usual reason HRV drops the next morning.");
  }

  const rows = recoveryBreakdown(result);
  const ordered = [...rows].sort((a, b) => b.maxPoints - a.maxPoints);

  for (const row of ordered) {
    const shortfall = Math.round(row.maxPoints - row.points);
    if (shortfall < MEANINGFUL_POINTS) continue;

    const name = TERM_PROSE[row.key] ?? row.key;
    const weight = `${capitalise(name)} is ${shareWord(row, ordered)}.`;
    const target = row.key === "sleep" ? sleepTargetScore(result) : termTarget(result, row.key);

    out.push(
      [
        weight,
        readingSentence(result, row),
        outlookSentence(result, row, head, target, shortfall),
        row.key === "sleep" ? sleepDriftSentence(result) : "",
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  return out;
}

/** Its share of the score, in words where the numbers are the usual ones. */
function shareWord(row, ordered) {
  if (row === ordered[0]) return "the biggest part of the score";
  const pct = Math.round(row.maxPoints);
  if (pct === 25) return "a quarter of it";
  if (pct === 50) return "half of it";
  return `worth ${pct} of its 100 points`;
}

/**
 * What the reading was, in the unit that suits the metric.
 *
 * **Percent for HRV, beats for resting heart rate.** HRV varies multiplicatively
 * and is discussed in percentages; resting heart rate moves across a few beats, so
 * "1% above baseline" is half a beat dressed up as a finding.
 */
function readingSentence(result, row) {
  if (row.key === "sleep") {
    // **The week, and it has to say so.** This read "Last night scored 84 out of
    // 100" while showing the seven-night average, directly under a card
    // reporting last night at 42. Two numbers for one night, and the page
    // arguing with itself about which was real.
    //
    // Last night's own score is deliberately NOT here, though it was once: the
    // paragraph then ran week, last night, the week's target, last night's
    // consequence, so the two sentences about last night were split by one about
    // the week and the whole thing read out of order. It belongs to
    // `sleepDriftSentence`, which is the sentence about last night.
    const week = Math.round((result.terms.sleep ?? 0) * 100);
    const nights = result.sleepNights ?? 0;
    const span = nights > 1 ? `over the last ${nights} nights` : "so far";
    return `Sleep has averaged ${week} out of 100 ${span}.`;
  }

  const reading = Math.round(result.readings[row.key]);
  const unit = (TERM_LABEL[row.key]?.unit ?? "").trim();
  const mean = result.baselines?.[row.key]?.mean;
  if (mean == null) return `Yours was ${reading} ${unit}.`.replace(/\s+/g, " ");

  if (row.key === "hrv") {
    const pct = Math.round(Math.abs(reading / mean - 1) * 100);
    if (pct < 3) return `Yours was ${reading} ${unit}, about level with your baseline.`;
    return `Yours was ${reading} ${unit}, ${pct}% ${reading > mean ? "above" : "below"} your baseline.`;
  }

  const beats = Math.abs(reading - mean);
  if (beats < 0.75) return `Yours was ${reading} ${unit}, right on your usual.`;
  const rounded = beats < 1.5 ? "about a beat" : `about ${Math.round(beats)} beats`;
  return `Yours was ${reading} ${unit}, ${rounded} ${reading > mean ? "above" : "below"} your usual.`;
}

/**
 * Whether to name a target reading, and the honest alternative when not.
 *
 * **A figure is only named when reaching it would take more than the metric's own
 * night-to-night variation.** On 4 August HRV read 105 against a baseline of 101
 * and the target was 111: a 6 ms ask on a metric whose nightly spread is 11 ms,
 * which is precision the reading does not have. On 5 August it read 74 and the
 * target was 93, which is a real difference worth stating.
 */
function outlookSentence(result, row, head, target, shortfall) {
  if (!target) {
    return `Even at its best it could only have made up ${shortfall} of the ${head.pointsNeeded} points, so it cannot get there on its own.`;
  }

  // "Higher is better" only where it tells you something. On a night HRV came in
  // 12% ABOVE baseline the page still said it, which reads as a correction to a
  // reading that was already good. Where the reading is on the favourable side
  // and there is no figure worth naming, the paragraph simply stops: the reading
  // sentence has already said the night was fine.
  //
  // This clause has been reworded four times and each version failed the same
  // way, so it is now scoped instead of rewritten.
  const better = onGoodSide(result, row.key)
    ? ""
    : row.key === "restingHr"
      ? "Lower is better, so there were points left in it."
      : "Higher is better, so there were points left in it.";

  if (row.key === "sleep") {
    const needed = target.reading - Math.round((result.terms.sleep ?? 0) * 100);
    return needed < SLEEP_NOISE_POINTS
      ? "A better week would have taken a few more points."
      : `A weekly average around ${target.reading} out of 100 would have reached ${head.nextLabel} on its own.`;
  }

  const base = result.baselines?.[row.key];
  const reading = result.readings[row.key];
  // One standard deviation, taken from the baseline's own back-converted ends so
  // it is in the reading's units even for log-scaled HRV.
  const spread =
    base == null
      ? null
      : target.direction === "higher"
        ? base.high - base.mean
        : base.mean - base.low;
  const ask = Math.abs(target.reading - reading);

  if (spread != null && ask < spread) {
    return better;
  }
  const unit = (TERM_LABEL[row.key]?.unit ?? "").trim();
  // The direction rides with the TARGET rather than with the reading. Saying
  // "higher is better" about a reading that came in above baseline read as a
  // correction to a good number, which is why that clause is scoped; attached to
  // a figure you are being asked to reach, it is simply what the figure means.
  const way = target.direction === "higher" ? "higher" : "lower";
  return `Around ${target.reading} ${unit}, ${way} than tonight, would have reached ${head.nextLabel} on its own.`.replace(
    /\s+/g,
    " "
  );
}

/**
 * What last night would do to Recovery if every night were like it.
 *
 * The sleep term is a seven-night average, so one night barely moves it. That is
 * the point, and it is also why a genuinely bad night can leave the score
 * looking untroubled: the effect is real but it is a week away. This says how
 * far away, in the score's own units, which is the honest version of a warning.
 *
 * **A projection, not a prediction.** It answers "what if this held" rather than
 * claiming it will, because nothing here knows anything about tomorrow night.
 *
 * Returns "" unless the drift is worth acting on, which keeps it off the page on
 * an ordinary night rather than teaching you to skip the paragraph.
 */
export function sleepDriftSentence(result) {
  if (!result || result.state !== "ready") return "";
  const week = result.terms?.sleep;
  const last = result.lastNightScore;
  if (week == null || last == null) return "";

  // It names last night before projecting from it, because a projection whose
  // starting figure was two sentences back and separated by one about the week
  // reads as arriving from nowhere. Where the two agree there is nothing to say
  // at all - the week's own sentence has already covered the night.
  const apart = Math.abs(Math.round(week * 100) - last);
  const named = `Last night scored ${last}.`;

  const row = recoveryBreakdown(result).find((r) => r.key === "sleep");
  if (!row) return apart >= LAST_NIGHT_WORTH_NAMING ? named : "";

  // Where the term would settle if last night repeated, against where it is now,
  // in points of the finished score. Uses the redistributed weight rather than
  // the nominal 25, so a day with a term missing still adds up.
  const points = Math.round((last / 100 - week) * row.maxPoints);
  if (Math.abs(points) < MEANINGFUL_POINTS) {
    return apart >= LAST_NIGHT_WORTH_NAMING ? named : "";
  }

  return points < 0
    ? `${named} Kept up, nights like that would take about ${Math.abs(points)} points off Recovery once the week catches up.`
    : `${named} Kept up, nights like that would add about ${points} points to Recovery once the week catches up.`;
}

/** Whether the reading sits on the favourable side of its own baseline. */
function onGoodSide(result, key) {
  const z = result.deviations?.[key];
  if (z == null) return false;
  return key === "restingHr" ? z < 0 : z > 0;
}

/**
 * How far last night has to fall below the week before it is worth naming.
 *
 * Twelve points, because the seven-night average moves by about two for a single
 * bad night, and anything smaller than this would put a sentence on the card for
 * ordinary night-to-night variation.
 */
const SLEEP_NIGHT_GAP = 12;

/** Below this a better sleep score is not worth naming a figure for. */
const SLEEP_NOISE_POINTS = 6;

/**
 * Whether the day is actually down, for the lines that should only appear then.
 *
 * LOW by band, or HRV genuinely outside its own range on the low side. The second
 * clause matters because a NORMAL day with HRV well down is still a day the
 * training explains, and the band alone would miss it.
 */
function scoreIsDown(result) {
  if (recoveryLabel(result.score) === "LOW") return true;
  const z = result.deviations?.hrv;
  return z != null && deviationBand(z, BASELINE_NIGHTS) !== "normal" && z < 0;
}

/**
 * The sleep score that would reach the next band on its own, or null.
 *
 * Sleep is the one term whose reading already *is* a 0-100 figure, so inverting it
 * needs no baseline: the term value and the score are the same number scaled.
 */
function sleepTargetScore(result) {
  const head = recoveryHeadroom(result);
  const current = result?.terms?.sleep;
  if (!head || current == null) return null;
  const target = RECOVERY_BANDS.find((b) => b.label === head.nextLabel)?.min;
  if (target == null) return null;

  const present = Object.entries(result.terms).filter(([, v]) => v != null);
  const totalWeight = present.reduce((sum, [k]) => sum + RECOVERY_WEIGHTS[k], 0);
  const others = present.reduce(
    (sum, [k, v]) => (k === "sleep" ? sum : sum + RECOVERY_WEIGHTS[k] * v),
    0
  );
  const neededTerm = ((target / 100) * totalWeight - others) / RECOVERY_WEIGHTS.sleep;
  if (!(neededTerm > current) || neededTerm > 1) return null;
  return { reading: Math.ceil(neededTerm * 100) };
}

/**
 * Which way a term has to move to score better, and whether its baseline is
 * held in log space. HRV is the only log one, matching how its baseline is
 * built; resting HR reads better when it falls.
 */
const DEVIATION_TERMS = {
  hrv: { higherIsBetter: true, log: true },
  restingHr: { higherIsBetter: false, log: false },
};

/**
 * The reading a single term would need for the score to reach the next band,
 * holding every other term exactly where it is.
 *
 * Every step from a reading to a score is invertible: the term needed follows
 * from the weights, the z-score from deviationToScore's `0.5 + directed/4`, and
 * the reading from the baseline. So "what would be enough" is arithmetic rather
 * than a guess, and saying it out loud is a readout, not advice.
 *
 * Generalised from an HRV-only version, which is why the page could only ever
 * talk about HRV: resting HR can close a gap too, and on a day where it is the
 * term sitting mid-range it is the more honest thing to name.
 *
 * **Returns null rather than a figure in every case where one would mislead**,
 * and there are four of them:
 *  - the score is already in the top band, so there is no next one;
 *  - the term is missing today, so it has no baseline to reason from;
 *  - the term is already at full strength and has nothing left to give;
 *  - the gap is wider than this term can close even saturated, which is two
 *    standard deviations out.
 *
 * @returns {{reading: number, direction: "higher"|"lower", delta: number}|null}
 */
export function termTarget(result, key) {
  const spec = DEVIATION_TERMS[key];
  const head = recoveryHeadroom(result);
  const base = result?.baselines?.[key];
  const current = result?.terms?.[key];
  const reading = result?.readings?.[key];
  if (!spec || !head || base == null || current == null || reading == null) return null;

  // `scaledMean`/`scaledSd` are the transformed pair for a log metric and the
  // plain pair for a linear one, so only the way back out differs. There is no
  // separate `sd` field on a baseline; reaching for one silently yields NaN.
  if (!base.scaledSd) return null;

  // Worked from the raw terms and weights rather than from the breakdown's
  // rounded points. Rounding twice on the way to a band boundary is enough to
  // name a figure landing a point short of the band it just promised, which the
  // round-trip test catches.
  const present = Object.entries(result.terms).filter(([, v]) => v != null);
  const totalWeight = present.reduce((sum, [k]) => sum + RECOVERY_WEIGHTS[k], 0);
  const others = present.reduce(
    (sum, [k, v]) => (k === key ? sum : sum + RECOVERY_WEIGHTS[k] * v),
    0
  );

  const target = RECOVERY_BANDS.find((b) => b.label === head.nextLabel)?.min;
  if (target == null) return null;

  const neededTerm = ((target / 100) * totalWeight - others) / RECOVERY_WEIGHTS[key];
  // Saturated, or already met. Both mean this term is not the answer.
  if (!(neededTerm > current) || neededTerm > 1) return null;

  // deviationToScore directs the z-score before scoring it, so inverting has to
  // undo that too, or a lower resting HR would be reported as a higher one.
  const directedZ = (neededTerm - 0.5) * 4;
  const neededZ = spec.higherIsBetter ? directedZ : -directedZ;

  const scaled = base.scaledMean + neededZ * base.scaledSd;
  const needed = spec.log ? Math.exp(scaled) : scaled;

  // Rounded AWAY from the current reading, never to nearest: this is an "at
  // least this much" figure, and rounding the wrong way names a number that
  // lands just short of the band it promises.
  const rounded = spec.higherIsBetter ? Math.ceil(needed) : Math.floor(needed);
  const delta = Math.abs(rounded - reading);
  // A target the reading has already passed is not a target. Can happen at the
  // rounding boundary when a term is a hair off.
  if (spec.higherIsBetter ? rounded <= reading : rounded >= reading) return null;

  return { reading: rounded, direction: spec.higherIsBetter ? "higher" : "lower", delta };
}

/**
 * Kept as a thin wrapper because the metric page and the tests both ask the
 * question in percentage terms, and it now has one definition rather than two.
 */
export function hrvGapPercent(result) {
  const target = termTarget(result, "hrv");
  const mean = result?.baselines?.hrv?.mean;
  if (!target || !mean) return null;
  const pct = Math.ceil((target.reading / mean - 1) * 100);
  return pct > 0 ? pct : null;
}

/**
 * The sentence about the baseline itself moving, or null on a steady week.
 *
 * Deliberately about the *score* and not about the body. A falling baseline
 * here turned out to be a training block responding exactly as it should, and
 * a version of this that called that a warning is a rejected ticket. This one
 * says only why an ordinary day is landing below the middle, which is a fact
 * about the arithmetic.
 */
export function baselineNote(result) {
  const now = result?.baselines?.hrv?.mean;
  const before = result?.hrvBaselineBefore?.mean;
  if (!now || !before) return "";

  const change = (now - before) / before;
  if (Math.abs(change) < BASELINE_SHIFT_NOTABLE) return "";

  // Named and given its units. It read "That baseline is still catching up with
  // you: 111 a week ago, 91 now", where "that baseline" pointed at nothing on
  // screen and 111 was a number with no idea what it measured.
  return change < 0
    ? `The HRV average you are judged against is still coming down: ${Math.round(before)} MS a week ago, ${Math.round(now)} MS now. Some of the low scores are that gap closing rather than anything new.`
    : `The HRV average you are judged against is still climbing: ${Math.round(before)} MS a week ago, ${Math.round(now)} MS now. Scores sit low until your readings catch up with it.`;
}

export const TERM_LABEL = {
  hrv: { label: "HRV", unit: "MS" },
  restingHr: { label: "REST HR", unit: "BPM" },
  sleep: { label: "SLEEP", unit: "" },
};

/**
 * The score, itemised: what each term was, and how many points it put in.
 *
 * `points` out of `maxPoints` is the honest framing. A weight on its own does
 * not explain a score, because a term at 50% weight scoring badly and one at
 * 25% weight scoring perfectly can leave the same dent. The pair says both how
 * much a term counted and how well it did.
 *
 * `maxPoints` uses the redistributed weight, not the nominal one, so the
 * figures still add up to the score on a day when a term is missing.
 */
export function recoveryBreakdown(result) {
  if (!result || result.state !== "ready") return [];

  const present = Object.entries(result.terms).filter(([, v]) => v != null);
  const totalWeight = present.reduce((sum, [key]) => sum + RECOVERY_WEIGHTS[key], 0);

  return present.map(([key, term]) => {
    const share = RECOVERY_WEIGHTS[key] / totalWeight;
    const z = result.deviations?.[key] ?? null;
    return {
      key,
      label: TERM_LABEL[key].label,
      unit: TERM_LABEL[key].unit,
      reading: result.readings?.[key] ?? null,
      baseline: result.baselines?.[key]?.mean ?? null,
      goal: key === "sleep" ? (result.sleepGoalHours ?? null) : null,
      deviation: z,
      band: z == null ? null : deviationBand(z),
      term,
      points: Math.round(share * term * 100),
      maxPoints: Math.round(share * 100),
      // Nominal weight is worth showing separately: it is the fixed design of
      // the score, while maxPoints is what it became on this particular day.
      nominalWeight: Math.round(RECOVERY_WEIGHTS[key] * 100),
      redistributed: share !== RECOVERY_WEIGHTS[key],
    };
  });
}

/**
 * One plain sentence explaining today's score, for the TODAY card.
 *
 * Names the term that moved it rather than restating the number, because the
 * number is already on the dial directly above.
 */
export function recoveryExplanation(result) {
  if (!result || result.state === "calibrating") {
    const left = Math.max(0, result.needed - result.nights);
    return `Learning your baseline. ${left} more ${left === 1 ? "night" : "nights"} before Recovery can mean anything.`;
  }
  if (result.state === "no-data") return "No readings from the strap for today yet.";

  const { deviations, terms } = result;

  // **Each term says which way it went AND whether that is good.** "HRV is
  // toward the high end of its range" is a true statement that reads as a
  // warning, because every other sentence on this card is about something being
  // off. A reading on the favourable side has to say so, or the one line Home
  // gives the score spends itself making good news sound like bad.
  //
  // Resting heart rate is named whenever it has left its usual range in EITHER
  // direction. It used to appear only when elevated, so the card could discuss
  // HRV and sleep and stay silent about a quarter of the score.
  const good = [];
  const off = [];

  const hrv = deviationBand(deviations.hrv);
  if (hrv === "low") off.push("HRV is below your usual range");
  else if (hrv === "slightly-low") off.push("HRV is toward the low end of its range");
  else if (hrv === "high") good.push("HRV is above your usual range");
  else if (hrv === "slightly-high") good.push("HRV is toward the high end of its range");

  const rhr = deviationBand(deviations.restingHr);
  if (rhr === "high") off.push("resting heart rate is elevated");
  else if (rhr === "slightly-high") off.push("resting heart rate is a little up");
  // "Low" is the wrong word here even though it is the right direction. A
  // resting heart rate described as low reads as a symptom, and this line is
  // supposed to be reporting good news. "Down on" says the same thing as a
  // movement rather than as a state, which is what it actually is.
  else if (rhr === "low") good.push("resting heart rate is well down on your usual");
  else if (rhr === "slightly-low") good.push("resting heart rate is down on your usual");

  // **A bad night has to be named even though the term barely moves.**
  //
  // Recovery's sleep term is a seven-night average, so one short night changes
  // it by a point or two. That is deliberate - a condition score should not
  // swing 25 points on a single night - but the effect on screen was the score
  // saying nothing at all about a night the sleep page was calling bad, which
  // reads as the two disagreeing rather than as one of them taking a longer
  // view. So when last night is well under the week, the line says exactly
  // that, and the two numbers explain each other.
  const weekly = terms.sleep != null ? Math.round(terms.sleep * 100) : null;
  const lastNight = result.lastNightScore ?? null;
  if (weekly != null && lastNight != null && weekly - lastNight >= SLEEP_NIGHT_GAP) {
    off.push(`last night scored ${lastNight} against ${weekly} for the week`);
  } else if (terms.sleep != null && terms.sleep < 0.7) {
    off.push("sleep has been short");
  }

  // The good news carries its own verdict, once, at the end of its own clause.
  // Tagging every item would read as an argument with itself on a mixed day.
  const parts = [...off];
  if (good.length) {
    const lead = good.join(" and ");
    const verdict = off.length
      ? "which is in your favour"
      : good.length > 1
        ? "both good signs"
        : "which is a good sign";
    parts.push(`${lead}, ${verdict}`);
  }

  if (parts.length) {
    const lead = parts.join(", ");
    return `${lead.charAt(0).toUpperCase()}${lead.slice(1)}.`;
  }

  // Nothing is individually notable, and the score can still land low: the
  // bands are coarse and the scoring is continuous, so three terms each a
  // little under their own normal add up to a number none of them explains.
  // "Everything sits inside your usual ranges" printed under a LOW badge read
  // as two sentences arguing with each other.
  // Scoped to LOW deliberately. At NORMAL the badge and the sentence agree -
  // an ordinary day is meant to land there - so only the bottom band produces
  // the contradiction worth rewording.
  if (result.label === "LOW") {
    return "Nothing is off on its own. Everything is a little under your normal at once, and that is what the score adds up to.";
  }
  return "Everything sits inside your usual ranges.";
}
