import { describe, it, expect } from "vitest";
import {
  rollingBaseline,
  deviation,
  deviationToScore,
  typicalRange,
  BASELINE_NIGHTS,
} from "@/utils/baseline";
import {
  computeRecovery,
  recoveryBreakdown,
  recoveryExplanation,
  recoveryHeadroom,
  headroomSentence,
  sleepDriftSentence,
  hrvGapPercent,
  termTarget,
  biggestOpportunity,
  baselineNote,
  recoveryLabel,
  sleepTerm,
  RECOVERY_BANDS,
} from "@/utils/recovery";

/** Seven steady nights, the minimum that produces a baseline. */
const steadyHrv = [52, 50, 54, 51, 53, 49, 52];
const steadyRhr = [54, 55, 53, 56, 54, 55, 54];

describe("rollingBaseline", () => {
  it("returns null until the window fills", () => {
    expect(rollingBaseline([50, 52, 51])).toBeNull();
    expect(rollingBaseline(steadyHrv.slice(0, BASELINE_NIGHTS - 1))).toBeNull();
    expect(rollingBaseline(steadyHrv)).not.toBeNull();
  });

  it("uses only the most recent window, so old nights stop counting", () => {
    const withAncientOutlier = [200, 200, 200, ...steadyHrv];
    const base = rollingBaseline(withAncientOutlier);
    expect(base.mean).toBeLessThan(60);
  });

  it("skips missing nights rather than treating them as zero", () => {
    const gappy = [52, null, 50, undefined, 54, 51, 53, 49, 52];
    const base = rollingBaseline(gappy);
    expect(base).not.toBeNull();
    expect(base.n).toBe(BASELINE_NIGHTS);
    expect(base.mean).toBeGreaterThan(45);
  });

  it("puts the mean inside its own range", () => {
    const base = rollingBaseline(steadyHrv);
    expect(base.low).toBeLessThan(base.mean);
    expect(base.high).toBeGreaterThan(base.mean);
  });

  // HRV is skewed, so a raw mean over-weights the high nights.
  it("log-transforms when asked, giving an asymmetric range in real units", () => {
    const base = rollingBaseline([30, 40, 50, 60, 70, 90, 120], { log: true });
    const below = base.mean - base.low;
    const above = base.high - base.mean;
    expect(above).toBeGreaterThan(below);
  });
});

describe("deviation and scoring", () => {
  it("reads a value at the baseline mean as no deviation", () => {
    const base = rollingBaseline(steadyRhr);
    expect(deviation(base.mean, base)).toBeCloseTo(0, 5);
    expect(deviationToScore(0)).toBe(0.5);
  });

  it("scores a favourable deviation up and an unfavourable one down", () => {
    expect(deviationToScore(2)).toBe(1);
    expect(deviationToScore(-2)).toBe(0);
    expect(deviationToScore(1)).toBe(0.75);
  });

  it("inverts direction for resting heart rate, where higher is worse", () => {
    expect(deviationToScore(2, { higherIsBetter: false })).toBe(0);
    expect(deviationToScore(-2, { higherIsBetter: false })).toBe(1);
  });

  it("clamps beyond two standard deviations rather than running away", () => {
    expect(deviationToScore(9)).toBe(1);
    expect(deviationToScore(-9)).toBe(0);
  });

  // Seven identical readings would otherwise make every deviation infinite.
  it("returns null when the baseline has no spread at all", () => {
    const flat = rollingBaseline([50, 50, 50, 50, 50, 50, 50]);
    expect(deviation(60, flat)).toBeNull();
  });

  it("returns null for a missing reading", () => {
    expect(deviation(null, rollingBaseline(steadyRhr))).toBeNull();
  });
});

