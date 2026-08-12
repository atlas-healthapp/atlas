import { describe, it, expect } from "vitest";
import {
  computeSleepScore,
  sleepBreakdown,
  awakeningCount,
  costliestTermSentence,
  durationTerm,
  habitualHours,
  SLEEP_WEIGHTS,
} from "@/utils/sleepScore";
import { sleepRegularityIndex } from "@/utils/sleepRegularity";

const at = (iso) => new Date(iso).getTime();

/** A solid night: 8h20m asleep, 15% deep, 22% REM, 18 minutes awake. */
const goodStages = () => ({
  deep: 75,
  light: 315,
  rem: 110,
  wake: 18,
  bedTime: at("2026-07-27T23:00:00"),
  wakeTime: at("2026-07-28T07:38:00"),
  timeline: [
    { stage: "light", startMinute: 0, minutes: 40 },
    { stage: "deep", startMinute: 40, minutes: 75 },
    { stage: "light", startMinute: 115, minutes: 130 },
    { stage: "awake", startMinute: 245, minutes: 18 },
    { stage: "rem", startMinute: 263, minutes: 110 },
    { stage: "light", startMinute: 373, minutes: 145 },
  ],
});

/**
 * The same night, genuinely unbroken: no awake run long enough to count and only
 * a few minutes awake in total.
 *
 * It has been quietened twice. 18 minutes awake stopped being "nothing worth
 * mentioning" when the thresholds first moved onto what this device reports, and
 * a single six-minute waking stopped counting as quiet when they tightened again
 * on 2026-08-07. This is now the only shape that earns full continuity, which is
 * the point: full marks should be rare.
 */
const quietStages = () => ({
  ...goodStages(),
  wake: 3,
  timeline: [
    { stage: "light", startMinute: 0, minutes: 245 },
    { stage: "rem", startMinute: 245, minutes: 110 },
    { stage: "light", startMinute: 355, minutes: 145 },
  ],
});

/** Seven regular nights, so regularity is present and high. */
const regularNights = () =>
  Array.from({ length: 7 }, (_, i) => ({
    date: `2026-07-2${i}`,
    bedMs: at(`2026-07-${20 + i}T23:00:00`),
    wakeMs: at(`2026-07-${21 + i}T07:20:00`),
  }));

describe("the weights are the agreed ones", () => {
  // Reweighted 2026-08-07. Regularity fell from 25 to 15 because it is a
  // property of the week rather than of the night, and with the other terms
  // pinned it was supplying most of the variation in a number that claims to
  // describe one night.
  it("is duration 50, regularity 15, continuity 25, composition 10", () => {
    expect(SLEEP_WEIGHTS).toEqual({
      duration: 0.5,
      regularity: 0.15,
      continuity: 0.25,
      composition: 0.1,
    });
  });
});

