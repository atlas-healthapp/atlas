// Starting and stopping a session from Atlas.
//
// The behaviour worth pinning is not "it records a session", it is the handful
// of refusals around it: a second start must not overwrite the first, a stop
// must produce something every other reader already understands, and a mistaken
// double tap must not leave a row claiming a workout of no length.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useSessionsStore } from "@/stores/sessions";

// The suite runs in the node environment and there is no jsdom here, so
// localStorage is stubbed exactly as sessions.test.js does. Only the four
// methods utils/storage.js actually uses.
const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
  clear: () => backing.clear(),
};

describe("a session started from Atlas", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T08:12:00+10:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is stored the moment it starts, not held in memory", () => {
    const store = useSessionsStore();
    store.startSession("climb");
    // The app can be killed for memory at any point in the next 45 minutes, so
    // the start time has to survive without the store instance that made it.
    expect(JSON.parse(localStorage.getItem("atlas_session_running"))).toMatchObject({
      typeId: "climb",
    });
  });

  it("survives the store being rebuilt, as it would after a kill", () => {
    useSessionsStore().startSession("climb");
    setActivePinia(createPinia());
    const revived = useSessionsStore();
    expect(revived.running?.typeId).toBe("climb");
  });

  it("refuses to start a second over the top of one already running", () => {
    const store = useSessionsStore();
    const first = store.startSession("climb");
    vi.advanceTimersByTime(10 * 60_000);
    const second = store.startSession("gym");
    expect(second).toBe(null);
    // The running record holds the only copy of a start time nobody can
    // reconstruct. Replacing it would throw away a session in progress.
    expect(store.running.startMillis).toBe(first.startMillis);
    expect(store.running.typeId).toBe("climb");
  });

  it("writes a stop through the same path a typed-in session uses", () => {
    const store = useSessionsStore();
    store.startSession("climb");
    vi.advanceTimersByTime(42 * 60_000);
    const result = store.stopSession();

    expect(result.activeSeconds).toBe(42 * 60);
    expect(store.running).toBe(null);
    // Everything downstream joins on startMillis and treats it as any other
    // manual session: types, notes, corrections, merging, splitting, tombstones.
    const stored = store.manualSessions.find((s) => s.startMillis === result.startMillis);
    expect(stored).toBeTruthy();
    expect(stored.activeSeconds).toBe(42 * 60);
    // Absent rather than zero: the band measures these and Atlas did not.
    expect(stored.caloriesKcal).toBe(null);
    expect(stored.hrAvg).toBe(null);
  });

  it("discards a session shorter than a minute rather than storing a nil one", () => {
    const store = useSessionsStore();
    store.startSession("climb");
    vi.advanceTimersByTime(20_000);
    expect(store.stopSession()).toBe(null);
    expect(store.running).toBe(null);
    // A mistaken double tap must not become a row saying a thing happened for no
    // time at all.
    expect(store.manualSessions).toHaveLength(0);
  });

  it("can be abandoned without recording anything", () => {
    const store = useSessionsStore();
    store.startSession("climb");
    vi.advanceTimersByTime(30 * 60_000);
    store.cancelSession();
    expect(store.running).toBe(null);
    expect(store.manualSessions).toHaveLength(0);
  });

  it("takes a type change while it runs", () => {
    const store = useSessionsStore();
    store.startSession(null);
    store.setRunningType("climb");
    expect(store.running.typeId).toBe("climb");
    vi.advanceTimersByTime(30 * 60_000);
    const result = store.stopSession();
    expect(store.annotationFor(result.startMillis).typeId).toBe("climb");
  });

  it("starts without a type, for something not in the library yet", () => {
    const store = useSessionsStore();
    expect(store.startSession()).toBeTruthy();
    vi.advanceTimersByTime(30 * 60_000);
    expect(store.stopSession()).toBeTruthy();
  });
});
