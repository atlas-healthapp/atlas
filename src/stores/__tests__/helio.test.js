import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// A sync ends when the band sends an event, so the failure mode that matters is
// the one where no event ever arrives: the promise never settles, `syncing`
// latches on, and because sync() returns early while it is set, the app never
// talks to the strap again until it is restarted. These tests are about the
// store letting go, not about the data it collects.

const plugin = {
  addListener: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  stopLiveHeartRate: vi.fn(),
  startLiveHeartRate: vi.fn(),
  setAuthKey: vi.fn(),
  startBackgroundSync: vi.fn(),
  stopBackgroundSync: vi.fn(),
  drainCache: vi.fn(),
};

vi.mock("@capacitor/core", () => ({ registerPlugin: () => plugin }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: async () => ({ value: null }) },
}));
vi.mock("@/utils/sampleIngest", () => ({
  ingestSamples: async () => new Set(),
  commitSleepSessions: () => new Set(),
  commitWorkouts: async () => new Set(),
}));

const { useHelioStore } = await import("@/stores/helio");

const AUTH_KEY = "00112233445566778899aabbccddeeff";

/**
 * The events the plugin would push; a test can fire them by hand.
 *
 * **Fanned out to every registered listener**, which is what Capacitor does and
 * what this mock used not to do: it kept only the most recent callback, so once
 * the store began attaching a permanent log listener alongside the one each sync
 * attaches, whichever registered second silently swallowed the other's events.
 * The log came out empty in tests while being fine on the device.
 */
let listeners = [];
function emit(event) {
  for (const listener of [...listeners]) listener(event);
}

function stubLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

