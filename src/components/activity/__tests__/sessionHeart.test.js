import { describe, it, expect } from "vitest";
import {
  heartGeometry,
  heartStats,
  scaledCalories,
  timeAtFraction,
  edgeNearest,
} from "../sessionHeart";

// Shaped like the user's real 27 July: quiet, then working, then still working
// for an hour after the band stopped counting, then coming down.
const START = new Date("2026-07-27T18:20:00").getTime();
const BAND_END = START + 75 * 60_000;
const REAL_END = START + 135 * 60_000;

function evening() {
  const out = [];
  for (let m = -20; m <= 180; m++) {
    let v;
    if (m < 0) v = 80;
    else if (m < 135) v = 120;
    else v = 75;
    out.push({ t: START + m * 60_000, v });
  }
  return out;
}

describe("heartGeometry", () => {
  it("draws the whole window, not only the logged part", () => {
    const geo = heartGeometry(evening(), { startMillis: START, endMillis: BAND_END });
    expect(geo.viewStart).toBe(START - 20 * 60_000);
    expect(geo.viewEnd).toBe(START + 180 * 60_000);
  });

  // The band is where the session is claimed to be; the line keeps running past
  // it, which is exactly the comparison the chart exists to make.
  it("grows the marked band as the chosen end moves out", () => {
    const short = heartGeometry(evening(), { startMillis: START, endMillis: BAND_END });
    const long = heartGeometry(evening(), { startMillis: START, endMillis: REAL_END });
    expect(long.bandWidth).toBeGreaterThan(short.bandWidth);
    expect(long.endX).toBeGreaterThan(short.endX);
  });

  it("keeps the end marker on the chart when the chosen end runs past the samples", () => {
    const geo = heartGeometry(evening(), {
      startMillis: START,
      endMillis: START + 999 * 60_000,
    });
    expect(geo.endX).toBeLessThanOrEqual(geo.width);
  });

  it("returns null rather than a flat line when there is nothing to draw", () => {
    expect(heartGeometry([], { startMillis: START, endMillis: BAND_END })).toBe(null);
    expect(heartGeometry([{ t: START, v: 90 }], { startMillis: START, endMillis: BAND_END })).toBe(
      null
    );
  });

  it("pads the vertical range so the line never sits on an edge", () => {
    const geo = heartGeometry(evening(), { startMillis: START, endMillis: BAND_END });
    expect(geo.lo).toBeLessThan(75);
    expect(geo.hi).toBeGreaterThan(120);
  });
});

describe("timeAtFraction", () => {
  const geo = heartGeometry(evening(), { startMillis: START, endMillis: BAND_END });

  it("maps across the drawn window, not across the session", () => {
    expect(timeAtFraction(geo, 0)).toBe(geo.viewStart);
    expect(timeAtFraction(geo, 1)).toBe(geo.viewEnd);
    expect(timeAtFraction(geo, 0.5)).toBe(
      Math.round((geo.viewStart + geo.viewEnd) / 2)
    );
  });

  // A tap past an edge means "as far as I can see", not a time with no reading.
  it("clamps a tap outside the chart to its ends", () => {
    expect(timeAtFraction(geo, -0.4)).toBe(geo.viewStart);
    expect(timeAtFraction(geo, 1.8)).toBe(geo.viewEnd);
  });

  it("has nothing to say without a chart", () => {
    expect(timeAtFraction(null, 0.5)).toBe(null);
  });
});

describe("heartStats", () => {
  // The band's own averages describe the band's window. Editing the duration
  // changes the window, so the numbers have to be recomputed or they describe
  // something that is no longer on screen.
  it("averages only the chosen window", () => {
    const working = heartStats(evening(), { startMillis: START, endMillis: BAND_END });
    expect(working.avg).toBe(120);

    const withCooldown = heartStats(evening(), {
      startMillis: START,
      endMillis: START + 180 * 60_000,
    });
    expect(withCooldown.avg).toBeLessThan(120);
  });

  it("returns null rather than averaging one or two stray readings", () => {
    expect(heartStats(evening(), { startMillis: START, endMillis: START + 60_000 })).toBe(
      null
    );
    expect(heartStats([], { startMillis: START, endMillis: BAND_END })).toBe(null);
  });
});

describe("scaledCalories", () => {
  it("passes the band's own figure through untouched when nothing was edited", () => {
    expect(scaledCalories(594, 4500, 4500)).toEqual({ kcal: 594, estimated: false });
  });

  // Flagged, always. The extra time is assumed to have been worked at the same
  // intensity, which is an assumption the user can check on the chart but which
  // the number must never hide.
  it("scales pro-rata and admits it is an estimate once edited", () => {
    expect(scaledCalories(594, 4500, 9000)).toEqual({ kcal: 1188, estimated: true });
  });

  it("gives nothing rather than zero when the band reported no calories", () => {
    expect(scaledCalories(null, 4500, 9000)).toBe(null);
    expect(scaledCalories(594, 0, 9000)).toBe(null);
  });
});

describe("edgeNearest", () => {
  const span = { startMillis: 1000, endMillis: 3000 };

  it("reads a tap before the session as being about its start", () => {
    // The band starting late is the case this exists for, so a tap out in the
    // run-up can only mean one thing.
    expect(edgeNearest(500, span)).toBe("start");
  });

  it("reads a tap past the session as being about its end", () => {
    expect(edgeNearest(5000, span)).toBe("end");
  });

  it("gives the midpoint to whichever end is nearer", () => {
    expect(edgeNearest(1400, span)).toBe("start");
    expect(edgeNearest(2600, span)).toBe("end");
  });

  it("has no answer for no tap", () => {
    expect(edgeNearest(null, span)).toBeNull();
  });
});
