// What a session actually was, once the strap has handed its window over.
//
// Pure, because the sheet that draws it is template-shaped and cannot be tested,
// and because every number here is arithmetic somebody will one day want to
// check against the archive.
//
// **Time in a zone is counted in samples, not in spans.** The band reports about
// once a minute and not on a strict schedule, so the honest measure of "how long
// were you in zone 3" is how many readings landed there, multiplied by the
// typical gap between readings. Measuring the span between consecutive samples
// instead would hand every gap - a lost connection, the strap sliding - to
// whichever zone happened to precede it, and a five-minute dropout would become
// five minutes of hard effort.
import { maxHeartRate, zoneOf, ZONE_NAMES } from "@/utils/hrZones";

/**
 * The gap a single reading stands for, when the spacing cannot be measured.
 *
 * The band's own rate. Only used when there are too few samples to derive a
 * median gap from, which is the case a recap of a very short session hits.
 */
const ASSUMED_GAP_MS = 60_000;

/** Gaps longer than this are the strap being off, not a slow minute. */
const MAX_GAP_MS = 5 * 60_000;

/**
 * The median interval between readings, which is what one reading represents.
 *
 * Median rather than mean: one dropout of twenty minutes would drag a mean far
 * enough to inflate every zone total in the session.
 */
export function medianGap(samples) {
  const times = (samples ?? [])
    .map((s) => s?.t)
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length < 3) return ASSUMED_GAP_MS;
  const gaps = [];
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > 0 && gap <= MAX_GAP_MS) gaps.push(gap);
  }
  if (!gaps.length) return ASSUMED_GAP_MS;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * Everything the recap says about the heart rate side of a session.
 *
 * Returns null when there is nothing measured, which is a real answer: the strap
 * may have been off, or the band may simply not have handed the window over yet.
 * A caller shows "waiting" for that rather than a row of zeroes, because zero
 * minutes in every zone is a claim that you did nothing.
 */
export function summariseSession({ samples, ageYears, minSamples = 5 }) {
  const usable = (samples ?? []).filter(
    (s) => s && Number.isFinite(s.t) && Number.isFinite(s.v) && s.v > 0
  );
  if (usable.length < minSamples) return null;

  const values = usable.map((s) => s.v);
  const max = maxHeartRate({ ageYears });
  const gap = medianGap(usable);

  // Index 0 is "below the first zone", which is not zone one and is not nothing
  // either: it is the warm-up, the walk to the car, the standing about. It is
  // counted so the totals add up to the session, and named separately.
  const buckets = [0, 0, 0, 0, 0, 0];
  for (const value of values) {
    const zone = zoneOf(value, max);
    buckets[zone ?? 0] += 1;
  }

  return {
    samples: usable.length,
    avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    min: Math.min(...values),
    max: Math.max(...values),
    maxHeartRate: max,
    // Minutes, rounded at the end rather than per bucket, so the parts still sum
    // to something recognisable as the whole.
    zones: buckets.map((count) => Math.round((count * gap) / 60_000)),
    zoneNames: ZONE_NAMES,
  };
}

/**
 * The zones worth drawing, biggest first, with the empty ones dropped.
 *
 * **A zone you never entered is not a row.** Five rows with three of them reading
 * zero is a table about what did not happen, and on a walk that never leaves zone
 * two it would be three quarters of the card.
 */
