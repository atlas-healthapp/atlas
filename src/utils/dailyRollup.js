// Turns stored samples into one value per metric per local date. Local dates,
// not UTC: a day boundary the user recognises matters more than a tidy epoch.

import { BODY_METRICS, rollupFor, restingHrFor } from "@/utils/bodyMetrics";
import { getSamples, loadRollups, saveRollups } from "@/utils/sampleDb";
import { addDays, today } from "@/utils/date";
import { load } from "@/utils/storage";

// Every key a caller can ever expect back from dailyValuesFor: every metric
// with a real rollup, which since 2026-08-06 includes raw `hr` - it was only
// restingHr's fallback source until heart rate got a page of its own.
const ROLLUP_KEYS = Object.entries(BODY_METRICS)
  .filter(([, def]) => def.rollup !== "none")
  .map(([metric]) => metric);

// Exported so the tiling-invariant regression test (dailyRollup.test.js) can
// exercise it directly across a full year of dates. That is a deliberate,
// authorised deviation from the brief, which kept this function private.
export function localDayBounds(dateKey) {
  // Not start + 24h: local days are 23 or 25 hours long across a daylight
  // saving transition, which would overlap or gap the windows and either
  // double count or drop a whole hour of samples.
  const startDate = new Date(`${dateKey}T00:00:00`);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);
  return { start: startDate.getTime(), end: endDate.getTime() };
}

/**
 * The night that ended on this date, as epoch bounds, or null if none is known.
 *
 * **Read straight out of the persisted check-ins rather than passed in.** The
 * alternative is threading a window through `dailyValuesFor`,
 * `dailyValuesForRange` and `rollupsForDate` and then through all seventeen
 * callers of those, most of which have no idea a sleep window exists. This
 * reads one localStorage key through the same guarded `load` the stores use, so
 * it degrades to null under test and in node rather than throwing.
 *
 * Nights are stored on the date they END, which is the same key this file rolls
 * up, so no date arithmetic is needed. `bedTime`/`wakeTime` are epoch ms - see
 * the note in `sampleIngest.commitSleepSessions` about why they are not Dates.
 */
