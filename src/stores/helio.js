import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { registerPlugin } from "@capacitor/core";
import {
  migrateSingle,
  nextDue,
  serialisePlan,
  slotOf,
} from "@/utils/alarmPlan";
import { Preferences } from "@capacitor/preferences";
import { load, persist } from "@/utils/storage";
import { useCheckinStore } from "@/stores/checkin";
import {
  SOURCE_ID,
  normaliseSamples,
  normaliseWorkouts,
  decodeSleepBlobs,
  decodeNapBlobs,
  EARLIEST_PLAUSIBLE,
  FUTURE_TOLERANCE_MS,
} from "@/sources/helioBleSource";
import { ingestSamples, commitSleepSessions, commitWorkouts } from "@/utils/sampleIngest";
import { clearWorkouts, newestWorkoutStart, purgeImplausible } from "@/utils/sampleDb";
import { publishWorkoutFloor } from "@/utils/nativeSummary";
import { backfillRollupKeys, rescopeRestingHrToNights } from "@/utils/dailyRollup";
import { repeatMask } from "@/utils/strapAlarm";
import { progressLabel } from "@/utils/syncProgress";

// Direct BLE link to the Helio Strap, with no Gadgetbridge and no Zepp in the
// path. The mirror image of stores/gadgetbridge.js: same job, same downstream
// calls, different transport. Protocol knowledge lives in the native plugin,
// normalisation in sources/helioBleSource.js, storage in utils/sampleDb.js.
//
// The auth key is held here rather than natively, so the pairing secret lives in
// exactly one place and never enters the source tree.

const HelioBle = registerPlugin("HelioBle");

/**
 * What the app calls the phase that files the background service's collection
 * into the archive.
 *
 * **Shared, because three places say it and two of them are fallbacks.** Home's
 * sync line and `AppHeader` both render `syncPhase || <this>` while `draining`
 * is true, so a word changed in one place and not the others would show a
 * different name depending on which tab you opened.
 *
 * It names the night rather than the mechanism: nobody has a word for the native
 * cache, and everybody knows what last night is. The honest limit is that the
 * service also collects during the day, so a first open at three in the
 * afternoon files a few hours and still calls them overnight. Accepted - the
 * case this phase is long enough to read is the morning one, and every other
 * time it is gone before it can be misread.
 */
export const DRAIN_PHASE = "READING OVERNIGHT";

const AUTH_KEY_KEY = "atlas_helio_authkey";
const CONNECTED_KEY = "atlas_helio_connected";
/** Whether the band last refused the key Atlas holds. See `authRejected`. */
const AUTH_REJECTED_KEY = "atlas_helio_auth_rejected";
// Persisted so the panel can say something true the moment it opens, rather
// than reading "never synced" until the first sync of the session finishes.
const LAST_SYNC_KEY = "atlas_helio_last_sync";
// How stale the data has to be before a resume or a tick actually talks to the
// strap. Unlocking the phone fires resume every time, and a BLE sync wakes the
// band and spends its battery, so a burst of unlocks has to collapse into one
// sync.
//
// **Ten minutes, up from five on 2026-08-19**: reported as the app seeming to
// sync on every open. Five was chosen against "the number on screen is current"
// alone, and that was the wrong side of the trade - the background service is
// also running its own schedule and its drains move this same clock, so the
// figures do not go stale while the app sits closed. What ten buys is a strap
// that is left alone. A pull-to-refresh still ignores this entirely, which is
// the deliberate way to say "no, now".
const REFRESH_MIN_AGE_MS = 10 * 60 * 1000;

/**
 * How many refresh decisions to keep, and where.
 *
 * **Modelled on the alarm trail, and for the same reason it exists.** The smart
 * alarm went three weeks writing alarms that never left the phone because the
 * log recorded the decision and never the outcome, so every morning looked like
 * it had worked. `refresh()` has exactly that shape: it returns a reason when it
 * declines, every automatic caller drops it on the floor, and a resume that
 * chose not to sync is indistinguishable from one that never fired.
 *
 * Measured against the real case on 2026-08-14: the app was resumed after a
 * night, showed numbers from a background sync ten minutes earlier, and did not
 * fetch. `connected` was true and the rate limit had expired, so neither of the
 * two obvious causes fits, and there is no way to tell whether the trigger fired
 * at all. That is what this closes.
 */
const SYNC_TRAIL_KEY = "atlas_helio_sync_trail";
const SYNC_TRAIL_MAX = 60;
const BATTERY_KEY = "atlas_helio_battery";
// The alarm Atlas last WROTE, which is not the same claim as the alarm the band
// is holding: nothing here can read its slots back, and they are shared with
// Zepp, so anything set outside Atlas is invisible to this.
const ALARM_KEY = "atlas_helio_alarm";
/** The list that replaced it, 2026-08-24. The old key is read once, to migrate. */
const ALARMS_KEY = "atlas_helio_alarms";
/*
 * The single-slot note that used to sit here is gone (2026-08-24). It said a
 * list of slots would be a UI asserting state it cannot verify - true while
 * slot 1 was only a protocol field. It was then proven on the device: the write
 * was accepted, the strap buzzed for it, and Zepp listed both alarms. So the
 * slot is now the alarm's position in the list. See utils/alarmPlan.js.
 */
/**
 * Long, because this is a cold BLE connect: finding the band, the handshake and
 * the reply, with the band possibly asleep at the far end. The sync watchdog is
 * the model for the shape.
 */
const ALARM_TIMEOUT_MS = 45 * 1000;
// A sync ends on an event from the band, so anything that stops those events
// arriving - a link that is up but not working on our behalf, a band that walks
// away mid-fetch - leaves it waiting forever, and `syncing` latches on: every
// later sync returns early, so the app never talks to the strap again until it
// is restarted. Long enough for a slow multi-day fetch, short enough to recover.
const SYNC_TIMEOUT_MS = 120000;
// Matches HelioBlePlugin.LINK_BUSY. A rejection code rather than its wording,
// so the two sides can be read against each other.
const LINK_BUSY = "LINK_BUSY";
// One-time migration flag for the 2026-07-28 workout-timestamp fix (parseStartDate
// was silently discarding the band's reported UTC offset). Records written before
// this landed have the wrong startMillis, and since that is the store's key, a
// corrected re-fetch cannot overwrite them - it just adds a second, correct entry
// alongside the stale one. Wiping only the workouts store (not samples/sleep/
// rollups) and letting the next sync repopulate it is simpler and safer than
// trying to identify which existing rows are the bad ones.
const WORKOUT_TZ_FIX_KEY = "atlas_helio_workout_tz_fixed_2026_07_28";

