import { describe, it, expect } from "vitest";
import {
  dischargeSegments,
  batteryLife,
  drainPerSync,
  formatDays,
  isUsable,
  lifeBand,
  CHARGE_RISE,
  MIN_SEGMENTS,
} from "@/utils/strapHealth";

const HOUR = 60 * 60 * 1000;
const T0 = new Date("2026-08-01T00:00:00Z").getTime();

/**
 * A discharge: `from` down to `to` over `hours`, one reading every half hour,
 * which is the service's own interval.
 */
function discharge(startT, from, to, hours) {
  const steps = Math.max(1, Math.round(hours * 2));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    out.push({
      t: startT + (i / steps) * hours * HOUR,
      v: from - ((from - to) * i) / steps,
    });
  }
  return out;
}

describe("dischargeSegments", () => {
  it("cuts the series where the level jumps upward", () => {
    const readings = [
      ...discharge(T0, 100, 40, 120),
      ...discharge(T0 + 130 * HOUR, 100, 50, 100),
    ];
    expect(dischargeSegments(readings)).toHaveLength(2);
  });

  // A coin-cell strap's reported percentage wobbles a point as the voltage
  // recovers between reads. Treating that as a charge cut a five-day discharge
  // into dozens of fragments and reported a battery lasting two hours.
  it("ignores a wobble smaller than a real charge", () => {
    const readings = [
      { t: T0, v: 80 },
      { t: T0 + HOUR, v: 79 },
      { t: T0 + 2 * HOUR, v: 81 },
      { t: T0 + 3 * HOUR, v: 78 },
    ];
    expect(dischargeSegments(readings)).toHaveLength(1);
  });

  it("treats a rise of exactly the threshold as a charge", () => {
    const readings = [
      { t: T0, v: 40 },
      { t: T0 + HOUR, v: 40 + CHARGE_RISE },
    ];
    expect(dischargeSegments(readings)).toHaveLength(2);
  });

  // The strap is not synced while the phone is away from it, so a long hole in
  // the middle of a discharge is ordinary and says nothing about charging.
  it("does not treat a gap in the readings as a charge", () => {
    const readings = [
      { t: T0, v: 90 },
      { t: T0 + 40 * HOUR, v: 60 },
    ];
    expect(dischargeSegments(readings)).toHaveLength(1);
  });

  it("marks the run still in progress as incomplete", () => {
    const readings = [
      ...discharge(T0, 100, 40, 120),
      ...discharge(T0 + 130 * HOUR, 100, 70, 60),
    ];
    const segs = dischargeSegments(readings);
    expect(segs[0].complete).toBe(true);
    expect(segs.at(-1).complete).toBe(false);
  });

  it("corroborates a segment the band said it was charging before", () => {
    const readings = [
      ...discharge(T0, 100, 40, 120),
      ...discharge(T0 + 122 * HOUR, 100, 60, 60),
    ];
    const segs = dischargeSegments(readings, [T0 + 121 * HOUR]);
    expect(segs.at(-1).confirmed).toBe(true);
    expect(segs[0].confirmed).toBe(false);
  });

  it("has nothing to say about one reading", () => {
    expect(dischargeSegments([{ t: T0, v: 90 }])).toEqual([]);
    expect(dischargeSegments([])).toEqual([]);
  });
});

describe("isUsable", () => {
  it("rejects a stub of a discharge", () => {
    // Unplugged to be looked at, then plugged back in. Extrapolated to 100% it
    // would report a very confident figure from almost nothing.
    const segs = dischargeSegments([
      ...discharge(T0, 100, 96, 2),
      ...discharge(T0 + 3 * HOUR, 100, 30, 140),
    ]);
    expect(isUsable(segs[0])).toBe(false);
  });
});

