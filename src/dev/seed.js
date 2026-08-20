// Dev-only sample data so the dashboard shows real numbers instead of dashes
// on a fresh localStorage. Only runs under `npm run dev` and only if nothing
// is stored yet - never touches a real device. Mirrors v10's dev/seed.js.
import { load, persist } from "@/utils/storage";
import { today, uid } from "@/utils/date";

/**
 * Async, and awaited by main.js before the app mounts.
 *
 * The localStorage half was always synchronous, but the IndexedDB half -
 * workouts, rollups, heart rate, stress - was fire-and-forget, so the app
 * mounted before any of it landed. Components that read a sample store once on
 * mount showed an empty state on first paint and only filled in if you happened
 * to leave the tab and come back. Home's stress row was the case that made it
 * obvious, because Home is the tab you never leave.
 */
/**
 * Bedtime and waketime for a seeded night, as the epoch ms the real decoder
 * stores. `daysAgo` counts back from today's wake date, so night 0 is the one
 * that ended this morning.
 */
function nightClock(daysAgo, bedHour, bedMinute, spanMinutes) {
  const bed = new Date();
  bed.setDate(bed.getDate() - daysAgo - 1);
  bed.setHours(bedHour, bedMinute, 0, 0);
  return { bedTime: bed.getTime(), wakeTime: bed.getTime() + spanMinutes * 60_000 };
}

/**
 * A fortnight of nights behind today's, so duration history, the regularity
 * chart and the SRI all have something real to draw. Hand-written rather than
 * random: the point of the seed is a shape worth looking at, and noise makes a
 * chart that cannot be judged. Two late nights sit in the middle on purpose, so
 * the usual-window band has something to be outside of.
 *
 * Each entry carries totals but no timeline. The hypnogram only ever draws the
 * night being viewed, and thirteen more timelines would be a thousand lines of
 * seed for a chart nobody opens.
 */
function priorNights() {
  // daysAgo, bed hour, bed minute, minutes in bed, deep, rem
  const shape = [
    [13, 22, 50, 505, 74, 108],
    [12, 23, 5, 470, 61, 96],
    [11, 22, 40, 520, 80, 118],
    [10, 23, 20, 455, 55, 92],
    [9, 1, 40, 350, 38, 61],
    [8, 23, 55, 430, 52, 88],
    [7, 22, 45, 515, 78, 115],
    [6, 23, 10, 480, 66, 101],
    [5, 0, 50, 395, 44, 70],
    [4, 22, 35, 530, 84, 121],
    [3, 23, 0, 490, 70, 104],
    [2, 23, 25, 460, 58, 95],
    [1, 22, 55, 500, 76, 110],
  ];

  return shape.map(([daysAgo, bedHour, bedMinute, span, deep, rem]) => {
    const wake = Math.round(span * 0.05);
    const asleep = span - wake;
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return {
      date: date.toLocaleDateString("sv"),
      sleep: asleep / 60,
      protein: null,
      water: null,
      creatine: null,
      weight: null,
      fibre: null,
      sleepStages: {
        deep,
        rem,
        light: asleep - deep - rem,
        wake,
        score: Math.round(60 + asleep / 20),
        // The band's own average across the sleep window. Varies with the
        // night's length so the chart has a shape rather than a flat row.
        avgHr: 49 + ((daysAgo * 3) % 7),
        ...nightClock(daysAgo, bedHour, bedMinute, span),
      },
    };
  });
}

