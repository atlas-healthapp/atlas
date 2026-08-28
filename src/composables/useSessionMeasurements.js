// Filling in what a manual session's heart rate and calories actually were.
//
// A session Atlas timed knows only when it started and stopped. The strap was on
// the wrist throughout, so the readings exist - they are simply not in the app
// yet when STOP is pressed, because the band hands its window over on the next
// sync and may still be short of the last few minutes on the one after that.
//
// So this runs after every sync and fills in whatever has arrived, and stops
// rewriting a session once a sync has completed after that session's window
// closed. That is the same "derive on demand, freeze when settled" rule
// `sampleIngest` applies to a night, and it exists for the same reason: a figure
// that keeps moving is worse than one that arrives late.
import { getSamples } from "@/utils/sampleDb";
import { aggregateWindow } from "@/components/activity/splitSessions";
import { metForTypeName } from "@/utils/activityMet";
import {
  estimateSessionCalories,
  fitConstant,
} from "@/utils/sessionCalories";

/**
 * How long after a session ends before its figures are considered final.
 *
 * The band's own commit lag is the thing being waited out. Measured only
 * indirectly so far - the sleep probe exists because nobody has measured it
 * properly - so this is deliberately generous: nothing is lost by freezing late,
 * and freezing early keeps a wrong number for good.
 */
const SETTLE_MS = 45 * 60_000;

/** Sessions worth looking at: recent, manual, and not already frozen. */
function pending(store, now) {
  return (store.sessions ?? []).filter((s) => {
    if (!s.manual || !Number.isFinite(s.manualActiveSeconds)) return false;
    if (s.measuredFinal) return false;
    // Beyond the retention window the samples have been downsampled and a
    // derived average would be worse than the nothing already shown.
    const age = now - s.startMillis;
    return age >= 0 && age < 7 * 24 * 3600_000;
  });
}

/**
 * The profile the equations need, in the units they expect.
 *
 * Weight comes from the latest check-in that has one rather than from a fixed
 * field, because it is the one input here that genuinely moves.
 */
export function profileFor(profileStore, checkinStore) {
  const withWeight = (checkinStore.entries ?? [])
    .filter((e) => Number.isFinite(e.weight))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return {
    weightKg: withWeight[0]?.weight ?? null,
    ageYears: profileStore.age ?? null,
    sex: profileStore.sex || null,
  };
}

/**
 * Fill in every manual session that can be, once.
 *
 * `bandSessions` are the device's own records, used only to fit the personal
 * calorie constant. They are never modified: the band's figure always wins where
 * there is one, and this exists for the sessions where there is not.
 */
export async function measurePendingSessions({
  sessionsStore,
  profile,
  bandSessions = [],
  now = Date.now(),
}) {
  const todo = pending(sessionsStore, now);
  if (!todo.length) return { updated: 0 };

  const { constant, provisional } = fitConstant(bandSessions, profile);

  let updated = 0;
  for (const session of todo) {
    const from = session.startMillis;
    const to = from + session.manualActiveSeconds * 1000;
    // One read per session rather than one for the lot: these are rare, and a
    // single wide read would pull every sample between two distant sessions.
    const samples = await getSamples("hr", from, to);
    const measured = aggregateWindow(samples, from, to);
    if (!measured) continue;

    // **The last resort, and it only fires when the window has no readings at
    // all** - the strap off, or on a charger. `estimateSessionCalories` prefers
    // heart rate whenever there is any, because measured on this archive that
    // lands within 4.2% of the band where a MET manages 9.1%. Passing it costs
    // nothing when heart rate is there and is the difference between a figure
    // and a blank when it is not. An unrecognised type name has no MET and the
    // session stays blank, which is the honest answer.
    const met = metForTypeName(sessionsStore.typeNameFor(session));

    const calories = estimateSessionCalories({
      met,
      hrAvg: measured.hrAvg,
      // The count, so a thin window is refused on the evidence rather than on
      // the clock. See MIN_SAMPLES.
      hrSamples: measured.samples,
      activeSeconds: session.manualActiveSeconds,
      profile,
      constant,
      provisional,
    });

    sessionsStore.setMeasured(
      from,
      {
        ...measured,
        kcal: calories?.kcal ?? null,
        kcalSource: calories?.source ?? null,
        kcalProvisional: calories?.provisional ?? false,
      },
      // Settled once the window closed long enough ago that a further sync
      // cannot reasonably add to it.
      { settled: now - to > SETTLE_MS }
    );
    updated += 1;
  }
  return { updated };
}