// One-off: fills `hr` into rollups frozen before heart rate had one of its own.
const HR_ROLLUP_BACKFILL_KEY = "atlas_hr_rollup_backfill_2026_08_06";
const RESTING_HR_NIGHT_SCOPE_KEY = "atlas_resting_hr_night_scope_2026_08_14";
const SAMPLE_PURGE_KEY = "atlas_sample_purge_2026_08_19";
// The deep fetch, and the version of the record it was last run for.
//
// A night is committed once and then only ever re-asked for by a fetch that
// reaches back to it. So when a new field is added to what a sleep session
// stores, every night already on the phone keeps its old shape forever unless
// something asks deep again. That happened once already and was not noticed
// until the phone was read: the 30-day fetch ran on the build that stored
// bedtimes, avgHr arrived a build later, and thirteen nights ended up with a
// bedtime and no sleeping heart rate.
//
// **Bump DEEP_FETCH_VERSION whenever commitSleepSessions learns a new field.**
// The next sync of any kind then asks deep once and rewrites what the band
// still holds.
// Bumped to 3 on 2026-08-10. Not for a new field this time but for a repair: a
// later revision with an undecodable stage timeline had overwritten a good one
// (see the fourth guard in commitSleepSessions), so the nights the strap still
// holds are asked for again now that the guard is in place to keep the better
// telling of each.
//
// Bumped to 4 on 2026-08-18, and this is the case the rule above was written
// for. `commitSleepSessions` learned `naps`, and naps are only collected from
// sessions the band hands over in a fetch - a routine two-day sync never
// re-delivers an afternoon sleep from last week, and nothing reprocesses what is
// already stored. So the feature shipped and showed nothing, on a phone with two
// naps in the last three days. The rule was written down after the same mistake
// left thirteen nights with a bedtime and no sleeping heart rate; it is easy to
// miss precisely because everything looks fine until somebody reads the device.
// 5 on 2026-08-18: the nap window itself was wrong, so the sessions fetched
// under 4 were offered and rejected. They have to be asked for again.
// 6 on 2026-08-18, and this is the one that actually collects them: naps were
// never separate sessions at all, they ride in a block inside the night record
// (see decodeNaps). Every night already stored was committed by a build that
// did not read those bytes, so the whole window has to be asked for once more.
// 7 on 2026-08-18: naps learned their stages. The band keeps a SECOND timeline
// in the same segment array (see decodeNaps), so the nights fetched an hour ago
// under 6 stored naps with no stages in them.
// 8 on 2026-08-19: the nap rule gained the one-hour gap, so every nap already
// stored has to be offered again for the rejected ones to be cleared. A routine
// sync would reach the last few days on its own; this reaches the fortnight the
// NAPS card draws.
// 9 on 2026-08-19: clearing now reconsiders every date the batch covers rather
// than only the dates that still carry a nap, because the band revises a record
// and drops one. A routine sync reaches today; this reaches the fortnight the
// NAPS card draws, where a stale nap would otherwise sit until it aged out.
// 10 on 2026-08-28, and the first bump that is not about sleep. A deep fetch now
// asks for workouts from the start of its window instead of from the newest one
// already stored, so this bump is the migration: every install walks the last
// month of sessions once and picks up anything the forward-only cursor had left
// behind it. Raised by a user whose walk was in Zepp and never in Atlas - which
// turned out to be a different cause, but the hole is real either way.
const DEEP_FETCH_VERSION = 10;
const DEEP_FETCH_KEY = "atlas_helio_deep_fetch_version";
/** How deep that fetch goes. Whatever the band still holds inside it, which
 *  measured as 13 nights of sleep sessions on 2026-08-04, not 30. */
const DEEP_FETCH_DAYS = 30;

