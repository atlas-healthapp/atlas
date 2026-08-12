import { describe, it, expect } from "vitest";
import {
  stressDayGeometry,
  zoneMinutes,
  zoneFor,
  averageBetween,
  longestCalm,
  GAP_MINUTES,
} from "../stressDay";

const DAY = "2026-07-29";
const at = (hour, minute = 0) =>
  new Date(`${DAY}T00:00:00`).getTime() + (hour * 60 + minute) * 60_000;

/** Every seven minutes, the way the band actually reports. */
function day({ from = 0, to = 24, value = () => 20 } = {}) {
  const out = [];
  for (let m = from * 60; m < to * 60; m += 7) {
    out.push({ t: at(0, m), v: value(m / 60) });
  }
  return out;
}

describe("zoneFor", () => {
  it("names the zone rather than leaving a bare number", () => {
    expect(zoneFor(12).key).toBe("calm");
    expect(zoneFor(51).key).toBe("mild");
    expect(zoneFor(66).key).toBe("moderate");
    expect(zoneFor(90).key).toBe("high");
  });

  it("puts the boundary values in the lower zone, as the labels imply", () => {
    expect(zoneFor(39).key).toBe("calm");
    expect(zoneFor(40).key).toBe("mild");
    expect(zoneFor(59).key).toBe("mild");
  });
});

describe("stressDayGeometry", () => {
  // The band has never reported above 66. Scaling to 100 would draw every day
  // in the bottom two thirds of the box and read as a broken instrument.
  it("scales to the day's own peak, not to the top of the scale", () => {
    const quiet = stressDayGeometry(day({ value: () => 20 }));
    const busy = stressDayGeometry(day({ value: () => 60 }));
    expect(quiet.peak).toBeLessThan(busy.peak);
    expect(quiet.peak).toBeLessThan(60);
  });

  // A line across four hours off the wrist claimed a calm afternoon that was
  // never measured. Columns leave a hole instead, which is what actually
  // happened.
  it("leaves a hole where the band was not reporting", () => {
    const morning = day({ from: 6, to: 8 });
    const evening = day({ from: 18, to: 20 });
    const geo = stressDayGeometry([...morning, ...evening]);

    const xs = geo.columns.map((c) => c.x).sort((a, b) => a - b);
    const biggestJump = Math.max(...xs.slice(1).map((v, i) => v - xs[i]));
    // The ten-hour hole is most of the axis, and nothing is drawn across it.
    expect(biggestJump).toBeGreaterThan(50);
    expect(geo.columns.every((c) => c.width < 10)).toBe(true);
  });

  it("sizes columns from the typical spacing, not by dividing the axis", () => {
    // A dense hour and a sparse one. Even columns would stretch the sparse
    // patch until it looked as busy as the dense one.
    const dense = [];
    for (let m = 0; m < 60; m += 5) dense.push({ t: at(6, m), v: 20 });
    const sparse = [{ t: at(8), v: 20 }, { t: at(8, 30), v: 20 }];
    const geo = stressDayGeometry([...dense, ...sparse]);

    const spanMinutes = 150;
    const expected = (5 / spanMinutes) * 100 * 0.82;
    expect(geo.barWidth).toBeCloseTo(expected, 1);
  });

  // A reading hovering either side of 40 made the line alternate blue and
  // green every few minutes, which read as two lines crossing rather than one
  // line near a boundary.
  it("does not flicker zone while a reading sits on a boundary", () => {
    const wobble = [38, 41, 39, 42, 38, 41].map((v, i) => ({ t: at(12, i * 7), v }));
    const zones = new Set(stressDayGeometry(wobble).columns.map((c) => c.zone.key));
    expect(zones.size).toBe(1);
  });

  it("still follows a genuine move into another zone", () => {
    const climb = [20, 25, 38, 48, 55, 58].map((v, i) => ({ t: at(12, i * 7), v }));
    const zones = stressDayGeometry(climb).columns.map((c) => c.zone.key);
    expect(zones[0]).toBe("calm");
    expect(zones.at(-1)).toBe("mild");
  });

  // At 9am a midnight-to-midnight axis spent two thirds of its width on hours
  // that had not happened yet.
  it("clips the axis to what was actually reported", () => {
    const morning = day({ from: 6, to: 9 });
    const geo = stressDayGeometry(morning);
    const centres = geo.columns.map((c) => c.x + c.width / 2);
    expect(centres[0]).toBeCloseTo(0, 1);
    expect(centres.at(-1)).toBeCloseTo(100, 0);
    expect(new Date(geo.firstMillis).getHours()).toBe(6);
  });

  it("returns null rather than a flat line when there is nothing to draw", () => {
    expect(stressDayGeometry([])).toBe(null);
    expect(stressDayGeometry([{ t: at(12), v: 40 }])).toBe(null);
  });
});

describe("zoneMinutes", () => {
  it("counts elapsed time, not readings, so a dense patch does not outweigh a sparse one", () => {
    const dense = [];
    for (let m = 0; m < 60; m += 1) dense.push({ t: at(1, m), v: 50 });
    const sparse = [];
    for (let m = 0; m < 60; m += 20) sparse.push({ t: at(3, m), v: 10 });

    const { totals } = zoneMinutes([...dense, ...sparse]);
    expect(Math.round(totals.mild)).toBe(59);
    expect(Math.round(totals.calm)).toBe(40);
  });

  // The band was off the wrist. That is not calm.
  it("does not count a long gap as time in any zone", () => {
    const { totals, measured } = zoneMinutes([
      { t: at(2), v: 10 },
      { t: at(14), v: 10 },
    ]);
    expect(measured).toBe(0);
    expect(totals.calm).toBe(0);
  });
});

describe("averageBetween", () => {
  it("averages only inside the window", () => {
    const samples = day({ value: (h) => (h < 12 ? 10 : 50) });
    expect(averageBetween(samples, 0, 360)).toBe(10);
    expect(averageBetween(samples, 720, 1080)).toBe(50);
  });

  it("returns null rather than zero for a window with no readings", () => {
    expect(averageBetween(day({ from: 6, to: 8 }), 0, 300)).toBe(null);
  });
});

describe("longestCalm", () => {
  it("finds the longest unbroken calm stretch", () => {
    const samples = [
      ...day({ from: 0, to: 5, value: () => 10 }),
      ...day({ from: 5, to: 6, value: () => 55 }),
      ...day({ from: 6, to: 8, value: () => 10 }),
    ];
    expect(longestCalm(samples)).toBeGreaterThan(4 * 60);
    expect(longestCalm(samples)).toBeLessThan(5 * 60 + 10);
  });

  it("does not count a stretch the band slept through", () => {
    expect(
      longestCalm([
        { t: at(1), v: 10 },
        { t: at(13), v: 10 },
      ])
    ).toBe(0);
  });
});
