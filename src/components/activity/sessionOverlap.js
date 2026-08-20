// One walk, two records: the band's and the one Atlas timed.
//
// Atlas can now stamp a session itself, and the band may separately decide the
// same window was a workout. That leaves two rows for one thing, and they will
// never agree on their boundaries: Atlas knows when you pressed the button, the
// band knows when it decided you had started, and measured on this archive the
// gap between those runs to minutes.
//
// **So the join is span overlap, never `startMillis`.** Every other annotation in
// this app joins on that key exactly, which is right for a label attached to one
// record and useless for deciding whether two records are the same event.
//
// **The band's record wins by default and the choice is permanent.** The band
// measured calories, a heart-rate summary and its own active time; Atlas has a
// start time and whatever the archive yields. Somebody who prefers their own can
// say so, and that decision then sticks rather than being re-derived on every
// read - a rule that changed its mind because a later sync moved a boundary would
// be worse than either answer.

/** Below this the two are different events that happen to be near each other. */
export const OVERLAP_THRESHOLD = 0.5;

/** Milliseconds the two spans share. */
export function overlapMs(a, b) {
  if (!a || !b) return 0;
  const from = Math.max(a.startMillis, b.startMillis);
  const to = Math.min(a.endMillis, b.endMillis);
  return Math.max(0, to - from);
}

/**
 * How much of the SHORTER session the overlap covers, 0 to 1.
 *
 * **The shorter, deliberately.** A ten-minute manual session sitting entirely
 * inside a three-hour band record is the same event by any sensible reading, and
 * measuring against the longer would score it 0.05 and call them unrelated.
 */
export function overlapFraction(a, b) {
  const shared = overlapMs(a, b);
  if (!shared) return 0;
  const shortest = Math.min(a.endMillis - a.startMillis, b.endMillis - b.startMillis);
  return shortest > 0 ? shared / shortest : 0;
}

/**
 * Pair each manual session with the band record that best covers it.
 *
 * Best rather than first: two band records can both overlap one manual session
 * when the band split a workout in two, and the one sharing most of it is the one
 * that is the same event.
 *
 * Returns `{ manual, band, fraction }`, only for pairs above the threshold.
 */
export function findOverlaps(manualSessions, bandRecords, threshold = OVERLAP_THRESHOLD) {
  const out = [];
  for (const manual of manualSessions ?? []) {
    let best = null;
    for (const band of bandRecords ?? []) {
      const fraction = overlapFraction(manual, band);
      if (fraction >= threshold && (!best || fraction > best.fraction)) {
        best = { manual, band, fraction };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * Which of a pair to show, given what the user has said about it.
 *
 * `choice` is what they picked, or null for never asked. The default is the
 * band's, so an untouched pair shows the record with the measurements in it.
 *
 * **The loser is hidden, never deleted.** A tombstone can be undone; a deletion
 * cannot, and Atlas has just been reminded how quietly a hide can fail to take.
 */
export function preferredOf(pair, choice) {
  return choice === "manual" ? pair.manual : pair.band;
}

/**
 * The start times to drop from a resolved list, given every pair and choice.
 *
 * A set rather than a filter, so the caller can apply it once over a list it is
 * already walking. Totals then follow for free: every screen reads sessions
 * through one path, so dropping the loser there drops it from the week chart, the
 * month, the list and Recovery's day markers at the same time - which is the
 * whole reason that path was extracted.
 */
export function suppressedStarts(pairs, choiceFor) {
  const drop = new Set();
  for (const pair of pairs ?? []) {
    const choice = choiceFor?.(pair.manual.startMillis) ?? null;
    const keep = preferredOf(pair, choice);
    const loser = keep === pair.manual ? pair.band : pair.manual;
    drop.add(loser.startMillis);
  }
  return drop;
}

/**
 * The pair a shown session belongs to, from either side, or null.
 *
 * A detail sheet only ever has the winner: the loser was dropped by
 * `resolveSessions` before anything rendered. So it has to be able to ask "is
 * there another record of this, and which side am I looking at" without the
 * suppressed one being in front of it.
 */
export function pairContaining(session, manualSessions, bandRecords, threshold = OVERLAP_THRESHOLD) {
  if (!session) return null;
  for (const pair of findOverlaps(manualSessions, bandRecords, threshold)) {
    if (
      pair.manual.startMillis === session.startMillis ||
      pair.band.startMillis === session.startMillis
    ) {
      return { ...pair, showing: pair.manual.startMillis === session.startMillis ? "manual" : "band" };
    }
  }
  return null;
}