describe("duration", () => {
  const term = (hours) =>
    computeSleepScore({ hours, stages: goodStages(), nights: regularNights() }).terms.duration;

  it("has an edge on both sides of the guideline band", () => {
    expect(term(8.5)).toBe(1);
    // Both edges, since the band has two. 7 and 9 are the guideline bounds.
    expect(term(6.9)).toBeLessThan(1);
    expect(term(9.5)).toBeLessThan(1);
  });

  it("scores a six hour night as a short one", () => {
    expect(term(6)).toBeGreaterThan(0.15);
    expect(term(6)).toBeLessThan(0.45);
  });

  it("penalises a long night, because here it usually means waking and dozing", () => {
    // This reverses a deliberate earlier decision, and the reasoning is in
    // sleepScore.js beside DURATION_FULL. Short version: the wearable-overestimate
    // and confounded-epidemiology arguments still hold in general, but the user
    // reads his own 9h+ nights as a real wake followed by dozing, and direct
    // evidence about this device on this wrist outranks a population statistic.
    expect(term(10)).toBeLessThan(0.8);
    expect(term(11)).toBeLessThan(0.6);
    // Never to zero, though: a long night is not a missed one.
    expect(term(12)).toBeGreaterThan(0.3);
  });

  it("treats a very short night as worse than a long one", () => {
    // The penalty above the band must stay milder than the one below it, or
    // eleven hours reads as worse than four.
    expect(term(4)).toBeLessThan(term(11.5));
  });

  it("scores a four hour night worse than a six hour one", () => {
    expect(term(4)).toBeLessThan(term(6));
  });

  it("gives full marks across the whole guideline band, 7h to 9h", () => {
    // The clinical figure, not a personal goal. An earlier version gave full
    // marks only from 8h, taken from this user's own GOALS.sleep, which docked
    // anyone habitually sleeping 7.5 hours and meeting the guidelines.
    expect(term(7)).toBe(1);
    expect(term(8)).toBe(1);
    expect(term(9)).toBe(1);
    expect(term(6.9)).toBeLessThan(1);
    expect(term(9.1)).toBeLessThan(1);
  });

  describe("against your own habitual night", () => {
    const t = (hours, habitual) => durationTerm(hours, habitual);

    it("does not punish a habitual seven-hour sleeper for sleeping seven hours", () => {
      // The release case. Their median clamps to 7, which is inside the band, so
      // both halves agree and the night scores full.
      expect(habitualHours([7, 7.1, 6.9, 7, 7.2, 6.8, 7]).hours).toBeCloseTo(7, 5);
      expect(t(7, 7)).toBe(1);
      expect(t(7.2, 7)).toBe(1);
    });

    it("marks a short night against a long habit, which a fixed goal cannot see", () => {
      // 6h 36m is only just under the guideline in absolute terms, but it is 2.4
      // hours under this user's own normal, and that is why it reads badly to him.
      expect(t(6.6, 9)).toBeLessThan(0.35);
      // The same night for someone who habitually sleeps seven hours is ordinary.
      expect(t(6.6, 7)).toBeGreaterThan(0.6);
    });

    it("clamps a habit above nine hours rather than treating it as the target", () => {
      // The user's rule: if the median is itself too long, the goal is to come
      // down, so it stops at nine. A 9.2h median must not license a 10h night.
      expect(habitualHours([9.4, 9.3, 10.1, 9.7, 9.2, 10, 9.5]).hours).toBe(9);
      expect(habitualHours([5.5, 5.2, 5.8, 5.1, 5.4, 5.6, 5.3]).hours).toBe(7);
    });

    it("docks a long night whatever the habit", () => {
      // Adequacy always sees it, and the deficit half can never excuse it because
      // the target is clamped at nine.
      expect(t(10, 9)).toBeLessThan(0.8);
      expect(t(11, 9)).toBeLessThan(0.6);
      // Identical for a long sleeper, because their median clamped to 9 too.
      expect(t(10, habitualHours([9.8, 10, 10.2, 9.9, 10.1, 9.7, 10]))).toBeLessThan(0.8);
    });

    // The user's own case: "if my median is solidly 8hrs but I sleep 7, it's
    // within the clinical band but still below my median a bit, so it should feel
    // worse than just 8hr. Same with 9hr."
    it("marks a night either side of your usual, even inside the clinical band", () => {
      const solidEight = habitualHours(Array.from({ length: 14 }, () => 8));
      expect(solidEight.hours).toBe(8);
      expect(solidEight.confidence).toBe(1);

      const eight = t(8, solidEight);
      const seven = t(7, solidEight);
      const nine = t(9, solidEight);

      // All three clear the 7-9h guideline, so adequacy alone cannot tell them
      // apart. The personal half is what makes eight the best of the three.
      expect(eight).toBe(1);
      expect(seven).toBeLessThan(eight);
      expect(nine).toBeLessThan(eight);
      // And short is worse than long by the same distance, deliberately.
      expect(seven).toBeLessThan(nine);
    });

    it("fades the personal half in as the nights accumulate", () => {
      // Rather than switching on at the seventh night, which would make the score
      // lurch on the day the median first became available.
      const week = habitualHours(Array.from({ length: 7 }, () => 8));
      const fortnight = habitualHours(Array.from({ length: 14 }, () => 8));
      expect(week.confidence).toBeCloseTo(0.5, 5);
      expect(fortnight.confidence).toBe(1);
      // The same 7h night is marked less harshly on a week of evidence.
      expect(t(7, week)).toBeGreaterThan(t(7, fortnight));
      expect(t(7, week)).toBeLessThan(1);
    });

    it("takes the worse of the two rather than averaging them", () => {
      // Averaging let a short night average its way back up to a respectable
      // figure, which is the thing that was objected to.
      const adequacyOnly = t(6.6, null);
      const withHabit = t(6.6, 9);
      expect(withHabit).toBeLessThan(adequacyOnly);
      expect(withHabit).toBeLessThan((adequacyOnly + 0.16) / 2);
    });

    it("says nothing personal until there are enough nights", () => {
      expect(habitualHours([8, 8.2, 7.9])).toBeNull();
      expect(habitualHours([])).toBeNull();
      // And the term then falls back to the guideline band alone, which never
      // punishes anyone for a night that is normal for them.
      expect(t(7, null)).toBe(1);
    });
  });

  it("keeps a short night out of the top band on its own", () => {
    // Everything except length is perfect, which is exactly the 31 Jul case.
    const result = computeSleepScore({
      hours: 6.617,
      stages: quietStages(),
      nights: regularNights(),
    });
    expect(result.label).not.toBe("GREAT");
  });
});

