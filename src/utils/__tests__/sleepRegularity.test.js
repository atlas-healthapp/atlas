import { describe, it, expect } from "vitest";
import {
  axisMinutes,
  nightsFrom,
  sleepRegularityIndex,
  usualWindow,
  AXIS_SPAN_MINUTES,
} from "@/utils/sleepRegularity";

const at = (iso) => new Date(iso).getTime();

/** A week of nights, each one `bed` to `wake` local time on consecutive dates. */
function week(times) {
  return times.map(([bed, wake], i) => ({
    date: `2026-07-${String(20 + i).padStart(2, "0")}`,
    bedMs: at(bed),
    wakeMs: at(wake),
  }));
}

describe("axisMinutes", () => {
  it("puts 21:00 at zero and measures forward from there", () => {
    expect(axisMinutes(at("2026-07-20T21:00:00"))).toBe(0);
    expect(axisMinutes(at("2026-07-20T23:30:00"))).toBe(150);
  });

  it("keeps an after-midnight time on the same axis rather than wrapping to zero", () => {
    // 00:40 is 3h40m past 21:00, not 40 minutes past midnight. Without this the
    // regularity chart draws a 1am bedtime at the far left, i.e. as the earliest
    // night of the week.
    expect(axisMinutes(at("2026-07-21T00:40:00"))).toBe(220);
    expect(axisMinutes(at("2026-07-21T08:20:00"))).toBe(680);
  });

  it("returns null for a time outside the axis", () => {
    expect(axisMinutes(at("2026-07-21T15:00:00"))).toBeNull();
    expect(axisMinutes(null)).toBeNull();
  });

  it("spans 21:00 to 13:00", () => {
    expect(AXIS_SPAN_MINUTES).toBe(960);
  });
});

describe("nightsFrom", () => {
  it("drops entries with no stored bedtime rather than guessing one", () => {
    const nights = nightsFrom([
      {
        date: "2026-07-20",
        sleepStages: {
          bedTime: at("2026-07-19T23:00:00"),
          wakeTime: at("2026-07-20T07:00:00"),
        },
      },
      { date: "2026-07-21", sleepStages: { deep: 90, light: 240, rem: 70 } },
      { date: "2026-07-22", sleep: 8 },
    ]);
    expect(nights.map((n) => n.date)).toEqual(["2026-07-20"]);
  });
});

describe("sleepRegularityIndex", () => {
  it("is withheld under three nights rather than computed from two", () => {
    const nights = week([
      ["2026-07-19T23:00:00", "2026-07-20T07:00:00"],
      ["2026-07-20T23:00:00", "2026-07-21T07:00:00"],
    ]);
    expect(sleepRegularityIndex(nights)).toBeNull();
  });

  it("scores an identical schedule at 100", () => {
    const nights = week([
      ["2026-07-19T23:00:00", "2026-07-20T07:00:00"],
      ["2026-07-20T23:00:00", "2026-07-21T07:00:00"],
      ["2026-07-21T23:00:00", "2026-07-22T07:00:00"],
      ["2026-07-22T23:00:00", "2026-07-23T07:00:00"],
    ]);
    expect(sleepRegularityIndex(nights)).toBe(100);
  });

  it("charges an hour of drift roughly two hours of mismatch a day", () => {
    // Bed and wake each shift an hour later on the second night, so 120 of the
    // 1440 minutes disagree with the day before: 200 * (1320/1440) - 100 = 83.3.
    const nights = week([
      ["2026-07-19T23:00:00", "2026-07-20T07:00:00"],
      ["2026-07-21T00:00:00", "2026-07-21T08:00:00"],
      ["2026-07-22T00:00:00", "2026-07-22T08:00:00"],
    ]);
    const sri = sleepRegularityIndex(nights);
    expect(sri).toBeGreaterThan(85);
    expect(sri).toBeLessThan(96);
  });

  it("scores a wildly irregular week below a regular one", () => {
    const regular = week([
      ["2026-07-19T23:00:00", "2026-07-20T07:00:00"],
      ["2026-07-20T23:10:00", "2026-07-21T07:05:00"],
      ["2026-07-21T22:55:00", "2026-07-22T07:00:00"],
      ["2026-07-22T23:05:00", "2026-07-23T07:10:00"],
    ]);
    const chaotic = week([
      ["2026-07-19T22:00:00", "2026-07-20T05:00:00"],
      ["2026-07-21T02:00:00", "2026-07-21T11:00:00"],
      ["2026-07-21T21:30:00", "2026-07-22T06:00:00"],
      ["2026-07-23T01:30:00", "2026-07-23T10:30:00"],
    ]);
    expect(sleepRegularityIndex(regular)).toBeGreaterThan(sleepRegularityIndex(chaotic) + 20);
  });

  it("never returns a negative score", () => {
    // Sleeping by day one night and by night the next is total disagreement,
    // which the raw formula scores at -100. A score is 0..100 everywhere else in
    // the app and a negative one would draw a bar backwards.
    const inverted = week([
      ["2026-07-19T22:00:00", "2026-07-20T06:00:00"],
      ["2026-07-21T10:00:00", "2026-07-21T18:00:00"],
      ["2026-07-21T22:00:00", "2026-07-22T06:00:00"],
    ]);
    expect(sleepRegularityIndex(inverted)).toBeGreaterThanOrEqual(0);
  });
});

describe("usualWindow", () => {
  it("takes the median of each end, so one late night does not move it", () => {
    const nights = week([
      ["2026-07-19T22:40:00", "2026-07-20T08:20:00"],
      ["2026-07-20T22:40:00", "2026-07-21T08:20:00"],
      ["2026-07-21T22:40:00", "2026-07-22T08:20:00"],
      ["2026-07-23T03:00:00", "2026-07-23T11:00:00"],
    ]);
    const usual = usualWindow(nights);
    // 22:40 is 100 minutes past the 21:00 anchor, 08:20 is 680.
    expect(usual.bedMinutes).toBe(100);
    expect(usual.wakeMinutes).toBe(680);
  });

  it("is null with nothing to take a median of", () => {
    expect(usualWindow([])).toBeNull();
  });
});