export function sleepWindowFor(dateKey) {
  const entries = load("atlas_checkins", []) ?? [];
  const stages = entries.find((e) => e?.date === dateKey)?.sleepStages;
  const start = stages?.bedTime;
  const end = stages?.wakeTime;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

export async function rollupsForDate(dateKey) {
  const { start, end } = localDayBounds(dateKey);
  const out = {};

  for (const [metric, def] of Object.entries(BODY_METRICS)) {
    // Raw HR is stored only as the fallback source for restingHr, so it gets
    // no rollup of its own.
    if (def.rollup === "none") continue;
    const samples = await getSamples(metric, start, end);
    out[metric] = rollupFor(
      def.rollup,
      samples.map((s) => s.v)
    );
  }

  // **Resting heart rate is the night's, not the calendar day's** (2026-08-14).
  //
  // It was the last resting sample the band emitted between midnight and
  // midnight, which is a different quantity depending on when you looked. Read
  // off the phone that morning: the band emitted 04:46=57, 05:16=55, 05:36=53
  // and then 09:26=52, the last of those forty minutes after waking. So Recovery
  // scored 57 at 09:17 and 52 at 09:28, and the score moved four points on a
  // refresh that collected nothing new about the night. Worse at the other end:
  // just after midnight there are no resting samples yet at all, so it fell
  // through to the tenth percentile of that date's handful of waking heart
  // rates and returned 67 against a real nightly figure near 47.
  //
  // Scoped to the night, the figure is settled by the time you wake and cannot
  // drift for the rest of the day. **The aggregation inside the window is
  // deliberately unchanged** - still the last device reading, still the tenth
  // percentile as a fallback - because which reading best represents a night is
  // a separate question from which readings belong to it, and only the second
  // one was wrong.
  //
  // Falls back to the whole day when the night is not known: nights before
  // 2026-08-04 have no stored bedtime, and today has none until you have slept.
  const night = sleepWindowFor(dateKey);
  const restFrom = night ?? { start, end };
  const deviceResting = night
    ? rollupFor(
        BODY_METRICS.restingHr.rollup,
        (await getSamples("restingHr", night.start, night.end)).map((s) => s.v)
      )
    : (out.restingHr ?? null);
  const hrSamples = await getSamples("hr", restFrom.start, restFrom.end);
  out.restingHr = restingHrFor(
    deviceResting,
    hrSamples.map((s) => s.v)
  );

  return out;
}

// The read path. A rollup frozen at sync time wins over recomputing, because
// once a day ages past the retention window its samples have been collapsed to
// 15-minute averages and a summed metric like steps can no longer be recovered
// from them.
//
// **Today is the exception and always recomputes.** A frozen rollup is a
// snapshot of the day as it stood at the last sync, and today is still
// accumulating: freezing it at 00:05 and then preferring that record all day is
// how a screen ends up insisting on 23 steps at six in the evening. Today's
// samples are always full resolution - downsampling only touches days past the
// retention window - so recomputing costs nothing and cannot lose a sum.
export async function dailyValuesFor(dateKey) {
  if (dateKey === today()) return rollupsForDate(dateKey);
  const stored = await loadRollups(dateKey);
  if (!stored) return rollupsForDate(dateKey);
  // A frozen record can predate a metric being added to BODY_METRICS, so it
  // may be missing keys a freshly computed rollup would always have. Without
  // this, an old frozen day returns undefined for that key while a recent
  // computed day returns null for the same "no data" case - two different
  // values meaning the same thing depending on how old the day is.
  const out = { ...stored };
  for (const key of ROLLUP_KEYS) {
    if (!(key in out)) out[key] = null;
  }
  return out;
}

/**
 * Fill a newly added metric into rollups frozen before it existed.
 *
 * A frozen rollup is never recomputed on read, deliberately: once a day ages
 * past the retention window its samples are collapsed to 15-minute averages and
 * a summed metric like steps cannot be recovered. The cost is that **adding a
 * metric leaves every existing day without it**, so the new row on BODY has a
 * reading for today and nothing behind it, and says BUILDING A RANGE for as
 * long as it takes to accumulate one. That is what happened when `hr` gained a
 * rollup on 2026-08-06: three days had it and thirteen did not.
 *
 * This fills the gap from the raw samples, which are still there and still full
 * resolution for anything inside the retention window. It only ever **adds**
 * keys - an existing value is never overwritten, so a frozen sum stays frozen
 * and this cannot undo the thing the freezing protects.
 *
 * Returns how many days it changed, so the caller can log a no-op distinctly
 * from a failure.
 */
export async function backfillRollupKeys(metrics, { days = 90 } = {}) {
  const wanted = (metrics ?? []).filter((m) => BODY_METRICS[m]?.rollup && BODY_METRICS[m].rollup !== "none");
  if (!wanted.length) return 0;

  let filled = 0;
  const todayKey = today();

  for (let i = 1; i <= days; i++) {
    const dateKey = addDays(todayKey, -i);
    const stored = await loadRollups(dateKey);
    // No stored rollup means the read path already recomputes that day, so
    // there is nothing to repair.
    if (!stored) continue;

    const missing = wanted.filter((m) => !(m in stored) || stored[m] == null);
    if (!missing.length) continue;

    const { start, end } = localDayBounds(dateKey);
    const patch = {};
    for (const metric of missing) {
      const samples = await getSamples(metric, start, end);
      const values = samples.map((s) => s.v).filter((v) => Number.isFinite(v));
      if (!values.length) continue;
      patch[metric] = rollupFor(BODY_METRICS[metric].rollup, values);
    }

    if (Object.keys(patch).length) {
      await saveRollups(dateKey, { ...stored, ...patch });
      filled++;
    }
  }

  return filled;
}

/**
 * Rewrite frozen resting heart rates onto the night-scoped definition.
 *
 * **This one overwrites, which `backfillRollupKeys` deliberately refuses to
 * do**, and the difference is worth stating. That function fills a metric that
 * was never computed, so adding is all it can do. This one changes a value that
 * exists, because the definition behind it changed on 2026-08-14: resting heart
 * rate is now the night's reading rather than the calendar day's.
 *
 * Without it the two definitions would sit side by side in one series. Recovery
 * scores today against a rolling baseline of the days before it, so today would
 * be a sleeping figure judged against a fortnight of end-of-day ones - and on
 * this archive that gap is several beats, which is several points of score and
 * a full band. A migration that leaves a metric meaning two things is worse
 * than no migration.
 *
 * **Only days whose night is known are touched.** A date with no stored bedtime
 * has no window to scope to, so its value is already the whole-day one and
 * rewriting it would change nothing. Ninety days by default: raw samples are
 * full resolution inside the retention window and collapsed to 15-minute
 * averages past it, and every baseline in the app is far shorter than that.
 *
 * Returns how many days it rewrote.
 */
export async function rescopeRestingHrToNights({ days = 90 } = {}) {
  let changed = 0;
  const todayKey = today();

  for (let i = 1; i <= days; i++) {
    const dateKey = addDays(todayKey, -i);
    const stored = await loadRollups(dateKey);
    // No frozen rollup means the read path recomputes that day from samples and
    // already applies the new scoping.
    if (!stored) continue;

    const night = sleepWindowFor(dateKey);
    if (!night) continue;

    const deviceSamples = await getSamples("restingHr", night.start, night.end);
    const hrSamples = await getSamples("hr", night.start, night.end);
    const rescoped = restingHrFor(
      rollupFor(
        BODY_METRICS.restingHr.rollup,
        deviceSamples.map((s) => s.v)
      ),
      hrSamples.map((s) => s.v)
    );
    // Nothing in the window is not a correction, it is a loss. A night whose
    // samples have aged out must keep the figure it already had.
    if (rescoped == null) continue;
    if (stored.restingHr === rescoped) continue;

    await saveRollups(dateKey, { ...stored, restingHr: rescoped });
    changed++;
  }

  return changed;
}

// Windowed read for screens that show a run of days. Each dailyValuesFor call
// already returns every metric for its day, so a 14-day window across nine
// metrics is 14 reads rather than 126: callers must not loop per metric.
export async function dailyValuesForRange(fromDateKey, toDateKey) {
  if (fromDateKey > toDateKey) return [];
  const out = [];
  let cursor = fromDateKey;
  // Date strings are YYYY-MM-DD, so lexical comparison is chronological.
  while (cursor <= toDateKey) {
    out.push({ date: cursor, values: await dailyValuesFor(cursor) });
    cursor = addDays(cursor, 1);
  }
  return out;
}