describe("continuity", () => {
  const term = (stages) =>
    computeSleepScore({ hours: 8.3, stages, nights: regularNights() }).terms.continuity;

  it("rewards a night with little time awake and few awakenings", () => {
    expect(term(quietStages())).toBe(1);
  });

  it("discriminates inside the range the band actually reports", () => {
    // The whole reason the thresholds moved. Against PSG-derived ones every
    // real night scored a flat 1.000, because this class of device
    // underestimates WASO by 12-48 minutes: 18 minutes awake is not a quiet
    // night on a device that reads low, and the term has to be able to say so.
    expect(term(goodStages())).toBeLessThan(1);
    expect(term(goodStages())).toBeGreaterThan(0.5);
  });

  it("marks down a fragmented night", () => {
    const broken = {
      ...goodStages(),
      wake: 55,
      timeline: [
        { stage: "light", startMinute: 0, minutes: 60 },
        { stage: "awake", startMinute: 60, minutes: 12 },
        { stage: "deep", startMinute: 72, minutes: 70 },
        { stage: "awake", startMinute: 142, minutes: 15 },
        { stage: "light", startMinute: 157, minutes: 90 },
        { stage: "awake", startMinute: 247, minutes: 13 },
        { stage: "rem", startMinute: 260, minutes: 100 },
        { stage: "awake", startMinute: 360, minutes: 15 },
        { stage: "light", startMinute: 375, minutes: 145 },
      ],
    };
    expect(term(broken)).toBeLessThan(term(goodStages()) - 0.25);
  });

  it("scores five awakenings below one", () => {
    const once = { ...goodStages(), wake: 18 };
    const fiveTimes = {
      ...goodStages(),
      timeline: [
        { stage: "light", startMinute: 0, minutes: 50 },
        // Eight minutes each: past the five minute mark that separates an
        // awakening from a turn over.
        ...Array.from({ length: 5 }, (_, i) => [
          { stage: "awake", startMinute: 50 + i * 80, minutes: 8 },
          { stage: "light", startMinute: 58 + i * 80, minutes: 72 },
        ]).flat(),
      ],
    };
    expect(term(fiveTimes)).toBeLessThan(term(once));
  });
});

describe("composition", () => {
  const term = (stages) =>
    computeSleepScore({ hours: 8.3, stages, nights: regularNights() }).terms.composition;

  it("gives full marks inside the reference bands", () => {
    expect(term(goodStages())).toBe(1);
  });

  it("marks down a night with almost no deep sleep", () => {
    // Deep at 2% collapses its half of the term while REM keeps its own, so the
    // term lands at 0.6 rather than at zero. Composition is two readings and
    // only one of them went wrong.
    const starved = term({ ...goodStages(), deep: 10, light: 380 });
    expect(starved).toBeLessThanOrEqual(0.6);
    expect(starved).toBeLessThan(term(goodStages()));
  });
});

