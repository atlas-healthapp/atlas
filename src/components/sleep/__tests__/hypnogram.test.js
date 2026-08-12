import { describe, it, expect } from "vitest";
import { hypnogramGeometry } from "@/components/sleep/hypnogram";

const at = (iso) => new Date(iso).getTime();
const timeline = [
  { stage: "light", startMinute: 0, minutes: 60 },
  { stage: "deep", startMinute: 60, minutes: 90 },
  { stage: "awake", startMinute: 150, minutes: 10 },
  { stage: "rem", startMinute: 160, minutes: 80 },
];

describe("hypnogramGeometry", () => {
  it("lays segments out in proportion to their minutes", () => {
    const { segments } = hypnogramGeometry(timeline, at("2026-07-27T23:00:00"), { width: 240 });
    // 240 minutes over 240px, so a minute is a pixel.
    expect(segments[0].x).toBeCloseTo(0, 1);
    expect(segments[1].x).toBeCloseTo(60, 1);
    expect(segments[3].x).toBeCloseTo(160, 1);
  });

  it("places deeper stages lower, so depth reads as position", () => {
    const { segments } = hypnogramGeometry(timeline, at("2026-07-27T23:00:00"), { width: 240 });
    const y = Object.fromEntries(segments.map((s) => [s.stage, s.y]));
    expect(y.awake).toBeLessThan(y.rem);
    expect(y.rem).toBeLessThan(y.light);
    expect(y.light).toBeLessThan(y.deep);
  });

  it("labels ticks with clock times when a bedtime is known", () => {
    const { ticks, elapsed } = hypnogramGeometry(timeline, at("2026-07-27T23:00:00"), {
      width: 240,
    });
    expect(elapsed).toBe(false);
    expect(ticks[0].label).toBe("23:00");
    expect(ticks.map((t) => t.label)).toContain("01:00");
    // Ticks land on whole hours, so the first is the hour after bedtime when
    // bedtime is not itself on the hour.
    expect(ticks.every((t) => /^\d{2}:\d{2}$/.test(t.label))).toBe(true);
  });

  it("starts its first tick at the hour after a bedtime that is not on the hour", () => {
    const { ticks } = hypnogramGeometry(timeline, at("2026-07-27T23:09:00"), { width: 240 });
    expect(ticks[0].label).toBe("00:00");
    expect(ticks[0].x).toBeGreaterThan(0);
  });

  it("falls back to an elapsed axis when the night has no stored bedtime", () => {
    // Every night committed before bedtimes were kept. An invented clock time
    // would be the one dishonest thing this chart could do.
    const { ticks, elapsed } = hypnogramGeometry(timeline, null, { width: 240 });
    expect(elapsed).toBe(true);
    expect(ticks[0].label).toBe("0H");
  });

  it("thins the ticks so they cannot collide on a phone", () => {
    // A ten hour night at 294px is a tick every 29px, and "23:00" does not fit
    // in 29px. Two-hourly on a long night keeps the labels readable.
    const longNight = [{ stage: "light", startMinute: 0, minutes: 600 }];
    const { ticks } = hypnogramGeometry(longNight, at("2026-07-27T22:00:00"), { width: 294 });
    const gaps = ticks.slice(1).map((t, i) => t.x - ticks[i].x);
    expect(Math.min(...gaps)).toBeGreaterThan(40);
  });

  it("returns nothing to draw for an empty timeline", () => {
    expect(hypnogramGeometry([], at("2026-07-27T23:00:00"), { width: 240 }).segments).toEqual([]);
  });
});
