import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { load, persist } from "@/utils/storage";
import { useCheckinStore } from "@/stores/checkin";
import {
  SOURCE_ID,
  normaliseSamples,
  normaliseWorkouts,
  decodeSleepBlobs,
} from "@/sources/helioBleSource";
import { ingestSamples, commitSleepSessions, commitWorkouts } from "@/utils/sampleIngest";
import { clearWorkouts, newestWorkoutStart } from "@/utils/sampleDb";
import { backfillRollupKeys } from "@/utils/dailyRollup";
import { repeatMask } from "@/utils/strapAlarm";

// Direct BLE link to the Helio Strap, with no Gadgetbridge and no Zepp in the
// path. The mirror image of stores/gadgetbridge.js: same job, same downstream
// calls, different transport. Protocol knowledge lives in the native plugin,
// normalisation in sources/helioBleSource.js, storage in utils/sampleDb.js.
//
// The auth key is held here rather than natively, so the pairing secret lives in
// exactly one place and never enters the source tree.

const HelioBle = registerPlugin("HelioBle");

const AUTH_KEY_KEY = "atlas_helio_authkey";
const CONNECTED_KEY = "atlas_helio_connected";
// Persisted so the panel can say something true the moment it opens, rather
// than reading "never synced" until the first sync of the session finishes.
const LAST_SYNC_KEY = "atlas_helio_last_sync";
// How stale the data has to be before a resume or a tick actually talks to the
// strap. Unlocking the phone fires resume every time, and a BLE sync wakes the
// band and spends its battery; five minutes is well inside "the number on
// screen is current" while collapsing a burst of unlocks into one sync.
const REFRESH_MIN_AGE_MS = 5 * 60 * 1000;
const BATTERY_KEY = "atlas_helio_battery";
// The alarm Atlas last WROTE, which is not the same claim as the alarm the band
// is holding: nothing here can read its slots back, and they are shared with
// Zepp, so anything set outside Atlas is invisible to this.
const ALARM_KEY = "atlas_helio_alarm";
/**
 * The single slot Atlas writes.
 *
 * One rather than a list, because a list of slots would be a UI asserting state
 * it cannot verify. When the read side exists this becomes a real set; until
 * then, one slot is the most that can be shown honestly.
 */
const ALARM_SLOT = 0;
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
const DEEP_FETCH_VERSION = 3;
const DEEP_FETCH_KEY = "atlas_helio_deep_fetch_version";
/** How deep that fetch goes. Whatever the band still holds inside it, which
 *  measured as 13 nights of sleep sessions on 2026-08-04, not 30. */
const DEEP_FETCH_DAYS = 30;

export const useHelioStore = defineStore("helio", () => {
  const connected = ref(load(CONNECTED_KEY, false));
  const authKey = ref(load(AUTH_KEY_KEY, ""));
  const syncing = ref(false);
  const lastSyncAt = ref(load(LAST_SYNC_KEY, null));
  const battery = ref(load(BATTERY_KEY, null));
  const lastSyncError = ref(null);
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
  const alarm = ref(load(ALARM_KEY, null));
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
  function writeAlarm({
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
        alarm.value = spec;
        persist(ALARM_KEY, spec);
        // Mirror it where the background service can read it. Only after the
        // band has accepted the write, so the service can never be watching a
        // window for an alarm the strap does not hold.
        HelioBle.setAlarmPlan({
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
            slot: ALARM_SLOT,
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
    const deepOwed = load(DEEP_FETCH_KEY, 0) < DEEP_FETCH_VERSION;
    const askDays = deepOwed ? Math.max(days, DEEP_FETCH_DAYS) : days;

    const checkin = useCheckinStore();
    const collectedSamples = [];
    const collectedSleep = [];
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
          const sleepDates = commitSleepSessions(collectedSleep, checkin);
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
            syncPhase.value = `SAVING · ${done} OF ${total}`;
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
          syncPhase.value = `READING SLEEP · ${collectedSleep.length}`;
        } else if (event.event === "workouts") {
          collectedWorkouts.push(...(event.workouts ?? []));
          syncPhase.value = `READING SESSIONS · ${collectedWorkouts.length}`;
        } else if (event.event === "fetchComplete") {
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
          let workoutSinceMillis = "0";
          try {
            workoutSinceMillis = String(await newestWorkoutStart());
          } catch {
            // No cursor is a slower sync, not a broken one. Fall through.
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
    if (serviceSyncedAt > (lastSyncAt.value ?? 0)) {
      lastSyncAt.value = serviceSyncedAt;
      persist(LAST_SYNC_KEY, lastSyncAt.value);
    }

    const rawSamples = drained?.samples ?? [];
    const rawSessions = drained?.sessions ?? [];
    const rawWorkouts = drained?.workouts ?? [];
    if (!rawSamples.length && !rawSessions.length && !rawWorkouts.length) return null;

    const checkin = useCheckinStore();
    // Sleep first, as everywhere else, so a storage failure cannot regress a
    // value that is already on the rings.
    const sleepDates = commitSleepSessions(decodeSleepBlobs(rawSessions), checkin);
    const samples = normaliseSamples(rawSamples);
    const touched = await ingestSamples(samples, SOURCE_ID);
    const workoutDates = await commitWorkouts(normaliseWorkouts(rawWorkouts));

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
  const busy = computed(() => syncing.value || connecting.value);

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
    // Before the strap check: this repairs stored data and owes nothing to a
    // band being connected.
    await backfillHeartRateRollups();
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
  async function refresh({ force = false } = {}) {
    if (!connected.value) return "NO STRAP CONNECTED";
    if (syncing.value) return "A SYNC IS ALREADY RUNNING";
    const age = lastSyncAt.value ? Date.now() - lastSyncAt.value : Infinity;
    if (!force && age < REFRESH_MIN_AGE_MS) {
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
      await drainBackground().catch(() => null);
      return "SYNCED IN THE LAST FIVE MINUTES";
    }

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

  return {
    connected,
    authKey,
    syncing,
    refresh,
    lastSyncAt,
    lastSyncError,
    battery,
    lastCounts,
    syncPhase,
    connecting,
    busy,
    logLines,
    diagnosticReport,
    liveHeartRate,
    liveActive,
    alarm,
    alarmSending,
    writeAlarm,
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
