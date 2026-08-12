import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { load, persist } from "@/utils/storage";
import { uid } from "@/utils/date";

// What a session was, as opposed to what the band measured.
//
// The band records that effort happened and for how long. It does not know it
// was climbing: every real session so far arrives carrying the same
// unrecognised auto-detected type code, so the label has to come from you.
//
// **Nothing here ever touches the device record.** Workouts live in IndexedDB
// (utils/sampleDb.js) and are overwritten wholesale by every sync, and the
// store has already been wiped once by a migration. A label written there is
// one migration from being gone. So these are annotations that sit beside the
// workout and are joined to it on `startMillis` at read time - the same rule
// the sleep decoder follows, where device data is read-only and Atlas's own
// interpretation lives alongside it.
//
// Known risk, accepted: the join key is `startMillis`, so a future timestamp
// correction orphans every label. That has happened once already to the
// workouts themselves. The alternative is storing labels inside the store that
// gets wiped, which is worse, and the failure mode here is a label to re-enter
// rather than data lost.

const TYPES_KEY = "atlas_session_types";
const SESSIONS_KEY = "atlas_sessions";

/**
 * Offered in the picker, and **deliberately not written to the store until one
 * is chosen.**
 *
 * This replaced a seed of three types (Indoor Climbing, Outdoor Climbing, Gym)
 * written straight into `types` on first launch. The difference is who they
 * belong to: a seeded type is *yours* from the moment you install, so a new
 * user's own list opens pre-filled with somebody else's activities and they
 * have to archive them one at a time. A suggestion is offered, and picking it
 * is what adds it, so the list starts genuinely empty and fills with what you
 * actually do - while still never facing a blank box.
 *
 * Alphabetical to match how `activeTypes` sorts, so the two groups in the sheet
 * read as one list rather than as two orderings.
 *
 * **This list is also the key the MET table will hang off** when per-activity
 * calorie correction is built: a suggested type can carry a MET value because
 * we know what it is, and a name somebody typed cannot. See docs/backlog.md.
 */
export const SUGGESTED_TYPES = [
  "Boxing",
  "Cycling",
  "Football",
  "Gym",
  "HIIT",
  "Hiking",
  "Indoor Climbing",
  "Outdoor Climbing",
  "Rowing",
  "Running",
  "Swimming",
  "Tennis",
  "Walking",
  "Yoga",
];

