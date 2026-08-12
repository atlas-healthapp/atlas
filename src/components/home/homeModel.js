// What Home decides to show, kept separate from how it draws it.
//
// The rules here are the ones with judgement in them: which nights feed the
// baseline, and which body rows are worth a line of their own today. The
// component below is then only layout.

import { computeRecovery } from "@/utils/recovery";
import { computeSleepScore, habitualHours } from "@/utils/sleepScore";
import { nightsFrom, SRI_WINDOW_DAYS } from "@/utils/sleepRegularity";
import { addDays } from "@/utils/date";
import { typicalRange, BASELINE_NIGHTS } from "@/utils/baseline";
import { levelFrom } from "@/utils/level";
import { currentStreak } from "@/utils/streak";

/** Metrics that have a personal normal rather than a target. */
// Stress belongs here for the same reason the others do: it has no goal, only a
// personal normal, so the only useful thing Home can say about it is whether
// today is outside that. It is derived from HRV rather than measured
// separately, which makes it partly redundant - but it is the one of these that
// moves during the day rather than being set overnight, so an unusual reading
// is about today rather than about last night.
// All six the strap measures, not three. The collapsed row said "3 NORMAL" while
// six vitals were being carried, which understates what was actually checked and
// reads as three of them having gone missing.
//
// SpO2 and skin temperature earn their place as flags rather than as scores, the
// same distinction recovery.js draws when it excludes them: flat almost always,
// then a sharp excursion that means something specific. That is precisely the
// shape a row which only appears when a reading is unusual is built for.
// **In the BODY tab's order.** They were listed in the order they happened to be
// added, so the same vitals appeared in one order on Home and another one tab
// over, and a reader who learned where to look on one screen had to learn again
// on the other. `homeModel.test.js` asserts the two lists still agree, because
// nothing else would catch them drifting apart.
export const VITALS = [
  { key: "hrv", label: "HRV", unit: "MS" },
  { key: "restingHr", label: "REST HR", unit: "BPM" },
  // The day's mean heart rate, which mixes a night at 50 with a session at 170.
  // Included because it is one of the six and the count should be honest about
  // what was measured, but it is the likeliest of them to flag on an ordinary
  // training day: watch whether it earns its own row too often.
  { key: "hr", label: "HEART RATE", unit: "BPM" },
  { key: "respRate", label: "RESP RATE", unit: "BRPM" },
  // Always shown, unlike the others, which collapse into one line on an
  // ordinary day. Stress is the only vital that moves during the day rather
  // than being settled overnight, so it is a reading about right now in a way
  // the others are not - and it is the only one with a page worth opening.
  // Collapsing it meant it disappeared on exactly the ordinary days you would
  // check it on.
  { key: "stress", label: "STRESS", unit: "", alwaysShown: true },
  { key: "spo2", label: "SPO2", unit: "%" },
  { key: "skinTemp", label: "SKIN TEMP", unit: "°C" },
];

/**
 * Pull one metric's history out of a day window, oldest first, excluding
 * today.
 *
 * Excluding today is not tidiness. A baseline that contains the reading being
 * judged is dragged toward it, which flattens the very deviation the score is
 * trying to measure.
 */
export function historyFor(dayWindow, metric, todayKey) {
  return (dayWindow ?? [])
    .filter((d) => d.date < todayKey)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => d.values?.[metric] ?? null);
}

/** The metrics for one date, in the shape dailyValuesForRange returns. */
function valuesOn(dayWindow, dateKey) {
  return (dayWindow ?? []).find((d) => d.date === dateKey)?.values ?? {};
}

/**
 * Atlas's own sleep score for one night: the whole result, from one place.
 *
 * **The single definition, used by the sleep page, Home's dial and Recovery's
 * sleep term.** It has to be, and not only for tidiness: the score now depends on
 * a habitual-hours median, so two screens choosing their own window would compute
 * two different targets and show two different scores for the same night.
 *
 * **Everything is cut off at the date being scored.** Regularity compares each
 * night with the one before it and the median is "your usual night by then", so
 * feeding in later nights would score a past day using its own future, and the
 * number would change every time a newer night arrived.
 */
export function sleepResultFor({ entries, entry, todayKey }) {
  if (!entry?.sleep && !entry?.sleepStages) return null;
  const upto = (entries ?? [])
    .filter((e) => e.date <= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date));
  // Regularity is a property of its window, so the window is part of the shared
  // definition rather than each screen's own choice. Before this, Home scored
  // regularity over all of history and the sleep page over a week, which is two
  // different scores for one night.
  const sriFrom = addDays(todayKey, -(SRI_WINDOW_DAYS - 1));
  return computeSleepScore({
    hours: entry?.sleep ?? null,
    stages: entry?.sleepStages ?? null,
    nights: nightsFrom(upto.filter((e) => e.date >= sriFrom)),
    // Hours actually slept, the same quantity being scored. The bed-to-wake spans
    // on `nights` include time awake, so a median of those would read the habitual
    // night 10-30 minutes long.
    habitual: habitualHours(upto.map((e) => e.sleep)),
  });
}

