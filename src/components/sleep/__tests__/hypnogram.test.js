import { describe, it, expect } from "vitest";
import {
  hypnogramGeometry,
  TICK_FONT_PX,
  TICK_LETTER_SPACING,
} from "@/components/sleep/hypnogram";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

// Same check as dayMarkers.test.js, for the same reason: the tick step is a
// prediction about how wide `.tick` renders, `.tick` is set in a stylesheet this
// module cannot see, and when the two drifted apart on 2026-08-27 the axis went
// from four characters of clear space between labels to about one. Nothing
// failed, because a crowded axis is still a valid drawing.
describe("the type it predicts", () => {
  const vue = readFileSync(
    resolve(process.cwd(), "src/components/sleep/SleepPage.vue"),
    "utf8"
  );
  const block = vue.slice(vue.indexOf("\n.tick {"));
  const body = block.slice(0, block.indexOf("}"));

  it("matches the font size .tick is actually set in", () => {
    const size = /font-size:\s*([\d.]+)px/.exec(body);
    expect(size).not.toBeNull();
    expect(Number(size[1])).toBe(TICK_FONT_PX);
  });

  it("matches the letter-spacing .tick is actually set in", () => {
    const spacing = /letter-spacing:\s*([\d.]+)px/.exec(body);
    expect(spacing).not.toBeNull();
    expect(Number(spacing[1])).toBe(TICK_LETTER_SPACING);
  });

  // The reported symptom, as arithmetic. A full night drawn inline is about nine
  // hours across 294 units, which at the current type can no longer carry an
  // hourly axis - so it must thin to two hours rather than print the labels a
  // character apart.
  it("thins a nine-hour night drawn inline to a two-hour axis", () => {
    const night = [{ stage: "light", startMinute: 0, minutes: 9 * 60 }];
    const geo = hypnogramGeometry(night, at("2026-08-26T22:30:00"), { width: 294 });
    const hours = geo.ticks.map((t) => Number(t.label.slice(0, 2)));
    const steps = hours.slice(1).map((h, i) => (h - hours[i] + 24) % 24);
    expect(steps.every((s) => s === 2)).toBe(true);
  });

  // And the other half of why this looked like a phone-only bug: the expanded
  // view draws the same labels into a wider box, so they fit at every hour.
  it("keeps an hourly axis when the same night is expanded", () => {
    const night = [{ stage: "light", startMinute: 0, minutes: 9 * 60 }];
    const geo = hypnogramGeometry(night, at("2026-08-26T22:30:00"), { width: 780 });
    const hours = geo.ticks.map((t) => Number(t.label.slice(0, 2)));
    const steps = hours.slice(1).map((h, i) => (h - hours[i] + 24) % 24);
    expect(steps.every((s) => s === 1)).toBe(true);
  });
});
