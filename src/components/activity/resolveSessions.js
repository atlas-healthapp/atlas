// Raw device records to the sessions that actually happened: deletions dropped,
// split records folded back together, hand-corrected durations applied.
//
// Extracted from ActivityTab when RecoveryPage needed the same list. Copying it
// would have been the exact drift this codebase has paid for before: two readers
// of the same records disagreeing about a day because one of them applied a
// correction the other did not. FITNESS's own note said it already ("applying
// any of it per-card is how the week chart and the session list end up
// disagreeing about the same day"), which made a second copy in another file
// hard to argue for.

import { mergeWorkouts } from "@/components/activity/mergeSessions";
import { applySplits } from "@/components/activity/splitSessions";
import { findOverlaps, suppressedStarts } from "@/components/activity/sessionOverlap";

/**
 * `store` is the sessions store, passed rather than imported so this stays a
 * plain function that can be tested without standing up Pinia.
 *
 * Returned newest first, which is the order every list of these is read in.
 */
export function resolveSessions(rawSessions, store) {
  const raw = rawSessions ?? [];
  const manual = store.manualSessions ?? [];
  // Manual sessions are in the lookup as well as the device records, because a
  // merge can name one as a member: without it here, folding a manual session
  // into a band record would drop it from the merge *and* from the list, since
  // a member is skipped on its own account.
  const byStart = new Map([...raw, ...manual].map((s) => [s.startMillis, s]));

  // **One walk must not be two rows, and this is the only place that can say so.**
  // Atlas can start a session itself and the band may separately decide the same
  // window was a workout; the two never agree on their boundaries, so they are
  // paired by span overlap rather than by `startMillis`. The band's record wins
  // unless the user has said otherwise, and the loser is dropped here rather than
  // per screen - every list, the week chart, the month totals and Recovery's day
  // markers all read through this function, which is why it was extracted, so
  // suppressing once keeps every one of them counting the session exactly once.
  const suppressed = suppressedStarts(
    findOverlaps(manual, raw),
    (manualStart) => store.overlapChoiceFor?.(manualStart) ?? null
  );

  const out = [];

  for (const record of raw) {
    if (store.isHidden(record)) continue;
    if (suppressed.has(record.startMillis)) continue;
    const annotation = store.annotationFor(record.startMillis);
    // A member of a merge is not a session of its own. It reappears inside its
    // owner rather than beside it.
    if (annotation?.mergedInto != null) continue;

    const memberStarts = store.membersOf(record.startMillis);
    if (!memberStarts.length) {
      out.push(...expand(store.resolve(record), record.startMillis, store));
      continue;
    }

    // Corrections are applied to each part before merging, so a part whose
    // duration was fixed by hand contributes the fixed figure.
    const parts = [record, ...memberStarts.map((t) => byStart.get(t)).filter(Boolean)].map((p) =>
      store.resolve(p)
    );
    out.push(
      ...expand(store.resolve(mergeWorkouts(parts)), record.startMillis, store)
    );
  }

  // Sessions the band never recorded. They exist only in the store, so the loop
  // above never reaches them - it walks device records. Everything else applies
  // unchanged: a manual session can be hidden, folded into another, split, or
  // have its duration corrected, because all of that joins on `startMillis` and
  // a manual session has one.
  for (const session of manual) {
    if (store.isHidden(session)) continue;
    if (suppressed.has(session.startMillis)) continue;
    const annotation = store.annotationFor(session.startMillis);
    if (annotation?.mergedInto != null) continue;

    const memberStarts = store.membersOf(session.startMillis);
    if (!memberStarts.length) {
      out.push(...expand(store.resolve(session), session.startMillis, store));
      continue;
    }

    const parts = [session, ...memberStarts.map((t) => byStart.get(t)).filter(Boolean)].map((p) =>
      store.resolve(p)
    );
    out.push(...expand(store.resolve(mergeWorkouts(parts)), session.startMillis, store));
  }

  return out.sort((a, b) => b.startMillis - a.startMillis);
}

/**
 * One session, or the several it was cut into.
 *
 * **After merging, not before**: the band's own splitting and the user's are
 * different acts pointing in opposite directions, and a record folded into a
 * merge and then cut somewhere else has to be cut on the merged span. Doing it
 * the other way round would offer cuts inside a part that no longer exists on
 * its own.
 *
 * Each part then picks up its own annotations by `startMillis`, so the two
 * halves of one record can be typed and named separately - which is the whole
 * point of cutting a gym session away from the walk home.
 */
function expand(session, recordStart, store) {
  if (!session) return [];
  const cuts = store.splitsOf?.(recordStart) ?? [];
  if (!cuts.length) return [session];

  const stats = store.splitStatsFor?.(recordStart) ?? {};

  return applySplits(session, cuts).map((part) => {
    // The heart rate measured for this part when the cut was made. Absent for a
    // cut stored before this existed, and then the band's own figures stand.
    const measured = stats[part.startMillis];
    const withStats = measured
      ? {
          ...part,
          hrAvg: measured.hrAvg ?? part.hrAvg,
          hrMax: measured.hrMax ?? part.hrMax,
          hrMin: measured.hrMin ?? part.hrMin,
          hrRecomputed: true,
          hrSampleCount: measured.samples ?? 0,
        }
      : part;

    // Run each part back through the store so a duration corrected by hand on
    // one half is applied to that half alone.
    return store.resolve(withStats);
  });
}