export async function seedIfEmpty() {
  if (load("atlas_food_library", []).length) return; // already has data - don't clobber

  // **A profile, or the dev server never reaches Home at all.** `App.vue` shows
  // FirstRun while `onboarded` is false, and nothing here was writing one, so a
  // fresh browser sat on the first-run form with a full set of seeded data
  // behind it. That also broke `scripts/screenshot.mjs` outright: Playwright
  // starts from empty storage every run, so every capture was of first run or
  // timed out looking for a control that was never on screen.
  //
  // The genuine new-user path is `?fresh`, which skips this function entirely.
  persist("atlas_profile", {
    name: "Sam Rivers",
    onboarded: true,
    dob: "1991-04-12",
    sex: "male",
    heightCm: 178,
  });

  const oats = {
    id: uid(),
    name: "Overnight Oats",
    kind: "meal",
    protein: 38,
    kcal: 520,
    fibre: 9,
    carbs: null,
    fat: null,
  };
  const burrito = {
    id: uid(),
    name: "Chicken Burrito Bowl",
    kind: "meal",
    protein: 46,
    kcal: 710,
    fibre: 12,
    carbs: null,
    fat: null,
  };
  const salmon = {
    id: uid(),
    name: "Salmon + Rice",
    kind: "meal",
    protein: 44,
    kcal: 640,
    fibre: 3,
    carbs: null,
    fat: null,
  };
  const yoghurt = {
    id: uid(),
    name: "Protein Yoghurt",
    kind: "snack",
    protein: 18,
    kcal: 160,
    fibre: 0,
    carbs: null,
    fat: null,
  };
  const bar = {
    id: uid(),
    name: "Protein Bar",
    kind: "snack",
    protein: 20,
    kcal: 210,
    fibre: 4,
    carbs: null,
    fat: null,
  };
  const kebab = {
    id: uid(),
    name: "Kebab Shop Large",
    kind: "takeaway",
    protein: 55,
    kcal: 1150,
    fibre: 7,
    carbs: null,
    fat: null,
  };
  persist("atlas_food_library", [oats, burrito, salmon, yoghurt, bar, kebab]);


  // Today's plan: first two meals already confirmed, snack logged, dinner pending
  persist("atlas_food_dayplans", [
    {
      date: today(),
      slots: [
        { time: "07:30", mealId: oats.id, confirmed: true },
        { time: "12:30", mealId: burrito.id, confirmed: true },
        { time: "19:00", mealId: salmon.id, confirmed: false },
      ],
      snacks: [{ mealId: yoghurt.id, at: new Date().toISOString() }],
    },
  ]);

  persist("atlas_checkins", [
    ...priorNights(),
    {
      date: today(),
      sleep: 7.5,
      protein: 0,
      water: 1.9,
      creatine: 5,
      weight: 74.2,
      // A real night off the band, halved in length to fit 7h30. Without
      // stages here the Home SLEEP row draws nothing at all, so the one mark
      // that cannot be checked without a device was also the one nobody could
      // see. The timeline is what SleepShape draws; the totals are the
      // fallback for a night that has no timeline, and both paths need
      // exercising.
      sleepStages: {
        deep: 46,
        light: 283,
        rem: 121,
        wake: 6,
        score: 74,
        avgHr: 52,
        // 23:12 to 06:48. Without these the hypnogram falls back to its elapsed
        // axis and the regularity chart has nothing to place, so the two things
        // the sleep page was rebuilt for cannot be seen in a browser.
        ...nightClock(0, 23, 12, 456),
        timeline: [
          { stage: "light", startMinute: 0, minutes: 17 },
          { stage: "deep", startMinute: 17, minutes: 9 },
          { stage: "light", startMinute: 26, minutes: 15 },
          { stage: "awake", startMinute: 41, minutes: 1 },
          { stage: "light", startMinute: 42, minutes: 3 },
          { stage: "rem", startMinute: 45, minutes: 11 },
          { stage: "light", startMinute: 56, minutes: 25 },
          { stage: "deep", startMinute: 81, minutes: 9 },
          { stage: "light", startMinute: 90, minutes: 27 },
          { stage: "rem", startMinute: 117, minutes: 9 },
          { stage: "light", startMinute: 126, minutes: 18 },
          { stage: "deep", startMinute: 144, minutes: 3 },
          { stage: "light", startMinute: 147, minutes: 14 },
          { stage: "rem", startMinute: 161, minutes: 32 },
          { stage: "light", startMinute: 193, minutes: 10 },
          { stage: "deep", startMinute: 203, minutes: 6 },
          { stage: "light", startMinute: 209, minutes: 12 },
          { stage: "rem", startMinute: 221, minutes: 16 },
          { stage: "light", startMinute: 237, minutes: 25 },
          { stage: "deep", startMinute: 262, minutes: 4 },
          { stage: "light", startMinute: 266, minutes: 24 },
          { stage: "rem", startMinute: 290, minutes: 12 },
          { stage: "light", startMinute: 302, minutes: 24 },
          { stage: "awake", startMinute: 326, minutes: 2 },
          { stage: "light", startMinute: 328, minutes: 17 },
          { stage: "rem", startMinute: 345, minutes: 12 },
          { stage: "light", startMinute: 357, minutes: 21 },
          { stage: "deep", startMinute: 378, minutes: 15 },
          { stage: "light", startMinute: 393, minutes: 31 },
          { stage: "rem", startMinute: 424, minutes: 12 },
          { stage: "light", startMinute: 436, minutes: 8 },
          { stage: "awake", startMinute: 444, minutes: 3 },
          { stage: "light", startMinute: 447, minutes: 3 },
        ],
      },
    },
  ]);

  const stretch = {
    id: uid(),
    name: "Stretch",
    days: [0, 1, 2, 3, 4, 5, 6],
    archived: false,
  };
  const read = {
    id: uid(),
    name: "Read 20 min",
    days: [0, 1, 2, 3, 4, 5, 6],
    archived: false,
  };
  const screens = {
    id: uid(),
    name: "No screens after 11",
    days: [0, 1, 2, 3, 4, 5, 6],
    archived: false,
  };
  persist("atlas_habits", [stretch, read, screens]);
  persist("atlas_habit_ticks", [
    { habitId: stretch.id, date: today() },
    { habitId: read.id, date: today() },
  ]);

  await Promise.all([seedWorkouts(), seedRollups(), seedHeartRate()]);
}

