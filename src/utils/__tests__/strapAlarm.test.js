import { describe, it, expect } from "vitest";
import {
  repeatMask,
  daysFromMask,
  describeAlarm,
  describeDays,
  formatTime,
  EVERY_DAY,
  WEEKDAYS,
  REPEAT_ONCE,
} from "../strapAlarm";

describe("repeatMask", () => {
  it("puts Monday on the low bit and Sunday on 0x40", () => {
    // The one that matters. Atlas counts Sunday as 0 and the band counts from
    // Monday, so a naive `1 << day` would set Sunday's alarm on Monday.
    expect(repeatMask([1])).toBe(0x01);
    expect(repeatMask([0])).toBe(0x40);
    expect(repeatMask([6])).toBe(0x20);
  });

  it("treats no days as a one-off rather than as every day", () => {
    // An empty mask and a full mask are opposites; a bug that confused them
    // would set a daily alarm from a single tap.
    expect(repeatMask([])).toBe(REPEAT_ONCE);
    expect(repeatMask(null)).toBe(REPEAT_ONCE);
    expect(repeatMask(EVERY_DAY)).toBe(0x7f);
  });

  it("maps weekdays to the low five bits", () => {
    expect(repeatMask(WEEKDAYS)).toBe(0x1f);
  });

  it("round-trips through daysFromMask", () => {
    for (const days of [[], [0], [1], [0, 6], WEEKDAYS, EVERY_DAY, [2, 4]]) {
      expect(daysFromMask(repeatMask(days)).sort()).toEqual([...days].sort());
    }
  });
});

describe("describeDays", () => {
  it("names a one-off as ONCE rather than as no days", () => {
    expect(describeDays([])).toBe("ONCE");
  });

  it("collapses the common repeats to a word", () => {
    expect(describeDays(EVERY_DAY)).toBe("EVERY DAY");
    expect(describeDays(WEEKDAYS)).toBe("WEEKDAYS");
  });

  it("lists an odd set Monday-first, not in tap order", () => {
    // The same set entered in a different order must read identically.
    expect(describeDays([0, 3])).toBe("WED SUN");
    expect(describeDays([3, 0])).toBe("WED SUN");
  });
});

describe("formatTime", () => {
  it("pads so a column of times does not jump", () => {
    expect(formatTime(7, 5)).toBe("07:05");
    expect(formatTime(23, 59)).toBe("23:59");
  });
});

describe("describeAlarm", () => {
  it("names a one-off as ONCE", () => {
    // Atlas cannot read the band back, so a spent one-off is still shown. The
    // word is what stops it reading as set for tomorrow.
    expect(describeAlarm({ hour: 8, minute: 30, days: [], enabled: true })).toBe("08:30 · ONCE");
  });

  it("pads the time so the column does not jump", () => {
    expect(describeAlarm({ hour: 7, minute: 5, days: [], enabled: true })).toBe("07:05 · ONCE");
  });

  it("collapses the common repeats to a word", () => {
    expect(describeAlarm({ hour: 8, minute: 30, days: EVERY_DAY, enabled: true }))
      .toBe("08:30 · EVERY DAY");
    expect(describeAlarm({ hour: 6, minute: 0, days: WEEKDAYS, enabled: true }))
      .toBe("06:00 · WEEKDAYS");
  });

  it("lists an odd set Monday-first, not in tap order", () => {
    expect(describeAlarm({ hour: 8, minute: 30, days: [0, 3], enabled: true }))
      .toBe("08:30 · WED SUN");
  });

  it("says OFF ahead of the days, since a disabled alarm's days are moot", () => {
    expect(describeAlarm({ hour: 8, minute: 30, days: EVERY_DAY, enabled: false }))
      .toBe("08:30 · OFF");
  });

  it("has something to say about no alarm at all", () => {
    expect(describeAlarm(null)).toBe("NOT SET");
  });
});
