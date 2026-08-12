import { defineStore } from "pinia";
import { computed, reactive, ref, watchEffect } from "vue";
import { load, persist } from "@/utils/storage";
import { DURATION_FULL } from "@/utils/sleepScore";

const KEY = "atlas_goals";

/**
 * The eight daily targets, and whether each one is being kept at all.
 *
 * **This replaced a frozen `GOALS` constant in `checkin.js` plus two more
 * hardcoded in `metricRegistry`** (steps at 8000, PAI at 100), which is why the
 * two sets had already drifted into different files with no relationship. All
 * eight live here now, in one shape.
 *
 * **`enabled` is not a nicety.** Creatine is a supplement most people do not
 * take, and a permanent `0 / 5G` row is somebody else's app showing through.
 * Off removes the row rather than greying it or showing zero, which is
 * `RoutineCard`'s existing rule: a bar of zero over one reads as a goal missed,
 * not as a goal absent.
 *
 * Values are stored in the app's own units and converted for display, never the
 * other way round. See `metricRegistry.formatValue`.
 */
export const DEFAULT_GOALS = {
  // **PAI is not here either.** 100 is PAI's own published threshold, the
  // number the whole metric is defined around, so a control to change it is a
  // control nobody will ever touch and one more row to read past.

  // **Sleep is deliberately not here**, and it was, briefly. `sleepScore` judges
  // a night against the clinical 7-9h band and your own habitual median, and it
  // explicitly refuses to use a user-set figure: an 8h floor docked anyone
  // habitually sleeping 7.5h and was unreleasable. So a sleep goal was a target
  // nothing scored against - a control that looked like it did something and
  // did not. The one place a number is still needed is Recovery's fallback term
  // for a night too early to score, and that reads `DURATION_FULL` now.

  // Published guideline figures, so a new user starts on something defensible
  // rather than on one person's numbers.
  water: { enabled: true, value: 2.5 }, // litres, EFSA/NHMRC adult intake
  fibre: { enabled: false, value: 30 }, // grams, UK/AU dietary guideline
  steps: { enabled: true, value: 8000 }, // matches the routine's own step habit

  // **Chosen, not derived, and these two are the weakest defaults here.**
  // Deriving them from the profile was designed and deliberately dropped for
  // speed, so these stand in until the user types their own: 2,000 kcal is the
  // reference intake food labels are built on, and 120g protein is a middle
  // figure that suits someone who trains without being anybody's in particular.
  // Both are meant to be replaced, which is why the prompt asks early.
  calories: { enabled: true, value: 2000 },

  // **Off to begin with.** Protein, fibre and creatine are all things somebody
  // decides to track rather than things everybody tracks, and three rows of
  // 0/120G on a Home screen belonging to a person who has never thought about
  // protein is the app telling them they are failing at something they never
  // took up. Calories, water and steps stay on because they are the three
  // anybody who installed a health app expects to see.
  protein: { enabled: false, value: 120 },
  creatine: { enabled: false, value: 5 },
};

export const GOAL_KEYS = Object.keys(DEFAULT_GOALS);