/**
 * A minute-by-minute evening around the two most recent sessions, so the
 * session sheet's heart rate chart draws something in a browser.
 *
 * The shape is taken from the user's real 27 July: quiet around 80, up to
 * 130-ish once the session starts, and - the whole point - still elevated for
 * roughly an hour after the band stopped counting, before coming back down.
 * That gap is what the chart exists to reveal, so a seed without it would make
 * the feature look like it works when the interesting case was never drawn.
 */
function seedHeartRate() {
  const samples = [];
  const evening = (daysAgo, startHour, startMin, bandMinutes, realMinutes) => {
    const base = new Date();
    base.setDate(base.getDate() - daysAgo);
    base.setHours(startHour, startMin, 0, 0);
    const start = base.getTime();

    for (let m = -20; m <= realMinutes + 45; m++) {
      const t = start + m * 60_000;
      let v;
      if (m < 0) v = 78 + Math.round(Math.sin(m / 4) * 6);
      else if (m < realMinutes) {
        // Working. Higher early, and it never settles because climbing is
        // bursts with standing around between them.
        const drift = m < bandMinutes ? 124 : 108;
        v = drift + Math.round(Math.sin(m / 3.2) * 14 + Math.cos(m / 7) * 6);
      } else {
        // Coming down over about half an hour.
        const after = m - realMinutes;
        v = Math.max(70, 104 - after * 1.1 + Math.round(Math.sin(after / 3) * 5));
      }
      samples.push({ metric: "hr", t, v: Math.round(v) });
    }
  };

  // Today: band and reality agree. Monday: the band stopped an hour early.
  evening(0, 17, 53, 79, 79);
  evening(2, 18, 20, 75, 135);

  // Stress across today, shaped like the user's real 29 July: single digits in
  // the small hours, climbing through the morning, and sitting in the fifties
  // from noon. Every seven minutes, which is roughly how often the band
  // reports, and irregular enough to exercise the gap handling.
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  for (let m = 0; m < 1440; m += 7) {
    const hour = m / 60;
    let v;
    if (hour < 5) v = 12 + Math.sin(m / 90) * 10;
    else if (hour < 9) v = 20 + Math.sin(m / 70) * 8;
    else if (hour < 12) v = 16 + Math.sin(m / 55) * 9;
    else v = 48 + Math.sin(m / 65) * 11;
    samples.push({
      metric: "stress",
      t: midnight.getTime() + m * 60_000,
      v: Math.max(4, Math.round(v)),
    });
  }

  return import("@/utils/sampleDb")
    .then(({ putSamples }) => putSamples(samples))
    .catch(() => {
      // Dev convenience only. The chart's empty state is worth seeing too.
    });
}

