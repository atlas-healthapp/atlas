import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

const HelioBle = registerPlugin("HelioBle");

// The one key the native side reads for anything it has to draw without the
// WebView: the ongoing notification, and later a home-screen widget.
//
// It exists because **nothing native can reach the app's data**. Habits and
// check-ins live in localStorage and the sample archive lives in IndexedDB,
// both inside the WebView; a notification is rebuilt by a service that may be
// running while no WebView exists at all, and a widget is RemoteViews built in
// Java. So the app publishes a small flat summary and the native side renders
// that, rather than either side reaching into the other's storage.
//
// Written through @capacitor/preferences, which lands in the "CapacitorStorage"
// SharedPreferences group - the same route MainActivity already uses to read
// the theme before the WebView exists.
const KEY = "atlas_summary_native";

/**
 * Publish today's headline numbers for the native surfaces.
 *
 * Fire-and-forget by design: this is a mirror of state the app already holds,
 * so a failed write costs a stale notification and nothing else. Never let it
 * throw into a component's render or watcher.
 */
export async function publishSummary(summary) {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    await Preferences.set({ key: KEY, value: JSON.stringify(summary) });
  } catch {
    return false;
  }
  // Writing is not enough: the service rebuilds its notification only at the end
  // of its own sync, so a summary published after a sync done *inside* the app
  // sat unread until the next background run half an hour later. Nudging it is
  // the whole reason the shade tracks the screen. Swallowed on failure for the
  // same reason the write is: a stale notification is not worth an exception.
  try {
    await HelioBle.refreshNotification();
  } catch {
    // service not running, or an older build without the method
  }
  return true;
}

/**
 * A bar fill, 0-100, or null when there is nothing to draw.
 *
 * Withheld rather than zeroed when the reading or the goal is missing, for the
 * same reason the scores withhold a term: a bar drawn empty says the day went
 * badly, and "no reading yet" is not a bad day. Clamped at 100 because a bar
 * past its own track is a drawing bug, and the figure beside it still shows the
 * overshoot.
 */
function fillPct(value, goal) {
  if (value == null || !goal || goal <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((value / goal) * 100)));
}

/**
 * The shape the native side parses. Kept as one function so the contract lives
 * in one place: adding a field here means adding it in
 * `HelioSyncService.buildNotification` (and the widget) or it is simply ignored.
 *
 * Every value is already formatted or a plain number - the native side does no
 * maths, because two implementations of the same rounding is how a widget ends
 * up disagreeing with the screen it mirrors. That is why the bar fills are
 * computed here and published as percentages: a notification layout that
 * divided a reading by a goal would be the second implementation.
 */
export function buildSummary({
  steps,
  stepsGoal,
  routineDone,
  routineDue,
  recovery,
  recoveryBand,
  sleepText,
  sleepHours,
  sleepGoal,
  protein,
  proteinGoal,
  nextHabit,
  syncedAt,
  strapBattery,
}) {
  const done = routineDone ?? 0;
  const due = routineDue ?? 0;
  return {
    steps: steps ?? null,
    stepsGoal: stepsGoal ?? null,
    stepsPct: fillPct(steps, stepsGoal),
    routineDone: done,
    routineDue: due,
    routinePct: fillPct(done, due),
    recovery: recovery ?? null,
    recoveryBand: recoveryBand ?? null,
    // Recovery is already a score out of 100, so its own value is the fill.
    recoveryPct: recovery == null ? null : Math.max(0, Math.min(100, Math.round(recovery))),
    sleepText: sleepText ?? null,
    sleepPct: fillPct(sleepHours, sleepGoal),
    protein: protein ?? null,
    proteinGoal: proteinGoal ?? null,
    proteinPct: fillPct(protein, proteinGoal),
    nextHabit: nextHabit ?? null,
    // The app's own last sync, which the background service cannot see. It
    // compares this against its own and shows whichever ran later, so the shade
    // reports the sync that actually happened most recently rather than the one
    // that happened to draw the notification.
    syncedAt: syncedAt ?? null,
    strapBattery: strapBattery ?? null,
    at: Date.now(),
  };
}