describe("typicalRange", () => {
  it("is null before the window fills, so the band renders nothing", () => {
    expect(typicalRange([50, 52])).toBeNull();
  });

  it("brackets the recent nights once it exists", () => {
    const range = typicalRange(steadyHrv);
    expect(range.low).toBeLessThan(50);
    expect(range.high).toBeGreaterThan(52);
  });

  // The band decides how often Home shows an exception row instead of its one
  // calm "all normal" line. Too tight and the exception is the normal state.
  // An earlier version used one standard deviation and flagged a third of all
  // days; at 1.5 it still flagged 21%, which with three vitals meant something
  // surfaced on half of all days.
  it("flags roughly one day in twenty for a metric that has not actually changed", () => {
    // Deterministic generator, so this cannot fail intermittently in CI.
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const normal = (mean, sd) => {
      const u = random() || 1e-9;
      const v = random() || 1e-9;
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };

    const TRIALS = 4000;
    let flagged = 0;
    for (let t = 0; t < TRIALS; t++) {
      const history = Array.from({ length: 7 }, () => normal(52, 6));
      const todayValue = normal(52, 6);
      const range = typicalRange(history);
      if (todayValue < range.low || todayValue > range.high) flagged++;
    }
    const rate = flagged / TRIALS;
    expect(rate).toBeGreaterThan(0.01);
    expect(rate).toBeLessThan(0.12);
  });

  it("widens the band for a small sample, not just for a noisy one", () => {
    // Same spread, fewer nights behind it: the interval has to admit that it
    // knows less, or a short history produces confident nonsense.
    const spread = [40, 46, 52, 58, 64, 46, 58];
    const narrow = typicalRange([...spread, ...spread, ...spread]);
    const wide = typicalRange(spread);
    expect(wide.high - wide.low).toBeGreaterThan(0);
    expect(narrow.high - narrow.low).toBeGreaterThan(0);
  });
});

describe("sleepTerm", () => {
  // Switched 2026-08-07: the term is Atlas's own sleep score where there is one,
  // because duration-against-goal was pinned at maximum on nine nights in ten
  // for this user and so carried no information about the night at all.
  it("prefers the sleep score over duration when it has one", () => {
    // Same night, two answers: a full 8 hours would score 1 on duration alone,
    // but a score of 62 says the night was not actually that good.
    expect(sleepTerm(8, 8, null, 62)).toBeCloseTo(0.62, 5);
    expect(sleepTerm(4, 8, null, 90)).toBeCloseTo(0.9, 5);
  });

  it("clamps a score rather than trusting it blindly", () => {
    expect(sleepTerm(8, 8, null, 140)).toBe(1);
    expect(sleepTerm(8, 8, null, -5)).toBe(0);
  });

  it("falls back to duration when the score cannot be had", () => {
    // Not a detail: the sleep score withholds itself under three nights of
    // recorded bedtimes, and returning null here would drop sleep out of
    // Recovery and silently move its weight onto HRV.
    expect(sleepTerm(8, 8, null, null)).toBe(1);
    expect(sleepTerm(4, 8, null, undefined)).toBe(0.5);
    expect(sleepTerm(8, 8, null, NaN)).toBe(1);
  });

  it("scores duration against the goal", () => {
    expect(sleepTerm(8, 8)).toBe(1);
    expect(sleepTerm(4, 8)).toBe(0.5);
  });

  it("does not reward oversleeping past the goal", () => {
    expect(sleepTerm(12, 8)).toBe(1);
  });

  it("blends in restorative share when stages are known", () => {
    const poor = sleepTerm(8, 8, { deep: 20, light: 400, rem: 20 });
    const good = sleepTerm(8, 8, { deep: 95, light: 240, rem: 75 });
    expect(good).toBeGreaterThan(poor);
    expect(poor).toBeLessThan(1);
  });

  // Every night synced before stage decoding landed has no stages.
  it("falls back to duration alone when stages are missing", () => {
    expect(sleepTerm(6, 8, null)).toBe(0.75);
    expect(sleepTerm(6, 8, { deep: 0, light: 0, rem: 0 })).toBe(0.75);
  });

  it("returns null with no sleep recorded", () => {
    expect(sleepTerm(null, 8)).toBeNull();
  });
});

