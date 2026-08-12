// One description per metric, for every screen that shows one.
//
// Before this there were two: BODY_GROUPS for the wearable readings and a
// private METRIC_DEFS inside TrendsTab for the logged ones, each with its own
// detail sheet. The same metric could therefore be labelled, formatted and
// windowed two different ways depending on which screen you reached it from,
// and sleep genuinely was: "SLEEP" in one and "SLEEP // 14D" in the other.
//
// Everything a screen needs to render a metric is here. Which family it belongs
// to still comes from families.js, because that is the source of truth for
// colour and nothing should be able to disagree with it.

import { goalValue } from "@/stores/goals";
import { familyOf } from "@/utils/families";
import { unitFor } from "@/stores/units";
import { formatWeight, formatTemperature } from "@/utils/unitConvert";
import { fmtHoursMins } from "@/utils/date";
import { DURATION_FULL } from "@/utils/sleepScore";

/**
 * How far back that metric's history chart looks.
 *
 * Per metric, because the right window is a property of how fast the number
 * moves rather than a global preference:
 *
 *   14  a fortnight is a pattern; a month of nightly bars is a smear
 *   30  the baseline itself is 7 nights, so a window has to run well past it
 *       before you can see the baseline move. Also what PAI needs, since PAI
 *       is already a rolling 7-day score and a short window would show mostly
 *       its own smoothing
 *   90  weight moves in kilograms per month. A fortnight of it is scale noise
 */
export const WINDOW = { SHORT: 14, MEDIUM: 30, LONG: 90 };

/**
 * `source` decides where a reading is read from and is easy to get wrong:
 * `checkin` metrics live on the daily entry, `samples` come from the rollups.
 * A wrong source renders blank rather than erroring.
 *
 * `chart` is bar for anything with a target to hit and line for anything
 * judged against itself.
 */
