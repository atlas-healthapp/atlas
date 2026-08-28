import { describe, it, expect } from "vitest";
import {
  dateFromDayKey,
  parseMorning,
  stageName,
  describeMorning,
  describeMornings,
  alarmReport,
} from "../alarmHistory";

describe("dateFromDayKey", () => {
  it("reads the service's year-and-day-of-year stamp", () => {
    // Day 1 is 1 January, so the offset is one short of the day number.
    expect(dateFromDayKey("2026-1").getMonth()).toBe(0);
    expect(dateFromDayKey("2026-1").getDate()).toBe(1);
    // 2026 is not a leap year: day 236 is 24 August.
    const d = dateFromDayKey("2026-236");
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(24);
  });

  it("refuses nonsense rather than inventing a date", () => {
    expect(dateFromDayKey("")).toBeNull();
    expect(dateFromDayKey("2026-0")).toBeNull();
    expect(dateFromDayKey("2026-400")).toBeNull();
    expect(dateFromDayKey(null)).toBeNull();
  });
});

describe("parseMorning", () => {
  it("splits a record into its fields", () => {
    const m = parseMorning("2026-236|mode=smart|set=09:00|checks=2|stage=4|fired=08:42");
    expect(m.day).toBe("2026-236");
    expect(m.mode).toBe("smart");
    expect(m.set).toBe("09:00");
    expect(m.fired).toBe("08:42");
  });

  // A field this build has never heard of must survive, or a phone running a
  // newer service than the app silently drops half its own diagnostic.
  it("keeps fields it does not know about", () => {
    expect(parseMorning("2026-236|somethingnew=7").somethingnew).toBe("7");
  });

  it("survives an empty or malformed record", () => {
    expect(parseMorning("").day).toBe("");
    expect(() => parseMorning(undefined)).not.toThrow();
  });
});

describe("stageName", () => {
  it("uses the band's own vocabulary", () => {
    expect(stageName(4)).toBe("LIGHT");
    expect(stageName(5)).toBe("DEEP");
    expect(stageName(7)).toBe("AWAKE");
    expect(stageName(8)).toBe("REM");
  });

  // -1 is the service's "cannot say", and it means three different things.
  // Naming it would be inventing a stage nobody was in.
  it("says nothing for a stage the service could not read", () => {
    expect(stageName(-1)).toBeNull();
    expect(stageName(undefined)).toBeNull();
  });
});

describe("describeMorning", () => {
  it("reports a morning that fired and was confirmed", () => {
    const d = describeMorning(
      "2026-236|mode=smart|set=09:00|checks=2|stage=4|stale=1|sessions=3|fired=08:42|ack=ok"
    );
    expect(d.outcome).toBe("fired");
    expect(d.setFor).toBe("09:00");
    expect(d.firedAt).toBe("08:42");
    expect(d.stageName).toBe("LIGHT");
    expect(d.smart).toBe(true);
  });

  // The three-week bug: the trail said FIRING and no alarm ever left the phone.
  // A write with no acknowledgement must never read the same as a real one.
  it("separates a write from a confirmed write", () => {
    const d = describeMorning("2026-236|mode=smart|set=09:00|checks=1|stage=4|fired=08:42");
    expect(d.outcome).toBe("fired-unconfirmed");
    expect(d.reason).toMatch(/never confirmed/i);
  });

  // 2026-08-21: awake two hours, dozed off, band 145 minutes behind.
  it("explains a stale strap rather than blaming the alarm", () => {
    const d = describeMorning(
      "2026-235|mode=smart|set=09:00|checks=2|stage=-1|stale=145|sessions=3"
    );
    expect(d.outcome).toBe("stale");
    expect(d.reason).toContain("145 minutes old");
  });

  it("tells no data apart from a stale reading", () => {
    const d = describeMorning("2026-235|mode=smart|set=09:00|checks=1|stage=-1|stale=-1|sessions=0");
    expect(d.outcome).toBe("no-data");
  });

  it("names the stage when it simply was not a wakeable one", () => {
    const d = describeMorning(
      "2026-235|mode=smart|set=09:00|checks=2|stage=5|stale=1|sessions=3"
    );
    expect(d.outcome).toBe("not-wakeable");
    expect(d.reason).toContain("deep");
  });

  // A fixed alarm is rung by the strap itself and there is nothing to look for.
  // Reporting that as a failure would teach people to ignore the screen.
  it("does not treat a non-smart mode as a fault", () => {
    expect(describeMorning("2026-235|mode=fixed|set=09:00").outcome).toBe("not-watching");
    expect(describeMorning("2026-235|mode=onset|set=09:30").outcome).toBe("not-watching");
  });

  // The one case that IS a fault: smart, due, and the window never looked.
  it("flags a window that was never checked", () => {
    const d = describeMorning("2026-235|mode=smart|set=09:00");
    expect(d.outcome).toBe("never-looked");
    expect(d.reason).toMatch(/worth reporting/i);
  });
});

