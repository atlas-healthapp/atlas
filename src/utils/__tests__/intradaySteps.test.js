import { describe, it, expect } from "vitest";
import {
  curveFor,
  curveSoFar,
  hoursElapsed,
  usualBand,
  projectFinish,
  intradayModel,
  HOURS,
  MIN_USUAL_DAYS,
} from "../intradaySteps";

const DAY = new Date(2026, 7, 27, 0, 0, 0, 0).getTime();
const at = (hour, minute = 0) => DAY + hour * 3600000 + minute * 60000;

/** A day built from interval counts, the way the band actually reports them. */
function day(...pairs) {
  return pairs.map(([hour, v]) => ({ t: at(hour, 30), v }));
}

describe("curveFor", () => {
  it("runs the interval counts into a total", () => {
    const c = curveFor(day([8, 100], [9, 50], [20, 400]), DAY);
    expect(c[8]).toBe(0); // the 08:30 sample lands in hour 9
    expect(c[9]).toBe(100);
    expect(c[10]).toBe(150);
    expect(c[HOURS]).toBe(550);
  });

  it("never goes backwards", () => {
    const c = curveFor(day([1, 10], [5, 5], [23, 200]), DAY);
    for (let i = 1; i <= HOURS; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
  });

  it("drops samples outside the day rather than folding them into an end", () => {
    const c = curveFor(
      [{ t: DAY - 3600000, v: 999 }, { t: DAY + 25 * 3600000, v: 999 }, ...day([12, 40])],
      DAY
    );
    expect(c[HOURS]).toBe(40);
  });

  it("survives a malformed sample without poisoning the total", () => {
    const c = curveFor([{ t: at(10), v: null }, { t: null, v: 5 }, ...day([11, 7])], DAY);
    expect(c[HOURS]).toBe(7);
  });
});

describe("hoursElapsed", () => {
  it("reports the hour reached", () => {
    expect(hoursElapsed(at(15, 28), DAY)).toBe(15);
  });

  it("clamps rather than indexing past the end of the curve", () => {
    expect(hoursElapsed(at(48), DAY)).toBe(HOURS);
    expect(hoursElapsed(DAY - 100000, DAY)).toBe(0);
  });
});

describe("curveSoFar", () => {
  // A flat line running on to midnight claims readings the day has not made,
  // and against a rising median it reads as having stopped moving.
  it("is null past the hour reached, not carried forward", () => {
    const c = curveFor(day([9, 100]), DAY);
    const s = curveSoFar(c, 12);
    expect(s[12]).toBe(100);
    expect(s[13]).toBeNull();
    expect(s[HOURS]).toBeNull();
  });
});

describe("usualBand", () => {
  const flat = (total) => {
    const c = new Array(HOURS + 1).fill(0);
    for (let h = 1; h <= HOURS; h++) c[h] = Math.round((total * h) / HOURS);
    return c;
  };

  it("withholds itself below the floor rather than guessing", () => {
    expect(usualBand([flat(1000), flat(2000)])).toBeNull();
    expect(usualBand([])).toBeNull();
  });

  it("orders the three percentiles", () => {
    const days = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000].map(flat);
    const b = usualBand(days);
    expect(b.days).toBe(8);
    for (let h = 0; h <= HOURS; h++) {
      expect(b.p25[h]).toBeLessThanOrEqual(b.p50[h]);
      expect(b.p50[h]).toBeLessThanOrEqual(b.p75[h]);
    }
  });

  // The defect this guards: a day the strap was not worn is missing data, and
  // counted as a flat zero it drags every percentile down, which makes an
  // ordinary day look exceptional.
  it("drops a day with nothing recorded rather than counting it as zero", () => {
    const worn = new Array(MIN_USUAL_DAYS).fill(0).map(() => flat(4000));
    const withEmpties = [...worn, flat(0), flat(0), flat(0)];
    expect(usualBand(withEmpties).p50[HOURS]).toBe(usualBand(worn).p50[HOURS]);
    expect(usualBand(withEmpties).days).toBe(MIN_USUAL_DAYS);
  });
});

describe("projectFinish", () => {
  // Measured on the real archive: 1,456 at 15:28, median 519 by then and 4,141
  // by midnight. A straight line through the current pace promises about 2,250,
  // which is a day nobody walks, because the evening is when the walking is.
  const p50 = (() => {
    const c = new Array(HOURS + 1).fill(0);
    for (let h = 0; h <= HOURS; h++) c[h] = h <= 15 ? Math.round(519 * (h / 15)) : 519 + Math.round((4141 - 519) * ((h - 15) / 9));
    return c;
  })();

  it("adds the median's remaining shape rather than extrapolating the pace", () => {
    expect(projectFinish(1456, p50, 15)).toBe(1456 + (4141 - 519));
  });

  it("never lands below what is already banked", () => {
    expect(projectFinish(9000, p50, 23)).toBeGreaterThanOrEqual(9000);
    expect(projectFinish(9000, p50, HOURS)).toBe(9000);
  });

  it("returns nothing when there is no band to project from", () => {
    expect(projectFinish(1000, null, 12)).toBeNull();
  });
});

describe("intradayModel", () => {
  const priors = new Array(10).fill(0).map(() => {
    const c = new Array(HOURS + 1).fill(0);
    for (let h = 1; h <= HOURS; h++) c[h] = h * 200;
    return c;
  });

  it("gives the chart and the sentence one set of numbers", () => {
    const m = intradayModel({
      todaySamples: day([9, 300], [14, 900]),
      priorCurves: priors,
      nowMs: at(15, 30),
      dayStartMs: DAY,
      goal: 8000,
    });
    expect(m.total).toBe(1200);
    expect(m.atHour).toBe(15);
    expect(m.usualNow).toBe(3000);
    expect(m.projected).toBe(1200 + (4800 - 3000));
    expect(m.soFar[16]).toBeNull();
  });

  // A target sitting off the top of the frame cannot be judged against, which is
  // the rule barGeometry already follows.
  it("scales the axis to include the goal", () => {
    const m = intradayModel({
      todaySamples: day([9, 10]),
      priorCurves: priors,
      nowMs: at(10),
      dayStartMs: DAY,
      goal: 20000,
    });
    expect(m.top).toBeGreaterThanOrEqual(20000);
  });

  it("withholds the band and the projection on a short history", () => {
    const m = intradayModel({
      todaySamples: day([9, 300]),
      priorCurves: priors.slice(0, 3),
      nowMs: at(10),
      dayStartMs: DAY,
      goal: 8000,
    });
    expect(m.band).toBeNull();
    expect(m.projected).toBeNull();
    expect(m.usualNow).toBeNull();
    expect(m.total).toBe(300);
  });
});