/**
 * Ten days of daily rollups, so Recovery, BODY and the FITNESS tiles have
 * something to work with in a browser.
 *
 * Without these every strap-derived number is a dash and Recovery is stuck on
 * "calibrating", which means the entire ready state of the Recovery page - the
 * band scale, the breakdown, the headroom sentence - could only ever be seen on
 * the phone. Today's HRV sits a little under the baseline on purpose: a page
 * about why a score is what it is is not testable against a perfect day.
 */
function seedRollups() {
  const hrv = [46, 44, 49, 47, 51, 45, 48, 43, 47, 45];
  const restingHr = [54, 55, 53, 54, 52, 56, 54, 57, 55, 55];
  const steps = [2435, 3733, 5704, 2203, 5066, 1846, 950, 4743, 3120, 4210];
  const pai = [43, 51, 83, 89, 121, 137, 137, 160, 152, 148];

  return import("@/utils/sampleDb")
    .then(({ saveRollups }) => {
      const writes = [];
      for (let i = 0; i < hrv.length; i++) {
        const d = new Date();
        d.setDate(d.getDate() - (hrv.length - 1 - i));
        writes.push(
          saveRollups(d.toLocaleDateString("sv"), {
            hrv: hrv[i],
            restingHr: restingHr[i],
            steps: steps[i],
            pai: pai[i],
            respRate: 14 + ((i % 3) - 1) * 0.4,
            spo2: 96,
            skinTemp: 33.4,
            stress: 28 + ((i % 4) - 1) * 3,
          })
        );
      }
      return Promise.all(writes);
    })
    .catch(() => {
      // Dev convenience only. The empty states are worth being able to see too.
    });
}

/**
 * Sessions live in IndexedDB, not localStorage, so nothing above reaches them
 * and the whole FITNESS tab rendered empty in a browser however much was
 * seeded. Shapes and durations are taken from the user's real archive: a long
 * Sunday climb, two evening sessions, and a six-minute one that is really a
 * walk the band decided to call a workout.
 *
 * Deliberately not awaited: seeding is fire-and-forget on a dev boot, and a
 * failure here must not stop the rest of the app starting.
 */
function seedWorkouts() {
  const at = (daysAgo, hour, minute) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  };
  const session = (startMillis, activeSeconds, caloriesKcal, hrAvg) => ({
    startMillis,
    endMillis: startMillis + activeSeconds * 1000,
    typeCode: 223,
    typeAutoDetected: true,
    activeSeconds,
    caloriesKcal,
    hrAvg,
    hrMax: hrAvg + 40,
    hrMin: hrAvg - 30,
    distanceMeters: null,
    altitudeAvgMeters: null,
  });

  return import("@/utils/sampleDb")
    .then(({ putWorkouts }) =>
      putWorkouts([
        session(at(0, 17, 53), 4744, 764, 138),
        session(at(2, 18, 20), 4529, 594, 123),
        session(at(3, 13, 31), 10928, 1380, 121),
        session(at(7, 17, 28), 376, 42, 119),
      ])
    )
    .catch(() => {
      // A dev convenience, not a feature. If IndexedDB is unavailable the tab
      // shows its empty state, which is also worth being able to see.
    });
}
