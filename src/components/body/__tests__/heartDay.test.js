import { describe, it, expect } from "vitest";
import { heartDayGeometry, BUCKET_MINUTES } from "@/components/body/heartDay";
import { hourTicks } from "@/components/body/dayAxis";

/** Local-midnight-based timestamp, so the maths matches what the page sees. */
function at(hour, minute = 0) {
  const d = new Date(2026, 7, 4, hour, minute, 0, 0);
  return d.getTime();
}

function series(spec) {
  return spec.map(([h, m, v]) => ({ t: at(h, m), v }));
}

/** A reading a minute from `fromHour` to `toHour` at `value`. */
function steady(fromHour, toHour, value) {
  const out = [];
  for (let m = fromHour * 60; m < toHour * 60; m++) {
    out.push({ t: at(0, m), v: value });
  }
  return out;
}

describe("heartDayGeometry", () => {
  it("collapses a day of readings into one column per bucket", () => {
    // Six hours at a reading a minute is 360 samples, which must not be 360
    // columns: that is the defect this module exists for.
    const g = heartDayGeometry(steady(6, 12, 60));

    expect(g.samples).toBe(360);
    expect(g.columns.length).toBe(360 / BUCKET_MINUTES);
  });

  it("draws each column from its bucket's low to its high", () => {
    const g = heartDayGeometry(
      series([
        [8, 0, 50],
        [8, 1, 90],
        [8, 30, 70],
      ])
    );

    const first = g.columns[0];
    expect(first.low).toBe(50);
    expect(first.high).toBe(90);
    // Higher values sit further up the plot, so the top of the column is the high.
    expect(first.y).toBeLessThan(first.y + first.height);
  });

  it("still draws a column when every reading in it is identical", () => {
    const g = heartDayGeometry(steady(6, 8, 62));
    for (const c of g.columns) expect(c.height).toBeGreaterThan(0);
  });

  it("leaves a hole where the band reported nothing", () => {
    const g = heartDayGeometry([...steady(6, 7, 60), ...steady(10, 11, 65)]);

    const minutes = g.columns.map((c) => c.minute);
    // Nothing between 07:00 and 10:00.
    expect(minutes.some((m) => m > 7 * 60 && m < 10 * 60)).toBe(false);
  });

  it("floors the axis below the day's lowest reading, never at zero", () => {
    const g = heartDayGeometry(series([[6, 0, 48], [7, 0, 120], [8, 0, 55]]));

    expect(g.axisLow).toBeGreaterThan(0);
    expect(g.axisLow).toBeLessThanOrEqual(48);
    expect(g.axisHigh).toBeGreaterThanOrEqual(120);
  });

  it("takes resting from a percentile, not from the lowest reading", () => {
    // One stray 30 must not become the resting line.
    const g = heartDayGeometry([...steady(6, 12, 60), { t: at(6, 30), v: 30 }]);

    expect(g.resting).toBe(60);
    expect(g.low).toBe(30);
  });

  it("reports the day's own average, low and high", () => {
    const g = heartDayGeometry([...steady(6, 7, 50), ...steady(7, 8, 70)]);

    expect(g.low).toBe(50);
    expect(g.high).toBe(70);
    expect(g.average).toBe(60);
  });

  it("marks the columns that fall inside a session", () => {
    const sessions = [{ startMillis: at(17, 33), endMillis: at(20, 31) }];
    const g = heartDayGeometry(steady(6, 22, 80), { sessions });

    const inside = g.columns.filter((c) => c.session);
    expect(inside.length).toBeGreaterThan(0);
    for (const c of inside) {
      expect(c.minute).toBeGreaterThanOrEqual(17 * 60);
      expect(c.minute).toBeLessThanOrEqual(20 * 60 + 31);
    }
  });

  it("gives a session a band clipped to the reported part of the day", () => {
    // Session runs past the last reading; the band must stop where the data does.
    const sessions = [{ startMillis: at(10, 0), endMillis: at(23, 0) }];
    const g = heartDayGeometry(steady(6, 12, 80), { sessions });

    expect(g.sessionBands).toHaveLength(1);
    expect(g.sessionBands[0].x + g.sessionBands[0].width).toBeLessThanOrEqual(100.001);
  });

  it("drops a session that sits entirely outside the reported day", () => {
    const sessions = [{ startMillis: at(2, 0), endMillis: at(3, 0) }];
    const g = heartDayGeometry(steady(6, 12, 80), { sessions });
    expect(g.sessionBands).toEqual([]);
  });

  it("clips the axis to what was reported rather than to midnight", () => {
    // Half a day of readings must fill the width, not sit in the left third.
    const g = heartDayGeometry(steady(6, 12, 70));

    expect(g.columns[0].x).toBeLessThan(1);
    const last = g.columns.at(-1);
    expect(last.x + g.width).toBeGreaterThan(99);
  });

  it("returns null below two readings", () => {
    expect(heartDayGeometry([])).toBeNull();
    expect(heartDayGeometry([{ t: at(6), v: 60 }])).toBeNull();
    expect(heartDayGeometry(null)).toBeNull();
  });

  it("ignores malformed samples rather than drawing them", () => {
    const g = heartDayGeometry([
      { t: at(6, 0), v: 60 },
      { t: at(6, 1), v: null },
      { t: NaN, v: 70 },
      { t: at(6, 2), v: 64 },
    ]);

    expect(g.samples).toBe(2);
  });
});

describe("hourTicks", () => {
  it("lands on the hour, not on the first reading", () => {
    const g = heartDayGeometry(steady(6, 18, 70));
    const ticks = hourTicks(g);

    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(t.minute % 60).toBe(0);
      expect(t.label).toMatch(/^\d{2}:00$/);
    }
  });

  it("stays inside the plot", () => {
    const g = heartDayGeometry(steady(6, 18, 70));
    for (const t of hourTicks(g)) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(100);
    }
  });

  it("says nothing when there is no geometry", () => {
    expect(hourTicks(null)).toEqual([]);
  });
});