export const METRICS = {
  sleep: {
    key: "sleep",
    label: "SLEEP",
    source: "checkin",
    format: "hours",
    // The clinical floor, not a goal you set. Sleep is scored against the
    // 7-9h band and your own habitual median, so a user-set target would draw a
    // line on the chart that nothing is judged against.
    goal: DURATION_FULL,
    step: 0.25,
    editable: true,
    chart: "bar",
    window: WINDOW.SHORT,
    info: "Hours actually asleep, measured by the strap rather than counted from when you went to bed.\n\nRecovery uses the average of your sleep scores over the last seven nights, not last night alone. It is a score about what condition you are in, and a week is a condition where one night is an event: at a quarter of the weight a single bad night could otherwise drag it twenty-five points.\n\nLast night on its own is still what the dial on Home and the whole sleep page show you, which is where a number you can act on belongs.",
    detail: {
      label: "WHAT MOVES IT",
      items: [
        "When you go to bed. This moves it more than when you get up does.",
        "A late meal, or a drink. Both cut the deep and REM share, so nine hours can score no better than eight.",
      ],
    },
  },
  hrv: {
    key: "hrv",
    label: "HRV",
    source: "samples",
    unit: " MS",
    chart: "line",
    window: WINDOW.MEDIUM,
    info: "Heart rate variability, measured overnight.\n\nThere is no target. What matters is where tonight sits against your own recent normal, which is why it is drawn against a band.\n\nIt answers over days, not hours. Tonight's reading is about the days behind it, not about anything you did since.",
    detail: {
      label: "WHAT MOVES IT",
      items: [
        "Training in the days before. A hard session lowers it the next morning, and a block of them can hold it down for a week. That is your body responding as it should.",
        "Eating late. Digesting overnight keeps the heart working.",
        "An irregular bedtime. This counts for more than an extra hour in bed.",
        "A warm room, or not drinking enough water. Each one pushes it down a little.",
        "Illness on the way. A drop you cannot explain often comes the day before you feel it.",
      ],
    },
  },
  hr: {
    key: "hr",
    label: "HEART RATE",
    source: "samples",
    unit: " BPM",
    chart: "line",
    window: WINDOW.MEDIUM,
    info: "Your heart rate through the day, about 1,400 readings of it.\n\nThe daily figure averages all of them, which mixes a night at 50 with a session at 170. The shape is what this page is for.",
    detail: {
      label: "WHAT TO LOOK FOR",
      items: [
        "How low it settles overnight.",
        "How long it takes to come down after training.",
        "Stretches of the day sitting higher than the rest of it.",
        "A resting rate climbing over weeks while training has not changed. That is the same signal resting HR carries.",
      ],
    },
  },
  restingHr: {
    key: "restingHr",
    label: "RESTING HR",
    source: "samples",
    unit: " BPM",
    chart: "line",
    window: WINDOW.MEDIUM,
    info: "Your heart rate at its quietest overnight.\n\nIt is the confirmer for HRV. When a low HRV is real rather than noise, resting heart rate usually moves the other way.\n\nIt drifts down over weeks as fitness improves, so compare it against last month rather than against yesterday.",
    detail: {
      label: "WHAT MOVES IT",
      items: [
        "Everything that moves HRV, in the same direction: hard training in the days before, a late or heavy meal, a warm room, not drinking enough water, illness arriving.",
        "Caffeine late in the day. It shows here more clearly than in HRV.",
      ],
    },
  },
  respRate: {
    key: "respRate",
    label: "RESP RATE",
    source: "samples",
    unit: " BRPM",
    // Same reason as SpO2: a day's breathing rate averages to something like
    // 14.3, and whole numbers hid every difference the day list draws.
    format: "decimal1",
    chart: "line",
    window: WINDOW.MEDIUM,
    info: "Breaths per minute during sleep. Flat almost every day, then a sharp jump that usually means illness, which is why it is a flag here rather than a term in the Recovery score.",
  },
  spo2: {
    key: "spo2",
    label: "SPO2",
    source: "samples",
    // A decimal, because a day's figure is an average of hundreds of readings
    // and every real day lands between 96 and 99. Rounded to whole percent the
    // metric page showed a column of identical 98% beside deviation bars of
    // visibly different lengths, which reads as the bars being wrong when it
    // was the numbers hiding the variation they were drawn from.
    format: "decimal1",
    unit: "%",
    chart: "line",
    window: WINDOW.MEDIUM,
  },
  skinTemp: {
    key: "skinTemp",
    label: "SKIN TEMP",
    source: "samples",
    format: "decimal1",
    // Matches homeModel, which already printed the degree sign. formatValue
    // intercepts this metric for the C/F conversion, so the suffix here is only
    // for anything reading def.unit directly.
    unit: "°C",
    chart: "line",
    window: WINDOW.MEDIUM,
  },
  stress: {
    key: "stress",
    label: "STRESS",
    source: "samples",
    chart: "line",
    window: WINDOW.MEDIUM,
    info: "Derived from heart rate variability, not from anything the band knows about your day. A spike tracks strain generally: a hard workout reads the same as a stressful meeting.",
  },
  weight: {
    key: "weight",
    label: "WEIGHT",
    source: "checkin",
    format: "decimal1",
    unit: "KG",
    step: 0.1,
    editable: true,
    chart: "line",
    window: WINDOW.LONG,
  },
  water: {
    key: "water",
    label: "WATER",
    source: "checkin",
    unit: "L",
    format: "decimal1",
    get goal() {
      return goalValue("water");
    },
    step: 0.25,
    editable: true,
    chart: "bar",
    window: WINDOW.SHORT,
  },
  calories: {
    key: "calories",
    label: "CALORIES",
    source: "checkin",
    unit: " KCAL",
    format: "count",
    get goal() {
      return goalValue("calories");
    },
    step: 50,
    editable: true,
    // Diary plus a manual extra, exactly like protein and fibre: the day's food
    // supplies most of it and the editor adds anything that was not logged.
    composite: true,
    // The food store calls this `kcal` and the user calls it calories. Named
    // here rather than mapped at each reader, since there are three of them.
    diaryKey: "kcal",
    chart: "bar",
    window: WINDOW.SHORT,
    info: "Everything logged for the day, plus anything you add by hand.\n\nThere is no derivation behind the target: it is the figure you typed. Atlas does not estimate what you burn, because it would be guessing at an activity level it cannot measure and then presenting the guess as a budget.",
  },
  protein: {
    key: "protein",
    label: "PROTEIN",
    source: "checkin",
    unit: "G",
    get goal() {
      return goalValue("protein");
    },
    step: 5,
    editable: true,
    // Diary plus a manual extra, so the editor has to say which one it edits.
    composite: true,
    chart: "bar",
    window: WINDOW.SHORT,
  },
  fibre: {
    key: "fibre",
    label: "FIBRE",
    source: "checkin",
    unit: "G",
    get goal() {
      return goalValue("fibre");
    },
    step: 1,
    editable: true,
    composite: true,
    chart: "bar",
    window: WINDOW.SHORT,
  },
  creatine: {
    key: "creatine",
    label: "CREATINE",
    source: "checkin",
    unit: "G",
    get goal() {
      return goalValue("creatine");
    },
    // One tap is one dose, so the stepper follows the target rather than
    // being a second number that can disagree with it.
    get step() {
      return goalValue("creatine") ?? 5;
    },
    editable: true,
    chart: "bar",
    window: WINDOW.SHORT,
  },
  steps: {
    key: "steps",
    label: "STEPS",
    source: "samples",
    format: "count",
    // 8,000, matching the routine's own step habit. It was 10,000 here while the
    // habit said 8k, so the two screens disagreed about the same target.
    get goal() {
      return goalValue("steps");
    },
    chart: "bar",
    window: WINDOW.MEDIUM,
  },
  pai: {
    key: "pai",
    label: "PAI",
    source: "samples",
    // A threshold to cross rather than a bar to fill: PAI's own literature puts
    // 100 as the line linked to lower cardiovascular risk, and exceeding it is
    // the point.
    // Fixed at PAI's own published threshold rather than read from the goals,
    // because 100 is what the metric is defined around: it is the line, not a
    // preference.
    goal: 100,
    chart: "bar",
    // **No trailing mean over it.** Every other bar chart here draws one, and on
    // PAI it would be a seven-day mean of a figure that is already a rolling
    // seven-day score - a mean of a mean, smoothing something that is smooth by
    // construction, and drawn in the same weight as the honest ones elsewhere.
    meanLine: false,
    window: WINDOW.MEDIUM,
    info: "Personal Activity Intelligence: a rolling 7-day score built from how hard and how long your heart rate runs elevated, not from steps or workouts directly. 100+ is the threshold the studies behind it link to lower cardiovascular risk.",
  },
};