export const useHelioStore = defineStore("helio", () => {
  const connected = ref(load(CONNECTED_KEY, false));
  const authKey = ref(load(AUTH_KEY_KEY, ""));
  const syncing = ref(false);
  /**
   * True while the native cache is being read into the archive.
   *
   * **Separate from `syncing`, and the reason this exists.** `syncing` covers the
   * BLE conversation, which is set several awaits inside `sync()`. The drain is
   * neither: it is a local read of work the service already did, and it runs on
   * the rate-limited path where `sync()` is never called at all. So opening the
   * app within five minutes of a background sync ingested tens of thousands of
   * samples with nothing anywhere saying so - and since the ingest is the part
   * that actually moves the numbers, Recovery changed under the reader while the
   * header said SYNCED 09:17 and had never said SYNCING.
   */
  const draining = ref(false);

  const lastSyncAt = ref(load(LAST_SYNC_KEY, null));
  const battery = ref(load(BATTERY_KEY, null));
  const lastSyncError = ref(null);
  /**
   * The band refused the key Atlas holds.
   *
   * **A different kind of failure from every other one here, and the only one
   * the user has to act on.** Everything else - out of range, link busy because
   * the Zepp app has the band, a close mid-sync - fixes itself on the next run.
   * This does not: it means the strap was paired somewhere else, which happens
   * when somebody logs out of Zepp and lets it re-bind the band, and Atlas will
   * fail every connect from then on until it is paired again. Told apart at the
   * protocol level (HelioBlePlugin emits `authFailed`) but treated as a generic
   * error everywhere above it, so it reached the user as an unexplained failure.
   *
   * Persisted, because the thing it describes survives a restart and the panel
   * that has to say so is often opened cold, hours later.
   */
  const authRejected = ref(load(AUTH_REJECTED_KEY, false));

  /** Cleared by the band accepting the key, which is the only real proof. */
  function markAuthAccepted() {
    if (!authRejected.value) return;
    authRejected.value = false;
    persist(AUTH_REJECTED_KEY, false);
  }

  function markAuthRejected() {
    if (authRejected.value) return;
    authRejected.value = true;
    persist(AUTH_REJECTED_KEY, true);
  }
  // Per-metric counts from the last run. Kept because "the sync worked" and
  // "the sync got everything" are different claims, and only this distinguishes
  // a metric the band has no data for from one being parsed wrongly into zero.
  const lastCounts = ref({});
  // What the sync is doing right now, in words, driven by the band's own events
  // rather than by a timer. A spinner with no words cannot distinguish a slow
  // fetch from a hung one, and a 30-day fetch is slow enough to look hung.
  const syncPhase = ref(null);
  const liveHeartRate = ref(null);
  const liveWatchers = ref(0);
  /**
   * Every alarm, in slot order.
   *
   * The list index IS the band slot, which is why nothing ever reorders it:
   * a slot is a physical thing on the band and shuffling would write over an
   * alarm the user never touched. Migrated once from the single alarm that
   * came before it; see `migrateSingle`.
   */
  const alarms = ref(load(ALARMS_KEY, null) ?? migrateSingle(load(ALARM_KEY, null)));
  /**
   * The alarm that will actually ring next, or the first one when none will.
   *
   * Kept because a good deal of the app asks "what is the alarm" and means
   * this. It is derived rather than stored, so it cannot drift from the list.
   */
  const alarm = computed(
    () => nextDue(alarms.value)?.alarm ?? alarms.value[0] ?? null
  );
  const alarmSending = ref(false);
  // "Streaming was asked for" is not the same as "a reading has arrived". The UI
  // needs the first to show a placeholder, or a slow first reading looks
  // identical to a broken one.
  const liveActive = computed(() => liveWatchers.value > 0);
  let liveHandle = null;

  /**
   * The BLE exchange, collected whether or not anything is looking at it.
   *
   * **In the store rather than in the panel, and that is the whole fix.** The
   * log lived in `DevicePanel`, inside the branch that only renders once
   * `connected` is true - so the one person who most needs it, somebody whose
   * very first connect is failing, could not reach it at all. A buffer attached
   * when a panel opens also starts empty, which means it never contains the
   * attempt that made you go looking for it.
   *
   * Bounded: a deep fetch emits hundreds of lines and the oldest are the least
   * interesting.
   */
  const logLines = ref([]);
  const LOG_MAX = 300;

  try {
    HelioBle.addListener("bleLog", (event) => {
      const at = new Date().toLocaleTimeString("en-GB", { hour12: false });
      const mark = event.event === "authFailed" || event.event === "error" ? "! " : "";
      logLines.value.push(`${at} ${mark}${event.message ?? event.event}`);
      if (logLines.value.length > LOG_MAX) {
        logLines.value.splice(0, logLines.value.length - LOG_MAX);
      }
    });
  } catch {
    // No native plugin (the dev server), so there is no exchange to log.
  }

  /**
   * Everything needed to diagnose a failure, as one block of text to send.
   *
   * **The pairing key is never in it.** It is the one secret in the app, it is
   * unrecoverable without the vendor's app, and a diagnostic people are told to
   * paste to a stranger is precisely where it must not appear. Nothing else here
   * identifies anybody: it is a version string, an error and a byte trace.
   */
  function diagnosticReport() {
    return [
      `ATLAS ${__APP_VERSION__}`,
      `DEVICE ${globalThis.navigator?.userAgent ?? "unknown"}`,
      `WHEN ${new Date().toISOString()}`,
      `CONNECTED ${connected.value}`,
      `LAST SYNC ${lastSyncAt.value ? new Date(lastSyncAt.value).toISOString() : "never"}`,
      `ERROR ${lastSyncError.value ?? "none"}`,
      "",
      ...logLines.value,
      "",
      // The decisions, under the exchange. The log says what went over the
      // radio; the trail says why a sync ran or declined at all, and the two
      // questions a report gets asked are "what did it send" and "why did
      // nothing happen". Neither can answer the other.
      "SYNC TRAIL",
      ...syncTrail(),
    ].join("\n");
  }

  function setAuthKey(key) {
    const next = (key ?? "").trim();
    // Ignore an empty write. The panel calls this on mount and on every
    // keystroke, and a component that renders before hydrate() finishes would
    // otherwise erase the stored key with its own empty field.
    if (!next) return;
    authKey.value = next;
    persist(AUTH_KEY_KEY, authKey.value);
  }

  /**
   * Recover a key written by the earlier version of this panel, which used
   * Capacitor Preferences (native SharedPreferences) rather than localStorage.
   * Different backing store, so the value was still on the device but invisible
   * here, and the field came up blank every time.
   */
  async function hydrate() {
    if (authKey.value) return authKey.value;
    try {
      const stored = await Preferences.get({ key: AUTH_KEY_KEY });
      if (stored?.value) setAuthKey(stored.value);
    } catch {
      // Preferences is unavailable on the web build. Nothing to recover.
    }
    return authKey.value;
  }

  function _setConnected(value) {
    connected.value = value;
    persist(CONNECTED_KEY, value);
  }

  /**
   * Whether the phone will let the background service book the exact alarm the
   * smart wake depends on, and whether there is a screen to ask on.
   *
   * **Defaults to granted.** Every screen reading this is deciding whether to warn
   * somebody, and the check is one async hop away on mount: starting at `false`
   * would flash "permission needed" at everybody whose permission is fine. The
   * cost of the optimistic default is one render of silence on a phone that does
   * need asking, which is the right way round.
   *
   * Not persisted. It is a fact about the phone, not about Atlas, and it can
   * change while the app is closed - which is exactly the stale answer this is
   * re-read on resume to avoid.
   */
  const exactAlarm = ref({ granted: true, askable: false });

  async function checkExactAlarm() {
    try {
      const state = await HelioBle.exactAlarmState();
      exactAlarm.value = {
        granted: state?.granted !== false,
        askable: state?.askable === true,
      };
    } catch {
      // No plugin (the dev server) or an old build without the method. Silence is
      // right here: a browser cannot grant an Android permission, so warning
      // about one would be noise nobody can act on.
      exactAlarm.value = { granted: true, askable: false };
    }
  }

  /**
   * Every Bluetooth device bonded to this phone, so somebody can say which is
   * the strap when the name rules have failed to work it out.
   *
   * **Atlas does not guess.** `likelyStrap` only reports whether the native name
   * matcher recognised the name, which by definition it did not for anybody
   * seeing this list, so it orders the list and decides nothing. The plausible
   * guesses and somebody's earbuds are the same shape, and connecting to the
   * wrong one is worse than asking.
   *
   * Returns `supported: false` off-device, where there is no adapter to ask.
   */
  /**
   * The newest live heart rate the background service has streamed.
   *
   * **Read, never opened.** The app used to start its own stream for the session
   * sheet, which meant two processes reaching for a strap that takes one BLE
   * central at a time. The service won, so the sheet sat on READING THE STRAP
   * forever and the app's own sync failed link-busy while the shade showed a
   * perfectly good reading. One owner of the radio, and every surface reads what
   * it publishes.
   *
   * Returns nulls off-device and before the first reading, which a caller shows
   * as "connecting" rather than as a failure.
   */
  async function liveHeartRateReading() {
    try {
      const res = await HelioBle.liveHeartRate();
      return {
        bpm: Number.isFinite(res?.bpm) ? res.bpm : null,
        at: Number.isFinite(res?.at) ? res.at : null,
      };
    } catch {
      return { bpm: null, at: null };
    }
  }

  /**
   * Every live reading the service kept during the session in progress.
   *
   * Returned as `{t, v}` to match the archive's own shape, so a caller can merge
   * the two without knowing which came from where.
   */
  async function sessionHeartTrail() {
    try {
      const res = await HelioBle.sessionHeartTrail();
      return (res?.trail ?? [])
        .map((point) => ({ t: Number(point?.[0]), v: Number(point?.[1]) }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0);
    } catch {
      return [];
    }
  }

  /**
   * Every morning the alarm has a record for, plus what is set right now.
   *
   * Returns `null` rather than an empty shape when the plugin is not there, so
   * a caller can tell "no build support" from "nothing has happened yet" - the
   * difference between a screen that should apologise and one that should say
   * the alarm has not run since it was set.
   */
  async function alarmHistory() {
    try {
      const res = await HelioBle.alarmHistory();
      return {
        mornings: res?.mornings ?? [],
        bandOffsetMinutes: Number(res?.bandOffsetMinutes ?? null),
        detectionSensitivity: Number(res?.detectionSensitivity ?? -1),
        detectionAlert: Number(res?.detectionAlert ?? -1),
        phoneOffsetMinutes: Number(res?.phoneOffsetMinutes ?? null),
        mode: res?.mode ?? "fixed",
        enabled: !!res?.enabled,
        hour: Number(res?.hour ?? -1),
        minute: Number(res?.minute ?? 0),
      };
    } catch {
      return null;
    }
  }

  /** True while a band settings write is in flight, for the panel's label. */
  const configSending = ref(false);

  /**
   * Set the strap's workout detection sensitivity (0 HIGH, 1 STANDARD, 2 LOW).
   *
   * **Waits for the strap, exactly as `writeAlarm` does.** The first version
   * queued this for the next sync, and the send only ran from the background
   * service's own listener - so a sync started by the app read the setting and
   * never acted on the queue, and the change sat on PENDING for good. A setting
   * somebody just pressed is something they are watching, so it gets its own
   * connect and its own answer.
   *
   * Resolves only once the band has accepted. A refusal, a dropped link or a
   * silence all reject, because a settings screen that says "saved" without the
   * band agreeing is the failure this whole read-first design exists to avoid.
   */
  function setDetectionSensitivity(level) {
    if (configSending.value) return Promise.resolve(null);
    if (!authKey.value) return Promise.reject(new Error("no auth key set"));
    if (liveActive.value) {
      return Promise.reject(new Error("heart rate is streaming"));
    }
    configSending.value = true;

    return new Promise((resolve, reject) => {
      let listener = null;
      let watchdog = null;
      let settled = false;

      const finish = async (error) => {
        if (settled) return;
        settled = true;
        if (watchdog) clearTimeout(watchdog);
        if (listener) await listener.remove();
        configSending.value = false;
        if (error) reject(error);
        else resolve(level);
      };

      // Registered before the write is asked for: the reply arrives as an event
      // and a listener attached afterwards can miss it.
      HelioBle.addListener("bleLog", (event) => {
        if (event?.event === "bandConfigSet") {
          finish(event.accepted ? null : new Error("the strap refused it"));
          return;
        }
        if (event?.event === "closed" && !settled) {
          finish(new Error("the strap closed the link before answering"));
        }
      })
        .then((handle) => {
          listener = handle;
          watchdog = setTimeout(
            () => finish(new Error("the strap did not answer")),
            ALARM_TIMEOUT_MS
          );
          return HelioBle.setDetectionSensitivity({ authKey: authKey.value, level });
        })
        .catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
    });
  }

  /** Start a fresh trail. A trail belongs to one session. */
  async function clearSessionHeartTrail() {
    try {
      await HelioBle.clearSessionHeartTrail();
    } catch {
      // No plugin, or an older build. The trail simply stays empty.
    }
  }

  async function listBondedDevices() {
    try {
      const res = await HelioBle.listBondedDevices();
      return {
        supported: res?.supported !== false,
        enabled: res?.enabled !== false,
        devices: Array.isArray(res?.devices) ? res.devices : [],
      };
    } catch {
      return { supported: false, enabled: false, devices: [] };
    }
  }

  /**
   * Remember which bonded device is the strap, by address, or clear it with a
   * falsy address so the name rules take over again.
   *
   * **Clearing has to exist.** A wrong pick persists across restarts exactly as
   * well as a right one, so without a way out it would be a permanent fault
   * fixable only by reinstalling, which on Atlas costs the whole archive.
   */
  async function setStrapAddress(address) {
    try {
      await HelioBle.setStrapAddress({ address: address || "" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send the user to the system screen. Nothing comes back from it, by design:
   * there is no result and no callback, so the answer is re-read on resume.
   */
  async function requestExactAlarm() {
    try {
      await HelioBle.requestExactAlarm();
    } catch {
      // Nothing to say. The panel keeps showing the row, which is still true.
    }
  }

  /**
   * Write one alarm to the strap.
   *
   * Its own connection rather than a piggyback on a sync, matching the native
   * side: writing a setting and pulling three days of samples have nothing to do
   * with each other, and an alarm should not wait behind a fetch.
   *
   * Only persisted **after the band accepts it**. A panel that saved on tap
   * would show 06:00 while the strap still held 08:30, and since nothing here
   * can read the band back, that lie would never be corrected.
   */
  /**
   * Take an alarm out of Atlas's list.
   *
   * **This cannot clear the band's slot**, because nothing here can write an
   * "empty" alarm and nothing can read the slots back to check. The strap keeps
   * whatever was last written there until something overwrites it, which is why
   * the panel says so before asking. Switching an alarm off and sending is the
   * way to make it silent; removing is the way to stop Atlas managing it.
   *
   * The list is spliced, so every later alarm's slot shifts down by one. That is
   * correct rather than convenient: the next mirror rewrites the plan, the
   * service resolves against the new positions, and the next send to each alarm
   * lands where the list now says. The cost is that the band briefly holds a
   * stale copy at the old index, which the note above is about.
   */
  function removeAlarm(id) {
    alarms.value = alarms.value.filter((a) => a.id !== id);
    persist(ALARMS_KEY, alarms.value);
    HelioBle.setAlarmPlan({
      plan: serialisePlan(alarms.value),
      slot: 0,
      ...flatFieldsOf(alarms.value[0]),
    }).catch(() => {
      // A failed mirror costs the early wake, never the alarm itself.
    });
  }

  /** The single-alarm fields the service still resolves into. */
  function flatFieldsOf(a) {
    if (!a) return { mode: "fixed", hour: -1, minute: 0, enabled: false, days: "" };
    return {
      mode: a.mode ?? "fixed",
      hour: a.hour,
      minute: a.minute,
      enabled: a.enabled,
      days: (a.days ?? []).join(","),
      onsetHours: a.onsetHours ?? 8,
      latestHour: a.latestHour ?? -1,
      latestMinute: a.latestMinute ?? 0,
    };
  }

  function writeAlarm({
    // Which alarm in the list this is. Absent means the first one, which is
    // what every caller meant back when there was only ever one.
    id = null,
    hour,
    minute,
    days = [],
    enabled = true,
    smart = false,
    // "fixed", "smart" or "onset". See src/utils/smartAlarm.js for what each
    // one means and the measurements behind the smart window.
    mode = "fixed",
    onsetHours = 8,
    latestHour = null,
    latestMinute = null,
  }) {
    if (alarmSending.value) return Promise.resolve(null);
    if (!authKey.value) return Promise.reject(new Error("no auth key set"));
    if (liveActive.value) {
      // Same reason a sync cannot run during a stream: the band takes one
      // central at a time. Said plainly rather than failing at the GATT layer.
      return Promise.reject(new Error("heart rate is streaming"));
    }

    alarmSending.value = true;
    const spec = {
      id: id ?? alarms.value[0]?.id ?? "alarm-1",
      hour,
      minute,
      days: [...days],
      enabled,
      smart,
      mode,
      onsetHours,
      latestHour,
      latestMinute,
    };

    // **What the band is given is always the LATEST the alarm may go off.**
    //
    // Fixed and smart both write the time you set; onset writes the latest time
    // you were willing to accept. Waking you earlier than that is decided on the
    // phone and done by overwriting this same slot, so the strap is holding a
    // backstop rather than the answer.
    //
    // That is what makes the whole feature safe to fail: if the phone is dead,
    // the app was reinstalled, or BLE will not connect, the strap still goes off
    // no later than the time on its face. The worst a broken smart window can do
    // is nothing.
    // Where on the band this one lives. An alarm being added for the first time
    // is not in the list yet, so it claims the next free slot - which is the
    // end of the list, because nothing ever reorders it.
    const writeSlot = slotOf(alarms.value, spec.id) ?? alarms.value.length;
    const hardHour = mode === "onset" && latestHour != null ? latestHour : hour;
    const hardMinute = mode === "onset" && latestMinute != null ? latestMinute : minute;

    return new Promise((resolve, reject) => {
      let listener = null;
      let settled = false;
      let watchdog = null;

      const finish = async (error) => {
        if (settled) return;
        settled = true;
        if (watchdog) clearTimeout(watchdog);
        if (listener) await listener.remove();
        alarmSending.value = false;
        if (error) {
          reject(error);
          return;
        }
        // Into the list at its own position, or appended when it is new.
        // Never reordered: the index is the band slot.
        const at = alarms.value.findIndex((a) => a.id === spec.id);
        alarms.value =
          at < 0
            ? [...alarms.value, spec]
            : alarms.value.map((a) => (a.id === spec.id ? spec : a));
        persist(ALARMS_KEY, alarms.value);
        // Mirror it where the background service can read it. Only after the
        // band has accepted the write, so the service can never be watching a
        // window for an alarm the strap does not hold.
        HelioBle.setAlarmPlan({
          // The whole list, which the service resolves into the flat fields
          // below on every tick. Serialised AFTER the list was updated above,
          // so the alarm just accepted is the one mirrored.
          plan: serialisePlan(alarms.value),
          slot: slotOf(alarms.value, spec.id) ?? 0,
          mode,
          hour,
          minute,
          enabled,
          days: days.join(","),
          onsetHours,
          latestHour: latestHour ?? -1,
          latestMinute: latestMinute ?? 0,
        }).catch(() => {
          // A failed mirror costs the early wake, never the alarm itself: the
          // strap already holds the time. Not worth failing the write over.
        });
        resolve(spec);
      };

      // Registered before the write is asked for, not after. The reply comes
      // back on an event, and a listener attached afterwards can miss it.
      HelioBle.addListener("bleLog", (event) => {
        if (event?.event === "alarmSet") {
          finish(
            event.accepted
              ? null
              : new Error(`the strap refused it (status ${event.status})`)
          );
          return;
        }
        // The link dropping before any answer is a failure, not a success with
        // no confirmation. Without this the watchdog would hold the panel on
        // "SENDING…" for the better part of a minute for a link already gone.
        if (event?.event === "closed" && !settled) {
          finish(new Error("the strap closed the link before answering"));
        }
      })
        .then((handle) => {
          listener = handle;
          watchdog = setTimeout(
            () => finish(new Error("the strap did not answer")),
            ALARM_TIMEOUT_MS
          );
          return HelioBle.setAlarm({
            authKey: authKey.value,
            // This alarm's own slot, not a constant. Slot 1 was proven on the
            // device (accepted, buzzed, and Zepp showed both), which is what
            // made more than one alarm possible at all.
            slot: writeSlot,
            hour: hardHour,
            minute: hardMinute,
            enabled,
            smart,
            repeat: repeatMask(days),
          });
        })
        .catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
    });
  }

  /**
   * One sync is one connection. The band accepts roughly one central at a time,
   * so holding the link open between syncs would starve anything else that
   * wants to talk to it. Connect, drain, disconnect.
   */
  function sync(days = 3) {
    if (syncing.value) return Promise.resolve(null);
    if (!authKey.value) return Promise.reject(new Error("no auth key set"));

    syncing.value = true;
    lastSyncError.value = null;
    syncPhase.value = "WAKING THE STRAP";

    // While a deep fetch is owed, ANY sync asks deep and whichever one gets the
    // link does it. Asking from startup() alone did not work: it stands the
    // background service up immediately before syncing, and the band takes one
    // central at a time, so the deep fetch lost the race and returned null -
    // which is also what a refused link returns, so nothing could tell the
    // difference and the flag simply stayed unset every launch.
    const deepOwed = deepFetchOwed();
    const askDays = deepOwed ? Math.max(days, DEEP_FETCH_DAYS) : days;

    const checkin = useCheckinStore();
    const collectedSamples = [];
    const collectedSleep = [];
    const collectedNaps = [];
    const collectedWorkouts = [];

    return new Promise((resolve, reject) => {
      let listener = null;
      let settled = false;
      let watchdog = null;
      // A refused connect means this sync never owned the link, so tearing it
      // down on the way out would disconnect whatever does own it - the live
      // heart-rate stream, most likely, which is still using it.
      let refused = false;

      const finish = async (error) => {
        if (settled) return;
        settled = true;
        if (watchdog) clearTimeout(watchdog);
        if (listener) await listener.remove();
        if (!refused) {
          try {
            await HelioBle.disconnect();
          } catch {
            // Already gone. Nothing useful to do, and it must not mask a real error.
          }
        }
        if (error) {
          syncing.value = false;
          syncPhase.value = null;
          // Something else holds the link (live heart rate, most likely). The
          // band takes one central at a time, so this is a "not now", not a
          // fault: recording it as a sync error would turn the device panel red
          // and offer TRY AGAIN for a state the user created deliberately and
          // can end whenever they like.
          if (error.code === LINK_BUSY) {
            resolve(null);
            return;
          }
          lastSyncError.value = error.message ?? String(error);
          reject(error);
          return;
        }

        // **`syncing` deliberately stays true through everything below, and is
        // cleared once in the `finally`.** The link is closed by this point but
        // the sync is not over: committing sleep, ingesting samples and freezing
        // rollups is seconds of main-thread work on a first connect, and it is
        // the part that actually blocks. Clearing the flag before it left every
        // screen keying on `syncing` going silent at exactly the moment the app
        // stopped responding - Home's sync line vanished and StrapConnect's
        // button reverted from CONNECTING… to CONNECT, over a connect that was
        // still running. Reported both times as the app freezing, which is the
        // right reading of a screen that says it is idle while it is not.
        try {
          // Sleep is committed before any IndexedDB work, exactly as the
          // Gadgetbridge path does it, so a storage failure can never regress a
          // value that is already on the rings.
          const sleepDates = commitSleepSessions(collectedSleep, checkin, collectedNaps);
          const samples = normaliseSamples(collectedSamples);
          const workouts = normaliseWorkouts(collectedWorkouts);

          const counts = {};
          for (const s of samples) counts[s.metric] = (counts[s.metric] ?? 0) + 1;
          if (sleepDates.size) counts.sleep = sleepDates.size;
          if (workouts.length) counts.workouts = workouts.length;
          lastCounts.value = counts;

          // Named with the figure, because this is the long one: a first connect
          // ingests tens of thousands of readings and a bare SAVING for half a
          // minute is indistinguishable from a hang.
          syncPhase.value = `SAVING · ${samples.length} READINGS`;
          const touched = await ingestSamples(samples, SOURCE_ID, (done, total) => {
            syncPhase.value = progressLabel("SAVING", done, total);
          });
          syncPhase.value = "SAVING SESSIONS";
          const workoutDates = await commitWorkouts(workouts);

          lastSyncAt.value = Date.now();
          persist(LAST_SYNC_KEY, lastSyncAt.value);
          // Only a fetch that ran to completion clears it. A refused or
          // interrupted one leaves it owed, so the next sync asks deep again.
          if (deepOwed) persist(DEEP_FETCH_KEY, DEEP_FETCH_VERSION);
          resolve({
            imported: samples.length,
            days: new Set([...sleepDates, ...touched, ...workoutDates]).size,
            sleepDays: sleepDates.size,
          });
        } catch (e) {
          lastSyncError.value = e.message ?? String(e);
          reject(e);
        } finally {
          syncing.value = false;
          syncPhase.value = null;
        }
      };

      HelioBle.addListener("bleLog", (event) => {
        if (event.event === "samples") {
          collectedSamples.push(...(event.samples ?? []));
          // The running count is the point: it is the only thing on screen that
          // proves a long fetch is still moving rather than stalled.
          syncPhase.value = `READING SAMPLES · ${collectedSamples.length}`;
        } else if (event.event === "sleepSessions") {
          collectedSleep.push(...decodeSleepBlobs(event.sessions));
          // Read off the same blobs rather than off the decoded nights, because
          // a nap-only day arrives as a record with no night in it - see
          // decodeNaps. The count is the nights, which is what the phase line
          // has always meant.
          collectedNaps.push(...decodeNapBlobs(event.sessions));
          syncPhase.value = `READING SLEEP · ${collectedSleep.length}`;
        } else if (event.event === "workouts") {
          collectedWorkouts.push(...(event.workouts ?? []));
          syncPhase.value = `READING SESSIONS · ${collectedWorkouts.length}`;
        } else if (event.event === "fetchComplete") {
          // Reaching a completed fetch means the band accepted the key, which is
          // the only real proof there is. Cleared here rather than on connect,
          // because a connect that goes on to fail auth is not evidence of
          // anything.
          markAuthAccepted();
          syncPhase.value = "SAVING";
          finish(null);
        } else if (event.event === "battery") {
          syncPhase.value = "CONNECTED";
          // "battery 70%" / "battery 70% charging"
          const match = /(\d+)%/.exec(event.message ?? "");
          if (match) {
            battery.value = Number(match[1]);
            persist(BATTERY_KEY, battery.value);
            // Recorded as a sample as well, matching what the background service
            // does. Both paths have to write it or the discharge curve has a hole
            // in it wherever the other one happened to run, and it is the SHAPE of
            // that curve the days-per-charge figure comes from.
            const at = Date.now();
            collectedSamples.push({ metric: "strapBattery", t: at, v: battery.value });
            if (/charging/i.test(event.message ?? "")) {
              collectedSamples.push({ metric: "strapCharging", t: at, v: 1 });
            }
          }
        } else if (event.event === "authFailed") {
          markAuthRejected();
          finish(new Error(event.message || "authentication failed"));
        } else if (event.event === "closed" && !settled) {
          // A close before fetchComplete means the band went away mid-sync.
          // Whatever arrived first is still good, so it is kept rather than
          // discarded, but the run is reported as incomplete.
          // The reason is printed to a person verbatim under COULD NOT CONNECT,
          // so it is not prefixed with "link closed" any more: the native side
          // now sends a sentence rather than a token, and "LINK CLOSED: ATLAS WAS
          // CLOSED BY ANDROID" says the same thing twice with the jargon first.
          finish(new Error(event.message || "the link to the strap closed"));
        }
      })
        .then(async (handle) => {
          listener = handle;
          watchdog = setTimeout(
            () => finish(new Error("the strap stopped responding")),
            SYNC_TIMEOUT_MS,
          );
          // Workouts need an absolute cursor, not a day count: the band hands
          // back the earliest session at or after the date asked for, so a
          // three-day window keeps landing on one already in the archive and
          // never reaches the newest. Sent as a string because a millisecond
          // timestamp does not survive the bridge's int.
          //
          // **Except on a deep fetch, where it starts from nothing.** That
          // cursor only ever moves forward, so a workout the band exposes AFTER
          // a later one is already stored can never be asked for again - it is
          // behind the watermark for good. Zepp contention is what sets that up:
          // the band takes one central at a time, so anybody sitting in that app
          // locks Atlas out, and the session can surface late.
          //
          // Sending 0 makes the round fall back to `sinceDays`, which a deep
          // fetch has already widened to DEEP_FETCH_DAYS, so the walk starts a
          // month back and picks up anything skipped. Safe because `putWorkouts`
          // upserts on `startMillis`: re-fetching a stored session overwrites it
          // with itself and cannot duplicate. The cost is one slower sync per
          // DEEP_FETCH_VERSION bump, which is also the migration - bumping it is
          // what makes every existing install do this repair once.
          //
          // It cannot recover anything older than the deep window. That is
          // accepted: the case this exists for is a session that arrived late,
          // not one lost a year ago.
          let workoutSinceMillis = "0";
          if (!deepOwed) {
            try {
              workoutSinceMillis = String(await newestWorkoutStart());
            } catch {
              // No cursor is a slower sync, not a broken one. Fall through.
            }
          }
          return HelioBle.connect({
            authKey: authKey.value,
            sinceDays: askDays,
            workoutSinceMillis,
          }).catch((e) => {
            refused = true;
            throw e;
          });
        })
        .catch((e) => finish(e));
    });
  }

  /**
   * Ingest whatever the background service collected while Atlas was closed.
   *
   * Runs on launch, before any live sync. The service cannot write to IndexedDB
   * (it has no WebView), so it parks results natively and this is where they
   * finally land. Safe to call repeatedly: draining clears the native side, and
   * samples are keyed on metric and timestamp so a replay overwrites rather than
   * duplicates.
   */
  async function drainBackground() {
    let drained;
    try {
      drained = await HelioBle.drainCache();
    } catch (e) {
      lastSyncError.value = e.message ?? String(e);
      return null;
    }

    // The service's own last run, taken before anything else. A background sync
    // that found nothing new still talked to the strap, and the app had no way
    // to know: its lastSyncAt only moved when IT synced or when a drain brought
    // something back. The notification reads the service's figure, so the two
    // disagreed by hours and the shade was the one telling the truth.
    const serviceSyncedAt = Number(drained?.serviceSyncedAt ?? 0);
    const noteServiceRun = () => {
      if (serviceSyncedAt > (lastSyncAt.value ?? 0)) {
        lastSyncAt.value = serviceSyncedAt;
        persist(LAST_SYNC_KEY, lastSyncAt.value);
      }
    };

    const rawSamples = drained?.samples ?? [];
    const rawSessions = drained?.sessions ?? [];
    const rawWorkouts = drained?.workouts ?? [];
    // Nothing came back, so there is nothing to ingest and the service's own run
    // is the whole truth. Recorded here, which is the case the timestamp was
    // added for: a background sync that found nothing still talked to the strap.
    if (!rawSamples.length && !rawSessions.length && !rawWorkouts.length) {
      noteServiceRun();
      return null;
    }

    const checkin = useCheckinStore();
    // **Flagged for the whole ingest, and the stamp waits for it.** Both halves
    // fix the same complaint: the app said SYNCED 09:17 while the 09:17 data was
    // still in the native cache, then Recovery jumped once it landed. Claiming a
    // time before the readings it describes have been stored is the app being
    // fresher in the header than it is on the screen.
    let sleepDates;
    let samples;
    let touched;
    let workoutDates;
    draining.value = true;
    try {
      // Sleep first, as everywhere else, so a storage failure cannot regress a
      // value that is already on the rings.
      sleepDates = commitSleepSessions(
        decodeSleepBlobs(rawSessions),
        checkin,
        decodeNapBlobs(rawSessions)
      );
      samples = normaliseSamples(rawSamples);
      // **The drain counts, exactly as the sync does.** It was a bare UPDATING
      // for however long the ingest took, which after a night of background
      // syncs is tens of thousands of readings, and it runs BEFORE the strap is
      // touched - so opening the app in the morning showed a motionless
      // UPDATING, then WAKING THE STRAP, then the real work. Reported as "it
      // said updating for so long whilst not saying it was doing anything".
      // `ingestSamples` already takes this callback and the sync path already
      // passes one; this path simply never did.
      // **It says what it is doing, and it is not the strap.** `UPDATING` was
      // the one word covering a phase that runs BEFORE anything is connected:
      // this is the background service's night being written into the archive,
      // work already fetched and paid for. So the percentage ran to 100 and then
      // the header said WAKING THE STRAP, which reads as starting over -
      // reported as exactly that. Naming the phase is what separates the two,
      // and it also explains why the step only appears on the first open of the
      // day: by the second there is no night to file.
      syncPhase.value = `${DRAIN_PHASE} · ${samples.length} READINGS`;
      touched = await ingestSamples(samples, SOURCE_ID, (done, total) => {
        syncPhase.value = progressLabel(DRAIN_PHASE, done, total);
      });
      syncPhase.value = `${DRAIN_PHASE} · SESSIONS`;
      workoutDates = await commitWorkouts(normaliseWorkouts(rawWorkouts));
    } finally {
      syncPhase.value = null;
      draining.value = false;
    }

    lastSyncAt.value = Date.now();
    persist(LAST_SYNC_KEY, lastSyncAt.value);
    return {
      imported: samples.length,
      days: new Set([...sleepDates, ...touched, ...workoutDates]).size,
      sleepDays: sleepDates.size,
    };
  }

  /**
   * Live heart rate, streamed while a screen is showing it.
   *
   * Deliberately not stored. These are the same readings the band already
   * records and hands over on the next sync, so persisting them here would
   * duplicate rows and, worse, write them under a different timestamp than the
   * band's own. This is a display value with a lifetime of one screen.
   *
   * Reference counted because both Home and BODY can want it at once: the last
   * one to leave stops the stream, and the band's sensor stops with it.
   *
   * **Nothing calls this today** (2026-08-12). BODY started a stream whenever it
   * came on screen, and **the strap takes one BLE central at a time**, so the
   * stream held the only connection: every sync had to stand it down, run, and
   * start it again, and opening BODY at the wrong moment was enough to make a
   * sync look broken. A live number was not worth that.
   *
   * Kept rather than deleted because the BLE side is built and proven, and the
   * cost of the feature is a design problem (when may a screen hold the radio)
   * rather than a protocol one. A future screen that genuinely earns the
   * connection can call this unchanged.
   */
  async function startLiveHeartRate() {
    liveWatchers.value++;
    if (liveWatchers.value > 1) return;
    if (!authKey.value) return;

    liveHandle = await HelioBle.addListener("bleLog", (event) => {
      if (event.event === "heartRate") {
        liveHeartRate.value = event.bpm;
      } else if (event.event === "closed") {
        liveHeartRate.value = null;
      }
    });
    try {
      await HelioBle.startLiveHeartRate({ authKey: authKey.value });
    } catch (e) {
      lastSyncError.value = e.message ?? String(e);
      await stopLiveHeartRate();
    }
  }

  async function stopLiveHeartRate() {
    if (liveWatchers.value > 0) liveWatchers.value--;
    if (liveWatchers.value > 0) return;

    liveHeartRate.value = null;
    if (liveHandle) {
      await liveHandle.remove();
      liveHandle = null;
    }
    try {
      await HelioBle.stopLiveHeartRate();
    } catch {
      // Link already gone; the band stops measuring on disconnect anyway.
    }
  }

  /** Mirror the key natively so the background service can authenticate without a WebView. */
  async function enableBackground() {
    if (!authKey.value) return false;
    await HelioBle.setAuthKey({ authKey: authKey.value });
    await HelioBle.startBackgroundSync();
    return true;
  }

  async function disableBackground() {
    await HelioBle.stopBackgroundSync();
  }

  /** Never rejects. Used where a failed sync must not break the caller. */
  async function syncSilently(days = 3) {
    try {
      return await sync(days);
    } catch (e) {
      lastSyncError.value = e.message ?? String(e);
      return null;
    }
  }

  /**
   * True for the whole of a first connect, which `syncing` is not.
   *
   * **`syncing` goes false the instant the fetch resolves, and `connected` only
   * goes true a line later**, so between them the device panel had nothing to
   * say and fell back to rendering the pairing form again. Measured on a real
   * first connect: 90,000 samples imported, SAVING on screen, then the connect
   * screen for a couple of seconds, then the connected view. It reads as the
   * connect having failed and then changing its mind.
   */
  const connecting = ref(false);

  /**
   * Talking to the strap right now, for any screen that has to get out of the way.
   *
   * **One definition, because two screens hide different things on it.**
   * `StrapConnect` swaps its form for the progress panel, and first run hides the
   * wordmark, the question and the LATER button so the panel is alone. Each
   * working it out from `syncing || connecting` separately is how one of them
   * ends up flickering back a beat before the other, which is the class of bug
   * this whole session started with.
   */
  const busy = computed(() => syncing.value || connecting.value || draining.value);

  async function connect(key) {
    if (key) setAuthKey(key);
    connecting.value = true;
    try {
      const res = await sync(30);
      // **`sync` resolves null rather than throwing in two cases**: a sync was
      // already running, and the link was busy. Both used to fall straight
      // through to success here, and `{ ok: true, ...null }` is `{ ok: true }`,
      // so the panel read `res.days` off nothing and flashed "CONNECTED.
      // UNDEFINED DAYS IMPORTED" for a connect that never happened - and marked
      // the strap connected on the strength of it.
      if (!res) throw new Error("the strap was busy, try again in a moment");
      _setConnected(true);
      // Never fail a connect that worked because the service would not start.
      // Android refuses a foreground-service start whenever it does not
      // consider the app foreground, and the sync above has already succeeded.
      await enableBackground().catch(() => false);
      return { ok: true, ...res };
    } finally {
      connecting.value = false;
    }
  }

  async function disconnect() {
    _setConnected(false);
    await disableBackground();
  }

  /**
   * Called once on launch. Drains anything the service cached, then syncs live
   * so the app opens with current data rather than whatever the last background
   * run happened to catch. Never throws: a failed sync must not stop the app
   * starting.
   */
  async function startup() {
    // **Seed the service's announce floor from what is already stored.**
    // `commitWorkouts` publishes it whenever a sync brings workouts in, which
    // leaves two holes: a session collected before this shipped, and a restore
    // onto a phone whose service has never announced anything. Both end with the
    // service announcing a session the user has been looking at for hours -
    // observed on 2026-08-27 doing exactly that. Reading the archive on launch
    // costs one indexed lookup and closes both.
    newestWorkoutStart()
      .then((t) => (t > 0 ? publishWorkoutFloor(t) : null))
      .catch(() => null);

    // **The migration is written down the first time it is read.** It runs in
    // the ref initialiser above, which produces the right list in memory but
    // persists nothing, so it re-ran on every launch and the service never
    // learned there was a plan at all. Storing it once settles both.
    if (alarms.value.length && load(ALARMS_KEY, null) == null) {
      persist(ALARMS_KEY, alarms.value);
    }
    // Mirror the plan even when nothing has been edited, so the service can
    // resolve which alarm tonight belongs to on a phone whose owner has not
    // touched the panel since updating. Harmless when it is already current.
    if (alarms.value.length) {
      HelioBle.setAlarmPlan({
        plan: serialisePlan(alarms.value),
        slot: 0,
        ...flatFieldsOf(alarm.value),
      }).catch(() => {
        // No plugin, or an older build. The flat keys are still whatever the
        // last real write left, which is the pre-list behaviour.
      });
    }
    // Before the strap check: this repairs stored data and owes nothing to a
    // band being connected.
    await backfillHeartRateRollups();
    await rescopeRestingHr();
    // Before the strap check, like the repairs above it: clearing readings that
    // cannot be real owes nothing to whether a band is paired, and somebody who
    // has restored a backup onto a fresh phone has the junk without the strap.
    await purgeImplausibleSamples();
    if (!connected.value) return;
    await migrateWorkoutTimezoneFix();
    await hydrate();
    await drainBackground().catch(() => null);
    await enableBackground().catch(() => false);
    // Always the usual two-day ask. sync() widens it to the deep window on its
    // own while that is still owed, so this does not have to win a race against
    // the background service to be the one that does it.
    await syncSilently(2);
  }

  /**
   * The refresh every "is this current?" moment calls: coming back to the app,
   * a foreground tick, or a pull.
   *
   * Two things, in order. **Draining first is not optional**: the background
   * service collects samples into a native cache and the WebView is the only
   * thing that ingests them, so an app that only ever synced live would leave
   * everything the service already fetched sitting unread.
   *
   * Rate limited, because resume fires every time the phone is unlocked and a
   * BLE sync is not free - it wakes the strap and costs its battery. `force`
   * is for a deliberate pull, which should always do something visible.
   * Never throws: this runs from lifecycle hooks that have nowhere to put an
   * error.
   *
   * Returns null when it synced, or a short reason when it did not. A pull that
   * silently does nothing is indistinguishable from a broken one, and there are
   * four different reasons nothing happens: no strap, one already running, the
   * band refusing the link, and the rate limit. Naming them costs a line and
   * saves guessing at a screen that just sat there.
   */
  /**
   * Record what a refresh decided, whatever it decided.
   *
   * **Inside `refresh` rather than at each call site**, which is the whole
   * lesson from the alarm: a caller that has to remember to record its own
   * outcome eventually does not, and the one that forgets is the one that
   * breaks. Every path out of `refresh` passes through here.
   */
  function noteRefresh(trigger, outcome) {
    try {
      const at = new Date().toLocaleTimeString("en-GB", { hour12: false });
      const trail = load(SYNC_TRAIL_KEY, []) ?? [];
      trail.push(`${at} ${trigger} ${outcome}`);
      persist(SYNC_TRAIL_KEY, trail.slice(-SYNC_TRAIL_MAX));
    } catch {
      // A diagnostic must never be the thing that breaks a sync.
    }
  }

  /**
   * The trail, newest last, for anything that wants to show it.
   *
   * Read from storage rather than held in a ref: the lines are written by
   * `noteRefresh` and by nothing else, they are read when somebody opens a
   * panel, and a reactive mirror of a 60-line append-only log would be a second
   * copy that could disagree with the file.
   *
   * **It existed for three weeks before anything could show it.** Written on
   * every refresh since 2026-08-14 and readable only over adb, which means only
   * the author could read it - and the ticket it was built for is about a
   * morning on somebody's phone.
   */
  function syncTrail() {
    return load(SYNC_TRAIL_KEY, []) ?? [];
  }

  /**
   * True from the synchronous instant a refresh is admitted until it is done.
   *
   * **`syncing` cannot do this job and the trail caught it not doing it.** That
   * flag is set inside the sync, which is several awaits away, so every caller
   * that arrives before the first one gets there passes the guard. Measured on
   * 2026-08-14 at 10:37:18: the resume listener, the visibility listener and the
   * five-minute tick all fired on the same second, all three read `syncing` as
   * false, and all three went through to open a link. The band takes one central
   * at a time, so the second and third were refused by the link lock and came
   * back as failures - which is a sync error on screen for a sync that was
   * working perfectly.
   *
   * A plain local rather than a ref: nothing renders it, and the whole point is
   * that it changes in the same tick it is read. `syncing` keeps its own job,
   * which is telling the header a sync is running.
   */
  let refreshInFlight = false;

  async function refresh({ force = false, trigger = "unknown" } = {}) {
    if (!connected.value) {
      noteRefresh(trigger, "declined: no strap connected");
      return "NO STRAP CONNECTED";
    }
    if (syncing.value || refreshInFlight) {
      noteRefresh(trigger, "declined: already syncing");
      return "A SYNC IS ALREADY RUNNING";
    }
    // Claimed here, before the first await, or this guard has the same hole as
    // the one above it.
    refreshInFlight = true;
    try {
      return await runRefresh({ force, trigger });
    } finally {
      refreshInFlight = false;
    }
  }

  /**
   * Is a deep fetch still owed? Read live rather than captured, because the flag
   * is cleared by whichever sync completes one and this is asked on every
   * refresh.
   */
  function deepFetchOwed() {
    return load(DEEP_FETCH_KEY, 0) < DEEP_FETCH_VERSION;
  }

  async function runRefresh({ force, trigger }) {
    // **Drain before judging how stale we are, not after.**
    //
    // The service's own runs move `lastSyncAt`, but only through `noteServiceRun`
    // inside the drain - so measuring age first asks a clock that has not yet
    // heard about the sync the background service just did. Reported 2026-08-19:
    // pressing a widget's refresh, waiting, then opening Atlas showed it syncing
    // again every single time, however long the wait, because the widget's sync
    // was the service's and the app had no idea it had happened.
    //
    // The drain is not the thing the rate limit protects against. It is a local
    // read of work already done and paid for, which is the same reason the
    // declined path below drains before giving up.
    if (!force) await drainBackground().catch(() => null);

    const age = lastSyncAt.value ? Date.now() - lastSyncAt.value : Infinity;
    // **A deep fetch is exempt from the rate limit, or it can be starved for
    // good.** The limit is measured against `lastSyncAt`, which the background
    // service also moves - through its own runs and through every drain - so on
    // a phone whose service is running normally the app's own sync is refused
    // every single time. Every trail line across an hour read
    // `declined: synced Ns ago` while a bumped DEEP_FETCH_VERSION sat unfetched,
    // and only a pull-to-refresh broke out of it. The battery argument the limit
    // exists for does not apply here: this runs once per version bump, not once
    // per unlock, and until it runs the reason for the bump is not on the phone.
    if (!force && !deepFetchOwed() && age < REFRESH_MIN_AGE_MS) {
      // Drain first, THEN give up. The rate limit exists to protect the strap's
      // battery from a BLE connect on every resume, and draining the native cache
      // is neither: it is a local read of work the background service has already
      // done and paid for.
      //
      // Returning here without draining is why a session could be announced by the
      // service's own notification and still be missing from FITNESS until a
      // pull-to-refresh forced it. The service collects into a cache only the
      // WebView can read, so anything it found inside the last five minutes sat
      // there unread.
      noteRefresh(trigger, `declined: synced ${Math.round(age / 1000)}s ago`);
      return "SYNCED IN THE LAST TEN MINUTES";
    }
    noteRefresh(
      trigger,
      force
        ? "syncing (forced)"
        : deepFetchOwed()
          ? `syncing (deep fetch owed), ${Math.round(age / 1000)}s since last`
          : `syncing, ${Math.round(age / 1000)}s since last`
    );

    // The band takes one central at a time, so a live heart-rate stream blocks
    // a sync outright: the plugin rejects with LINK_BUSY and the sync quietly
    // does nothing. That is right for a background tick - a stream the user is
    // watching should not be torn down for it - but wrong for a pull, where
    // nothing happening reads as the gesture being broken. So a forced refresh
    // stands the stream down, syncs, and puts it back.
    const resumeLive = force && liveActive.value;
    if (resumeLive) await stopLiveHeartRate().catch(() => null);

    try {
      await drainBackground().catch(() => null);
      const res = await syncSilently(1);
      // syncSilently swallows failures onto lastSyncError and returns null; a
      // null with no error recorded is the band refusing the link, which is a
      // "not now" rather than a fault.
      if (res) return null;
      return lastSyncError.value
        ? `SYNC FAILED: ${lastSyncError.value}`.toUpperCase()
        : "THE STRAP WAS BUSY, TRY AGAIN";
    } finally {
      if (resumeLive) await startLiveHeartRate().catch(() => null);
    }
  }

  /**
   * Runs once per install, before anything else touches the workouts store, so
   * the wipe cannot race a sync that already wrote corrected rows. Failure is
   * swallowed rather than blocking startup - worst case the stale/duplicate
   * rows survive one more launch and this retries next time, since the flag is
   * only persisted after a successful clear.
   */
  async function migrateWorkoutTimezoneFix() {
    if (load(WORKOUT_TZ_FIX_KEY, false)) return;
    try {
      await clearWorkouts();
      persist(WORKOUT_TZ_FIX_KEY, true);
    } catch {
      // Retried on the next launch; not fatal to this one.
    }
  }

  /**
   * Fill `hr` into the rollups frozen before it had one.
   *
   * Heart rate was raw-only until 2026-08-06 - stored so resting HR had a
   * fallback source, with no daily figure of its own. Giving it a page meant
   * giving it a rollup, and a frozen rollup is never recomputed on read, so the
   * new BODY row had three days behind it and read BUILDING A RANGE.
   *
   * One-off, and only ever additive: `backfillRollupKeys` will not overwrite a
   * value that is already there. Flag persisted only after it succeeds, so a
   * failure retries next launch rather than leaving the row short forever.
   */
  async function backfillHeartRateRollups() {
    if (load(HR_ROLLUP_BACKFILL_KEY, false)) return;
    try {
      await backfillRollupKeys(["hr"]);
      persist(HR_ROLLUP_BACKFILL_KEY, true);
    } catch {
      // Retried on the next launch.
    }
  }

  /**
   * Move frozen resting heart rates onto the night-scoped definition.
   *
   * Resting HR was the last reading the band emitted in the calendar day until
   * 2026-08-14, which made it a different quantity depending on the hour: the
   * same morning it read 57 at 09:17 and 52 at 09:28, and just after midnight it
   * fell back to a waking percentile and read 67 against a real nightly 47.
   *
   * **This one overwrites**, unlike the additive backfill above, and it has to:
   * Recovery judges today against a rolling baseline of the days behind it, so
   * leaving those on the old definition would compare a sleeping figure with a
   * fortnight of end-of-day ones. On this archive that is several beats, which
   * is a whole band of score.
   */
  async function rescopeRestingHr() {
    if (load(RESTING_HR_NIGHT_SCOPE_KEY, false)) return;
    try {
      await rescopeRestingHrToNights();
      persist(RESTING_HR_NIGHT_SCOPE_KEY, true);
    } catch {
      // Retried on the next launch.
    }
  }

  /**
   * Clear out readings whose timestamps cannot be real.
   *
   * **Everybody who synced before the ingest guard has some**, which is why this
   * is a migration rather than a one-off repair: the archive it was found in
   * held 155, all `hrv`, dated 1973 to 2106, and they had frozen 75 rollup rows
   * for dates that do not exist. Nothing reads them - a date nobody has never
   * gets asked for - but they are exported in every backup, counted wherever the
   * app reports how many readings it holds, and they make the archive's own
   * bounds a lie.
   *
   * Deleting is the one thing in here that cannot be undone, so the window is
   * the same one `normaliseSamples` refuses on rather than a second opinion, and
   * the count is recorded rather than swallowed.
   */
  async function purgeImplausibleSamples() {
    if (load(SAMPLE_PURGE_KEY, false)) return;
    try {
      const removed = await purgeImplausible(EARLIEST_PLAUSIBLE, Date.now() + FUTURE_TOLERANCE_MS);
      persist(SAMPLE_PURGE_KEY, true);
      // Recorded in the same log COPY DETAILS renders, so a purge is something
      // somebody can see happened rather than data quietly going missing.
      if (removed.samples || removed.rollups) {
        const at = new Date().toLocaleTimeString("en-GB", { hour12: false });
        logLines.value.push(
          `${at} purged ${removed.samples} impossible readings and ${removed.rollups} rollups`
        );
      }
    } catch {
      // Retried on the next launch.
    }
  }

  return {
    connected,
    authKey,
    authRejected,
    syncing,
    refresh,
    lastSyncAt,
    lastSyncError,
    battery,
    lastCounts,
    syncPhase,
    draining,
    connecting,
    busy,
    logLines,
    diagnosticReport,
    syncTrail,
    liveHeartRate,
    liveActive,
    alarm,
    alarms,
    removeAlarm,
    alarmSending,
    writeAlarm,
    exactAlarm,
    checkExactAlarm,
    requestExactAlarm,
    liveHeartRateReading,
    sessionHeartTrail,
    alarmHistory,
    setDetectionSensitivity,
    configSending,
    clearSessionHeartTrail,
    listBondedDevices,
    setStrapAddress,
    noteRefresh,
    startLiveHeartRate,
    stopLiveHeartRate,
    setAuthKey,
    hydrate,
    startup,
    drainBackground,
    enableBackground,
    disableBackground,
    sync,
    syncSilently,
    connect,
    disconnect,
  };
});