export const useSessionsStore = defineStore("sessions", () => {
  const types = ref(load(TYPES_KEY, []));
  const sessions = ref(load(SESSIONS_KEY, []));

  const saveTypes = () => persist(TYPES_KEY, types.value);
  const saveSessions = () => persist(SESSIONS_KEY, sessions.value);

  /** Pickable types. Archived ones stay readable but stop being offered. */
  const activeTypes = computed(() =>
    types.value.filter((t) => !t.archived).sort((a, b) => a.name.localeCompare(b.name))
  );

  function typeById(id) {
    return types.value.find((t) => t.id === id) ?? null;
  }

  /**
   * Adds a type, or returns the existing one if the name is already taken.
   *
   * Case-insensitive, because "gym" and "Gym" are the same kind of session and
   * two of them would split the totals that are the entire reason types exist.
   * An archived match is revived rather than duplicated.
   */
  function addType(name) {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return null;
    const existing = types.value.find(
      (t) => t.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      if (existing.archived) {
        existing.archived = false;
        saveTypes();
      }
      return existing;
    }
    const created = { id: uid(), name: trimmed, archived: false };
    types.value = [...types.value, created];
    saveTypes();
    return created;
  }

  function renameType(id, name) {
    const trimmed = (name ?? "").trim();
    const type = typeById(id);
    if (!type || !trimmed) return;
    type.name = trimmed;
    saveTypes();
  }

  /**
   * Archived, never deleted: sessions already labelled with it still have to
   * read as what they were. A type that vanished would leave months of history
   * silently unnamed again.
   */
  function archiveType(id) {
    const type = typeById(id);
    if (!type) return;
    type.archived = true;
    saveTypes();
  }

  /**
   * A session the band never recorded.
   *
   * Everything else in this store is an *annotation* joined to a device record
   * at read time. A manual session has no device record to join to, so it has
   * to carry its own timings and be emitted as a session in its own right -
   * without that it would be stored faithfully and never appear anywhere, since
   * `resolveSessions` only ever walks the band's workouts.
   *
   * It lives in the same array as the annotations, keyed the same way on
   * `startMillis`, so everything already built on that key keeps working: types,
   * notes, duration corrections, the delete tombstone and merging all join to a
   * manual session exactly as they do to a real one.
   *
   * The collision risk is real but small: a manual session started at the same
   * millisecond as a band record would share its key. Minutes are the finest
   * thing the sheet offers and the band's own starts are seconds-precise, so
   * this rounds to the minute and takes the first free minute after it.
   */
  function addManualSession({ startMillis, activeSeconds, typeId = null, note = "" }) {
    if (!Number.isFinite(startMillis) || !Number.isFinite(activeSeconds)) return null;
    if (activeSeconds <= 0) return null;

    let start = Math.round(startMillis / 60000) * 60000;
    while (annotationFor(start)) start += 60000;

    upsert(start, {
      manual: true,
      source: "manual",
      manualActiveSeconds: Math.round(activeSeconds),
      typeId,
      note: (note ?? "").trim(),
    });
    return start;
  }

  /**
   * Manual sessions shaped like the band's own records, so every reader can
   * treat them identically.
   *
   * `endMillis` is derived from the duration rather than stored: for a manual
   * entry there is no gap between elapsed and active time to represent, because
   * nobody is going to tell Atlas they stopped for four minutes at the lights.
   */
  const manualSessions = computed(() =>
    sessions.value
      .filter((s) => s.manual && Number.isFinite(s.manualActiveSeconds))
      .map((s) => ({
        startMillis: s.startMillis,
        endMillis: s.startMillis + s.manualActiveSeconds * 1000,
        activeSeconds: s.manualActiveSeconds,
        manual: true,
        source: "manual",
        // Absent rather than zero: the band measures these and a manual entry
        // does not, and a zero would be drawn as a reading of zero.
        caloriesKcal: null,
        hrAvg: null,
        hrMax: null,
        hrMin: null,
        distanceMeters: null,
        altitudeAvgMeters: null,
      }))
      .sort((a, b) => b.startMillis - a.startMillis)
  );

  /** The annotation for a workout, or null if it has never been touched. */
  function annotationFor(startMillis) {
    return sessions.value.find((s) => s.startMillis === startMillis) ?? null;
  }

  /**
   * The key an annotation is stored under, given a workout that may already have
   * been through `resolve`.
   *
   * **Every lookup that takes a workout OBJECT must go through this**, because a
   * resolved workout's `startMillis` is the corrected start, not the one its
   * annotations are filed against. That is not a subtlety, it is the bug: after
   * pulling a climb's start back half an hour its type vanished and it read
   * UNNAMED SESSION, because `typeNameFor` looked the annotation up under a time
   * nothing was ever stored at. `resolve` was already handing back
   * `recordStartMillis` for exactly this and only the detail sheet was using it.
   *
   * A workout that has not been resolved has no `recordStartMillis` and falls
   * back to its own start, which is the same value.
   */
  function joinKeyOf(workout) {
    return workout?.recordStartMillis ?? workout?.startMillis;
  }

  function upsert(startMillis, patch) {
    const existing = annotationFor(startMillis);
    if (existing) {
      Object.assign(existing, patch);
      sessions.value = [...sessions.value];
    } else {
      sessions.value = [
        ...sessions.value,
        {
          id: uid(),
          startMillis,
          typeId: null,
          note: "",
          // Present from the first record even though everything is "helio"
          // today: road-to-v10 already tracks the same gym sessions, and the
          // shape has to survive one arriving from there without a migration.
          source: "helio",
          manual: null,
          ...patch,
        },
      ];
    }
    saveSessions();
  }

  function setType(startMillis, typeId) {
    upsert(startMillis, { typeId });
  }

  function setNote(startMillis, note) {
    upsert(startMillis, { note: (note ?? "").trim() });
  }

  /**
   * Correct how long a session actually was.
   *
   * The band decides on its own when effort starts and stops, and it gets it
   * wrong in one direction: it cuts sessions short. A climb logged as 1h15 was
   * really two and a half hours with belaying in between, and the band stopped
   * counting during the standing around.
   *
   * Stored as an override beside the record rather than written over it, so a
   * re-sync still cannot undo it and the band's own figure stays visible for
   * comparison. Clearing it (null) returns the session to what the band said.
   */
  function setDuration(startMillis, activeSeconds) {
    const value =
      activeSeconds == null || !Number.isFinite(activeSeconds) || activeSeconds <= 0
        ? null
        : Math.round(activeSeconds);
    upsert(startMillis, { activeSecondsOverride: value });
  }

  /**
   * A workout with any corrections applied, ready to display.
   *
   * Everything that reads a session should go through this rather than the raw
   * IndexedDB record, or an edited duration shows in one place and not another.
   */
  /**
   * Move a session's start earlier, for the case the band began recording after
   * you did. `null` clears it.
   *
   * **Keyed on the record's own start, which never changes.** That is the join
   * every annotation, merge, split and tombstone uses, so a correction that
   * actually rewrote it would orphan all of them. What moves is the start the
   * app SHOWS; `resolve` hands both back and the detail sheet writes against the
   * record one.
   */
  function setStart(startMillis, correctedMillis) {
    upsert(startMillis, { startOverride: correctedMillis ?? null });
  }

  function resolve(workout) {
    if (!workout) return workout;
    const annotation = annotationFor(workout.startMillis);
    const started = annotation?.startOverride ?? null;
    if (annotation?.activeSecondsOverride == null && started == null) return workout;

    if (started != null) {
      // Moving the start earlier lengthens the session by the same amount,
      // unless the duration was also set by hand - in which case that figure is
      // the more deliberate of the two and wins.
      const extra = Math.max(0, Math.round((workout.startMillis - started) / 1000));
      const seconds =
        annotation.activeSecondsOverride ?? (workout.activeSeconds ?? 0) + extra;
      return {
        ...workout,
        startMillis: started,
        activeSeconds: seconds,
        endMillis: started + seconds * 1000,
        // The key everything joins on, and what the band itself recorded. Both
        // kept because an edit that hides the original is indistinguishable
        // from bad data.
        recordStartMillis: workout.startMillis,
        bandStartMillis: workout.startMillis,
        bandActiveSeconds: workout.activeSeconds,
        bandEndMillis: workout.endMillis ?? null,
        edited: true,
      };
    }

    return {
      ...workout,
      activeSeconds: annotation.activeSecondsOverride,
      // The end has to move with the duration. Anything that shades where a
      // session sat reads `endMillis`, not `activeSeconds`, so leaving it at the
      // band's own end meant a duration you corrected in FITNESS was ignored by
      // every chart drawing it - which is exactly what the heart page's session
      // bands were doing.
      endMillis: workout.startMillis + annotation.activeSecondsOverride * 1000,
      // Both originals kept so the detail sheet can show what the band itself
      // recorded. An edit that hides the original is indistinguishable from bad
      // data.
      bandActiveSeconds: workout.activeSeconds,
      bandEndMillis: workout.endMillis ?? null,
      edited: true,
    };
  }

  /**
   * Hide a session without deleting the record it describes.
   *
   * A tombstone, never a row removal. Removing the workout from IndexedDB fails
   * twice over: the next sync re-fetches it, and the fetch cursor is derived
   * from the newest stored workout, so deleting that one winds the cursor
   * backwards and re-downloads everything after it.
   */
  function setHidden(startMillis, hidden) {
    upsert(startMillis, { hidden: !!hidden });
  }

  function isHidden(workout) {
    return !!annotationFor(joinKeyOf(workout))?.hidden;
  }

  /**
   * Fold several records into one session.
   *
   * The band sometimes splits a single climb across two summaries. The earliest
   * member owns the group and the others are marked as belonging to it; nothing
   * is destroyed, so unmerging is free.
   *
   * Members carry `mergedInto` rather than the owner carrying a list, so a
   * member re-fetched by a later sync cannot end up orphaned by an owner that
   * does not know about it.
   */
  function merge(startMillisList) {
    const starts = [...new Set(startMillisList ?? [])].sort((a, b) => a - b);
    if (starts.length < 2) return null;
    const owner = starts[0];
    for (const start of starts.slice(1)) {
      upsert(start, { mergedInto: owner });
    }
    // The owner absorbs anything already merged into a member, so merging a
    // merged session does not leave a chain nothing follows.
    for (const s of sessions.value) {
      if (s.mergedInto != null && starts.includes(s.mergedInto) && s.mergedInto !== owner) {
        s.mergedInto = owner;
      }
    }
    upsert(owner, { mergedInto: null });
    saveSessions();
    return owner;
  }

  /**
   * Cut one record into the activities it actually covered.
   *
   * Stored as timestamps against the record, never as new records: workouts are
   * overwritten wholesale by every sync, so a session written into IndexedDB
   * would be gone by tomorrow. The cuts are re-applied at read time, exactly the
   * way merge membership and duration overrides already are.
   *
   * The second half's annotations key on the cut itself, since that becomes its
   * `startMillis`. Moving a cut therefore orphans whatever was labelled on the
   * part after it - the same known cost the whole join carries, and the same
   * failure mode: a label to re-enter, not data lost.
   */
  function splitAt(startMillis, atMillis, stats = null) {
    if (!Number.isFinite(atMillis)) return;
    const annotation = annotationFor(startMillis);
    const existing = annotation?.splits ?? [];
    if (existing.includes(atMillis)) return;
    upsert(startMillis, {
      splits: [...existing, atMillis].sort((a, b) => a - b),
      // A snapshot of what the samples said, keyed by each part's own start.
      //
      // Recomputing at read time is not available: the heart-rate samples live
      // in IndexedDB and every reader of a session list is synchronous. It is
      // also the same rule a logged meal follows - the measurement is taken
      // once, at the moment it is made, and stops depending on a store that can
      // be downsampled underneath it. Samples past 90 days are collapsed into
      // 15-minute averages, so a peak recomputed next quarter would be lower
      // than the one recomputed today for no reason the screen could explain.
      splitStats: { ...(annotation?.splitStats ?? {}), ...(stats ?? {}) },
    });
  }

  /** Undo one cut, or every cut on the record when no time is given. */
  function unsplit(startMillis, atMillis = null) {
    const annotation = annotationFor(startMillis);
    const existing = annotation?.splits ?? [];
    if (!existing.length) return;
    const splits = atMillis == null ? [] : existing.filter((t) => t !== atMillis);

    // Stats for parts that no longer exist are dropped rather than kept for a
    // re-split: a later cut at the same instant would land on a different span
    // if the cuts either side of it changed, and stale aggregates would be
    // silently wrong rather than absent.
    const keep = {};
    if (splits.length) {
      const live = new Set([startMillis, ...splits]);
      for (const [key, value] of Object.entries(annotation?.splitStats ?? {})) {
        if (live.has(Number(key))) keep[key] = value;
      }
    }
    upsert(startMillis, { splits, splitStats: keep });
  }

  /** The cuts stored against a record, earliest first. */
  function splitsOf(startMillis) {
    return [...(annotationFor(startMillis)?.splits ?? [])].sort((a, b) => a - b);
  }

  /** Measured aggregates per part, keyed by the part's own start time. */
  function splitStatsFor(startMillis) {
    return annotationFor(startMillis)?.splitStats ?? {};
  }

  function unmerge(ownerStartMillis) {
    for (const s of sessions.value) {
      if (s.mergedInto === ownerStartMillis) s.mergedInto = null;
    }
    sessions.value = [...sessions.value];
    saveSessions();
  }

  /** The start times folded into this one, earliest first. */
  function membersOf(startMillis) {
    return sessions.value
      .filter((s) => s.mergedInto === startMillis)
      .map((s) => s.startMillis)
      .sort((a, b) => a - b);
  }

  /** Type name for a workout, or null when it has not been named. */
  function typeNameFor(workout) {
    const annotation = annotationFor(joinKeyOf(workout));
    if (!annotation?.typeId) return null;
    return typeById(annotation.typeId)?.name ?? null;
  }

  /** How many of these workouts still have no type. */
  function unnamedCount(workouts) {
    return (workouts ?? []).filter((w) => !typeNameFor(w)).length;
  }

  return {
    types,
    sessions,
    activeTypes,
    typeById,
    addType,
    renameType,
    archiveType,
    annotationFor,
    addManualSession,
    manualSessions,
    setType,
    setNote,
    setDuration,
    setStart,
    setHidden,
    isHidden,
    merge,
    unmerge,
    membersOf,
    splitAt,
    unsplit,
    splitsOf,
    splitStatsFor,
    resolve,
    typeNameFor,
    unnamedCount,
  };
});