describe("helio sync lifecycle", () => {
  beforeEach(() => {
    stubLocalStorage();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useFakeTimers();

    listeners = [];
    plugin.addListener.mockImplementation(async (_name, callback) => {
      listeners.push(callback);
      return {
        remove: async () => {
          listeners = listeners.filter((l) => l !== callback);
        },
      };
    });
    plugin.connect.mockResolvedValue(undefined);
    plugin.disconnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks deep while a deep fetch is owed, whichever sync gets the link", async () => {
    // Not a property of one call site. Asking from startup() alone lost a race
    // against the background service it had just started, every launch, and a
    // lost race returns null exactly like a refused link, so nothing could tell
    // the difference.
    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);
    plugin.connect.mockImplementation(async () => {
      queueMicrotask(() => emit({ event: "fetchComplete" }));
    });

    await store.sync(1);

    expect(plugin.connect.mock.calls[0][0].sinceDays).toBe(30);
    expect(localStorage.getItem("atlas_helio_deep_fetch_version")).toBeTruthy();

    // Once done, a one-day ask is a one-day ask again.
    vi.clearAllMocks();
    plugin.connect.mockImplementation(async () => {
      queueMicrotask(() => emit({ event: "fetchComplete" }));
    });
    await store.sync(1);
    expect(plugin.connect.mock.calls[0][0].sinceDays).toBe(1);
  });

  it("lets a deep fetch past the rate limit, which the service could otherwise starve for good", async () => {
    // The limit is measured against `lastSyncAt`, and the background service
    // moves that too - through its own runs and through every drain. So on a
    // phone whose service is running, a bumped DEEP_FETCH_VERSION could sit
    // unfetched indefinitely: an hour of trail lines all reading
    // `declined: synced Ns ago`, and only a pull-to-refresh breaking out.
    localStorage.setItem("atlas_helio_connected", "true");
    localStorage.setItem("atlas_helio_last_sync", String(Date.now()));
    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);
    plugin.drainCache.mockResolvedValue({ samples: [], sessions: [], workouts: [] });
    plugin.connect.mockImplementation(async () => {
      queueMicrotask(() => emit({ event: "fetchComplete" }));
    });

    // Synced seconds ago, and it goes anyway, because the deep fetch is owed.
    await store.refresh({ trigger: "test" });
    expect(plugin.connect).toHaveBeenCalled();

    // And the exemption is only that: with the deep fetch done, the limit is
    // back and a resume seconds later still declines.
    plugin.connect.mockClear();
    expect(await store.refresh({ trigger: "test" })).toBe("SYNCED IN THE LAST TEN MINUTES");
    expect(plugin.connect).not.toHaveBeenCalled();
  });

  it("leaves the deep fetch owed when it never completed", async () => {
    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);
    plugin.connect.mockImplementation(async () => {
      queueMicrotask(() => emit({ event: "closed", message: "gone" }));
    });

    await store.sync(1).catch(() => null);

    expect(localStorage.getItem("atlas_helio_deep_fetch_version")).toBeFalsy();
  });

  it("says what it is doing while it does it, and stops saying it at the end", async () => {
    // A spinner cannot distinguish a slow fetch from a hung one, and the
    // backfill fetch is slow enough to look hung.
    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);
    const seen = [];
    plugin.connect.mockImplementation(async () => {
      seen.push(store.syncPhase);
      emit({ event: "samples", samples: [{ metric: "hr", t: 1, v: 60 }] });
      seen.push(store.syncPhase);
      emit({ event: "fetchComplete" });
    });

    await store.sync(1);

    expect(seen[0]).toMatch(/WAKING/);
    expect(seen[1]).toMatch(/SAMPLES · 1/);
    expect(store.syncPhase).toBeNull();
  });

  it("stays busy through the save, not just through the fetch", async () => {
    // `syncing` used to drop the moment the link closed, while committing sleep
    // and ingesting tens of thousands of samples was still to come - which is
    // the part that actually blocks the thread. Every screen keying on it went
    // quiet at exactly the moment the app stopped responding: Home's sync line
    // vanished and the pairing form came back over a connect still running.
    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);
    let duringSave = null;
    const ingest = await import("@/utils/sampleIngest");
    vi.spyOn(ingest, "ingestSamples").mockImplementation(async () => {
      duringSave = { syncing: store.syncing, phase: store.syncPhase };
      return new Set();
    });
    plugin.connect.mockImplementation(async () => {
      emit({ event: "samples", samples: [{ metric: "hr", t: 1, v: 60 }] });
      emit({ event: "fetchComplete" });
    });

    await store.sync(1);

    expect(duringSave.syncing).toBe(true);
    expect(duringSave.phase).toMatch(/SAVING/);
    // And it does let go at the end, which is the failure the rest of this file
    // is about.
    expect(store.syncing).toBe(false);
    expect(store.syncPhase).toBeNull();
  });

  it("refuses to call a connect successful when the sync never ran", async () => {
    // `sync` resolves null rather than throwing when the link is busy or a sync
    // is already running. `connect` fell straight through to success on it, and
    // `{ ok: true, ...null }` is `{ ok: true }`, so the panel read `res.days`
    // off nothing, flashed "CONNECTED. UNDEFINED DAYS IMPORTED", and marked the
    // strap connected on the strength of a connect that never happened.
    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);
    plugin.connect.mockImplementation(async () => {
      const busy = new Error("the strap link is already in use");
      busy.code = "LINK_BUSY";
      throw busy;
    });

    await expect(store.connect()).rejects.toThrow(/busy/i);
    expect(store.connected).toBe(false);
  });

  describe("the diagnostic report", () => {
    // The panel tells people to paste this to a stranger to get a bug fixed, so
    // the claim printed above the button ("no personal data and not your pairing
    // key") has to be enforced rather than believed. The key is the one secret in
    // the app and it is unrecoverable without the vendor's own app.
    it("never contains the pairing key, in any casing", async () => {
      const store = useHelioStore();
      store.setAuthKey(AUTH_KEY);
      plugin.connect.mockImplementation(async () => {
        emit({ event: "log", message: "auth: sending public key" });
        emit({ event: "fetchComplete" });
      });
      await store.sync(1);

      const report = store.diagnosticReport();
      expect(report).not.toContain(AUTH_KEY);
      expect(report.toLowerCase()).not.toContain(AUTH_KEY.toLowerCase());
      expect(report.toUpperCase()).not.toContain(AUTH_KEY.toUpperCase());
    });

    it("carries the version, the error and the exchange", async () => {
      const store = useHelioStore();
      store.setAuthKey(AUTH_KEY);
      plugin.connect.mockImplementation(async () => {
        emit({ event: "log", message: "connecting…" });
        emit({ event: "closed", message: "status 133" });
      });
      await store.sync(1).catch(() => null);

      const report = store.diagnosticReport();
      // vitest.config.js defines __APP_VERSION__ as a real version shape rather
      // than the word "test", because updateCheck compares the running build
      // against the newest release and an unparseable local version makes every
      // such comparison vacuously false.
      expect(report).toContain("ATLAS 1.0.0");
      expect(report).toContain("status 133");
      expect(report).toContain("connecting…");
    });

    it("collects the exchange whether or not a panel is open", () => {
      // The whole reason the buffer moved into the store: it used to be attached
      // when DevicePanel mounted, inside a branch that only renders once the
      // strap is connected, so somebody whose first connect was failing could
      // reach no log at all.
      const store = useHelioStore();
      expect(Array.isArray(store.logLines)).toBe(true);
    });
  });

  it("completes normally when the band reports it is done", async () => {
    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);
    plugin.connect.mockImplementation(async () => {
      queueMicrotask(() => emit({ event: "fetchComplete" }));
    });

    const result = await store.sync(1);

    expect(result.imported).toBe(0);
    expect(store.syncing).toBe(false);
    expect(plugin.disconnect).toHaveBeenCalled();
  });

  it("gives up rather than waiting forever when no event ever arrives", async () => {
    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);

    const pending = store.sync(1);
    const settled = expect(pending).rejects.toThrow(/stopped responding/);

    await vi.advanceTimersByTimeAsync(120000);
    await settled;

    expect(store.syncing).toBe(false);
  });

  it("can sync again after one has timed out", async () => {
    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);

    const first = store.sync(1);
    const firstSettled = expect(first).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(120000);
    await firstSettled;

    plugin.connect.mockImplementation(async () => {
      queueMicrotask(() => emit({ event: "fetchComplete" }));
    });
    await expect(store.sync(1)).resolves.toBeTruthy();
  });

  /** What the plugin answers when live heart rate already holds the link. */
  function refuseAsBusy() {
    const busy = new Error("the strap link is already in use");
    busy.code = "LINK_BUSY";
    plugin.connect.mockRejectedValue(busy);
  }

  it("leaves the link alone when the connect was refused", async () => {
    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);
    refuseAsBusy();

    await store.sync(1);

    // Tearing down here would disconnect the stream that does own the link.
    expect(plugin.disconnect).not.toHaveBeenCalled();
    expect(store.syncing).toBe(false);
  });

  it("treats a busy link as nothing to do, not as a failure", async () => {
    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);
    refuseAsBusy();

    // Null is the same answer sync() already gives when one is in flight, and
    // it is what stops the device panel turning red and offering TRY AGAIN.
    await expect(store.sync(1)).resolves.toBeNull();
    expect(store.lastSyncError).toBeNull();
  });

  it("still reports a genuine connect failure", async () => {
    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);
    plugin.connect.mockRejectedValue(new Error("bluetooth is off"));

    await expect(store.sync(1)).rejects.toThrow(/bluetooth is off/);
    expect(store.lastSyncError).toMatch(/bluetooth is off/);
  });

  it("still tears the link down when the sync itself failed", async () => {
    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);
    plugin.connect.mockImplementation(async () => {
      queueMicrotask(() =>
        emit({ event: "authFailed", message: "wrong auth key" }),
      );
    });

    await expect(store.sync(1)).rejects.toThrow(/wrong auth key/);
    expect(plugin.disconnect).toHaveBeenCalled();
  });
});