/** Just the number, for the dial and the sleep page. */
export function sleepScoreFor(args) {
  const result = sleepResultFor(args);
  return result?.state === "ready" ? result.score : null;
}

/** Nights of sleep that make up Recovery's sleep term. */
export const SLEEP_TERM_NIGHTS = 7;

/**
 * Recent sleep rather than last night's, for Recovery only.
 *
 * In a score that means condition, last night was the one component still
 * answering "how was today" - and at a quarter of the weight, one bad night
 * could drag a condition reading by 25 points. A week is the state; a night is
 * an event.
 *
 * The nightly figure is not lost, it moves: Home's dial and the whole sleep page
 * still show last night, which is where an actionable number belongs. The cost,
 * accepted when this was agreed, is that Recovery stops reacting to a bad night
 * the way you might expect - so any screen showing this must say it is a week.
 *
 * Missing nights are skipped rather than counted as zero, and the average is
 * withheld entirely with nothing to average, so a first-time user falls back to
 * the duration term rather than being told their sleep scored nothing.
 */
export function recentSleepScore({ entries, todayKey, nights = SLEEP_TERM_NIGHTS }) {
  const scores = [];
  for (let i = 0; i < nights; i++) {
    const date = addDays(todayKey, -i);
    const entry = (entries ?? []).find((e) => e.date === date);
    if (!entry) continue;
    const score = sleepScoreFor({ entries, entry, todayKey: date });
    if (score != null) scores.push(score);
  }
  if (!scores.length) return null;
  return {
    score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    nights: scores.length,
  };
}

/**
 * Today's Recovery, assembled from the day window and the checkin entry.
 *
 * Sleep comes off the checkin entry rather than the sample rollups, because
 * that is where SP1a deliberately left it so Home and Trends kept working.
 */
export function recoveryFor({
  dayWindow,
  entry,
  todayKey,
  sleepGoalHours,
  entries = [],
  // Six months of rollups, for the level half of the score. Optional: without it
  // every term falls back to the deviation-only shape, which is what the app did
  // before condition scoring and what a new user sees for their first month.
  //
  // **Passed as a window rather than as a computed level on purpose.** A past day
  // has to be scored against the ceiling as it stood on that day, or every bar in
  // RECOVERY OVER TIME would be rescored the moment a new best arrived. Cutting
  // the window at the date being scored is what `historyFor` already does for the
  // baselines, so the two cannot disagree about which days counted.
  longWindow = null,
  profile = null,
}) {
  const todayValues = valuesOn(dayWindow, todayKey);
  const forLevels = longWindow ?? dayWindow;
  const recentSleep = recentSleepScore({ entries, todayKey });
  return computeRecovery({
    levels: {
      hrv: levelFrom(historyFor(forLevels, "hrv", todayKey)),
      restingHr: levelFrom(historyFor(forLevels, "restingHr", todayKey), {
        higherIsBetter: false,
      }),
    },
    profile,
    today: {
      hrv: todayValues.hrv ?? null,
      restingHr: todayValues.restingHr ?? null,
      sleep: entry?.sleep ?? null,
      sleepStages: entry?.sleepStages ?? null,
      // The week, not the night. See recentSleepScore.
      sleepScore: recentSleep?.score ?? null,
      sleepNights: recentSleep?.nights ?? 0,
      lastNightScore: sleepScoreFor({ entries, entry, todayKey }),
    },
    history: {
      hrv: historyFor(dayWindow, "hrv", todayKey),
      restingHr: historyFor(dayWindow, "restingHr", todayKey),
    },
    sleepGoalHours,
  });
}

/**
 * The BODY card's rows.
 *
 * Sleep always shows. The three vitals only earn their own row when they are
 * outside their usual range: on an ordinary day they collapse into one checked
 * line, which is what keeps Home at a glanceable length instead of listing
 * every metric the app holds. That listing is what the BODY tab is for.
 *
 * Before the baseline window fills there is no "usual range" to be outside of,
 * so each vital shows its bare value and says nothing it cannot support.
 */
/**
 * `showAllVitals` forces every measured vital to take its own row.
 *
 * A switch rather than a code change, because it exists to *look at* rows that
 * an ordinary day is designed to hide - there is no way to check the HRV row
 * renders correctly on a day HRV is perfectly normal, which is most days. Off by
 * default, so the collapse is what the tests measure and what ships; turned on
 * per device from `localStorage['atlas_show_all_vitals']`.
 */