export function metric(key) {
  return METRICS[key] ?? null;
}

/**
 * A reading as text.
 *
 * `null` means nothing was recorded, and it must never render as zero: zero is
 * a real reading for stress and PAI, and an idle-but-worn day rolls up to null
 * for steps. Collapsing the two would report "you took no steps" for a day the
 * strap simply had nothing to say.
 */
export function formatValue(def, value, { empty = "--" } = {}) {
  if (value == null) return empty;
  // **The one place a stored value becomes a displayed one, which is the only
  // place a unit conversion may happen.** Storage stays metric: a conversion
  // anywhere upstream would mean switching units twice walks the archive
  // through two roundings, invisibly and with no undo. See utils/unitConvert.
  if (def.key === "weight") return formatWeight(value, unitFor("weight"));
  if (def.key === "skinTemp") return formatTemperature(value, unitFor("temperature"));
  if (def.format === "hours") return fmtHoursMins(value);
  if (def.format === "count") return Math.round(value).toLocaleString("en-AU");
  if (def.format === "decimal1") {
    return `${(Math.round(value * 10) / 10).toFixed(1)}${def.unit ?? ""}`;
  }
  return `${Math.round(value)}${def.unit ?? ""}`;
}

/**
 * A metric's reading for one date, from whichever source owns it.
 *
 * Both sources key off the same date rather than array position. Reading the
 * samples branch positionally meant "today" could mean two different days at
 * once, because the checkin branch resolves live while the window is a snapshot
 * from whenever it last loaded: an overnight resume showed sleep as NO DATA
 * beside eight rows of yesterday's numbers labelled as today's.
 */
export function valueForDate(def, dateKey, dayValues, entryFor) {
  if (def.source === "checkin") return entryFor(dateKey)?.[def.key] ?? null;
  return dayValues?.[def.key] ?? null;
}

/** Every metric belonging to one colour family, in registry order. */
export function metricsInFamily(family) {
  return Object.values(METRICS).filter((m) => familyOf(m.key) === family);
}
