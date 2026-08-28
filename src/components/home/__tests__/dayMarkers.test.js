import { describe, it, expect } from "vitest";
import {
  axisFraction,
  labelPlacement,
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
  gapNeeded,
  labelExtent,
  MK_FONT_PX,
  MK_LETTER_SPACING,
} from "@/components/home/dayMarkers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
    //
    // **`b` is deliberately much wider than `a` and only just behind it.** The
    // original fixture put two five-character labels 0.005 apart, which is 1.4
    // units on this axis: `b` reserved almost exactly the span `a` already had,
    // so anything clearing `a` cleared `b` too and the case passed whether the
    // rule held or not. A wide `b` reaches well past `a` on the right, so `c`
    // sits in space that only `b` could have claimed.
    const out = placeLabels([
      { id: "a", at: 0.2, text: "10:29" },
      { id: "b", at: 0.25, text: "18:50→20:49" },
      { id: "c", at: 0.45, text: "19:40" },
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

describe("labelPlacement", () => {
  // Reported from the phone: a 06:01 wake put WOKE and its time centred on the
  // first mark of the axis, at x=6 in a 300-wide box, and the card clipped both
  // to "OKE" and ":01".
  it("keeps a label at the left edge inside the drawing", () => {
    const p = labelPlacement(0, "WOKE");
    expect(p.from).toBeCloseTo(2, 5);
    expect(p.shifted).toBe(true);
  });

  it("keeps a label at the right edge inside the drawing", () => {
    const p = labelPlacement(1, "23:41");
    expect(p.to).toBeLessThanOrEqual(298);
    expect(p.shifted).toBe(true);
  });

  it("leaves a label with room on both sides exactly on its mark", () => {
    const p = labelPlacement(0.5, "18:20");
    expect(p.x).toBe(p.mark);
    expect(p.shifted).toBe(false);
  });

  // **The change of 2026-08-28.** This used to flip the label's anchor, which
  // displaces it by half its own width however little room was actually needed -
  // a 01:30 bedtime wanted 8.8 units and was moved 20, so it sat well left of
  // the dot it names and took the space its neighbour needed. Moving it by the
  // least amount that fits is what keeps it under its own mark.
  it("moves an edge label by the least amount that fits, not by half its width", () => {
    const p = labelPlacement(0.975, "01:30");
    const halfWidth = (p.to - p.from) / 2;
    expect(p.mark - p.x).toBeLessThan(halfWidth);
    expect(p.to).toBeCloseTo(298, 5);
  });

  it("decides from the text's own width", () => {
    // A wide label at the same mark has to move further than a narrow one.
    const wide = labelPlacement(0.05, "18:20→18:32");
    const narrow = labelPlacement(0.05, "6");
    expect(wide.shifted).toBe(true);
    expect(narrow.shifted).toBe(false);
  });

  it("treats a missing label as having no width", () => {
    const p = labelPlacement(0.5, null);
    expect(p.from).toBe(p.to);
    expect(p.shifted).toBe(false);
  });
});

// The check that did not exist when this went wrong.
//
// `CHAR_W` is a prediction of how wide `.mk` renders, and `.mk` is set in a
// stylesheet this module cannot see. For months the two disagreed - the label
// grew from 8.5px to 13px on 2026-08-27 and the prediction stayed at 8.5 - and
// nothing anywhere failed, because two `<text>` nodes overlapping is not an
// error, it is a drawing. So the stylesheet is read here and compared, the same
// way families.test.js reads style.css rather than trusting a copy of it.
describe("the type it predicts", () => {
  const vue = readFileSync(
    resolve(process.cwd(), "src/components/home/RecoveryPage.vue"),
    "utf8"
  );
  const block = vue.slice(vue.indexOf("\n.mk {"));
  const body = block.slice(0, block.indexOf("}"));

  it("matches the font size .mk is actually set in", () => {
    const size = /font-size:\s*([\d.]+)px/.exec(body);
    expect(size).not.toBeNull();
    expect(Number(size[1])).toBe(MK_FONT_PX);
  });

  it("matches the letter-spacing .mk is actually set in", () => {
    const spacing = /letter-spacing:\s*([\d.]+)px/.exec(body);
    expect(spacing).not.toBeNull();
    expect(Number(spacing[1])).toBe(MK_LETTER_SPACING);
  });

  // The regression itself, read off the phone on 2026-08-28: woke 10:29,
  // trained 18:50 to 20:49, in bed 01:30. Measured in the rendered SVG, the
  // merged session label ran to 248.8 and the bedtime began at 246.8, and the
  // card read `18:50→20:4901:30`.
  //
  // The cause was not the label widths but the anchoring. A 01:30 bedtime sits
  // at 97.5% of the axis, so its label is anchored `end` and hangs LEFT of its
  // mark - while `placeLabels` had cleared it against the centred position it
  // would have taken if there were room.
  const realDay = () =>
    dayRow({
      date: "2026-08-27",
      sessions: [
        {
          startMillis: at("2026-08-27T18:50:00"),
          endMillis: at("2026-08-27T20:49:00"),
          activeSeconds: 119 * 60,
        },
      ],
      wakeMs: at("2026-08-27T10:29:00"),
      bedMs: at("2026-08-28T01:30:00"),
    });

  it("does not print a session's times into the bedtime beside it", () => {
    const row = realDay();
    const drawn = [];
    if (row.showWakeText) drawn.push(labelExtent(row.wake, row.wakeText));
    if (row.showBedText) drawn.push(labelExtent(row.bed, row.bedText));
    for (const s of row.spans) {
      if (s.showMergedText) drawn.push(labelExtent(s.mergedAt, s.mergedText));
      if (s.showStartText) drawn.push(labelExtent(s.from, s.startText));
      if (s.showEndText) drawn.push(labelExtent(s.to, s.endText));
    }
    const sorted = drawn.sort((a, b) => a.from - b.from);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].from).toBeGreaterThanOrEqual(sorted[i - 1].to);
    }
  });

  it("says both ends of the session, not just its start", () => {
    // What the smaller type and the minimal clamp bought between them. At 12px
    // with the label displaced half its width, these two cleared each other by
    // 0.9 units - a fit on this day's data and a collision on the next - so the
    // session had to fall back to its start alone. At 11px with the clamp the
    // margin is 7.8 and both times fit.
    const row = realDay();
    const span = row.spans[0];
    expect(span.showMergedText).toBe(true);
    expect(span.mergedText).toBe("18:50→20:49");
    expect(row.showBedText).toBe(true);
  });

  it("keeps the bedtime under its own dot", () => {
    // 01:30 is at the far right of the axis, so its label has to come inward or
    // the card clips it. Inward by the least that fits: it still straddles the
    // mark it names rather than sitting entirely to one side of it.
    const row = realDay();
    const p = labelPlacement(row.bed, row.bedText);
    expect(p.to).toBeCloseTo(298, 5);
    expect(p.from).toBeLessThan(p.mark);
    expect(p.to).toBeGreaterThan(p.mark);
  });

  it("still falls back to the start time when even that will not fit", () => {
    // The mechanism has not gone, it is just no longer needed on this day. A
    // session ending nearer the bedtime still cannot print both ends.
    const row = dayRow({
      date: "2026-08-27",
      sessions: [
        {
          startMillis: at("2026-08-27T21:40:00"),
          endMillis: at("2026-08-27T23:20:00"),
          activeSeconds: 100 * 60,
        },
      ],
      bedMs: at("2026-08-28T01:30:00"),
    });
    const span = row.spans[0];
    expect(span.showMergedText).toBe(true);
    expect(span.mergedText).toBe("21:40");
    expect(span.mergedAt).toBeCloseTo(span.from, 5);
  });
});