describe("batteryLife", () => {
  const twoRuns = [
    ...discharge(T0, 100, 20, 120), // 80% over 5 days -> 6.25 days full
    ...discharge(T0 + 130 * HOUR, 100, 20, 120),
    { t: T0 + 260 * HOUR, v: 100 }, // a third charge, so both runs are complete
  ];

  it("calls a single complete discharge provisional rather than settled", () => {
    const one = batteryLife([...discharge(T0, 100, 20, 120), { t: T0 + 130 * HOUR, v: 100 }]);
    expect(one.state).toBe("provisional");
    expect(one.days).toBeCloseTo(6.25, 2);
    expect(one.needed).toBe(MIN_SEGMENTS - 1);
    expect(one.trend).toBeNull();
  });

  // On a strap lasting a week, waiting for two COMPLETE discharges is a
  // fortnight of an empty row. The run in hand is a real measurement of the
  // rate; what it cannot do is settle it.
  it("measures the run still in progress once it has gone far enough", () => {
    const out = batteryLife(discharge(T0, 100, 40, 90));
    expect(out.state).toBe("provisional");
    expect(out.fromCurrentRun).toBe(true);
    expect(out.days).toBeCloseTo(6.25, 2);
  });

  it("stays quiet while the only run is still a stub", () => {
    const out = batteryLife(discharge(T0, 100, 97, 3));
    expect(out.state).toBe("calibrating");
    expect(out.days).toBeNull();
  });

  it("has nothing provisional to say about no readings", () => {
    expect(batteryLife([]).state).toBe("calibrating");
  });

  it("extrapolates each run to a full charge and averages them", () => {
    const out = batteryLife(twoRuns);
    expect(out.state).toBe("ready");
    expect(out.days).toBeCloseTo(6.25, 2);
    expect(out.usable).toBe(2);
  });

  it("reports the run in progress separately from the rate", () => {
    const out = batteryLife([...twoRuns, ...discharge(T0 + 261 * HOUR, 100, 80, 24)]);
    expect(out.current.complete).toBe(false);
    expect(out.current.toPct).toBeCloseTo(80, 5);
  });

  // "Six days, down from nine" is the whole point of the panel.
  it("compares the latest run with the ones before it once there are three", () => {
    const out = batteryLife([
      ...discharge(T0, 100, 20, 240), // 10 days' worth
      ...discharge(T0 + 250 * HOUR, 100, 20, 240),
      ...discharge(T0 + 500 * HOUR, 100, 20, 120), // then half that
      { t: T0 + 630 * HOUR, v: 100 },
    ]);
    expect(out.trend.change).toBeLessThan(0);
    expect(out.trend.previous).toBeGreaterThan(out.trend.latest);
  });

  it("offers no trend from two runs, since a change needs something to change from", () => {
    expect(batteryLife(twoRuns).trend).toBeNull();
  });

  it("survives having no readings at all", () => {
    expect(batteryLife([]).state).toBe("calibrating");
    expect(batteryLife(null).state).toBe("calibrating");
  });
});

describe("drainPerSync", () => {
  it("reports percent per sync rather than implying a cause", () => {
    const readings = [
      ...discharge(T0, 100, 20, 120),
      ...discharge(T0 + 130 * HOUR, 100, 20, 120),
      { t: T0 + 260 * HOUR, v: 100 },
    ];
    // 80% over 120 hours at a sync every 30 minutes is 240 syncs.
    expect(drainPerSync(readings, [], 30)).toBeCloseTo(80 / 240, 4);
  });

  it("has nothing to divide without a usable run", () => {
    expect(drainPerSync([{ t: T0, v: 90 }], [], 30)).toBeNull();
  });
});

describe("formatDays", () => {
  it("says hours when a day would round to nothing useful", () => {
    expect(formatDays(0.5)).toBe("12 HOURS");
  });

  it("keeps one decimal, since the difference between 6 and 6.5 days is the point", () => {
    expect(formatDays(6.24)).toBe("6.2 DAYS");
  });

  it("says nothing about nothing", () => {
    expect(formatDays(null)).toBe("");
  });
});

describe("lifeBand", () => {
  it("names the four bands against what this strap does in this app", () => {
    expect(lifeBand(12).label).toBe("GREAT");
    expect(lifeBand(7).label).toBe("GOOD");
    expect(lifeBand(4).label).toBe("OKAY");
    expect(lifeBand(2).label).toBe("POOR");
  });

  it("puts a boundary figure in the higher band", () => {
    expect(lifeBand(10).label).toBe("GREAT");
    expect(lifeBand(6).label).toBe("GOOD");
  });

  // The row says NOT AVAILABLE off the back of this, which is a different fact
  // from a bad battery and has to read differently.
  it("has no verdict without a figure", () => {
    expect(lifeBand(null)).toBeNull();
    expect(lifeBand(undefined)).toBeNull();
  });

  it("borrows Recovery's ramp rather than inventing a second one", () => {
    expect(lifeBand(12).token).toBe("--rec-great");
    expect(lifeBand(2).token).toBe("--rec-low");
  });
});

