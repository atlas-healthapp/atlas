import { describe, it, expect } from "vitest";
import {
  axisFraction,
  labelAnchor,
  hoursFrom,
  dayRow,
  clockTime,
  activeMinutes,
  durationText,
  weekdayLabel,
  AXIS_FROM,
  AXIS_TO,
  AXIS_TICKS,
  placeLabels,
} from "@/components/home/dayMarkers";

const at = (iso) => new Date(iso).getTime();

describe("axis placement", () => {
  it("counts past midnight rather than wrapping", () => {
    // 00:53 the next morning belongs to the night that started on the row's day.
    // Wrapping it to 0.88 would land it at breakfast on the same row.
    expect(hoursFrom("2026-08-05", at("2026-08-06T00:53:00"))).toBeCloseTo(24.883, 2);
  });

  it("puts the ends of the axis at 0 and 1", () => {
    expect(axisFraction(AXIS_FROM)).toBe(0);
    expect(axisFraction(AXIS_TO)).toBe(1);
  });

  it("drops a moment outside the axis rather than pinning it to the edge", () => {
    // A mark clamped to the edge claims a time it does not have, and the edge is
    // where the interesting values already are.
    expect(axisFraction(3)).toBeNull();
    expect(axisFraction(27)).toBeNull();
  });
});

describe("dayRow", () => {
  const session = (from, to, activeSeconds) => ({
    startMillis: at(from),
    endMillis: at(to),
    activeSeconds,
  });

  it("places a session and reads its clock times back", () => {
    const row = dayRow({
      date: "2026-08-05",
      sessions: [session("2026-08-05T17:02:00", "2026-08-05T20:21:00", 199 * 60)],
    });
    expect(row.spans).toHaveLength(1);
    expect(row.spans[0].startText).toBe("17:02");
    expect(row.spans[0].endText).toBe("20:21");
    expect(row.spans[0].from).toBeGreaterThan(row.spans[0].to - 1);
    expect(row.spans[0].from).toBeLessThan(row.spans[0].to);
  });

  it("places a bedtime that falls after midnight", () => {
    const row = dayRow({ date: "2026-07-31", bedMs: at("2026-08-01T00:53:00") });
    expect(row.bed).toBeGreaterThan(0.9);
    expect(row.bedText).toBe("00:53");
  });

  it("sorts sessions by when they started", () => {
    const row = dayRow({
      date: "2026-08-03",
      sessions: [
        session("2026-08-03T13:39:00", "2026-08-03T13:56:00", 17 * 60),
        session("2026-08-03T10:51:00", "2026-08-03T11:25:00", 34 * 60),
      ],
    });
    expect(row.spans.map((s) => s.startText)).toEqual(["10:51", "13:39"]);
  });

  it("has no bed mark when the night was never recorded", () => {
    const row = dayRow({ date: "2026-08-05", bedMs: null });
    expect(row.bed).toBeNull();
    expect(row.bedText).toBeNull();
  });

  it("places the morning you got up, left of everything else", () => {
    // The two ends of the waking day. They join to different entries: wake comes
    // from the row's own night, bed from the night that starts on it.
    const row = dayRow({
      date: "2026-08-05",
      sessions: [session("2026-08-05T17:02:00", "2026-08-05T20:21:00", 199 * 60)],
      wakeMs: at("2026-08-05T08:41:00"),
      bedMs: at("2026-08-05T23:39:00"),
    });
    expect(row.wakeText).toBe("08:41");
    expect(row.wake).toBeLessThan(row.spans[0].from);
    expect(row.bed).toBeGreaterThan(row.spans[0].to);
  });

  it("drops a wake before the axis starts rather than pinning it to the edge", () => {
    const row = dayRow({ date: "2026-08-05", wakeMs: at("2026-08-05T04:30:00") });
    expect(row.wake).toBeNull();
    expect(row.wakeText).toBeNull();
  });
});

describe("duration", () => {
  it("sums active seconds rather than measuring the span", () => {
    // The gap between two halves is the band deciding you had stopped.
    const parts = [
      { activeSeconds: 30 * 60 },
      { activeSeconds: 30 * 60 },
    ];
    expect(activeMinutes(parts)).toBe(60);
  });

  it("formats hours and minutes the way the rest of the app does", () => {
    expect(durationText(199)).toBe("3H 19M");
    expect(durationText(120)).toBe("2H");
    expect(durationText(45)).toBe("45M");
    expect(durationText(0)).toBeNull();
  });
});

describe("axis ticks", () => {
  it("anchors the end ticks inward so they are not clipped", () => {
    // The last tick rendered as "0" instead of "02" before this: anchored at the
    // start, its text ran off the right of the viewBox.
    expect(AXIS_TICKS[0].anchor).toBe("start");
    expect(AXIS_TICKS.at(-1).anchor).toBe("end");
    expect(AXIS_TICKS.at(-1).label).toBe("02");
  });
});

describe("labels", () => {
  it("gives a short weekday", () => {
    expect(weekdayLabel("2026-08-05")).toBe("WED");
  });

  it("pads clock times to 24 hours", () => {
    expect(clockTime(at("2026-08-05T09:05:00"))).toBe("09:05");
    expect(clockTime(null)).toBeNull();
  });
});

