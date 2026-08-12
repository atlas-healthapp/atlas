import { describe, it, expect } from "vitest";
import {
  trailingAverages,
  levelFrom,
  levelWeight,
  conditionTerm,
  LEVEL_MIN_NIGHTS,
  LEVEL_FULL_NIGHTS,
  LEVEL_FLOOR,
} from "@/utils/level";

/** n nights all at the same value, which makes the arithmetic checkable by eye. */
const flat = (n, v) => Array.from({ length: n }, () => v);

describe("trailingAverages", () => {
  it("returns one average per position once the window has filled", () => {
    expect(trailingAverages([1, 2, 3, 4], 2)).toEqual([1.5, 2.5, 3.5]);
  });

  it("returns nothing until there are enough readings", () => {
    expect(trailingAverages([1, 2], 7)).toEqual([]);
  });

  it("closes gaps up rather than averaging across a night with no reading", () => {
    // A null is not a reading. Dropping it is what stops a missing night being
    // silently invented as the mean of its neighbours.
    expect(trailingAverages([10, null, 20], 2)).toEqual([15]);
  });
});

describe("levelFrom", () => {
  it("withholds itself until there is enough history", () => {
    const out = levelFrom(flat(LEVEL_MIN_NIGHTS - 1, 100));
    expect(out.state).toBe("calibrating");
    expect(out.needed).toBe(LEVEL_MIN_NIGHTS);
  });

  it("scores full marks when you are sitting at your own ceiling", () => {
    const out = levelFrom(flat(LEVEL_MIN_NIGHTS, 100));
    expect(out.state).toBe("ready");
    expect(out.value).toBeCloseTo(1, 5);
  });

  it("scores zero at the floor and nothing below it", () => {
    // Thirty nights at the ceiling, then thirty far under it.
    const values = [...flat(30, 100), ...flat(30, 40)];
    const out = levelFrom(values);
    expect(out.ratio).toBeLessThan(LEVEL_FLOOR);
    expect(out.value).toBe(0);
  });

  it("puts a reading midway between floor and ceiling at about half", () => {
    const mid = 100 * (LEVEL_FLOOR + (1 - LEVEL_FLOOR) / 2);
    const out = levelFrom([...flat(30, 100), ...flat(30, mid)]);
    expect(out.value).toBeCloseTo(0.5, 1);
  });

  it("inverts for a metric where lower is better", () => {
    // Resting heart rate: the ceiling is the lowest sustained average, and being
    // above it is the bad direction.
    const out = levelFrom([...flat(30, 50), ...flat(30, 60)], { higherIsBetter: false });
    expect(out.ceiling).toBeCloseTo(50, 1);
    expect(out.value).toBeLessThan(1);

    const atBest = levelFrom(flat(40, 50), { higherIsBetter: false });
    expect(atBest.value).toBeCloseTo(1, 5);
  });

  it("does not score over full marks when today beats the ceiling", () => {
    const out = levelFrom([...flat(35, 100), ...flat(10, 200)]);
    expect(out.value).toBe(1);
  });

  it("is not dragged to the maximum by one lucky week", () => {
    // The whole reason the ceiling is a percentile. One exceptional week inside
    // a long ordinary history should barely move the bar.
    const steady = flat(180, 100);
    const withSpike = [...flat(170, 100), ...flat(10, 200)];
    const a = levelFrom(steady).ceiling;
    const b = levelFrom(withSpike).ceiling;
    expect(b - a).toBeLessThan(a * 0.25);
  });
});

describe("levelWeight", () => {
  it("is nothing before the gate and everything after the ramp", () => {
    expect(levelWeight(LEVEL_MIN_NIGHTS - 1)).toBe(0);
    expect(levelWeight(LEVEL_FULL_NIGHTS)).toBe(1);
    expect(levelWeight(LEVEL_FULL_NIGHTS + 50)).toBe(1);
  });

  it("fades in rather than switching on", () => {
    const mid = (LEVEL_MIN_NIGHTS + LEVEL_FULL_NIGHTS) / 2;
    expect(levelWeight(mid)).toBeCloseTo(0.5, 2);
  });
});

describe("conditionTerm", () => {
  const ready = (value) => ({ state: "ready", value, weight: 1 });

  it("scores your level exactly on an ordinary day", () => {
    // The point of the whole rework: a reading on your own baseline used to earn
    // half marks by construction, which punished consistency.
    expect(conditionTerm(ready(0.8), 0.5)).toBeCloseTo(0.8, 5);
  });

  it("lifts a great reading and bites on a bad one, by no more than 0.2", () => {
    expect(conditionTerm(ready(0.5), 1)).toBeCloseTo(0.7, 5);
    expect(conditionTerm(ready(0.5), 0)).toBeCloseTo(0.3, 5);
  });

  it("keeps a sustained ceiling at full marks day after day", () => {
    // Being at your best should not decay because it stopped being news.
    expect(conditionTerm(ready(1), 0.5)).toBeCloseTo(1, 5);
    expect(conditionTerm(ready(1), 0.5)).toBeCloseTo(1, 5);
  });

  it("falls back to responsiveness alone while level is calibrating", () => {
    expect(conditionTerm({ state: "calibrating" }, 0.42)).toBeCloseTo(0.42, 5);
    expect(conditionTerm(null, 0.42)).toBeCloseTo(0.42, 5);
  });

  it("blends the two shapes while the level term is fading in", () => {
    const half = { state: "ready", value: 1, weight: 0.5 };
    // Half way between the old shape (0.5) and the new one (1.0).
    expect(conditionTerm(half, 0.5)).toBeCloseTo(0.75, 5);
  });

  it("passes a missing reading through as missing", () => {
    expect(conditionTerm(ready(0.8), null)).toBeNull();
  });
});
