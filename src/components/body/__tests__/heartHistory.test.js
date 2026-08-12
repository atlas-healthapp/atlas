import { describe, it, expect } from "vitest";
import { heartByDay, heartHistoryBars, HISTORY_DAYS } from "@/components/body/heartHistory";
import { RESTING_PERCENTILE } from "@/components/body/heartDay";
import { percentile } from "@/utils/bodyMetrics";

const DATES = ["2026-08-01", "2026-08-02", "2026-08-03"];

/** A reading every ten minutes across `date`, cycling through `values`. */
function dayOf(date, values) {
  const base = new Date(`${date}T00:00:00`).getTime();
  return values.map((v, i) => ({ t: base + i * 600000, v }));
}

/**
 * `values` spread evenly across the 24 hours of `date`.
 *
 * Needed alongside dayOf because a real day holds 1,300-1,440 readings and a
 * fixed ten-minute spacing would run a set that size days past its own date,
 * scattering it across every slot in the window.
 */
function denseDay(date, values) {
  const base = new Date(`${date}T00:00:00`).getTime();
  const step = 86400000 / values.length;
  return values.map((v, i) => ({ t: base + Math.floor(i * step), v }));
}

/**
 * A day shaped like the archive's: a long quiet night, a working day, one hard
 * session, and a few dropped readings well below anything physiological.
 */
function realisticDay() {
  const values = [];
  for (let i = 0; i < 480; i++) values.push(48 + (i % 5)); // asleep, 48-52
  for (let i = 0; i < 720; i++) values.push(65 + (i % 21)); // awake, 65-85
  for (let i = 0; i < 120; i++) values.push(140 + (i % 36)); // a session, 140-175
  for (let i = 0; i < 120; i++) values.push(60 + (i % 11)); // evening, 60-70
  values.push(35, 36, 35); // dropouts: real in the archive, not resting rates
  return values;
}

describe("heartByDay", () => {
  it("keeps a slot for a day the band reported nothing", () => {
    const out = heartByDay(dayOf("2026-08-01", [60, 70]), DATES);

    expect(out).toHaveLength(3);
    expect(out[1]).toMatchObject({ date: "2026-08-02", resting: null, high: null, samples: 0 });
  });

  it("takes resting from a percentile and the high from the top reading", () => {
    // One stray 30 must not become the day's resting rate.
    const values = [...Array(100).fill(60), 30, 170];
    const out = heartByDay(dayOf("2026-08-01", values), DATES);

    expect(out[0].resting).toBe(60);
    expect(out[0].high).toBe(170);
  });

  it("assigns each sample to its own local date", () => {
    const out = heartByDay(
      [...dayOf("2026-08-01", [50]), ...dayOf("2026-08-03", [90])],
      DATES
    );

    expect(out[0].samples).toBe(1);
    expect(out[1].samples).toBe(0);
    expect(out[2].samples).toBe(1);
  });

  it("rests on the same definition bodyMetrics uses, not a second one", () => {
    // heartByDay takes the nearest-rank reading at RESTING_PERCENTILE while
    // bodyMetrics.percentile interpolates and rounds to a decimal, so they are
    // two implementations of one definition rather than one shared function.
    // Measured against the real archive on 2026-08-10 they returned the same
    // integer on all seven days in the window, which is what a day of 1,300+
    // readings does to an interpolation. This pins them together: swapping in a
    // raw minimum, a different percentile or the band's own restingHr all move
    // the answer by more than a beat.
    const values = realisticDay();
    const out = heartByDay(denseDay("2026-08-01", values), DATES);

    expect(Math.abs(out[0].resting - percentile(values, RESTING_PERCENTILE))).toBeLessThanOrEqual(1);
  });

  it("does not let a dropped reading become the day's resting rate", () => {
    // The same realistic day bottoms out at 35, which is the sensor losing the
    // wrist rather than a heart rate. A percentile has to ignore it; a minimum
    // would draw every bar from there and make the window's axis meaningless.
    const values = realisticDay();
    const out = heartByDay(denseDay("2026-08-01", values), DATES);

    expect(Math.min(...values)).toBe(35);
    expect(out[0].resting).toBeGreaterThan(45);
    expect(out[0].resting).toBeLessThan(55);
  });

  it("ignores malformed samples", () => {
    const out = heartByDay(
      [{ t: NaN, v: 60 }, { t: Date.now(), v: null }, null],
      DATES
    );
    for (const d of out) expect(d.samples).toBe(0);
  });
});

describe("heartHistoryBars", () => {
  const days = [
    { date: "2026-08-01", resting: 48, high: 120, mean: 70, samples: 100 },
    { date: "2026-08-02", resting: 51, high: 173, mean: 76, samples: 100 },
    { date: "2026-08-03", resting: null, high: null, mean: null, samples: 0 },
  ];

  it("spans each bar from that day's resting rate to its high", () => {
    const { bars } = heartHistoryBars(days);

    // Higher values sit further up, so a bigger spread is a taller bar.
    expect(bars[1].height).toBeGreaterThan(bars[0].height);
    expect(bars[1].resting).toBe(51);
    expect(bars[1].high).toBe(173);
  });

  it("scales to the window's own spread rather than from zero", () => {
    const { axisLow, axisHigh } = heartHistoryBars(days);

    expect(axisLow).toBeGreaterThan(0);
    expect(axisLow).toBeLessThanOrEqual(48);
    expect(axisHigh).toBeGreaterThanOrEqual(173);
  });

  it("draws nothing for a day with no readings", () => {
    const { bars } = heartHistoryBars(days);

    expect(bars[2].empty).toBe(true);
    expect(bars[2].height).toBe(0);
  });

  it("counts only the days that were measured", () => {
    expect(heartHistoryBars(days).measuredDays).toBe(2);
  });

  it("averages resting across the measured days only", () => {
    // (48 + 51) / 2, with the empty day left out rather than counted as zero.
    expect(heartHistoryBars(days).restingAverage).toBe(50);
  });

  it("still draws a day whose resting and high are identical", () => {
    const flat = [{ date: "2026-08-01", resting: 60, high: 60, mean: 60, samples: 10 }];
    expect(heartHistoryBars(flat).bars[0].height).toBeGreaterThan(0);
  });

  it("says nothing rather than inventing an axis when no day was measured", () => {
    const none = [{ date: "2026-08-01", resting: null, high: null, mean: null, samples: 0 }];
    const out = heartHistoryBars(none);

    expect(out.bars).toEqual([]);
    expect(out.axisLow).toBeNull();
    expect(out.measuredDays).toBe(0);
  });

  it("keeps the bars inside the plot", () => {
    const { bars } = heartHistoryBars(days);
    for (const b of bars) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(100.001);
    }
  });

  it("uses a window short enough for one fetch of a dense metric", () => {
    // Heart rate is stored about seven times as densely as stress, which
    // already trimmed its own window to keep a single read affordable.
    //
    // No longer a guess: measured on the device 2026-08-10, seven days is 9,785
    // samples read in 173 ms, once, behind the card's skeleton. The rollups
    // cannot replace it because they store no daily low or high, so the ceiling
    // half of every bar would have nowhere to come from. Re-measure before
    // moving this either way - the reasoning is on HISTORY_DAYS itself.
    expect(HISTORY_DAYS).toBeLessThanOrEqual(14);
  });
});