// resume fires every time the phone is unlocked, and a BLE sync wakes the strap
// and spends its battery. These are about refresh() knowing when to do nothing.
describe("helio refresh", () => {
  beforeEach(() => {
    stubLocalStorage();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    listeners = [];
    plugin.addListener.mockImplementation(async (_name, callback) => {
      listeners.push(callback);
      return {
        remove: async () => {
          listeners = listeners.filter((l) => l !== callback);
        },
      };
    });
    plugin.connect.mockImplementation(async () => {
      queueMicrotask(() => emit({ event: "fetchComplete" }));
    });
    plugin.disconnect.mockResolvedValue(undefined);
    plugin.drainCache.mockResolvedValue({ samples: [], sleepSessions: [], workouts: [] });
  });

  /** A store that believes it is paired, which is all refresh checks. */
  function connectedStore() {
    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);
    store.connected = true;
    return store;
  }

  it("does nothing at all when the strap was never connected", async () => {
    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);

    // The reason, not a bare false: a pull that silently does nothing is
    // indistinguishable from one that never registered, so every path out of
    // refresh names itself and the indicator holds that line up.
    expect(await store.refresh()).toMatch(/NO STRAP/);
    expect(plugin.connect).not.toHaveBeenCalled();
  });

  it("syncs when there has never been a sync", async () => {
    const store = connectedStore();

    // Null means it ran. Only the paths that decline return words.
    expect(await store.refresh()).toBeNull();
    expect(plugin.connect).toHaveBeenCalled();
  });

  it("drains the background cache before syncing, or the service's work is never read", async () => {
    const store = connectedStore();

    await store.refresh();

    expect(plugin.drainCache).toHaveBeenCalled();
  });

  it("skips a refresh that comes minutes after the last one", async () => {
    const store = connectedStore();
    await store.refresh();
    vi.clearAllMocks();

    expect(await store.refresh()).toMatch(/LAST TEN MINUTES/);
    expect(plugin.connect).not.toHaveBeenCalled();
  });

  it("goes anyway when the refresh was asked for by hand", async () => {
    const store = connectedStore();
    await store.refresh();
    vi.clearAllMocks();

    expect(await store.refresh({ force: true })).toBeNull();
    expect(plugin.connect).toHaveBeenCalled();
  });

  it("skips while a sync is already running, so a resume cannot stack them", async () => {
    const store = connectedStore();
    plugin.connect.mockImplementation(async () => {});

    const first = store.sync(1);
    const second = await store.refresh({ force: true });

    expect(second).toMatch(/ALREADY RUNNING/);
    emit({ event: "fetchComplete" });
    await first;
  });

  it("admits one of three refreshes fired on the same tick, not all three", async () => {
    // **This is the case the test above does not cover, and it happened.** That
    // one starts a sync and THEN refreshes, so `syncing` is already true by the
    // time the guard reads it. Three listeners firing together never give it
    // that chance: `syncing` is set several awaits inside the sync, so all three
    // pass the check before any of them arrives.
    //
    // Read off the phone on 2026-08-14 at 10:37:18 - resume, visibilitychange
    // and the five-minute tick on the same second, all three opening a link. The
    // band takes one central at a time, so two came back as failures and showed
    // as a sync error for a sync that worked.
    const store = connectedStore();
    plugin.connect.mockImplementation(async () => {});

    // Started together and not awaited yet: the whole point is what happens
    // when all three are in flight at once.
    const pending = [
      store.refresh({ force: true, trigger: "resume" }),
      store.refresh({ force: true, trigger: "visible" }),
      store.refresh({ force: true, trigger: "tick" }),
    ];
    // The admitted one reaches the plugin a few awaits in, so the reply cannot
    // be emitted until it has: emitting earlier lands before anything is
    // listening and the sync never finishes.
    await vi.waitFor(() => expect(plugin.connect).toHaveBeenCalled());
    emit({ event: "fetchComplete" });
    const [a, b, c] = await Promise.all(pending);

    const declined = [a, b, c].filter((r) => /ALREADY RUNNING/.test(r ?? ""));
    expect(declined).toHaveLength(2);
    expect(plugin.connect).toHaveBeenCalledTimes(1);
  });
});

