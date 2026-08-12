// Turns stored samples into one value per metric per local date. Local dates,
// not UTC: a day boundary the user recognises matters more than a tidy epoch.

import { BODY_METRICS, rollupFor, restingHrFor } from "@/utils/bodyMetrics";
import { getSamples, loadRollups, saveRollups } from "@/utils/sampleDb";
import { addDays, today } from "@/utils/date";

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

  const deviceResting = out.restingHr ?? null;
  const hrSamples = await getSamples("hr", start, end);
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