describe("pooling the evidence", () => {
  const run = (startT, hours, from, to) => [
    { t: startT, v: from },
    { t: startT + hours * 60 * 60 * 1000, v: to },
  ];

  it("weights a long discharge above a short one", () => {
    // A 70% run over 14 days says 20 days. A 16% run over 1 day says 6.25. The
    // mean of those two ratios is 13.1, which splits the difference between a
    // fortnight of evidence and an afternoon of it. Pooled, the long run
    // dominates as it should.
    const t0 = Date.parse("2026-07-01T00:00:00Z");
    const DAY = 24 * 60 * 60 * 1000;
    const readings = [
      ...run(t0, 14 * 24, 95, 25),
      ...run(t0 + 15 * DAY, 24, 95, 79),
      // A segment only counts once a charge has closed it, so the second run
      // needs one after it too.
      { t: t0 + 17 * DAY, v: 96 },
    ];
    const life = batteryLife(readings);
    expect(life.state).toBe("ready");
    expect(life.days).toBeGreaterThan(15);
    expect(life.days).toBeLessThan(20);
  });

  it("says how much discharge it is built on", () => {
    const t0 = Date.parse("2026-07-01T00:00:00Z");
    const DAY2 = 24 * 60 * 60 * 1000;
    const readings = [
      ...run(t0, 10 * 24, 90, 30),
      ...run(t0 + 12 * DAY2, 5 * 24, 90, 50),
      { t: t0 + 19 * DAY2, v: 95 },
    ];
    // 60 + 40 points of real discharge behind the figure.
    expect(batteryLife(readings).basisDrop).toBe(100);
  });
});

// Added 2026-08-20, from the real device series. One charge from 20% to 99% was
// synced eight times on the way up, and each rise started a new segment: eleven
// "charges" for one, with near-zero discharges wedged between them feeding the
// average as though they were real runs.
describe("one charge is one charge, however often it was synced", () => {
  const H = 60 * 60 * 1000;
  const t0 = Date.UTC(2026, 7, 19, 10, 0);

  // The actual shape off the phone: a discharge, then a charge climbing in eight
  // steps over ninety minutes, including a plateau at 97 before the last rise.
  const series = [
    { t: t0 - 40 * H, v: 66 },
    { t: t0 - 20 * H, v: 45 },
    { t: t0, v: 20 },
    { t: t0 + 0.2 * H, v: 36 },
    { t: t0 + 0.4 * H, v: 50 },
    { t: t0 + 0.5 * H, v: 56 },
    { t: t0 + 1.0 * H, v: 92 },
    { t: t0 + 1.1 * H, v: 93 },
    { t: t0 + 1.2 * H, v: 95 },
    { t: t0 + 1.3 * H, v: 97 },
    { t: t0 + 1.4 * H, v: 97 },
    { t: t0 + 1.5 * H, v: 99 },
    { t: t0 + 20 * H, v: 88 },
  ];

  it("cuts it into two runs, not nine", () => {
    const segs = dischargeSegments(series);
    expect(segs).toHaveLength(2);
  });

  it("never reports a discharge that went up", () => {
    // The first attempt stopped the climb at the plateau, so the run started at
    // 97 and rose to 99 inside itself: a segment with a drop of minus two.
    for (const s of dischargeSegments(series)) {
      expect(s.drop).toBeGreaterThanOrEqual(0);
    }
  });

  it("starts the new run at the top of the charge", () => {
    const [, after] = dischargeSegments(series);
    expect(after.fromPct).toBe(99);
    expect(after.toPct).toBe(88);
  });

  it("leaves the discharge before the charge intact", () => {
    const [before] = dischargeSegments(series);
    expect(before.fromPct).toBe(66);
    expect(before.toPct).toBe(20);
    expect(before.drop).toBe(46);
  });
});
