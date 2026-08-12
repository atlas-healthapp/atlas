import { describe, it, expect } from "vitest";
import { tripSpans, tripReach, spanBox , placeTripLabels } from "@/utils/tripSpans";

const bali = { id: "t1", label: "BALI", start: "2026-06-30", end: "2026-07-07" };

/** Days oldest first, the order every history chart builds its series in. */
function days(spec) {
  return Object.entries(spec).map(([date, value]) => ({ date, value }));
}

describe("tripSpans", () => {
  it("covers only the missing days, not the whole range", () => {
    const spans = tripSpans(
      days({
        "2026-06-29": 70,
        "2026-06-30": null,
        "2026-07-01": null,
        "2026-07-02": 68,
        "2026-07-03": 71,
      }),
      [bali]
    );

    expect(spans).toEqual([{ tripId: "t1", label: "BALI", from: 1, to: 2, count: 2 }]);
  });

  it("splits into two spans when a day inside the trip has a reading", () => {
    const spans = tripSpans(
      days({
        "2026-06-30": null,
        "2026-07-01": 66,
        "2026-07-02": null,
        "2026-07-03": null,
      }),
      [bali]
    );

    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ from: 0, to: 0, count: 1 });
    expect(spans[1]).toMatchObject({ from: 2, to: 3, count: 2 });
  });

  it("treats a stored zero as missing, the way the charts already do", () => {
    const spans = tripSpans(days({ "2026-06-30": 0, "2026-07-01": 0 }), [bali]);
    expect(spans).toEqual([{ tripId: "t1", label: "BALI", from: 0, to: 1, count: 2 }]);
  });

  it("says nothing about a trip whose days all have readings", () => {
    const spans = tripSpans(days({ "2026-06-30": 70, "2026-07-01": 71 }), [bali]);
    expect(spans).toEqual([]);
  });

  it("ignores missing days outside every trip", () => {
    const spans = tripSpans(days({ "2026-07-20": null, "2026-07-21": null }), [bali]);
    expect(spans).toEqual([]);
  });

  it("runs a span to the end of the window when the trip is still going", () => {
    const spans = tripSpans(days({ "2026-07-05": 70, "2026-07-06": null, "2026-07-07": null }), [
      bali,
    ]);
    expect(spans).toEqual([{ tripId: "t1", label: "BALI", from: 1, to: 2, count: 2 }]);
  });

  it("handles two trips in one window, ordered by where they start", () => {
    const gc = { id: "t2", label: "GOLD COAST", start: "2026-08-01", end: "2026-08-03" };
    const spans = tripSpans(
      days({
        "2026-06-30": null,
        "2026-07-01": 70,
        "2026-08-01": null,
        "2026-08-02": null,
      }),
      [gc, bali]
    );

    expect(spans.map((s) => s.label)).toEqual(["BALI", "GOLD COAST"]);
  });

  it("survives an empty series and a store with nothing in it", () => {
    expect(tripSpans([], [bali])).toEqual([]);
    expect(tripSpans(days({ "2026-06-30": null }), [])).toEqual([]);
    expect(tripSpans(null, null)).toEqual([]);
  });

  it("skips a malformed trip rather than matching every date against undefined", () => {
    expect(tripSpans(days({ "2026-06-30": null }), [{ id: "x", label: "BROKEN" }])).toEqual([]);
  });
});

describe("tripReach", () => {
  // The real case: Gold Coast 1-3 August, every day of it recorded. tripSpans
  // has nothing to say about it, which is the whole reason this exists.
  const goldCoast = { id: "t2", label: "GOLD COAST", start: "2026-08-01", end: "2026-08-03" };
  const recorded = days({
    "2026-07-31": 48,
    "2026-08-01": 48,
    "2026-08-02": 51,
    "2026-08-03": 53,
    "2026-08-04": 50,
  });

  it("reaches days that have readings, where tripSpans draws nothing", () => {
    expect(tripSpans(recorded, [goldCoast])).toEqual([]);
    expect(tripReach(recorded, [goldCoast])).toEqual([
      { tripId: "t2", label: "GOLD COAST", from: 1, to: 3 },
    ]);
  });

  it("stays one span across a mix of recorded and missing days", () => {
    const mixed = days({
      "2026-08-01": 48,
      "2026-08-02": null,
      "2026-08-03": 53,
    });
    expect(tripReach(mixed, [goldCoast])).toEqual([
      { tripId: "t2", label: "GOLD COAST", from: 0, to: 2 },
    ]);
    // ...while the gap band still covers the one missing day inside it.
    expect(tripSpans(mixed, [goldCoast])).toMatchObject([{ from: 1, to: 1 }]);
  });

  it("clips to the window when the trip runs off the start of it", () => {
    const clipped = days({ "2026-08-03": 53, "2026-08-04": 50 });
    expect(tripReach(clipped, [goldCoast])).toEqual([
      { tripId: "t2", label: "GOLD COAST", from: 0, to: 0 },
    ]);
  });

  it("says nothing about a trip outside the window entirely", () => {
    expect(tripReach(days({ "2026-09-01": 50 }), [goldCoast])).toEqual([]);
  });

  it("skips a malformed trip", () => {
    expect(tripReach(recorded, [{ id: "x", label: "BROKEN" }])).toEqual([]);
    expect(tripReach(null, null)).toEqual([]);
  });
});

describe("spanBox", () => {
  it("lines a span up with the empty slots barGeometry leaves", () => {
    // barGeometry puts bar i at i * (width / count); a span over slots 1-2 of 10
    // has to start where bar 1 would and cover two slots.
    const box = spanBox({ from: 1, to: 2 }, 10, 300);
    expect(box.x).toBe(30);
    expect(box.width).toBe(60);
  });

  it("gives a single missing day a full slot rather than no width", () => {
    const box = spanBox({ from: 4, to: 4 }, 10, 300);
    expect(box.width).toBe(30);
  });
});

describe("placeTripLabels", () => {
  const trip = (id, label, x) => ({ tripId: id, label, box: { x, width: 3 } });

  it("keeps both labels when the trips are far apart", () => {
    const out = placeTripLabels([trip("a", "GOLD COAST", 5), trip("b", "JAPAN", 70)]);
    expect(out.map((t) => t.showLabel)).toEqual([true, true]);
  });

  it("drops the later label rather than printing two on top of each other", () => {
    // A long name on a narrow rule overflows it, which is deliberate, and two of
    // them beside each other is what that costs.
    const out = placeTripLabels([trip("a", "GOLD COAST", 40), trip("b", "BYRON BAY", 44)]);
    expect(out[0].showLabel).toBe(true);
    expect(out[1].showLabel).toBe(false);
  });

  it("keeps the rule even when its label is dropped", () => {
    const out = placeTripLabels([trip("a", "GOLD COAST", 40), trip("b", "BYRON BAY", 44)]);
    // The fact survives; only the name of it goes.
    expect(out[1].box).toBeTruthy();
    expect(out[1].tripId).toBe("b");
  });

  it("does not let a dropped label reserve the space it would have taken", () => {
    const out = placeTripLabels([
      trip("a", "GOLD COAST", 40),
      trip("b", "BYRON BAY", 44),
      trip("c", "PERTH", 80),
    ]);
    expect(out.map((t) => t.showLabel)).toEqual([true, false, true]);
  });
});