describe("regularity", () => {
  it("is scored against the published distribution, not as a share of 100", () => {
    // Windred et al. 2024: median SRI 81, IQR 73.8-86.3, and the excess risk
    // sits below 71.6. An SRI in the middle of that is an ordinary week, not the
    // 80% of full marks sri/100 used to award it, and treating it as 80% was
    // what left every real night inside three points of every other.
    const shifted = [
      ...regularNights().slice(0, 4),
      // Two nights pushed four hours later, which is what a trip does.
      { date: "2026-07-24", bedMs: at("2026-07-24T03:00:00"), wakeMs: at("2026-07-24T11:20:00") },
      { date: "2026-07-25", bedMs: at("2026-07-25T03:00:00"), wakeMs: at("2026-07-25T11:20:00") },
      { date: "2026-07-26", bedMs: at("2026-07-26T23:00:00"), wakeMs: at("2026-07-27T07:20:00") },
    ];
    const sri = sleepRegularityIndex(shifted);
    const term = computeSleepScore({ hours: 8.3, stages: goodStages(), nights: shifted }).terms
      .regularity;

    expect(sri).toBeGreaterThan(0);
    expect(sri).toBeLessThan(86.3);
    // Stricter than the old linear mapping everywhere below the top of the IQR.
    expect(term).toBeLessThan(sri / 100);
  });

  it("gives full marks anywhere in the plateau, not only at a perfect 100", () => {
    const term = computeSleepScore({
      hours: 8.3,
      stages: goodStages(),
      nights: regularNights(),
    }).terms.regularity;
    expect(term).toBe(1);
  });

  it("is withheld under three nights and its weight redistributed", () => {
    const result = computeSleepScore({
      hours: 8.3,
      stages: goodStages(),
      nights: regularNights().slice(0, 2),
    });
    expect(result.terms.regularity).toBeNull();

    const rows = sleepBreakdown(result);
    expect(rows.map((r) => r.key)).not.toContain("regularity");
    // The remaining terms carry the withheld weight between them, so the page
    // can never itemise a score out of the 75 points the surviving terms
    // nominally hold. Within a point of a hundred, since each row rounds
    // independently, exactly as recoveryBreakdown does.
    const possible = rows.reduce((sum, r) => sum + r.maxPoints, 0);
    expect(Math.abs(possible - 100)).toBeLessThanOrEqual(1);
    expect(rows.every((r) => r.redistributed)).toBe(true);
  });

  it("is never scored as zero when it is missing", () => {
    const withheld = computeSleepScore({
      hours: 8.3,
      stages: goodStages(),
      nights: regularNights().slice(0, 2),
    });
    const present = computeSleepScore({
      hours: 8.3,
      stages: goodStages(),
      nights: regularNights(),
    });
    // A withheld term must not drag the score below one where regularity is
    // present and good.
    expect(withheld.score).toBeGreaterThan(present.score - 12);
  });
});

describe("the score as a whole", () => {
  it("says it has nothing rather than scoring a night it does not have", () => {
    const result = computeSleepScore({ hours: null, stages: null, nights: [] });
    expect(result.state).toBe("no-data");
    expect(result.score).toBeNull();
  });

  it("itemises into points that add up to the score", () => {
    const result = computeSleepScore({
      hours: 8.3,
      stages: goodStages(),
      nights: regularNights(),
    });
    const rows = sleepBreakdown(result);
    const summed = rows.reduce((sum, r) => sum + r.points, 0);
    // Rounding each row independently can differ from the score by a point.
    expect(Math.abs(summed - result.score)).toBeLessThanOrEqual(1);
  });

  it("describes the term that cost the most, not the lowest scoring one", () => {
    // Composition is at zero but carries 10 points; duration is far below the
    // band and carries 50, so duration cost much more.
    const result = computeSleepScore({
      hours: 5,
      stages: { ...goodStages(), deep: 0, rem: 0, light: 300 },
      nights: regularNights(),
    });
    // It describes the night rather than naming the term. The term rows sit
    // directly under this sentence with their points on them, so "most of what
    // was lost was duration" said twice what the card already showed once.
    expect(costliestTermSentence(result)).toMatch(/short night/i);
    // fmtHoursMins drops a zero minutes part, so a round five hours is "5h".
    expect(costliestTermSentence(result)).toContain("5h");
  });

  it("never quotes a threshold, since the term is a gradient", () => {
    // The bug this replaced said "ran short of seven and a half hours" under a
    // nine hour night. Even with the direction fixed, naming a boundary
    // misdescribes a term where 9h 12m loses two points and 10h loses fourteen.
    const long = computeSleepScore({
      hours: 10.5,
      stages: goodStages(),
      nights: regularNights(),
    });
    expect(costliestTermSentence(long)).toContain("10h 30m");
    expect(costliestTermSentence(long)).not.toMatch(/past nine|9 hours|nine hours/i);
  });

  it("says so plainly when nothing meaningful was lost", () => {
    const result = computeSleepScore({
      hours: 8.3,
      stages: quietStages(),
      nights: regularNights(),
    });
    expect(costliestTermSentence(result)).toBe("A good night on every measure.");
  });
});