export function zoneRows(summary) {
  if (!summary) return [];
  const total = summary.zones.reduce((a, b) => a + b, 0);
  if (!total) return [];
  return summary.zones
    .map((minutes, index) => ({
      index,
      minutes,
      name: index === 0 ? "BELOW ZONE 1" : `ZONE ${index} · ${summary.zoneNames[index - 1]}`,
      // **Words, not "1M".** The same complaint the duration had: an abbreviation
      // that short reads as a code rather than a length of time, and these sit in
      // a column narrow enough that "1 min" costs nothing.
      label: minutes < 60 ? `${minutes} min${minutes === 1 ? "" : "s"}` : durationWords(minutes * 60),
      pct: Math.round((minutes / total) * 100),
    }))
    .filter((row) => row.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

/**
 * A duration in words: "1 min 15 secs", "42 mins", "1 hr 5 mins".
 *
 * **Seconds are shown below ten minutes and never above**, which is the line
 * between a session you are checking and a session you are reading. "1M" was what
 * this said before, and on a one-minute test it rounded a real 75 seconds to a
 * figure that looked like a placeholder.
 *
 * Spelled out rather than abbreviated because this is a sentence somebody reads
 * once, not a column they scan.
 */
export function durationWords(totalSeconds) {
  const secs = Math.max(0, Math.round(totalSeconds ?? 0));
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;
  // **Abbreviated, because the long form wrapped.** "3 minutes 44 seconds" ran
  // to two lines under a 42px figure, which is worse than the "3M" it replaced:
  // that at least fitted. "mins" and "secs" keep the words readable as words
  // while costing half the width.
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  const parts = [];
  if (hours) parts.push(plural(hours, "hr"));
  if (minutes) parts.push(plural(minutes, "min"));
  // Under ten minutes the seconds are the interesting half; past that they are
  // noise on a number nobody is timing to the second.
  if (!hours && secs < 600 && (seconds || !parts.length)) {
    parts.push(plural(seconds, "sec"));
  }
  return parts.join(" ");
}

/**
 * Why there is nothing to show, which is not always the same reason.
 *
 * A session too short to have produced enough readings is a permanent state and
 * has to say so: waiting for a sync that will never help is the wrong thing to
 * tell somebody who has just stopped a one-minute session and is looking at an
 * empty card.
 */
export function noHeartRateReason({ activeSeconds, samples, connected, syncing, minSamples = 5 }) {
  const found = (samples ?? []).length;
  if (found >= minSamples) return null;
  // The band reports about once a minute, so this many minutes can never yield
  // enough readings however long you wait.
  if (activeSeconds < minSamples * 60) {
    return `TOO SHORT TO MEASURE. THE STRAP REPORTS ABOUT ONCE A MINUTE, SO A SESSION NEEDS AROUND ${minSamples} MINUTES BEFORE THERE IS A HEART RATE WORTH SHOWING.`;
  }
  if (!connected) return "NO STRAP CONNECTED, SO THERE IS NO HEART RATE FOR THIS SESSION.";
  if (syncing) return "READING THE STRAP…";
  if (found > 0) {
    return `ONLY ${found} READING${found === 1 ? "" : "S"} SO FAR. THE REST ARRIVES ON THE NEXT SYNC.`;
  }
  return "THE STRAP HAS NOT HANDED THIS WINDOW OVER YET. IT WILL FILL IN ON THE NEXT SYNC.";
}

/**
 * How complete the picture is, and what would make it better.
 *
 * **Nearly every recap opens provisional and nobody would guess it.** The live
 * trail only fills while the screen is on, so a session spent with the phone in a
 * pocket has almost nothing in it, and the band's own copy of the window does not
 * arrive until the next sync. The figures shown are therefore honest about the
 * readings in hand and silent about the ones that are not - which reads as a
 * complete answer unless the sheet says otherwise.
 *
 * Returns null once the archive covers the window, at which point nothing further
 * is coming and the figures are final.
 */
export function coverageNote({ activeSeconds, storedCount = 0, trailCount = 0 }) {
  const minutes = Math.max(1, Math.round((activeSeconds ?? 0) / 60));
  // The band reports about once a minute, so a covered window holds roughly one
  // reading per minute. Eighty percent, because the first and last minute of a
  // session are usually partial.
  const expected = Math.floor(minutes * 0.8);
  if (storedCount >= expected && storedCount > 0) return null;

  if (!trailCount && !storedCount) return null;
  if (!storedCount) {
    return "PROVISIONAL. THESE ARE THE READINGS TAKEN WHILE THE SCREEN WAS ON. THE STRAP'S OWN RECORD OF THE WHOLE SESSION ARRIVES ON THE NEXT SYNC AND WILL REPLACE THEM.";
  }
  return "PROVISIONAL. PART OF THIS SESSION IS STILL ON THE STRAP AND FILLS IN ON THE NEXT SYNC.";
}
