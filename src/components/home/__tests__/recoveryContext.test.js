import { describe, it, expect } from "vitest";
import { termContext } from "@/components/home/recoveryContext";

const at = (iso) => new Date(iso).getTime();

const session = {
  startMillis: at("2026-08-05T17:02:00"),
  endMillis: at("2026-08-05T20:21:00"),
  activeSeconds: 199 * 60,
};

const row = (key, band, points, maxPoints) => ({ key, band, points, maxPoints });

describe("termContext gating", () => {
  // The defect this module exists for. On 6 August every reading sat inside its
  // normal range and the score was 55 purely because matching your baseline is
  // half marks. Naming a session next to HRV on that day reads as "this is why
  // you are down", and nothing was down.
  it("says nothing about a reading that is inside its normal range", () => {
    const out = termContext({
      rows: [row("hrv", "normal", 16, 50), row("restingHr", "normal", 14, 25)],
      sessions: [session],
    });
    expect(out).toEqual({});
  });

  it("stays quiet even when an in-range term gave up most of its points", () => {
    // HRV gave up 34 of its 50 points on the day this was found, while sitting
    // well inside normal. Points cost is the wrong trigger; the band is the
    // right one.
    const out = termContext({
      rows: [row("hrv", "normal", 16, 50)],
      sessions: [session],
    });
    expect(out.hrv).toBeUndefined();
  });

  it("names the training when the reading really is outside its range", () => {
    const out = termContext({
      rows: [row("hrv", "low", 4, 50)],
      sessions: [session],
    });
    expect(out.hrv).toBe("AFTER 3H 19M TRAINING TO 20:21");
  });

  it("has nothing to say when there was no session to name", () => {
    const out = termContext({ rows: [row("hrv", "low", 4, 50)], sessions: [] });
    expect(out.hrv).toBeUndefined();
  });
});

describe("termContext sleep", () => {
  // Sleep is scored against a goal rather than a baseline, so it has no band and
  // triggers on giving up points worth acting on instead.
  it("says nothing when the night scored close to full marks", () => {
    const out = termContext({
      rows: [row("sleep", null, 24, 25)],
      bedMs: at("2026-08-05T23:39:00"),
      bedMinutes: 159,
      usualBedMinutes: 129,
    });
    expect(out.sleep).toBeUndefined();
  });

  it("names a late bedtime when the night actually cost points", () => {
    const out = termContext({
      rows: [row("sleep", null, 14, 25)],
      bedMs: at("2026-08-05T23:39:00"),
      bedMinutes: 159,
      usualBedMinutes: 129,
    });
    expect(out.sleep).toBe("IN BED 23:39, 30 MIN LATE");
  });

  it("gives the bedtime without calling it late when it was not", () => {
    const out = termContext({
      rows: [row("sleep", null, 14, 25)],
      bedMs: at("2026-08-05T22:35:00"),
      bedMinutes: 95,
      usualBedMinutes: 129,
    });
    expect(out.sleep).toBe("IN BED 22:35");
  });

  it("says nothing when there is no bedtime recorded at all", () => {
    const out = termContext({ rows: [row("sleep", null, 14, 25)], bedMs: null });
    expect(out.sleep).toBeUndefined();
  });
});