// The widget's refresh is the SERVICE's sync, and the app has its own clock. If
// the app judges staleness before draining, it never learns that a sync just
// happened and syncs again the moment it is opened.
describe("the app's rate limit and the service's clock", () => {
  it("counts a background sync as a sync, not as silence", async () => {
    // Reported 2026-08-19: press a widget's refresh, wait as long as you like,
    // open Atlas, and it starts syncing again every single time. The service had
    // synced; only `drainBackground` folds its stamp into `lastSyncAt`, and the
    // age was measured before the drain ran.
    const store = useHelioStore();
    store.connected = true;
    store.lastSyncAt = Date.now() - 60 * 60 * 1000;

    // The service talked to the strap a moment ago and brought nothing back,
    // which is the case that used to be invisible.
    plugin.drainCache.mockResolvedValueOnce({
      samples: [],
      sessions: [],
      workouts: [],
      serviceSyncedAt: Date.now() - 30 * 1000,
    });

    // Counted as a delta, because the plugin mock is shared with every other
    // test in this file.
    const before = plugin.connect.mock.calls.length;
    const reason = await store.refresh({ trigger: "test-resume" });

    expect(reason).toMatch(/LAST TEN MINUTES/);
    // The strap is never opened, which is the whole point: the sync this would
    // have run has already happened in the background, from the widget's button.
    expect(plugin.connect.mock.calls.length).toBe(before);
  });
});