export const useGoalsStore = defineStore("goals", () => {
  // Merged over the defaults rather than replacing them, so a goal added in a
  // later version appears for someone who already has a stored record instead
  // of being silently absent.
  const stored = load(KEY, {});
  const goals = ref(
    Object.fromEntries(
      GOAL_KEYS.map((key) => [key, { ...DEFAULT_GOALS[key], ...(stored[key] ?? {}) }])
    )
  );

  /**
   * Anything already being logged keeps its row, whatever the default says.
   *
   * The defaults are about a *new* install. Applying them to a phone with months
   * of entries would delete rows somebody uses, silently, on the launch after an
   * update. Read from storage rather than through `useCheckinStore`, because a
   * store reaching into another store to build its own initial state would make
   * the order they are first used matter.
   *
   * Runs once: it writes a record, and a record present means never again.
   */
  if (!Object.keys(stored).length) {
    const entries = load("atlas_checkins", []);
    for (const key of GOAL_KEYS) {
      if (goals.value[key].enabled) continue;
      if (entries.some((e) => (e?.[key] ?? 0) > 0)) {
        goals.value[key] = { ...goals.value[key], enabled: true };
      }
    }
    persist(KEY, goals.value);
  }

  const save = () => persist(KEY, goals.value);

  /** The target, or null when the goal is switched off. */
  function valueFor(key) {
    const g = goals.value[key];
    if (!g || !g.enabled) return null;
    return g.value;
  }

  function isEnabled(key) {
    return Boolean(goals.value[key]?.enabled);
  }

  function setValue(key, value) {
    const g = goals.value[key];
    if (!g) return;
    const n = Number(value);
    // A goal of zero or less is not a goal, it is the row switched off, and
    // storing it would divide by zero in every percentage on the screen.
    if (!Number.isFinite(n) || n <= 0) return;
    goals.value = { ...goals.value, [key]: { ...g, value: n } };
    save();
  }

  function setEnabled(key, enabled) {
    const g = goals.value[key];
    if (!g) return;
    goals.value = { ...goals.value, [key]: { ...g, enabled: Boolean(enabled) } };
    save();
  }

  /**
   * The eight targets as a plain reactive object, `{ sleep: 8, creatine: null }`.
   *
   * **A `reactive` object rather than a computed ref on purpose.** It is what
   * the components read, and it means `GOALS.protein` keeps working unchanged
   * in both `<script>` and `<template>` where a ref would need `.value` in one
   * of them and not the other. That difference was going to be twenty-odd
   * hand-edited call sites and one of them silently reading `undefined`.
   *
   * **A switched-off goal is `null` here, never 0.** Zero is a target you have
   * failed; null is a target you are not keeping, and every consumer has to be
   * able to tell those apart to know whether to draw the row at all.
   */
  const values = reactive({});
  watchEffect(() => {
    for (const key of GOAL_KEYS) values[key] = valueFor(key);
  });

  /** Whether anything has been changed from the defaults, for the setup prompt. */
  const isUntouched = computed(() =>
    GOAL_KEYS.every(
      (key) =>
        goals.value[key].value === DEFAULT_GOALS[key].value &&
        goals.value[key].enabled === DEFAULT_GOALS[key].enabled
    )
  );

  return { goals, values, valueFor, isEnabled, setValue, setEnabled, isUntouched };
});

/**
 * The target, or its default when the goal is switched off.
 *
 * **For the places a reference is needed whether or not you are keeping a
 * target.** Recovery's sleep term measures last night against a figure
 * (`sleepTerm(today.sleep, sleepGoalHours, ...)`), so switching the sleep goal
 * off would otherwise pass null into the score and break a number that has
 * nothing to do with whether you are tracking sleep as a goal.
 *
 * Use `valueFor` everywhere else. Somewhere that draws a row is asking "am I
 * keeping this target", and null is the answer it needs.
 *
 * Open question this papers over rather than settles: whether that sleep term
 * should be reading a user-set goal at all, given `sleepScore` deliberately
 * stopped using one (an 8h floor docked anyone habitually sleeping 7.5h and was
 * unreleasable). See docs/backlog.md.
 */
export function goalOrDefault(key) {
  // Sleep has no user goal at all any more. Recovery's fallback term still
  // needs a figure for a night too early for the sleep score, and the clinical
  // floor is the defensible one: 7 hours is where NSF and AASM both draw the
  // line, where an 8 was only ever somebody's preference.
  if (key === "sleep") return DURATION_FULL;
  const store = useGoalsStore();
  return store.valueFor(key) ?? DEFAULT_GOALS[key]?.value ?? null;
}

/**
 * The target outside a component, where a store may not be active.
 *
 * `metricRegistry` is a plain module whose `goal` fields are read by tests that
 * never create a Pinia, so this falls back to the default rather than throwing.
 * A wrong-but-sane number in a test beats every consumer needing a store.
 */
export function goalValue(key) {
  try {
    return useGoalsStore().valueFor(key);
  } catch {
    const d = DEFAULT_GOALS[key];
    return d && d.enabled ? d.value : null;
  }
}