describe("describeMornings", () => {
  it("puts the newest first, counting day numbers as numbers", () => {
    const out = describeMornings([
      "2026-99|mode=smart",
      "2026-236|mode=smart",
      "2026-100|mode=smart",
    ]);
    // A plain string sort would put 99 above 236.
    expect(out.map((m) => m.day)).toEqual(["2026-236", "2026-100", "2026-99"]);
  });

  it("copes with nothing recorded yet", () => {
    expect(describeMornings(undefined)).toEqual([]);
  });
});

describe("alarmReport", () => {
  it("carries the raw records under a header, not a paraphrase", () => {
    const text = alarmReport({
      mornings: ["2026-236|mode=smart|fired=08:42|ack=ok"],
      mode: "smart",
      enabled: true,
      hour: 9,
      minute: 0,
      version: "1.0.8",
    });
    expect(text).toContain("ATLAS ALARM LOG 1.0.8");
    expect(text).toContain("now: on smart 09:00");
    expect(text).toContain("mornings: 1");
    // The record itself, exactly as the service wrote it.
    expect(text).toContain("2026-236|mode=smart|fired=08:42|ack=ok");
  });

  it("says so when no alarm is set", () => {
    expect(alarmReport({ mornings: [], enabled: false, hour: -1 })).toContain("not set");
  });

  // Somebody is going to paste this to a stranger. There is nothing in a
  // morning record but times and stage codes, and this proves it stays that way.
  //
  // **Checked against the report's own vocabulary rather than against one name.**
  // This used to assert the text did not contain the author's first name, which
  // is a canary that only ever worked on the author's phone: the way a name would
  // get in here is the report learning to read the profile, and then it would say
  // whoever's name it was. A closed vocabulary catches that for every user, and
  // it also catches a strap name, a device name, a place - anything alphabetic
  // that nobody deliberately put in the format.
  //
  // (It also has to: scripts/auditPublic.mjs refuses a real first name in any
  // published file, having twice found one that had already gone out.)
  it("carries no identity", () => {
    const text = alarmReport({
      mornings: ["2026-236|mode=smart|set=09:00|fired=08:42|ack=ok|hr=n=12 mean=61 ratio=1.30"],
      mode: "smart",
      enabled: true,
      hour: 9,
      minute: 0,
      version: "1.0.9",
    });
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/);
    expect(text).not.toMatch(/[0-9a-f]{16,}/i);

    // Every alphabetic run the format is allowed to produce. A word appearing
    // here that is not in this list is either a new field nobody wrote down or
    // something that came off the user's phone, and both want looking at.
    const ALLOWED = new Set([
      "ATLAS", "ALARM", "LOG",
      "now", "on", "off", "not", "set",
      "mornings", "mode", "fired", "ack", "ok", "failed", "hr", "n", "mean", "ratio",
      "smart", "onset", "fixed", "none",
    ]);
    const words = text.match(/[A-Za-z]+/g) ?? [];
    expect(words.filter((w) => !ALLOWED.has(w))).toEqual([]);
  });
});