// The workout cursor only ever moved forward, so a session the band exposed
// after a later one was already stored could never be asked for again.
//
// The band hands back the EARLIEST session at or after the date asked for, which
// is why workouts use an absolute cursor where every other type uses a day
// window. That cursor is `newestWorkoutStart()`, and nothing ever asked behind
// it - so Zepp contention, which locks Atlas out of the band for as long as
// somebody is in that app, could leave a session permanently unreachable.
describe("the workout cursor", () => {
  beforeEach(() => {
    // Real timers, unlike the suites above, and no fake-indexeddb: the archive
    // is stubbed at `newestWorkoutStart` instead. Standing up a real fake DB
    // here made two existing tests hang, because that call used to throw
    // instantly and be caught, and awaiting a real one never settles under the
    // fake timers they run on.
    stubLocalStorage();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    listeners = [];
    plugin.addListener.mockImplementation(async (_name, callback) => {
      listeners.push(callback);
      return {
        remove: async () => {
          listeners = listeners.filter((l) => l !== callback);
        },
      };
    });
    plugin.connect.mockImplementation(async () => {
      queueMicrotask(() => emit({ event: "fetchComplete" }));
    });
    plugin.disconnect.mockResolvedValue(undefined);
  });

  it("asks from the start of the window while a deep fetch is owed", async () => {
    // The repair. Zero makes the round fall back to `sinceDays`, which the deep
    // fetch has already widened to a month, so the walk starts behind the
    // watermark and picks up whatever was skipped. Safe because putWorkouts
    // upserts on startMillis - re-fetching a stored session cannot duplicate it.
    const sampleDb = await import("@/utils/sampleDb");
    const cursor = vi.spyOn(sampleDb, "newestWorkoutStart");

    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);
    await store.sync(1);

    const call = plugin.connect.mock.calls[0][0];
    expect(call.sinceDays).toBe(30);
    expect(call.workoutSinceMillis).toBe("0");
    // Not merely zero by accident: the archive is not consulted at all, which is
    // what makes this independent of what happens to be stored.
    expect(cursor).not.toHaveBeenCalled();
  });

  it("asks from the newest stored session once the deep fetch is done", async () => {
    // The ordinary path is unchanged: re-walking a month on every sync would
    // spend the band's battery for nothing.
    const newest = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const sampleDb = await import("@/utils/sampleDb");
    vi.spyOn(sampleDb, "newestWorkoutStart").mockResolvedValue(newest);

    const store = useHelioStore();
    store.setAuthKey(AUTH_KEY);
    await store.sync(1);

    vi.clearAllMocks();
    plugin.connect.mockImplementation(async () => {
      queueMicrotask(() => emit({ event: "fetchComplete" }));
    });
    await store.sync(1);

    const call = plugin.connect.mock.calls[0][0];
    expect(call.sinceDays).toBe(1);
    expect(call.workoutSinceMillis).toBe(String(newest));
  });
});
