import { describe, it, expect } from "vitest";
import { DEFAULT_GOALS } from "@/stores/goals";
import { METRICS, metric, formatValue, valueForDate } from "@/utils/metricRegistry";
import { BODY_METRICS } from "@/utils/bodyMetrics";
import { familyOf } from "@/utils/families";

describe("METRICS", () => {
  // Anything added to or removed from the ingest registry has to show up here
  // too, or a metric is being collected and never displayed.
  it("covers every wearable metric that gets rolled up", () => {
    const fromSamples = Object.values(METRICS)
      .filter((m) => m.source === "samples")
      .map((m) => m.key)
      .sort();
    const collected = Object.keys(BODY_METRICS)
      .filter((k) => BODY_METRICS[k].rollup !== "none")
      .sort();
    expect(fromSamples).toEqual(collected);
  });

  // Sleep deliberately stayed on checkin in SP1a so Home kept working. Getting
  // this wrong makes a metric render blank rather than error.
  it("reads sleep from checkin, and the wearable metrics from samples", () => {
    expect(METRICS.sleep.source).toBe("checkin");
    for (const key of ["hrv", "restingHr", "steps", "pai", "spo2", "skinTemp", "stress"]) {
      expect(METRICS[key].source, key).toBe("samples");
    }
  });

  it("gives every metric a family, so nothing renders in the fallback grey", () => {
    for (const key of Object.keys(METRICS)) {
      expect(familyOf(key), `${key} has no family`).not.toBeNull();
    }
  });

  it("only marks a metric editable when it is one Atlas owns", () => {
    for (const m of Object.values(METRICS)) {
      if (m.editable) expect(m.source, m.key).toBe("checkin");
      // An editable metric needs a step size or its stepper moves by undefined.
      if (m.editable) expect(typeof m.step, m.key).toBe("number");
    }
  });

  // The invariant is now conditional, and the condition is the point: a goal can
  // be switched off, and `goal` is then null on purpose rather than missing. So
  // the rule is that every bar metric has a target *defined*, and a screen must
  // not draw a bar for one that is currently off.
  it("defines a goal for every bar metric, since a bar chart with no target has no axis", () => {
    for (const m of Object.values(METRICS)) {
      if (m.chart !== "bar") continue;
      // Two references are fixed rather than chosen, so they have a target
      // without having a goal: sleep's is clinical, and PAI's 100 is what the
      // metric is defined around. Everything else takes its line from the store.
      if (m.key === "sleep" || m.key === "pai") {
        expect(m.goal, m.key).toBeGreaterThan(0);
        expect(DEFAULT_GOALS[m.key], `${m.key} must not be a settable goal`).toBeUndefined();
        continue;
      }
      expect(DEFAULT_GOALS[m.key], m.key).toBeDefined();
      expect(DEFAULT_GOALS[m.key].value, m.key).toBeGreaterThan(0);
    }
  });

  it("reports no goal at all for a metric whose target is switched off", () => {
    // Creatine is the one that ships off, because most people take none and a
    // permanent 0/5G row is somebody else's app showing through.
    expect(DEFAULT_GOALS.creatine.enabled).toBe(false);
    expect(METRICS.creatine.goal).toBe(null);
  });

  it("windows every metric, and only at one of the three agreed lengths", () => {
    for (const m of Object.values(METRICS)) {
      expect([14, 30, 90], m.key).toContain(m.window);
    }
  });

  it("returns null for an unknown key rather than a half-built descriptor", () => {
    expect(metric("nonsense")).toBeNull();
  });
});

describe("formatValue", () => {
  // Zero is a real reading for stress and PAI, and an idle-but-worn day rolls
  // up to null for steps. Collapsing the two would report "you took no steps"
  // for a day the strap simply had nothing to say.
  it("renders nothing-recorded and a real zero differently", () => {
    expect(formatValue(METRICS.stress, null)).toBe("--");
    expect(formatValue(METRICS.steps, null)).toBe("--");
    expect(formatValue(METRICS.stress, 0)).toBe("0");
    expect(formatValue(METRICS.pai, 0)).toBe("0");
  });

  it("formats sleep as hours and minutes", () => {
    expect(formatValue(METRICS.sleep, 8.3833)).toBe("8h 23m");
  });

  it("thousand-separates steps", () => {
    expect(formatValue(METRICS.steps, 8240)).toBe("8,240");
  });

  it("rounds skin temperature to one decimal and adds the unit", () => {
    expect(formatValue(METRICS.skinTemp, 33.14159)).toBe("33.1°C");
  });

  it("appends the unit for plain metrics and rounds to a whole number", () => {
    expect(formatValue(METRICS.restingHr, 54.4)).toBe("54 BPM");
    expect(formatValue(METRICS.hrv, 46.6)).toBe("47 MS");
  });

  // SpO2 and breathing rate are averages of hundreds of readings that land in a
  // narrow band, so whole numbers hid every difference. The metric page showed
  // a column of identical 98% beside deviation bars of visibly different
  // lengths, which reads as the bars being wrong.
  it("keeps a decimal where whole numbers would collapse a real spread", () => {
    expect(formatValue(METRICS.spo2, 97.4)).toBe("97.4%");
    expect(formatValue(METRICS.respRate, 14.26)).toBe("14.3 BRPM");
  });

  it("takes a caller's own empty text", () => {
    expect(formatValue(METRICS.steps, null, { empty: "NO DATA" })).toBe("NO DATA");
  });
});

describe("valueForDate", () => {
  it("reads a checkin metric through entryFor, keyed on the given date", () => {
    const entryFor = (d) => (d === "2026-07-26" ? { sleep: 7.5 } : null);
    expect(valueForDate(METRICS.sleep, "2026-07-26", null, entryFor)).toBe(7.5);
    expect(valueForDate(METRICS.sleep, "2026-07-25", null, entryFor)).toBeNull();
  });

  it("reads a samples metric from the passed-in day values", () => {
    expect(valueForDate(METRICS.steps, "2026-07-26", { steps: 8000 }, () => null)).toBe(8000);
    expect(valueForDate(METRICS.steps, "2026-07-26", {}, () => null)).toBeNull();
    expect(valueForDate(METRICS.steps, "2026-07-26", null, () => null)).toBeNull();
  });

  it("treats a real zero as a value rather than nulling it", () => {
    expect(valueForDate(METRICS.sleep, "2026-07-26", null, () => ({ sleep: 0 }))).toBe(0);
    expect(valueForDate(METRICS.steps, "2026-07-26", { steps: 0 }, () => null)).toBe(0);
  });
});