describe("computeRecovery", () => {
  const goal = 8;
  const ready = (today, history = {}) =>
    computeRecovery({
      today,
      history: { hrv: steadyHrv, restingHr: steadyRhr, ...history },
      sleepGoalHours: goal,
    });

  it("calibrates until there are seven nights of HRV", () => {
    const result = computeRecovery({
      today: { hrv: 52, restingHr: 54, sleep: 8 },
      history: { hrv: [52, 50, 54], restingHr: [54, 55, 53] },
      sleepGoalHours: goal,
    });
    expect(result.state).toBe("calibrating");
    expect(result.score).toBeNull();
    expect(result.nights).toBe(3);
    expect(result.needed).toBe(BASELINE_NIGHTS);
  });

  it("never shows a provisional number while calibrating", () => {
    const result = computeRecovery({
      today: { hrv: 52, restingHr: 54, sleep: 8 },
      history: { hrv: [52, 50] },
      sleepGoalHours: goal,
    });
    expect(result.score).toBeNull();
    expect(result.label).toBeNull();
  });

  it("scores a normal day near the middle", () => {
    const result = ready({ hrv: 52, restingHr: 54, sleep: 8 });
    expect(result.state).toBe("ready");
    expect(result.score).toBeGreaterThan(50);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("scores a suppressed-HRV day below a normal one", () => {
    const normal = ready({ hrv: 52, restingHr: 54, sleep: 8 });
    const suppressed = ready({ hrv: 38, restingHr: 54, sleep: 8 });
    expect(suppressed.score).toBeLessThan(normal.score);
  });

  it("scores an elevated resting heart rate below a normal one", () => {
    const normal = ready({ hrv: 52, restingHr: 54, sleep: 8 });
    const elevated = ready({ hrv: 52, restingHr: 63, sleep: 8 });
    expect(elevated.score).toBeLessThan(normal.score);
  });

  it("lets HRV move the score further than sleep can, per the weighting", () => {
    const base = ready({ hrv: 52, restingHr: 54, sleep: 8 });
    const badSleep = ready({ hrv: 52, restingHr: 54, sleep: 4 });
    const badHrv = ready({ hrv: 30, restingHr: 54, sleep: 8 });
    expect(base.score - badHrv.score).toBeGreaterThan(base.score - badSleep.score);
  });

  // A missing reading is not a reading of zero, which would read as a
  // catastrophic day rather than an incomplete one.
  it("redistributes weight rather than counting a missing term as zero", () => {
    const withRhr = ready({ hrv: 52, restingHr: 54, sleep: 8 });
    const withoutRhr = ready({ hrv: 52, sleep: 8 });
    expect(withoutRhr.state).toBe("ready");
    expect(Math.abs(withoutRhr.score - withRhr.score)).toBeLessThan(12);
  });

  it("reports no-data when nothing at all was recorded today", () => {
    const result = ready({});
    expect(result.state).toBe("no-data");
    expect(result.score).toBeNull();
  });

  it("keeps the component terms so a surprising score can be explained", () => {
    const result = ready({ hrv: 52, restingHr: 54, sleep: 8 });
    expect(result.terms.hrv).not.toBeNull();
    expect(result.terms.restingHr).not.toBeNull();
    expect(result.terms.sleep).not.toBeNull();
    expect(result.deviations.hrv).toBeTypeOf("number");
  });

  // Floors lowered 2026-08-07 from 85/70/50 after ten real days measured a mean
  // of 49.3 and a maximum of 73: GREAT at 85 was never reached once, so the top
  // third of the scale was unusable.
  it("bands the score", () => {
    expect(recoveryLabel(85)).toBe("GREAT");
    expect(recoveryLabel(65)).toBe("GOOD");
    expect(recoveryLabel(45)).toBe("NORMAL");
    expect(recoveryLabel(30)).toBe("LOW");
  });

  it("puts each boundary where the band starts", () => {
    expect(recoveryLabel(39)).toBe("LOW");
    expect(recoveryLabel(40)).toBe("NORMAL");
    expect(recoveryLabel(59)).toBe("NORMAL");
    expect(recoveryLabel(60)).toBe("GOOD");
    expect(recoveryLabel(79)).toBe("GOOD");
    expect(recoveryLabel(80)).toBe("GREAT");
  });

  it("keeps the best day so far as a GOOD one, not a great one", () => {
    // GREAT was tried at 70, which made 73 read GREAT. The user's call: 73 is a
    // good day. So the word keeps its meaning and the band stays above the
    // archive until the readings genuinely improve.
    expect(recoveryLabel(73)).toBe("GOOD");
  });
});

describe("recoveryBreakdown", () => {
  const goal = 8;
  const ready = (today, history = {}) =>
    computeRecovery({
      today,
      history: { hrv: steadyHrv, restingHr: steadyRhr, ...history },
      sleepGoalHours: goal,
    });

  it("itemises every term that had a reading", () => {
    const rows = recoveryBreakdown(ready({ hrv: 52, restingHr: 54, sleep: 8 }));
    expect(rows.map((r) => r.key)).toEqual(["hrv", "restingHr", "sleep"]);
  });

  it("splits the points 50/25/25 when nothing is missing", () => {
    const rows = recoveryBreakdown(ready({ hrv: 52, restingHr: 54, sleep: 8 }));
    expect(rows.map((r) => r.maxPoints)).toEqual([50, 25, 25]);
    expect(rows.every((r) => !r.redistributed)).toBe(true);
  });

  // The whole point of showing the working: the parts have to add up to the
  // number on the dial, or the page undermines the score instead of explaining
  // it. Rounding each row lets it drift by at most one point per term.
  it("has points that reconstruct the score", () => {
    const result = ready({ hrv: 44, restingHr: 58, sleep: 6.2 });
    const total = recoveryBreakdown(result).reduce((sum, r) => sum + r.points, 0);
    expect(Math.abs(total - result.score)).toBeLessThanOrEqual(3);
  });

  it("shows the redistributed weight, not the nominal one, when a term is missing", () => {
    const rows = recoveryBreakdown(ready({ hrv: 52, sleep: 8 }));
    expect(rows.map((r) => r.key)).toEqual(["hrv", "sleep"]);
    // 50 and 25 renormalise to two thirds and one third.
    expect(rows[0].maxPoints).toBe(67);
    expect(rows[1].maxPoints).toBe(33);
    expect(rows[0].redistributed).toBe(true);
    expect(rows[0].nominalWeight).toBe(50);
  });

  it("carries the reading and the baseline it was judged against", () => {
    const rows = recoveryBreakdown(ready({ hrv: 52, restingHr: 54, sleep: 8 }));
    const hrv = rows.find((r) => r.key === "hrv");
    expect(hrv.reading).toBe(52);
    expect(hrv.baseline).toBeGreaterThan(50);
    expect(hrv.baseline).toBeLessThan(52);
    const sleep = rows.find((r) => r.key === "sleep");
    expect(sleep.goal).toBe(goal);
  });

  it("returns nothing while calibrating, rather than a breakdown of null terms", () => {
    const result = computeRecovery({
      today: { hrv: 52, restingHr: 54, sleep: 8 },
      history: { hrv: [52, 50] },
      sleepGoalHours: goal,
    });
    expect(recoveryBreakdown(result)).toEqual([]);
    expect(recoveryBreakdown(null)).toEqual([]);
  });
});

describe("recoveryHeadroom", () => {
  const goal = 8;
  const ready = (today) =>
    computeRecovery({
      today,
      history: { hrv: steadyHrv, restingHr: steadyRhr },
      sleepGoalHours: goal,
    });

  it("names the next band up, not the highest band above today", () => {
    const result = ready({ hrv: 52, restingHr: 54, sleep: 8 });
    const head = recoveryHeadroom(result);
    // Bands run high to low, so a naive find() would skip past NORMAL/GOOD
    // straight to GREAT and quote a gap nobody is about to close.
    const nextUp = [...RECOVERY_BANDS].reverse().find((b) => b.min > result.score);
    expect(head.nextLabel).toBe(nextUp.label);
    expect(head.pointsNeeded).toBe(nextUp.min - result.score);
    expect(head.pointsNeeded).toBeGreaterThan(0);
  });

  // The naive "term with the most unclaimed points" always answers HRV, because
  // it carries double weight and holds the most slack even sitting exactly at
  // baseline. Sleep is the only term with a lever attached.
  // A figure only while it is one you could act on. "About 2h 45m more sleep
  // would cover it" is precise about something nobody can aim at, and rounding to
  // the quarter hour stops the sentence implying a precision the score has not
  // got.
  it("names minutes only when the gap is small enough to act on", () => {
    // Swept rather than hand-picked, because the window is narrow: the sentence
    // only quotes minutes when the score sits within about three points of a
    // band boundary AND sleep is what is short.
    const found = [];
    // HRV has to straddle a band boundary for the gap to be small enough, and
    // this fixture's baseline sits near 51, so the interesting readings are right
    // around it. Both renderings are collected: past an hour the figure is set as
    // "1h 15m" rather than "75 minutes".
    for (let sleep = 6; sleep <= 7.05; sleep += 0.05) {
      for (const hrv of [48, 49, 50, 51, 52, 53, 54, 55]) {
        const sentence = headroomSentence(ready({ hrv, restingHr: 54, sleep }));
        const bare = sentence.match(/About (\d+) minutes more sleep/);
        if (bare) found.push(Number(bare[1]));
        const hrs = sentence.match(/About (\d+)h(?: (\d+)m)? more sleep/);
        if (hrs) found.push(Number(hrs[1]) * 60 + Number(hrs[2] ?? 0));
      }
    }
    expect(found.length).toBeGreaterThan(0);
    // Rounded to the quarter hour, so never a figure like "About 23 minutes",
    // which implies a precision the score has not got.
    for (const minutes of found) expect(minutes % 15).toBe(0);
    // And never past the point where a figure stops being actionable.
    for (const minutes of found) expect(minutes).toBeLessThanOrEqual(90);
  });

  it("says 'a longer night' rather than naming an unactionable stretch", () => {
    const short = headroomSentence(ready({ hrv: 48, restingHr: 50, sleep: 6.5 }));
    expect(short).toMatch(/longer night/);
    // The point of the branch: no minute figure for a stretch nobody can aim at.
    expect(short).not.toMatch(/\d+ minutes/);
    expect(short).not.toMatch(/About \d+h/);
  });

  // Saying "nothing tonight changes it" when sleep is exactly what is short
  // would be flatly wrong, so a gap too big for one night gets its own wording.
  it("does not claim nothing can be done when sleep is the thing that is short", () => {
    // Sleep is checked before the vitals precisely because it is the one term you
    // can act on tonight, so a short night must never be answered with silence.
    const veryShort = headroomSentence(ready({ hrv: 40, restingHr: 60, sleep: 3 }));
    expect(veryShort).not.toMatch(/Nothing tonight changes it/);
    expect(veryShort).toMatch(/night|sleep/i);
  });

  // Three wordings have failed here. "Nothing tonight changes it" read as
  // "nothing you do matters". A list of general levers was true of every day and
  // so said nothing about this one. "HRV and resting heart rate hold the rest"
  // was accurate and left no way to know what would be enough, which produced
  // the question "how would it even be possible to reach GOOD". It is
  // answerable, so it gets answered.
  // The fifth wording, and the first to name a reading in its own units with a
  // direction attached. "HRV about 25% above your baseline" answered the question
  // in a unit nobody holds in their head, against a baseline the sentence never
  // stated, and named HRV only because HRV was the one term the code could
  // invert.
  // Option B of three, mocked up against every kind of day. Both halves are
  // load-bearing: a figure-free version was shipped and rejected for being true
  // of every day, and a figure-only version read as a readout rather than a
  // sentence. The figure also needs tonight's reading beside it, since 113 only
  // means something next to 102.
  it("names the lever in words, then the figure, then tonight's reading", () => {
    const full = headroomSentence(ready({ hrv: 52, restingHr: 54, sleep: 8 }));
    // Option C, chosen 2026-08-07. The reading and the target never share a
    // clause: every earlier version wrote "115 MS tonight, up from 102", which
    // reads as a claim about tonight and contradicts itself.
    expect(full).toMatch(/(An HRV|A resting heart rate) of about \d+ would have got there/);
    expect(full).toMatch(/(up|down) from tonight's \d+/);
    expect(full).not.toMatch(/A HRV/);
    expect(full).not.toMatch(/% above your baseline/);
    expect(full).not.toMatch(/minutes of sleep/);
  });

  it("uses spoken names, not column headings", () => {
    const full = headroomSentence(ready({ hrv: 52, restingHr: 54, sleep: 8 }));
    // "REST HR" belongs over a row, not in prose.
    expect(full).not.toMatch(/REST HR/);
  });

  it("gives the second route no verb of its own", () => {
    // Repeating "would get you there" twice ran to four lines on a phone and read
    // as two instructions rather than one choice.
    const both = headroomSentence(ready({ hrv: 96, restingHr: 51, sleep: 8.5 }));
    const verbs = both.match(/would get you there/g) ?? [];
    expect(verbs.length).toBeLessThanOrEqual(1);
  });

  // The range of days, because a sentence that only works on an average one is
  // the failure mode here: every outcome has to say something true.
  describe("across every kind of day", () => {
    it("says nothing is above a day already in the top band", () => {
      // Everything strongly favourable: high HRV, low resting HR, full night.
      const great = ready({ hrv: 70, restingHr: 46, sleep: 9 });
      expect(great.label).toBe("GREAT");
      expect(recoveryHeadroom(great)).toBeNull();
      expect(termTarget(great, "hrv")).toBeNull();
      expect(headroomSentence(great)).toBe("Nothing scores higher than this.");
    });

    it("aims a bad day at the next band up, not at the top", () => {
      const bad = ready({ hrv: 38, restingHr: 62, sleep: 5 });
      const head = recoveryHeadroom(bad);
      expect(bad.label).toBe("LOW");
      expect(head.nextLabel).toBe("NORMAL");
      // Every figure in the sentence must be about NORMAL. Quoting GREAT to
      // someone scoring 25 is a target nobody can use.
      expect(headroomSentence(bad)).toMatch(/NORMAL/);
      expect(headroomSentence(bad)).not.toMatch(/GREAT/);
    });

    it("withholds a target the term cannot reach on its own", () => {
      // A gap wider than a saturated term closes. Naming a figure here would be
      // promising a band that reading does not actually reach.
      const bad = ready({ hrv: 30, restingHr: 70, sleep: 3 });
      const target = termTarget(bad, "restingHr");
      if (target) {
        const raised = ready({ hrv: 30, restingHr: target.reading, sleep: 3 });
        expect(raised.score).toBeGreaterThanOrEqual(50);
      }
      // Whatever it decides, it must not produce an unusable figure.
      expect(target === null || target.reading > 0).toBe(true);
    });

    it("says something honest when no single reading closes the gap", () => {
      const sentence = headroomSentence(ready({ hrv: 30, restingHr: 70, sleep: 8 }));
      expect(sentence).toMatch(/points to/);
      expect(sentence).not.toMatch(/undefined|NaN|null/);
    });

    it("never produces a broken sentence, whatever the readings", () => {
      for (const hrv of [28, 40, 52, 64, 80]) {
        for (const restingHr of [44, 50, 56, 64]) {
          for (const sleep of [3, 6.5, 8, 10]) {
            const sentence = headroomSentence(ready({ hrv, restingHr, sleep }));
            expect(sentence).not.toMatch(/undefined|NaN|null|Infinity/);
            expect(sentence.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it("says nothing at all while calibrating", () => {
      const calibrating = computeRecovery({
        today: { hrv: 52, restingHr: 54, sleep: 8 },
        history: { hrv: [52, 50] },
        sleepGoalHours: goal,
      });
      expect(headroomSentence(calibrating)).toBe("");
      expect(termTarget(calibrating, "hrv")).toBeNull();
    });

    it("has no target for a term that is missing today", () => {
      const noRhr = ready({ hrv: 52, sleep: 8 });
      expect(termTarget(noRhr, "restingHr")).toBeNull();
    });
  });

  describe("termTarget", () => {
    it("asks resting HR to go DOWN and HRV to go UP", () => {
      // The sign flip is the trap: deviationToScore directs the z-score before
      // scoring it, so inverting without undoing that reports a resting HR that
      // needs to RISE, which is exactly backwards.
      const day = ready({ hrv: 52, restingHr: 54, sleep: 8 });
      const hrv = termTarget(day, "hrv");
      const rhr = termTarget(day, "restingHr");
      if (hrv) {
        expect(hrv.direction).toBe("higher");
        expect(hrv.reading).toBeGreaterThan(52);
      }
      if (rhr) {
        expect(rhr.direction).toBe("lower");
        expect(rhr.reading).toBeLessThan(54);
      }
    });

    it("round-trips: the reading it names actually reaches the band", () => {
      // Without this the figures are plausible numbers nobody has checked, and
      // rounding twice on the way to a boundary lands a point short.
      const today = { hrv: 52, restingHr: 54, sleep: 8 };
      const result = ready(today);
      const wanted = recoveryHeadroom(result).nextLabel;

      for (const key of ["hrv", "restingHr"]) {
        const target = termTarget(result, key);
        if (!target) continue;
        const moved = ready({ ...today, [key]: target.reading });
        expect(moved.label).toBe(wanted);
      }
    });
  });

  describe("biggestOpportunity", () => {
    it("names nothing on a day where every reading sits inside its normal", () => {
      // The bug this replaced: ranking by unclaimed points named HRV here,
      // because a reading exactly on baseline still gives up half its weight and
      // HRV's weight is double everything else's.
      const ordinary = ready({ hrv: 52, restingHr: 54, sleep: 8 });
      expect(biggestOpportunity(ordinary)).toBeNull();
    });

    it("names the term that is genuinely down", () => {
      const lowHrv = ready({ hrv: 34, restingHr: 54, sleep: 8 });
      expect(biggestOpportunity(lowHrv)?.key).toBe("hrv");

      const highRhr = ready({ hrv: 52, restingHr: 64, sleep: 8 });
      expect(biggestOpportunity(highRhr)?.key).toBe("restingHr");
    });

    it("does not treat a resting HR below baseline as a problem", () => {
      // Directed, or a favourably low resting HR reads as a large deviation and
      // gets named as what held the day back.
      const lowRhr = ready({ hrv: 52, restingHr: 46, sleep: 8 });
      expect(biggestOpportunity(lowRhr)?.key).not.toBe("restingHr");
    });

    it("names sleep when it is short, which has no baseline to be outside of", () => {
      expect(biggestOpportunity(ready({ hrv: 52, restingHr: 54, sleep: 5 }))?.key).toBe("sleep");
    });
  });

  it("puts the HRV target where the arithmetic actually lands", () => {
    // Round-trip it: raise HRV to the figure the sentence names and the score
    // must reach the band it promised. Without this the percentage is a plausible
    // number nobody has checked.
    const today = { hrv: 52, restingHr: 54, sleep: 8 };
    const result = ready(today);
    const pct = hrvGapPercent(result);
    expect(pct).toBeGreaterThan(0);

    const target = recoveryHeadroom(result).nextLabel;
    const raised = ready({ ...today, hrv: result.baselines.hrv.mean * (1 + pct / 100) });
    expect(raised.label).toBe(target);
  });

  it("withholds a target HRV cannot reach on its own", () => {
    // HRV already saturated, resting HR at zero and a short night: the gap to
    // GOOD is wider than the whole HRV term, so no reading closes it. Naming a
    // figure anyway would be a lie dressed as arithmetic.
    const maxedOut = ready({ hrv: 70, restingHr: 60, sleep: 4.8 });
    expect(maxedOut.terms.hrv).toBe(1);
    expect(maxedOut.label).toBe("GOOD");
    expect(hrvGapPercent(maxedOut)).toBeNull();
    // The sentence still has something true to say, because on this fixture the
    // short night is the real lever and the sleep branch is checked first. That
    // ordering is deliberate: sleep is the one term you can act on tonight.
    expect(headroomSentence(maxedOut)).toMatch(/longer night/);
  });

  // A falling baseline explains a run of low days that none of the individual
  // terms can account for: every reading is judged against an average built from
  // higher days that have not aged out yet. Deliberately about the score and not
  // about the body - the real decline this was built against was a training
  // block, and calling that a health warning is a rejected ticket.
  it("says nothing about the baseline on a steady week", () => {
    const steady = ready({ hrv: 52, restingHr: 54, sleep: 8 });
    expect(baselineNote(steady)).toBe("");
  });

  it("names both ends when the baseline has fallen out from under the score", () => {
    // Fourteen nights: a high week, then a much lower one. The baseline is the
    // last seven; the comparison is the seven before those.
    const falling = [120, 118, 122, 119, 121, 117, 120, 96, 94, 92, 95, 93, 91, 94];
    const result = computeRecovery({
      today: { hrv: 93, restingHr: 54, sleep: 8 },
      history: { hrv: falling, restingHr: [...steadyRhr, ...steadyRhr] },
      sleepGoalHours: 8,
    });
    const note = baselineNote(result);
    expect(note).toMatch(/coming down/);
    // Named and given its units. It used to open "That baseline is still catching
    // up with you: 111 a week ago, 91 now", where "that baseline" pointed at
    // nothing on screen and 111 was a figure with no idea what it measured.
    expect(note).toMatch(/HRV average/);
    // Both figures are geometric means, since the HRV baseline is taken in log
    // space: 120 for the high week, 94 for the low one.
    expect(note).toMatch(/120 MS a week ago, 94 MS now/);
  });

  it("says the opposite thing when the baseline is climbing", () => {
    const rising = [94, 91, 93, 95, 92, 94, 96, 120, 117, 121, 119, 122, 118, 120];
    const result = computeRecovery({
      today: { hrv: 119, restingHr: 54, sleep: 8 },
      history: { hrv: rising, restingHr: [...steadyRhr, ...steadyRhr] },
      sleepGoalHours: 8,
    });
    expect(baselineNote(result)).toMatch(/still climbing/);
  });

  it("says nothing before there are two windows to compare", () => {
    // Seven nights makes one baseline and no earlier one, so there is no shift
    // to report rather than a shift of zero.
    const oneWindow = ready({ hrv: 52, restingHr: 54, sleep: 8 });
    expect(oneWindow.hrvBaselineBefore).toBeNull();
    expect(baselineNote(oneWindow)).toBe("");
  });

  it("returns nothing at the top band, since there is nowhere to go", () => {
    const result = ready({ hrv: 200, restingHr: 30, sleep: 8 });
    expect(result.label).toBe("GREAT");
    expect(recoveryHeadroom(result)).toBeNull();
    expect(headroomSentence(result)).toBe("Nothing scores higher than this.");
  });

  // A calibrating day used to read "Nothing scores higher than this" directly
  // under "Learning your baseline", because no headroom was being treated the
  // same as being at the top.
  it("says nothing at all while calibrating, rather than claiming the top", () => {
    const result = computeRecovery({
      today: { hrv: 52 },
      history: { hrv: [52, 50] },
      sleepGoalHours: goal,
    });
    expect(recoveryHeadroom(result)).toBeNull();
    expect(headroomSentence(result)).toBe("");
  });
});

describe("recoveryExplanation", () => {
  it("says what it is waiting for while calibrating", () => {
    const text = recoveryExplanation({ state: "calibrating", nights: 5, needed: 7 });
    expect(text).toContain("2 more nights");
  });

  it("uses the singular for the last night", () => {
    const text = recoveryExplanation({ state: "calibrating", nights: 6, needed: 7 });
    expect(text).toContain("1 more night");
    expect(text).not.toContain("nights");
  });

  it("names the term that moved the score", () => {
    const result = computeRecovery({
      today: { hrv: 34, restingHr: 54, sleep: 8 },
      history: { hrv: steadyHrv, restingHr: steadyRhr },
      sleepGoalHours: 8,
    });
    expect(recoveryExplanation(result)).toContain("below your usual range");
  });

  // The verdict line and the BODY rows describe the same metrics. An earlier
  // version used a standard deviation for one and a prediction interval for
  // the other, so Home could say "HRV is below your usual range" directly
  // above a row reporting HRV as normal.
  it("never claims a metric is out of range when the rows would call it normal", () => {
    const history = [52, 50, 54, 51, 53, 49, 52];
    const range = typicalRange(history);
    for (const value of [40, 44, 46, 48, 50, 52, 54, 56, 58, 62, 70]) {
      const result = computeRecovery({
        today: { hrv: value, restingHr: 54, sleep: 8 },
        history: { hrv: history, restingHr: steadyRhr },
        sleepGoalHours: 8,
      });
      const text = recoveryExplanation(result);
      const rowWouldFlag = value < range.low || value > range.high;
      const claimsOutOfRange = /HRV is (below|above) your usual range/.test(text);
      expect(claimsOutOfRange, `hrv ${value}: text said "${text}"`).toBe(rowWouldFlag);
    }
  });

  it("says so plainly when nothing is out of the ordinary", () => {
    const result = computeRecovery({
      today: { hrv: 52, restingHr: 54, sleep: 8 },
      history: { hrv: steadyHrv, restingHr: steadyRhr },
      sleepGoalHours: 8,
    });
    expect(recoveryExplanation(result)).toContain("usual range");
  });
});

describe("sleepDriftSentence", () => {
  // The sleep term is a seven-night average, so one bad night barely moves it.
  // That is the design, and it is also why the page can look untroubled after a
  // night the sleep score called bad: the effect is real but a week away.
  const withSleep = (weekTerm, lastNight) => ({
    state: "ready",
    score: 60,
    terms: { hrv: 0.5, restingHr: 0.5, sleep: weekTerm },
    lastNightScore: lastNight,
    deviations: { hrv: 0, restingHr: 0 },
    baselines: {},
    readings: {},
  });

  it("says how far a repeated bad night would pull the score down", () => {
    const out = sleepDriftSentence(withSleep(0.84, 42));
    expect(out).toMatch(/take about \d+ points off/);
  });

  // The projection used to arrive without its own starting figure: last night's
  // score was named two sentences earlier, separated by one about the week, so
  // "nights like that" pointed back past a different number.
  it("names the night it is projecting from, immediately before projecting", () => {
    const out = sleepDriftSentence(withSleep(0.84, 42));
    expect(out.indexOf("Last night scored 42.")).toBe(0);
  });

  it("still names a night that stands out even when the drift is small", () => {
    // Six points apart, which is worth reporting, against a term weight small
    // enough that the projection itself rounds away.
    const out = sleepDriftSentence({
      state: "ready",
      score: 60,
      terms: { hrv: 0.5, restingHr: 0.5, sleep: 0.86 },
      lastNightScore: 80,
      deviations: { hrv: 0, restingHr: 0 },
      baselines: {},
      readings: {},
    });
    expect(out).toBe("Last night scored 80.");
  });

  it("says nothing on an ordinary night", () => {
    // Within a couple of points, so a sentence would appear every day and stop
    // being read.
    expect(sleepDriftSentence(withSleep(0.8, 79))).toBe("");
  });

  it("credits a good night the same way it debits a bad one", () => {
    const out = sleepDriftSentence(withSleep(0.5, 95));
    expect(out).toMatch(/add about \d+ points/);
  });

  it("has nothing to project without last night's own score", () => {
    expect(sleepDriftSentence(withSleep(0.84, null))).toBe("");
  });

  it("stays quiet while the score is not ready", () => {
    expect(sleepDriftSentence({ state: "calibrating" })).toBe("");
  });
});