describe("label collision", () => {
  it("keeps both labels when they are far apart", () => {
    const out = placeLabels([
      { id: "a", at: 0.1, text: "07:30" },
      { id: "b", at: 0.9, text: "22:15" },
    ]);
    expect(out.map((o) => o.show)).toEqual([true, true]);
  });

  it("drops the later label rather than overlapping it", () => {
    // A 12 minute session: both ends land within a couple of viewBox units.
    const out = placeLabels([
      { id: "from", at: 0.5, text: "18:20" },
      { id: "to", at: 0.51, text: "18:32" },
    ]);
    expect(out.map((o) => o.show)).toEqual([true, false]);
  });

  it("resolves by priority, not by position", () => {
    // Bed is listed first, so it survives and the session end that crowds it goes.
    const out = placeLabels([
      { id: "bed", at: 0.8, text: "22:40" },
      { id: "sessionEnd", at: 0.805, text: "22:35" },
    ]);
    expect(out.find((o) => o.id === "bed").show).toBe(true);
    expect(out.find((o) => o.id === "sessionEnd").show).toBe(false);
  });

  it("never shows a label with no position", () => {
    const out = placeLabels([{ id: "bed", at: null, text: "22:40" }]);
    expect(out[0].show).toBe(false);
  });

  it("does not let a dropped label reserve space", () => {
    // The middle one is dropped, so the third is judged against the first only.
    const out = placeLabels([
      { id: "a", at: 0.5, text: "18:20" },
      { id: "b", at: 0.505, text: "18:22" },
      { id: "c", at: 0.62, text: "19:40" },
    ]);
    expect(out.map((o) => o.show)).toEqual([true, false, true]);
  });
});

describe("dayRow label flags", () => {
  const at2 = (iso) => new Date(iso).getTime();

  it("merges a short session's two ends into one label rather than dropping either", () => {
    const row = dayRow({
      date: "2026-08-05",
      sessions: [
        {
          startMillis: at2("2026-08-05T18:20:00"),
          endMillis: at2("2026-08-05T18:32:00"),
          activeSeconds: 720,
        },
      ],
    });
    const span = row.spans[0];
    expect(span.mergedText).toBe("18:20→18:32");
    expect(span.showMergedText).toBe(true);
    // The separate ones stand down so nothing is printed twice.
    expect(span.showStartText).toBe(false);
    expect(span.showEndText).toBe(false);
    // Drawn between the two ends, not at either of them.
    expect(span.mergedAt).toBeGreaterThan(span.from);
    expect(span.mergedAt).toBeLessThan(span.to);
  });

  it("keeps both ends of a session long enough to fit them", () => {
    const row = dayRow({
      date: "2026-08-05",
      sessions: [
        {
          startMillis: at2("2026-08-05T09:00:00"),
          endMillis: at2("2026-08-05T14:00:00"),
          activeSeconds: 18000,
        },
      ],
    });
    expect(row.spans[0].showStartText).toBe(true);
    expect(row.spans[0].showEndText).toBe(true);
  });

  it("keeps wake and bed over a session that crowds them", () => {
    const row = dayRow({
      date: "2026-08-05",
      wakeMs: at2("2026-08-05T07:00:00"),
      bedMs: at2("2026-08-05T22:30:00"),
      sessions: [
        {
          startMillis: at2("2026-08-05T07:05:00"),
          endMillis: at2("2026-08-05T22:25:00"),
          activeSeconds: 600,
        },
      ],
    });
    expect(row.showWakeText).toBe(true);
    expect(row.showBedText).toBe(true);
    expect(row.spans[0].showStartText).toBe(false);
    expect(row.spans[0].showEndText).toBe(false);
  });

  it("keeps a long session's ends separate rather than merging them", () => {
    const row = dayRow({
      date: "2026-08-05",
      sessions: [
        {
          startMillis: at2("2026-08-05T09:00:00"),
          endMillis: at2("2026-08-05T14:00:00"),
          activeSeconds: 18000,
        },
      ],
    });
    expect(row.spans[0].mergedText).toBeNull();
    expect(row.spans[0].showStartText).toBe(true);
    expect(row.spans[0].showEndText).toBe(true);
  });
});

describe("labelAnchor", () => {
  // Reported from the phone: a 06:01 wake put WOKE and its time centred on the
  // first mark of the axis, at x=6 in a 300-wide box, and the card clipped both
  // to "OKE" and ":01".
  it("hangs a label at the left edge rightward", () => {
    expect(labelAnchor(6, "WOKE")).toBe("start");
    expect(labelAnchor(6, "6:01")).toBe("start");
  });

  it("hangs a label at the right edge leftward", () => {
    expect(labelAnchor(294, "23:41")).toBe("end");
  });

  it("leaves a label with room on both sides centred on its mark", () => {
    expect(labelAnchor(150, "18:20")).toBe("middle");
  });

  // The anchor moves, never the position: the label has to keep pointing at the
  // mark it belongs to.
  it("decides from the text's own width", () => {
    expect(labelAnchor(20, "18:20→18:32")).toBe("start");
    expect(labelAnchor(20, "6")).toBe("middle");
  });

  it("treats a missing label as having no width", () => {
    expect(labelAnchor(150, null)).toBe("middle");
  });
});
