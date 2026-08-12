import { describe, it, expect } from "vitest";
import {
  DEFAULT_DIALS,
  DIAL_CANDIDATES,
  DIAL_COUNT,
  dialFor,
  resolveDials,
} from "@/components/home/dialModel";

const all = () => true;

describe("resolveDials", () => {
  it("defaults to Recovery, Sleep and Steps", () => {
    expect(resolveDials(null, all)).toEqual(DEFAULT_DIALS);
  });

  it("keeps a stored choice in the order it was chosen", () => {
    expect(resolveDials(["water", "pai", "sleep"], all)).toEqual(["water", "pai", "sleep"]);
  });

  // The row is a fixed three across, so a dropped ring leaves a hole where the
  // layout expects one.
  it("always returns three, whatever it is given", () => {
    expect(resolveDials([], all)).toHaveLength(DIAL_COUNT);
    expect(resolveDials(["sleep"], all)).toHaveLength(DIAL_COUNT);
    expect(resolveDials(["a", "b", "c", "d", "e"], all)).toHaveLength(DIAL_COUNT);
  });

  // The case this function exists for: a stored choice naming a goal that has
  // since been switched off. A ring for a target nobody keeps can only read
  // zero, for ever, with nothing saying why.
  it("replaces a dial whose goal has been switched off", () => {
    const available = (key) => key !== "protein";
    const out = resolveDials(["protein", "sleep", "steps"], available);
    expect(out).not.toContain("protein");
    expect(out).toHaveLength(DIAL_COUNT);
    expect(out).toContain("sleep");
  });

  it("never shows the same dial twice", () => {
    const out = resolveDials(["sleep", "sleep", "sleep"], all);
    expect(new Set(out).size).toBe(DIAL_COUNT);
  });

  it("only ever returns real candidates", () => {
    for (const key of resolveDials(["nonsense", "rubbish"], all)) {
      expect(DIAL_CANDIDATES).toContain(key);
    }
  });
});

describe("dialFor", () => {
  const bag = {
    recoveryScore: 62,
    recoveryText: "62",
    recoveryColor: "gold",
    recoveryInk: "gold-ink",
    recoveryBand: "GOOD",
    sleepPct: 88,
    sleepText: "88",
    habitsDone: 3,
    habitsDue: 9,
    totals: { steps: 6400, protein: 90, water: 0 },
    goals: { steps: 8000, protein: 120, water: 2.5 },
    texts: { steps: "6,400" },
  };

  it("fills a goal metric's ring against its target", () => {
    expect(dialFor("steps", bag).pct).toBe(80);
  });

  // A ring reading full on a target nobody is keeping is the worst answer
  // available, and dividing by null gives exactly that.
  it("leaves a ring empty when the goal is switched off", () => {
    const off = { ...bag, goals: { ...bag.goals, steps: null } };
    expect(dialFor("steps", off).pct).toBe(0);
  });

  it("never overfills past 100", () => {
    const over = { ...bag, totals: { ...bag.totals, steps: 20000 } };
    expect(dialFor("steps", over).pct).toBe(100);
  });

  it("counts the routine rather than expressing it as a percentage", () => {
    const dial = dialFor("routine", bag);
    expect(dial.text).toBe("3/9");
    expect(dial.pct).toBeCloseTo(33.3, 0);
  });

  it("says nothing rather than 0/0 when no habit is due", () => {
    expect(dialFor("routine", { ...bag, habitsDue: 0 }).text).toBe("--");
  });

  it("glows only on a great recovery", () => {
    expect(dialFor("recovery", bag).glow).toBe(false);
    expect(dialFor("recovery", { ...bag, recoveryBand: "GREAT" }).glow).toBe(true);
  });

  it("sends the food metrics to the diary and the rest to their own page", () => {
    expect(dialFor("protein", bag).opens).toBe("food");
    expect(dialFor("steps", bag).opens).toBe("metric");
  });

  it("gives every candidate a label and a colour", () => {
    for (const key of DIAL_CANDIDATES) {
      const dial = dialFor(key, bag);
      expect(dial.label, key).toBeTruthy();
      expect(dial.color, key).toBeTruthy();
    }
  });
});
