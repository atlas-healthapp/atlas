import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { SUGGESTED_TYPES, useSessionsStore } from "@/stores/sessions";

// The suite runs in the node environment (see vitest.config.js) and there is no
// jsdom in this project, so localStorage is stubbed here rather than pulling in
// a DOM for one file. Only the four methods utils/storage.js actually uses.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

/** What this suite was written against, back when the store seeded them. */
const WAS_SEEDED = ["Gym", "Indoor Climbing", "Outdoor Climbing"];

describe("sessions store", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    // The store no longer seeds anything: suggestions are offered in the picker
    // and only enter the store when one is chosen. Every case below still wants
    // these three to exist, so the suite adds them itself rather than each test
    // growing its own setup.
    const seeded = useSessionsStore();
    WAS_SEEDED.forEach((name) => seeded.addType(name));
  });

  // The behaviour that replaced seeding. A seeded type is *yours* from the
  // moment you install, so a new user's list opened pre-filled with somebody
  // else's activities and they had to archive them one at a time.
  it("starts with no types at all, so the list is only ever what you chose", () => {
    localStorage.clear();
    setActivePinia(createPinia());
    expect(useSessionsStore().types).toHaveLength(0);
  });

  it("offers suggestions without writing any of them into the store", () => {
    localStorage.clear();
    setActivePinia(createPinia());
    const fresh = useSessionsStore();

    expect(SUGGESTED_TYPES.length).toBeGreaterThan(0);
    expect(fresh.types).toHaveLength(0);
    // Alphabetical, so the suggested group and activeTypes read as one list
    // rather than as two different orderings stacked on each other.
    expect([...SUGGESTED_TYPES].sort((a, b) => a.localeCompare(b))).toEqual(
      SUGGESTED_TYPES
    );
  });

  it("adds a suggestion as an ordinary type once it is picked", () => {
    localStorage.clear();
    setActivePinia(createPinia());
    const fresh = useSessionsStore();

    const added = fresh.addType("Swimming");
    expect(added.name).toBe("Swimming");
    expect(fresh.activeTypes.map((t) => t.name)).toEqual(["Swimming"]);
  });

  // Two of the same type would split the totals that are the entire reason
  // types exist.
  it("treats a name that differs only by case as the same type", () => {
    const store = useSessionsStore();
    const before = store.types.length;
    const again = store.addType("gym");
    expect(store.types).toHaveLength(before);
    expect(again.name).toBe("Gym");
  });

  it("revives an archived type rather than making a second one", () => {
    const store = useSessionsStore();
    const gym = store.activeTypes.find((t) => t.name === "Gym");
    store.archiveType(gym.id);

    const revived = store.addType("Gym");
    expect(revived.id).toBe(gym.id);
    expect(store.activeTypes.some((t) => t.id === gym.id)).toBe(true);
  });

  // A type that vanished would leave months of history silently unnamed again.
  it("keeps an archived type readable for sessions already labelled with it", () => {
    const store = useSessionsStore();
    const gym = store.activeTypes.find((t) => t.name === "Gym");
    store.setType(1000, gym.id);
    store.archiveType(gym.id);

    expect(store.activeTypes.some((t) => t.id === gym.id)).toBe(false);
    expect(store.typeNameFor({ startMillis: 1000 })).toBe("Gym");
  });

  it("ignores a blank name instead of creating an unnamed type", () => {
    const store = useSessionsStore();
    const before = store.types.length;
    expect(store.addType("   ")).toBe(null);
    expect(store.types).toHaveLength(before);
  });

  it("keeps the type and the note on one annotation per session", () => {
    const store = useSessionsStore();
    const gym = store.activeTypes.find((t) => t.name === "Gym");
    store.setType(2000, gym.id);
    store.setNote(2000, "  shoulders  ");

    expect(store.sessions).toHaveLength(1);
    expect(store.annotationFor(2000)).toMatchObject({
      typeId: gym.id,
      note: "shoulders",
      source: "helio",
      manual: null,
    });
  });

  it("clears a type without discarding the note beside it", () => {
    const store = useSessionsStore();
    const gym = store.activeTypes.find((t) => t.name === "Gym");
    store.setType(3000, gym.id);
    store.setNote(3000, "felt heavy");
    store.setType(3000, null);

    expect(store.typeNameFor({ startMillis: 3000 })).toBe(null);
    expect(store.annotationFor(3000).note).toBe("felt heavy");
  });

  it("counts what still needs naming", () => {
    const store = useSessionsStore();
    const gym = store.activeTypes.find((t) => t.name === "Gym");
    store.setType(1000, gym.id);

    const workouts = [{ startMillis: 1000 }, { startMillis: 2000 }, { startMillis: 3000 }];
    expect(store.unnamedCount(workouts)).toBe(2);
  });

  // Annotations are joined to device records that a sync overwrites wholesale,
  // so they have to survive being written before the workout is even seen.
  it("survives a reload, and annotates a session it has never seen", () => {
    const store = useSessionsStore();
    const gym = store.activeTypes.find((t) => t.name === "Gym");
    store.setType(4000, gym.id);

    setActivePinia(createPinia());
    const reloaded = useSessionsStore();
    expect(reloaded.typeNameFor({ startMillis: 4000 })).toBe("Gym");
  });

  // Reported from the phone: pulling a climb's start back half an hour dropped
  // its type and the row went back to UNNAMED SESSION. `resolve` was handing
  // back `recordStartMillis` correctly and only the detail sheet was using it,
  // so every lookup that takes a resolved workout was searching under a time
  // nothing had ever been stored at.
  describe("annotations survive a corrected start", () => {
    const band = { startMillis: 9000, activeSeconds: 600 };

    it("still knows the type after the start has been moved", () => {
      const store = useSessionsStore();
      const type = store.addType("Indoor Climbing");
      store.setType(9000, type.id);
      store.setStart(9000, 6000);

      const resolved = store.resolve(band);
      expect(resolved.startMillis).toBe(6000);
      expect(store.typeNameFor(resolved)).toBe("Indoor Climbing");
    });

    it("still knows a tombstone after the start has been moved", () => {
      const store = useSessionsStore();
      store.setHidden(9000, true);
      store.setStart(9000, 6000);
      expect(store.isHidden(store.resolve(band))).toBe(true);
    });

    it("keeps working on a workout that was never resolved", () => {
      // No `recordStartMillis` on a raw record, so the key falls back to its own
      // start, which is the same value.
      const store = useSessionsStore();
      const type = store.addType("Gym");
      store.setType(9000, type.id);
      expect(store.typeNameFor(band)).toBe("Gym");
    });
  });

  // The band stops counting during the standing around, so a climb logged as
  // 1h15 was really two and a half hours.
  describe("duration corrections", () => {
    const band = { startMillis: 9000, activeSeconds: 4529, caloriesKcal: 594 };

    it("leaves an uncorrected session exactly as the band recorded it", () => {
      const store = useSessionsStore();
      expect(store.resolve(band)).toBe(band);
    });

    it("applies a correction without losing what the band said", () => {
      const store = useSessionsStore();
      store.setDuration(9000, 9000);

      const got = store.resolve(band);
      expect(got.activeSeconds).toBe(9000);
      expect(got.bandActiveSeconds).toBe(4529);
      expect(got.edited).toBe(true);
      // Everything else is still the device's.
      expect(got.caloriesKcal).toBe(594);
    });

    it("reverts to the band's own figure", () => {
      const store = useSessionsStore();
      store.setDuration(9000, 9000);
      store.setDuration(9000, null);
      expect(store.resolve(band).activeSeconds).toBe(4529);
      expect(store.resolve(band).edited).toBeUndefined();
    });

    it("refuses a zero or negative duration rather than storing one", () => {
      const store = useSessionsStore();
      store.setDuration(9000, 0);
      expect(store.resolve(band).activeSeconds).toBe(4529);
      store.setDuration(9000, -60);
      expect(store.resolve(band).activeSeconds).toBe(4529);
    });

    it("keeps the correction and the type on the same annotation", () => {
      const store = useSessionsStore();
      const gym = store.activeTypes.find((t) => t.name === "Gym");
      store.setType(9000, gym.id);
      store.setDuration(9000, 9000);

      expect(store.sessions).toHaveLength(1);
      expect(store.resolve(band).activeSeconds).toBe(9000);
      expect(store.typeNameFor(band)).toBe("Gym");
    });

    // A sync overwrites the device record wholesale. The correction has to
    // outlive that, which is the whole reason it is not stored there.
    it("survives a reload", () => {
      const store = useSessionsStore();
      store.setDuration(9000, 9000);

      setActivePinia(createPinia());
      expect(useSessionsStore().resolve(band).activeSeconds).toBe(9000);
    });
  });

  describe("merging and deleting", () => {
    it("hides a session without touching the device record", () => {
      const store = useSessionsStore();
      store.setHidden(1000, true);
      expect(store.isHidden({ startMillis: 1000 })).toBe(true);
      store.setHidden(1000, false);
      expect(store.isHidden({ startMillis: 1000 })).toBe(false);
    });

    it("gives the group to the earliest record", () => {
      const store = useSessionsStore();
      expect(store.merge([3000, 1000, 2000])).toBe(1000);
      expect(store.membersOf(1000)).toEqual([2000, 3000]);
    });

    it("refuses to merge fewer than two", () => {
      const store = useSessionsStore();
      expect(store.merge([1000])).toBe(null);
      expect(store.merge([])).toBe(null);
    });

    // Otherwise merging a merged session leaves a chain nothing follows.
    it("absorbs an existing group rather than nesting one inside another", () => {
      const store = useSessionsStore();
      store.merge([2000, 3000]);
      store.merge([1000, 2000]);

      expect(store.membersOf(1000).sort()).toEqual([2000, 3000]);
      expect(store.membersOf(2000)).toEqual([]);
    });

    it("splits back apart without having destroyed anything", () => {
      const store = useSessionsStore();
      store.merge([1000, 2000]);
      store.unmerge(1000);
      expect(store.membersOf(1000)).toEqual([]);
    });

    it("keeps a type set on the group through a split", () => {
      const store = useSessionsStore();
      const gym = store.activeTypes.find((t) => t.name === "Gym");
      store.merge([1000, 2000]);
      store.setType(1000, gym.id);
      store.unmerge(1000);
      expect(store.typeNameFor({ startMillis: 1000 })).toBe("Gym");
    });

    it("survives a reload", () => {
      const store = useSessionsStore();
      store.merge([1000, 2000]);
      store.setHidden(5000, true);

      setActivePinia(createPinia());
      const reloaded = useSessionsStore();
      expect(reloaded.membersOf(1000)).toEqual([2000]);
      expect(reloaded.isHidden({ startMillis: 5000 })).toBe(true);
    });
  });

  it("renames a type everywhere at once, since sessions reference it by id", () => {
    const store = useSessionsStore();
    const gym = store.activeTypes.find((t) => t.name === "Gym");
    store.setType(5000, gym.id);
    store.renameType(gym.id, "Strength");

    expect(store.typeNameFor({ startMillis: 5000 })).toBe("Strength");
  });
});