export function bodyRows({ dayWindow, entry, todayKey, showAllVitals = false }) {
  const rows = [];
  const todayValues = valuesOn(dayWindow, todayKey);

  rows.push({
    kind: "sleep",
    key: "sleep",
    label: "SLEEP",
    hours: entry?.sleep ?? null,
    stages: entry?.sleepStages ?? null,
  });

  const assessed = [];
  for (const vital of VITALS) {
    const value = todayValues[vital.key] ?? null;
    // The window itself is carried, not just the range derived from it: the
    // range mark scales its axis to the readings rather than to the range,
    // which is what stops every vital drawing the same picture.
    const history = historyFor(dayWindow, vital.key, todayKey).filter((v) => v != null);
    assessed.push({ ...vital, value, range: typicalRange(history), history });
  }

  const measurable = assessed.filter((v) => v.value != null);
  const calibrating = measurable.filter((v) => !v.range);
  // A vital earns its own row by being unusual, or by being one that always
  // gets one.
  const outside = measurable.filter(
    (v) =>
      v.alwaysShown ||
      showAllVitals ||
      (v.range && (v.value < v.range.low || v.value > v.range.high))
  );

  // Nothing recorded yet today. Say that once rather than three times.
  if (!measurable.length) {
    rows.push({ kind: "empty", key: "vitals", label: "VITALS", text: "NO READINGS YET" });
    return rows;
  }

  // No baselines yet, so no claim about normal is available. Show the numbers.
  if (calibrating.length === measurable.length) {
    for (const v of measurable) {
      rows.push({
        kind: "plain",
        key: v.key,
        label: v.label,
        value: v.value,
        unit: v.unit,
      });
    }
    return rows;
  }

  for (const v of outside) {
    // An always-shown vital can reach here before its baseline has filled, and
    // a band drawn from a range that does not exist is a band drawn from
    // undefined. It shows its bare value until there is a normal to judge it
    // against, exactly as a calibrating vital does.
    rows.push(
      v.range
        ? {
            kind: "baseline",
            key: v.key,
            label: v.label,
            value: v.value,
            unit: v.unit,
            low: v.range.low,
            high: v.range.high,
            baseline: v.range.mean ?? null,
            history: v.history,
          }
        : { kind: "plain", key: v.key, label: v.label, value: v.value, unit: v.unit }
    );
  }

  // The rest, collapsed. This used to return early as soon as anything was
  // outside its range, so one unusual vital silently took the other three off
  // the screen - and a missing row is indistinguishable from a metric that was
  // never measured. With four vitals rather than three, that happened most
  // days. Whatever is not worth its own row still gets counted.
  const settled = measurable.filter((v) => !outside.includes(v));
  if (settled.length) {
    // Named individually this ran to "HRV, REST HR, RESP RATE ALL NORMAL",
    // which outgrew its row once the type scale went up. Listing them was
    // redundant anyway: the label already says VITALS, and the point of this
    // row is that none of them want your attention. The count stays because
    // "ALL NORMAL" on a day when only one was measured would overstate what
    // was actually checked.
    const allSettled = settled.length === measurable.length;
    rows.push({
      kind: "allNormal",
      key: "vitals",
      label: "VITALS",
      text:
        settled.length === 1
          ? "NORMAL"
          : `${allSettled ? "ALL " : ""}${settled.length} NORMAL`,
    });
  }
  return rows;
}

/**
 * How many days running each nutrition target has been met.
 *
 * Protein and fibre are read the same additive way Home displays them, diary
 * plus manual override, or a day logged entirely by hand would break a streak
 * it actually met. Creatine is included because a fixed daily dose is exactly
 * the kind of target a run of days means something for.
 */
export function nutritionStreaks({ checkin, food, goals, todayKey }) {
  const entryOn = (d) => checkin.entryFor(d) ?? {};
  return {
    water: currentStreak(todayKey, (d) => (entryOn(d).water ?? 0) >= goals.water),
    protein: currentStreak(
      todayKey,
      (d) => food.proteinFor(d) + (entryOn(d).protein || 0) >= goals.protein
    ),
    fibre: currentStreak(
      todayKey,
      (d) => food.fibreFor(d) + (entryOn(d).fibre || 0) >= goals.fibre
    ),
    creatine: currentStreak(todayKey, (d) => (entryOn(d).creatine ?? 0) >= goals.creatine),
  };
}

/**
 * Days running the step goal has been met.
 *
 * Capped by the day window rather than walking back forever: steps come from
 * the sample rollups, and a date with no row is indistinguishable from a day
 * the strap was not worn. Overstating a streak from missing data is worse than
 * understating one.
 */
export function stepsStreak({ dayWindow, todayKey, goal }) {
  const byDate = new Map((dayWindow ?? []).map((d) => [d.date, d.values ?? {}]));
  return currentStreak(todayKey, (d) => (byDate.get(d)?.steps ?? 0) >= goal, {
    maxDays: byDate.size,
  });
}

export { BASELINE_NIGHTS };
