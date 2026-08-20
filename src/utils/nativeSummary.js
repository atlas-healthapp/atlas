import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { stageMinutes } from "@/utils/sleepStages";
import { SLEEP_BANDS } from "@/utils/sleepScore";

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
 * A day's readings collapsed to one point per bucket, for the widgets that draw
 * a shape rather than a number.
 *
 * **48 buckets of half an hour, and the resolution is the point.** The band
 * reports heart rate about seven times a minute, which is thousands of readings
 * a day and four per pixel on a widget; 48 is what a 340dp sparkline can
 * actually resolve, and it costs under 200 bytes in a string native re-reads on
 * every redraw.
 *
 * **A bucket with nothing in it is null, never zero.** The strap comes off, and
 * a zero would draw as a heart rate of nothing. The widget's line breaks across
 * a gap instead, which is the rule `historyChart.js` already applies in the app.
 *
 * `cumulative` is for counts: steps want the shape of the day so far, so a flat
 * stretch reads as sitting still rather than as a gap.
 */
export function bucketSeries(
  samples,
  { from, buckets = 48, minutes = 30, agg = "mean", cumulative = false, minSamples = 1 } = {}
) {
  const width = minutes * 60000;
  const sums = new Array(buckets).fill(0);
  const counts = new Array(buckets).fill(0);

  for (const s of samples ?? []) {
    if (!s || typeof s.t !== "number" || typeof s.v !== "number") continue;
    const index = Math.floor((s.t - from) / width);
    if (index < 0 || index >= buckets) continue;
    sums[index] += s.v;
    counts[index] += 1;
  }

  const out = [];
  let running = 0;
  for (let i = 0; i < buckets; i++) {
    // **A mean of one reading is not a mean, and on a widget it is a lie the
    // app never tells.** The band reports heart rate about once a minute, so a
    // worn half hour arrives as roughly thirty samples; a bucket holding one or
    // two is the strap being taken off or put back on, and that single reading
    // is exactly when a wrist sensor produces nonsense. Measured 2026-08-19: a
    // shower left one sample of 161 in the 18:30 bucket, which published as a
    // half hour averaging 161, stretched the widget's axis to 44-161 and
    // flattened the other eighteen hours into the bottom fifth. Neither Atlas's
    // own page nor Zepp showed anything of the sort, because both draw from the
    // raw samples where one point is a hairline.
    //
    // Withheld rather than smoothed: the strap was off, and a gap is what that
    // was. Counts are exempt - `cumulative` never averages anything, so one
    // step sample is one step sample.
    if (!cumulative && counts[i] > 0 && counts[i] < minSamples) {
      out.push(null);
      continue;
    }
    if (!counts[i]) {
      // A cumulative series has no holes at either end: it keeps its total
      // across an empty bucket once it has started, and it starts at zero
      // rather than at nothing.
      //
      // **The leading zeros are the fix for a real defect.** They were nulls,
      // so a day whose first steps arrived at half past five drew its curve
      // starting a quarter of the way across the widget - reported twice as the
      // chart being misaligned with the gauge below it, and screenshotted
      // before the cause was found. A count is not missing before you have
      // taken any; it is zero, and midnight is where the day starts.
      out.push(cumulative ? running : null);
      continue;
    }
    const value = agg === "sum" ? sums[i] : sums[i] / counts[i];
    running += agg === "sum" ? sums[i] : 0;
    out.push(Math.round(cumulative ? running : value));
  }
  return out;
}

/**
 * Last night's four stage totals, in the vocabulary native draws them in.
 *
 * **The stored record calls the awake stage `wake` and the decoder calls it
 * `awake`**, which `sleepStages.js` reconciles for every screen in the app; the
 * widget gets the reconciled answer rather than a fourth place that has to know
 * about both. Withheld entirely when the night has no stages, so native can tell
 * "no stages" from "a night that was all light sleep" without summing four
 * zeros.
 *
 * Rounded here, because the composition bar's widths are derived from these and
 * a native rounding would be the second implementation this payload exists to
 * prevent.
 */
