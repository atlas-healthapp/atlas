// Shared vocabulary for sleep stages, so the Home row, the detail sheet and
// the decoder cannot disagree about what the stages are or what order they go
// in. huamiSleep.js produces these keys; everything downstream reads them.

/**
 * Deep first, awake last. This is depth order, not chronological order, and it
 * is what both the composition bar and the sheet's legend lay out along, so a
 * glance at the row and a glance at the sheet agree about which end is which.
 */
export const STAGE_ORDER = ["deep", "light", "rem", "awake"];

export const STAGE_LABEL = {
  deep: "DEEP",
  light: "LIGHT",
  rem: "REM",
  awake: "AWAKE",
};

/**
 * Opacity steps for the single-colour variant used on Home, where the BODY
 * card has to read as one idea.
 *
 * Strength tracks depth: deep is the most solid, then REM, then light. The
 * first version had this inverted, with deep at 0.38 and REM at 1, so the
 * deepest sleep of the night rendered as the palest thing in the bar and read
 * as the least of it. Awake carries a value here for completeness but does not
 * use it, because it leaves the family hue entirely (see CompositionBar).
 */
export const STAGE_FAMILY_OPACITY = {
  deep: 1,
  light: 0.7,
  rem: 0.85,
  awake: 0.6,
};


/**
 * Row order for the hypnogram: awake at the top, deep at the bottom, so depth
 * is carried by vertical position as well as by hue. That redundancy is what
 * keeps the chart readable without colour, and it is why the Home row can draw
 * the same chart in a single family hue where a proportion bar could not.
 */
export const STAGE_ROW = { awake: 0, rem: 1, light: 2, deep: 3 };

/** Rows in the hypnogram, i.e. how many distinct depths it has. */
export const STAGE_ROWS = 4;

/**
 * Minutes in one stage, whatever the record happens to call it.
 *
 * The decoder names the awake stage `awake`, because that is the word the
 * timeline uses. The stored totals call the same thing `wake`, because that is
 * the field name in the record's footer. Both are already on disk and on the
 * user's phone, so this reconciles them in one place rather than renaming
 * stored data. Without it the sheet reported a night as 0% awake while drawing
 * awake segments in the chart directly above.
 */
export function stageMinutes(stages, key) {
  if (!stages) return 0;
  if (key === "awake") return stages.awake ?? stages.wake ?? 0;
  return stages[key] ?? 0;
}

/**
 * Total minutes asleep. Awake time inside a sleep window is not sleep, and
 * summing it in is how a night reads longer than it was.
 */
export function asleepMinutes(stages) {
  if (!stages) return 0;
  return stageMinutes(stages, "deep") + stageMinutes(stages, "light") + stageMinutes(stages, "rem");
}

/** Each stage's share of the night, for the sheet's legend. */
export function stagePercentages(stages) {
  const total = STAGE_ORDER.reduce((sum, key) => sum + stageMinutes(stages, key), 0);
  if (!total) return {};
  return Object.fromEntries(
    STAGE_ORDER.map((key) => [key, Math.round((stageMinutes(stages, key) / total) * 100)])
  );
}
