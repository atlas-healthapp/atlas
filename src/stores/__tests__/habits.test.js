import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useHabitsStore } from "@/stores/habits";
import { today } from "@/utils/date";
import { bandForHour } from "@/utils/bands";

// Same stub as sessions.test.js: the suite runs in node, and utils/storage.js
// only ever touches these four methods.
const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
  clear: () => backing.clear(),
};

describe("habits store", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("stamps a new habit with the day it was created", () => {
    const store = useHabitsStore();
    store.addHabit("Stretch");
    expect(store.habits[0].created).toBe(today());
  });

  it("takes the band it is given, and otherwise the one the clock is in", () => {
    const store = useHabitsStore();
    store.addHabit("Read 20 min", [0, 1, 2, 3, 4, 5, 6], "night");
    expect(store.habits[0].band).toBe("night");

    store.addHabit("Stretch");
    expect(store.habits[1].band).toBe(bandForHour(new Date().getHours()));
  });

  // The point of editing in place rather than replacing: ticks join on the
  // habit's id, so a rename that minted a new id would silently drop the
  // history it was renaming.
  it("keeps a habit's ticks when it is renamed, re-timed and re-banded", () => {
    const store = useHabitsStore();
    store.addHabit("Strech", [1, 3, 5], "morning");
    const { id } = store.habits[0];
    store.toggle(id, "2026-07-27");

    store.updateHabit(id, {
      name: "Stretch",
      days: [0, 1, 2, 3, 4, 5, 6],
      band: "evening",
    });

    expect(store.habits[0].name).toBe("Stretch");
    expect(store.habits[0].days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(store.habits[0].band).toBe("evening");
    expect(store.isDone(id, "2026-07-27")).toBe(true);
  });

  it("ignores an empty name, an empty week or an unknown band", () => {
    const store = useHabitsStore();
    store.addHabit("Stretch", [1, 3], "morning");
    const { id } = store.habits[0];

    store.updateHabit(id, { name: "", days: [], band: "afternoon" });

    expect(store.habits[0].name).toBe("Stretch");
    expect(store.habits[0].days).toEqual([1, 3]);
    expect(store.habits[0].band).toBe("morning");
  });

  it("does nothing for an id that is not there", () => {
    const store = useHabitsStore();
    store.addHabit("Stretch");
    expect(() => store.updateHabit("nope", { name: "X" })).not.toThrow();
    expect(store.habits[0].name).toBe("Stretch");
  });

  // The distinction between the two ways out: archive keeps the history,
  // delete takes it. A delete that left the ticks behind would leave them
  // unreachable but still stored, and a habit added later under the same name
  // would count somebody else's days.
  it("deletes a habit and its ticks, leaving every other habit alone", () => {
    const store = useHabitsStore();
    store.addHabit("Stretch");
    store.addHabit("Read 20 min");
    const [stretch, read] = store.habits;
    store.toggle(stretch.id, "2026-07-27");
    store.toggle(stretch.id, "2026-07-28");
    store.toggle(read.id, "2026-07-27");

    expect(store.tickCount(stretch.id)).toBe(2);
    store.deleteHabit(stretch.id);

    expect(store.habits.map((h) => h.name)).toEqual(["Read 20 min"]);
    expect(store.ticks).toHaveLength(1);
    expect(store.isDone(read.id, "2026-07-27")).toBe(true);
  });

  it("does nothing when asked to delete an id that is not there", () => {
    const store = useHabitsStore();
    store.addHabit("Stretch");
    store.toggle(store.habits[0].id, "2026-07-27");

    store.deleteHabit("nope");

    expect(store.habits).toHaveLength(1);
    expect(store.ticks).toHaveLength(1);
  });

  it("archives and restores without touching the ticks", () => {
    const store = useHabitsStore();
    store.addHabit("Stretch");
    const { id } = store.habits[0];
    store.toggle(id, "2026-07-27");

    store.archiveHabit(id);
    expect(store.habits[0].archived).toBe(true);
    expect(store.dueOn("2026-07-27")).toEqual([]);

    store.unarchiveHabit(id);
    expect(store.habits[0].archived).toBe(false);
    expect(store.isDone(id, "2026-07-27")).toBe(true);
  });
});
