import { describe, it, expect } from "vitest";
import {
  coverageNote,
  durationWords,
  medianGap,
  noHeartRateReason,
  summariseSession,
  zoneRows,
} from "@/components/activity/sessionRecap";

const AGE = 32; // max 186 by Tanaka, so zone 1 starts at 93

/** A run of readings a minute apart, from a start time. */
function series(values, { from = 1_700_000_000_000, gapMs = 60_000 } = {}) {
  return values.map((v, i) => ({ t: from + i * gapMs, v }));
}

describe("medianGap", () => {
  it("finds the band's own reporting interval", () => {
    expect(medianGap(series([100, 101, 102, 103, 104]))).toBe(60_000);
  });

  it("is not dragged by a dropout, which is why it is a median", () => {
    const samples = series([100, 101, 102, 103, 104]);
    // Twenty minutes with the strap off, in the middle.
    samples[3].t += 20 * 60_000;
    samples[4].t += 20 * 60_000;
    expect(medianGap(samples)).toBe(60_000);
  });

  it("assumes the band's rate when there is nothing to measure", () => {
    expect(medianGap([])).toBe(60_000);
    expect(medianGap(series([100, 101]))).toBe(60_000);
  });
});

describe("summariseSession", () => {
  it("withholds everything when the window is too thin to believe", () => {
    // The same floor the calorie estimate uses, and for the same reason: a
    // window holding one or two readings is the strap being handled.
    expect(summariseSession({ samples: series([120, 130]), ageYears: AGE })).toBe(null);
  });

  it("reports the three figures a session is actually described by", () => {
    const out = summariseSession({ samples: series([110, 120, 130, 140, 150, 120]), ageYears: AGE });
    expect(out.avg).toBe(128);
    expect(out.min).toBe(110);
    expect(out.max).toBe(150);
    expect(out.samples).toBe(6);
  });

  it("counts minutes per zone from the readings, not from the spans between them", () => {
    // Six minutes: two below zone 1 (under 93), two in zone 2 (112-130), two in
    // zone 4 (149-167).
    const out = summariseSession({
      samples: series([80, 85, 115, 120, 150, 155]),
      ageYears: AGE,
    });
    expect(out.zones[0]).toBe(2);
    expect(out.zones[2]).toBe(2);
    expect(out.zones[4]).toBe(2);
    expect(out.zones[1]).toBe(0);
  });

  it("does not hand a dropout to whichever zone preceded it", () => {
    // The case the sample counting exists for. Five readings in zone 2, then the
    // strap is off for twenty minutes, then one more. Measuring spans would call
    // that twenty minutes of zone 2.
    const samples = series([115, 116, 117, 118, 119, 120]);
    samples[5].t += 20 * 60_000;
    const out = summariseSession({ samples, ageYears: AGE });
    expect(out.zones[2]).toBe(6);
  });

  it("has nothing to say about a zone without an age to compute a maximum from", () => {
    const out = summariseSession({ samples: series([110, 120, 130, 140, 150]), ageYears: null });
    // Still reports the readings themselves - those need no maximum - but every
    // reading falls outside a zone it cannot place.
    expect(out.avg).toBe(130);
    expect(out.zones.slice(1).every((m) => m === 0)).toBe(true);
  });
});

describe("zoneRows", () => {
  const summary = summariseSession({
    samples: series([80, 85, 115, 120, 122, 150]),
    ageYears: AGE,
  });

  it("drops the zones you never entered", () => {
    const rows = zoneRows(summary);
    // Below-zone-1, zone 2 and zone 4 only.
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.minutes > 0)).toBe(true);
  });

  it("puts the biggest first, because that is what the session was", () => {
    const rows = zoneRows(summary);
    expect(rows[0].minutes).toBeGreaterThanOrEqual(rows[1].minutes);
  });

  it("names the sub-zone time as what it is rather than calling it a zone", () => {
    const rows = zoneRows(summary);
    expect(rows.find((r) => r.index === 0).name).toBe("BELOW ZONE 1");
  });

  it("has nothing to draw when there is no summary", () => {
    expect(zoneRows(null)).toEqual([]);
  });
});