export function publishableStages(stages) {
  if (!stages) return null;
  const out = {
    deep: Math.round(stageMinutes(stages, "deep")),
    light: Math.round(stageMinutes(stages, "light")),
    rem: Math.round(stageMinutes(stages, "rem")),
    awake: Math.round(stageMinutes(stages, "awake")),
  };
  return out.deep + out.light + out.rem + out.awake > 0 ? out : null;
}

/**
 * When the night ran, as text.
 *
 * **Formatted here rather than published as two epochs**, which is the same
 * bargain the bar fills strike: a native surface formatting a timestamp is a
 * second implementation of a thing the app already does, and it would have to
 * get the device's own locale and 24-hour preference right to agree with the
 * screen it mirrors. One string, and native draws it.
 */
export function sleepWindowText(stages) {
  const bed = stages?.bedTime;
  const wake = stages?.wakeTime;
  if (!Number.isFinite(bed) || !Number.isFinite(wake)) return null;
  const clock = (ms) =>
    new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${clock(bed)} → ${clock(wake)}`;
}

/**
 * Which band each of seven nights fell in, as one character per night.
 *
 * <p>**The thresholds stay in `SLEEP_BANDS` and only the answer travels.** A
 * widget colouring a bar by comparing a score against 85, 70 and 50 would be a
 * second copy of a table that has already moved once, and nothing could check
 * the two agreed - which is the change-both-or-neither hazard the smart alarm
 * lives with and nobody wants a second of. Native maps a character to a colour
 * resource, which is a lookup rather than a rule.
 *
 * One character rather than a tone name per night because seven of
 * `"recovery-normal"` is 120 bytes for a thing that has four possible values.
 * `0` is a night with no score, which draws as a gap.
 */
const BAND_CODE = { GREAT: "4", GOOD: "3", FAIR: "2", POOR: "1" };

export function sleepBandCodes(scores) {
  if (!scores?.some((v) => v != null)) return null;
  return scores
    .map((score) => {
      if (score == null) return "0";
      const band = SLEEP_BANDS.find((b) => score >= b.min) ?? SLEEP_BANDS.at(-1);
      return BAND_CODE[band.label] ?? "0";
    })
    .join("");
}

/** Recovery's band decides its colour; everything else takes its family's. */
const DIAL_TONES = {
  recovery: "recovery",
  sleep: "body",
  hrv: "body",
  restingHr: "body",
  weight: "body",
  steps: "activity",
  pai: "activity",
  routine: "activity",
  calories: "intake",
  protein: "intake",
  fibre: "intake",
  water: "intake",
  creatine: "intake",
};

/**
 * The three dials Home is showing, in a shape native can render.
 *
 * **The widget follows the dials the user already chose** (`stores/home.js`,
 * user-selectable since 2026-08-12) rather than three metrics fixed in Java, so
 * it needs no configuration screen of its own and cannot drift from the screen
 * it mirrors.
 *
 * A tone rather than a colour, because native paints its own ground and follows
 * the shade's night mode rather than the app's theme: a hex lifted from the
 * WebView would be the wrong colour half the time. Native maps the tone to its
 * own resources, exactly as the notification already does.
 */
export function publishableDials(dials) {
  const out = [];
  for (const dial of dials ?? []) {
    if (!dial?.key) continue;
    const family = DIAL_TONES[dial.key] ?? "accent";
    out.push({
      key: dial.key,
      label: dial.label ?? dial.key.toUpperCase(),
      text: dial.text ?? "--",
      pct: dial.pct == null ? null : Math.max(0, Math.min(100, Math.round(dial.pct))),
      // What the figure is not saying: the band for a score, the hours for a
      // sleep score, the target for anything with one. A widget has no card
      // under it and no page one tap away, so a bare 54 there cannot say whether
      // 54 was a good morning.
      sub: dial.sub ?? null,
      tone:
        family === "recovery" && dial.band
          ? `recovery-${String(dial.band).toLowerCase()}`
          : family,
    });
  }
  return out;
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
  dials,
  steps48,
  hr48,
  hrNow,
  hrLow,
  hrHigh,
  restingHr,
  sleepStages,
  sleepScore,
  trend7,
  session,
  profileAge,
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
    // The three readings Home is showing, whichever they are. The widget draws
    // these rather than a set fixed in Java, so choosing on Home changes the
    // widget and there is one place to choose.
    dials: publishableDials(dials),
    // The day's shape, for the widgets that draw one. Withheld entirely rather
    // than sent as an array of nulls, so native can tell "no series" from "a
    // series of gaps" without inspecting every element.
    steps48: steps48?.some((v) => v != null) ? steps48 : null,
    // Heart rate is the one reading that moves while you sit still, which makes
    // it the only honest test of whether a refresh did anything. `hrNow` is the
    // last sample rather than anything derived, so the sync service can carry it
    // forward without computing a figure the app computes differently.
    hr48: hr48?.some((v) => v != null) ? hr48 : null,
    hrNow: hrNow ?? null,
    hrLow: hrLow ?? null,
    hrHigh: hrHigh ?? null,
    restingHr: restingHr ?? null,
    // Last night, in the depth the widget's tallest size draws. The stage
    // totals and the window are what a card taller than one reading buys, and
    // `sleepScore` rides beside `sleepText` because the app's own score is the
    // only sleep score left in Atlas - the band's came off every screen on
    // 2026-08-07, and a widget reintroducing it would be a second number asking
    // which to believe.
    sleepStages: publishableStages(sleepStages),
    sleepScore: sleepScore ?? null,
    sleepWindow: sleepWindowText(sleepStages),
    // The week behind last night, oldest first, so the tallest card can answer
    // "and how does that compare". Nulls kept as nulls for the nights the band
    // has nothing for: a missing night is a gap in the row, never a score of
    // zero, which is the same rule the bucketed series follow.
    trend7: trend7?.some((v) => v != null) ? trend7 : null,
    trend7Bands: sleepBandCodes(trend7),
    // The session running right now, or null.
    //
    // **The start time travels and the elapsed time does not.** Android's
    // `Chronometer` counts up in the system's own process from a base it is
    // given, so publishing a duration would be a number going stale between
    // syncs while the one thing native needs to never go stale is exactly this.
    // It is also why the shade can show a live clock without Atlas waking at
    // all - the same reason the widget draws its own bars rather than asking.
    //
    // The type's NAME rather than its id, because nothing native can resolve an
    // id: session types live in localStorage, which is unreachable from Java,
    // and shipping an id would mean a second lookup table that could disagree
    // with the app's.
    session: publishableSession(session),
    // **Only what a zone needs, which is the age and nothing else.** Native
    // cannot compute a maximum heart rate without it, and it must not read the
    // band's own reported peaks instead - those claim maxima the stored samples
    // contradict, which is why hrZones refuses them. Publishing the whole
    // profile would be sending a name and a sex to a notification that has no
    // use for either.
    profile: Number.isFinite(profileAge) && profileAge > 0 ? { age: profileAge } : null,
    at: Date.now(),
  };
}

/**
 * What the shade needs to draw a running session, or null when none is.
 *
 * Deliberately three fields. Anything derived from the clock is computed native
 * side from `startedAt`, and anything derived from the archive is not knowable
 * until the session ends anyway.
 */
export function publishableSession(session) {
  if (!session || !Number.isFinite(session.startMillis)) return null;
  const name = typeof session.typeName === "string" ? session.typeName.trim() : "";
  return {
    startedAt: session.startMillis,
    // Empty rather than a placeholder: native decides what an untyped session is
    // called, so the wording lives in one place rather than in two languages.
    typeName: name || null,
  };
}