describe("what a term's row says", () => {
  const rows = () =>
    sleepBreakdown(
      computeSleepScore({ hours: 8.3, stages: goodStages(), nights: regularNights() })
    );
  const row = (key) => rows().find((r) => r.key === key);

  it("gives composition a real reading instead of restating its own label", () => {
    // It read "DEEP AND REM SHARE", which is the label beside it said twice and
    // tells you nothing about the night.
    expect(row("composition").reading).toMatch(/\d+% DEEP · \d+% REM/);
    expect(row("composition").reading).not.toMatch(/SHARE/);
  });

  it("separates the reading from the reference it was judged against", () => {
    expect(row("duration").reading).toBe("8h 18m");
    expect(row("duration").reference).toBe("7H TO 9H");
  });

  // Three cases, not two, since the term gained a top end on 2026-08-07. The
  // trap: "AT OR PAST 8H" is true of an eleven-hour night and would name the
  // band it had just fallen out of.
  it("names which side of the band a night fell on", () => {
    const ref = (hours) =>
      sleepBreakdown(computeSleepScore({ hours, stages: goodStages(), nights: regularNights() })).find(
        (r) => r.key === "duration"
      ).reference;

    expect(ref(5.5)).toContain("SHORT OF");
    expect(ref(8.5)).toBe("7H TO 9H");
    expect(ref(10.5)).toContain("OVER");
    expect(ref(10.5)).not.toContain("SHORT");
  });

  it("counts one awakening as ONCE rather than as 1 TIMES", () => {
    expect(row("continuity").reference).toContain("UP ONCE");
  });

  it("says what it counted, since the hypnogram draws the blips it does not", () => {
    // A night with three awake runs all under five minutes reported "UP 0
    // TIMES" directly above a chart showing three of them.
    const blips = sleepBreakdown(
      computeSleepScore({
        hours: 8.3,
        stages: {
          ...goodStages(),
          wake: 6,
          timeline: [
            { stage: "light", startMinute: 0, minutes: 100 },
            { stage: "awake", startMinute: 100, minutes: 2 },
            { stage: "deep", startMinute: 102, minutes: 100 },
            { stage: "awake", startMinute: 202, minutes: 2 },
            { stage: "rem", startMinute: 204, minutes: 110 },
            { stage: "awake", startMinute: 314, minutes: 2 },
            { stage: "light", startMinute: 316, minutes: 190 },
          ],
        },
        nights: regularNights(),
      })
    ).find((r) => r.key === "continuity");

    // Three minutes since 2026-08-07. The threshold is in the copy on purpose:
    // the hypnogram above draws every blip, so a row saying "no wakings" without
    // qualifying it contradicts the chart it sits under.
    expect(blips.reference).toBe("NO WAKINGS OVER 3 MIN");
    expect(blips.reference).not.toContain("UP 0");
  });

  it("gives the SRI something to be read against", () => {
    // A bare "SRI 76" is unreadable without knowing what an ordinary one is.
    expect(row("regularity").reading).toMatch(/^SRI \d+$/);
    expect(row("regularity").reference).toContain("TYPICAL IS 81");
  });

  it("no longer claims an efficiency the band cannot measure", () => {
    expect(row("continuity").reference).not.toMatch(/EFFICIENT/);
    expect(row("continuity").reading).not.toMatch(/EFFICIENT/);
  });
});

describe("awakeningCount", () => {
  it("counts the awake runs inside the night", () => {
    expect(awakeningCount(goodStages().timeline)).toBe(1);
  });

  it("does not count an awake run at the very end as an awakening", () => {
    // Waking up is not waking during the night, and counting it would charge
    // every night one awakening it did not have.
    const timeline = [
      { stage: "light", startMinute: 0, minutes: 200 },
      { stage: "rem", startMinute: 200, minutes: 100 },
      { stage: "awake", startMinute: 300, minutes: 9 },
    ];
    expect(awakeningCount(timeline)).toBe(0);
  });

  it("is null with no timeline, rather than zero", () => {
    expect(awakeningCount(null)).toBeNull();
  });
});