describe("durationWords", () => {
  it("keeps the seconds on a short session, which is the case that read as a placeholder", () => {
    // "1M" for a real 75 seconds is what this replaced, and the fully spelled
    // out version wrapped to two lines under the figure.
    expect(durationWords(75)).toBe("1 min 15 secs");
  });

  it("says seconds alone under a minute", () => {
    expect(durationWords(42)).toBe("42 secs");
    expect(durationWords(1)).toBe("1 sec");
  });

  it("drops the seconds once nobody is timing to them", () => {
    expect(durationWords(42 * 60 + 20)).toBe("42 mins");
    expect(durationWords(65 * 60 + 30)).toBe("1 hr 5 mins");
  });

  it("keeps a session of no length honest rather than empty", () => {
    expect(durationWords(0)).toBe("0 secs");
  });
});

describe("noHeartRateReason", () => {
  const base = { connected: true, syncing: false, samples: [] };

  it("says a short session can never have one, rather than promising a sync", () => {
    const out = noHeartRateReason({ ...base, activeSeconds: 60 });
    expect(out).toMatch(/TOO SHORT/);
    expect(out).not.toMatch(/NEXT SYNC/);
  });

  it("separates no strap from a sync in progress", () => {
    expect(noHeartRateReason({ ...base, activeSeconds: 1800, connected: false })).toMatch(/NO STRAP/);
    expect(noHeartRateReason({ ...base, activeSeconds: 1800, syncing: true })).toMatch(/READING/);
  });

  it("says how many readings have landed when some have", () => {
    const out = noHeartRateReason({
      ...base,
      activeSeconds: 1800,
      samples: [{ t: 1, v: 100 }, { t: 2, v: 101 }],
    });
    expect(out).toMatch(/ONLY 2 READINGS/);
  });

  it("has nothing to say once there are enough", () => {
    const samples = Array.from({ length: 6 }, (_, i) => ({ t: i, v: 120 }));
    expect(noHeartRateReason({ ...base, activeSeconds: 1800, samples })).toBe(null);
  });
});

describe("coverageNote", () => {
  it("says nothing once the strap's own record covers the session", () => {
    // 30 minutes, 28 readings: the band's copy has landed.
    expect(coverageNote({ activeSeconds: 30 * 60, storedCount: 28, trailCount: 300 })).toBe(null);
  });

  it("warns when everything shown came from the live stream", () => {
    // The locked-phone case turned inside out: the screen was on, so the trail
    // has plenty, but the band has handed over nothing.
    const out = coverageNote({ activeSeconds: 30 * 60, storedCount: 0, trailCount: 300 });
    expect(out).toMatch(/PROVISIONAL/);
    expect(out).toMatch(/NEXT SYNC/);
  });

  it("warns when the strap has delivered only part of the window", () => {
    // The real locked-phone case: a long session, a handful of readings.
    const out = coverageNote({ activeSeconds: 45 * 60, storedCount: 6, trailCount: 20 });
    expect(out).toMatch(/PROVISIONAL/);
    expect(out).toMatch(/STILL ON THE STRAP/);
  });

  it("has nothing to qualify when there is nothing at all", () => {
    // That case has its own message, from noHeartRateReason.
    expect(coverageNote({ activeSeconds: 60, storedCount: 0, trailCount: 0 })).toBe(null);
  });
});

describe("zoneRows labels", () => {
  it("says minutes in words rather than as a code", () => {
    const summary = summariseSession({ samples: series([115, 116, 117]), ageYears: AGE, minSamples: 2 });
    const rows = zoneRows(summary);
    expect(rows[0].label).toMatch(/min/);
    expect(rows[0].label).not.toMatch(/^\d+M$/);
  });

  it("uses the singular for one minute", () => {
    const summary = summariseSession({ samples: series([115, 116]), ageYears: AGE, minSamples: 2 });
    const rows = zoneRows(summary);
    expect(rows[0].label).toBe("2 mins");
  });
});
