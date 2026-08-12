import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { DEFAULT_GOALS, GOAL_KEYS, useGoalsStore, goalValue } from "@/stores/goals";

const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
  clear: () => backing.clear(),
};

describe("goals store", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  // The three anybody who installed a health app expects, and nothing else.
  // Protein, fibre and creatine are taken up rather than assumed, and a row of
  // 0/120G for somebody who has never thought about protein is the app telling
  // them they are failing at something they never started.
  it("starts with calories, water and steps on and the rest off", () => {
    const goals = useGoalsStore();
    const on = GOAL_KEYS.filter((key) => goals.isEnabled(key)).sort();
    expect(on).toEqual(["calories", "steps", "water"]);
  });

  // Null and 0 are different claims: null is a target you are not keeping, 0 is
  // one you have failed. Every consumer decides whether to draw a row on it.
  it("reports null rather than zero for a goal that is switched off", () => {
    const goals = useGoalsStore();
    expect(goals.valueFor("creatine")).toBe(null);
    goals.setEnabled("creatine", true);
    expect(goals.valueFor("creatine")).toBe(5);
  });

  // Goals that ship on, so a null here would mean the guard failed rather than
  // the goal being switched off.
  it("refuses a target of zero or less, which would divide every percentage by it", () => {
    const goals = useGoalsStore();
    goals.setValue("calories", 0);
    goals.setValue("steps", -5);
    goals.setValue("water", "not a number");
    expect(goals.valueFor("calories")).toBe(DEFAULT_GOALS.calories.value);
    expect(goals.valueFor("steps")).toBe(DEFAULT_GOALS.steps.value);
    expect(goals.valueFor("water")).toBe(DEFAULT_GOALS.water.value);
  });

  it("survives a reload", () => {
    useGoalsStore().setValue("calories", 2400);
    setActivePinia(createPinia());
    expect(useGoalsStore().valueFor("calories")).toBe(2400);
  });

  // A goal added in a later version has to appear for someone who already has a
  // stored record, rather than being silently absent because their JSON predates
  // it. This is the case that would otherwise fail as an undefined target.
  it("merges new goals over an older stored record", () => {
    localStorage.setItem("atlas_goals", JSON.stringify({ protein: { enabled: true, value: 200 } }));
    const goals = useGoalsStore();
    expect(goals.valueFor("protein")).toBe(200);
    expect(goals.valueFor("calories")).toBe(DEFAULT_GOALS.calories.value);
  });

  // The default is about a NEW install. Applying it to a phone with months of
  // creatine entries would delete a row somebody uses, on the launch after an
  // update, with nothing said.
  it("keeps a goal on for somebody who was already logging it", () => {
    localStorage.setItem(
      "atlas_checkins",
      JSON.stringify([{ date: "2026-08-01", creatine: 5, protein: 140 }])
    );
    const goals = useGoalsStore();
    expect(goals.isEnabled("creatine")).toBe(true);
    expect(goals.isEnabled("protein")).toBe(true);
    expect(goals.isEnabled("fibre")).toBe(false);
  });

  it("leaves a goal off when the history has none", () => {
    localStorage.setItem(
      "atlas_checkins",
      JSON.stringify([{ date: "2026-08-01", creatine: 0 }, { date: "2026-08-02" }])
    );
    expect(useGoalsStore().isEnabled("creatine")).toBe(false);
  });

  // metricRegistry is a plain module and its `goal` getters are read by tests
  // that never create a Pinia. Throwing there would make every consumer of the
  // registry need a store.
  it("falls back to the default outside an active store", () => {
    setActivePinia(undefined);
    expect(goalValue("calories")).toBe(DEFAULT_GOALS.calories.value);
    // Off by default, so the fallback has to report null rather than the value
    // it would have had if it were on.
    expect(goalValue("creatine")).toBe(null);
  });
});
