// Source-agnostic persistence for wearable samples and sleep sessions.
//
// Extracted from stores/gadgetbridge.js when a second source (direct BLE)
// arrived. The ordering rules below are subtle and were paid for once already;
// duplicating them per source is how two copies quietly drift apart, which is
// exactly the failure this codebase has fixed before.
//
// Nothing here names a data source: callers pass their own sourceId, which only
// ever appears in watermark keys.

import {
  putSamples,
  getWatermark,
  setWatermark,
  saveRollups,
  loadRollups,
  downsampleOlderThan,
  putWorkouts,
} from "@/utils/sampleDb";
import { rollupsForDate } from "@/utils/dailyRollup";
import { BODY_METRICS, isMeaningful } from "@/utils/bodyMetrics";
import { sleepMinutesToHours } from "@/utils/huamiSleep";
import { today } from "@/utils/date";

export const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Per-metric watermarks for a source, in the shape extractors expect. */
export async function watermarksFor(sourceId) {
  const sinceByMetric = {};
  for (const metric of Object.keys(BODY_METRICS)) {
    sinceByMetric[metric] = await getWatermark(`${sourceId}:${metric}`);
  }
  return sinceByMetric;
}

/**
 * Store samples, freeze the daily rollups they affect, then advance watermarks
 * and downsample. Returns the set of date keys this run touched.
 */
export async function ingestSamples(samples, sourceId, onProgress) {
  await putSamples(samples, onProgress);

  // Freeze rollups for every date this import touched, while the samples
  // behind them are still at full resolution. This must happen before
  // downsampling: collapsing samples to 15-minute averages destroys the
  // resolution a summed metric like steps needs, so a rollup recomputed
  // afterwards would be wrong.
  const touched = new Set(
    samples.map((s) => new Date(s.t).toLocaleDateString("sv"))
  );
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
  for (const dateKey of touched) {
    // Guard: a date outside the retention window has already had its samples
    // downsampled to 15-minute averages by an earlier sync, so recomputing its
    // rollups now would silently derive a wrong total (e.g. summed steps) from
    // averaged data and overwrite the correct frozen one - permanently, since
    // nothing else keeps the original full-resolution samples around. Only skip
    // when a rollup already exists for that date: a date that has never been
    // frozen still needs freezing now, however old it is, or its real numbers
    // would never get captured before they're averaged away.
    if (new Date(`${dateKey}T00:00:00`).getTime() < cutoff) {
      const existing = await loadRollups(dateKey);
      if (existing) continue;
    }
    await saveRollups(dateKey, await rollupsForDate(dateKey));
  }

  // Watermarks only advance after rollups are frozen, not right after
  // putSamples. If saveRollups throws partway through, the watermark must not
  // have moved yet, or the dates that didn't get a frozen rollup would never be
  // retried (their samples are already imported, so the next run would consider
  // them already synced) and downsampling would eventually collapse them with a
  // summed metric like steps missing rows. A crash here just means an idempotent
  // re-import next run: putSamples is keyed on [metric, t], so replaying
  // already-imported samples is harmless.
  const maxByMetric = {};
  for (const s of samples) {
    if (maxByMetric[s.metric] == null || s.t > maxByMetric[s.metric]) {
      maxByMetric[s.metric] = s.t;
    }
  }
  for (const [metric, t] of Object.entries(maxByMetric)) {
    await setWatermark(`${sourceId}:${metric}`, t);
  }

  for (const metric of Object.keys(BODY_METRICS)) {
    await downsampleOlderThan(metric, cutoff);
  }

  return touched;
}

/**
 * Store decoded workouts. No revision-grouping needed the way sleep sessions
 * need it: each workout is one complete record rather than successive partial
 * views of the same session, and putWorkouts already upserts by startMillis,
 * so a re-fetched workout naturally overwrites rather than duplicates.
 *
 * Returns the dates touched, in the same shape ingestSamples/commitSleepSessions
 * return, so a caller can report one combined "days touched" figure.
 */
export async function commitWorkouts(workouts) {
  if (!workouts || workouts.length === 0) return new Set();
  await putWorkouts(workouts);
  return new Set(workouts.map((w) => new Date(w.startMillis).toLocaleDateString("sv")));
}

/**
 * Commit decoded sleep sessions onto checkin entries. Returns the dates whose
 * stored value genuinely changed, so a caller can report real updates rather
 * than claiming every date was touched.
 *
 * Sessions are grouped before anything is written. A source does not hand over
 * one row per sleep segment: it hands over successive REVISIONS of the same
 * session, so the same bedtime reappears with a later wake time as the night
 * extends, alongside byte-identical duplicates from repeat fetches. Writing
 * session by session therefore stored whichever revision happened to arrive
 * last (a real night read 8h55 when its final value was 11h05).
 */
/**
 * Below this, a session is a nap or a fragment of a night that arrived on its
 * own. Ninety minutes is roughly one sleep cycle: long enough that a real short
 * night still counts, short enough that the hour-long fragments a truncated
 * fetch produces never do.
 */
const NIGHT_FLOOR_MINUTES = 90;

export function commitSleepSessions(sessions, checkin) {
  const byDate = new Map();
  for (const session of sessions) {
    if (!session) continue;
    const dateKey = session.wakeTime.toLocaleDateString("sv");
    const bedKey = session.bedTime.getTime();
    const forDate = byDate.get(dateKey) ?? new Map();
    const seen = forDate.get(bedKey);
    // Same bedtime means the same sleep, so keep the most complete telling
    // of it. Never add them together: they are one night, not several.
    if (!seen || session.wakeTime > seen.wakeTime) forDate.set(bedKey, session);
    byDate.set(dateKey, forDate);
  }

  const changed = new Set();
  for (const [dateKey, forDate] of byDate) {
    // Genuinely different bedtimes on one wake date would be separate sleeps,
    // i.e. a nap on top of the night, and the night is the figure this metric is
    // meant to report.
    //
    // Picked by length rather than by earliest bedtime, which is what this used
    // to do. A nap is shorter than the night either way, so that case is
    // unaffected; what earliest-bedtime got wrong was revisions. The band
    // refines sleep onset between them, so a fragment whose bedtime landed a
    // minute earlier than the finished night's beat it outright, and the longer
    // reading sitting right beside it was discarded.
    const night = [...forDate.values()].sort(
      (a, b) => b.totalSleepMinutes - a.totalSleepMinutes || a.bedTime - b.bedTime
    )[0];
    const hours = sleepMinutesToHours(night.totalSleepMinutes);

    // A fetch can arrive in pieces - the band caps how much it answers with in
    // one round - so the first thing to land for a date may be a fragment of
    // the night rather than the night. Committing it anyway is how a pull at
    // 08:35 briefly announced an hour of sleep before correcting itself, which
    // is worse than showing nothing: the wrong number is alarming and it is on
    // screen long enough to be believed.
    //
    // Three guards, all about what a finished *night* is:
    //   - under NIGHT_FLOOR_MINUTES it is a nap or a fragment, never the night;
    //   - a figure that would shorten a night already recorded for that date is
    //     a partial telling of it, not a correction;
    //   - this morning's night is only taken once the band has scored it.
    // The cost of the second is that a genuine downward correction from the band
    // is ignored until the date is cleared, which is accepted: the band revising
    // a night downward has never been observed, and a fragment arriving first
    // has.
    //
    // The third is what the 90-minute floor could not catch. On 2026-08-06 a
    // sync shortly after waking committed three hours for a night that was nine,
    // and a later sync corrected it: the band had written a revision ending
    // around 02:40 and the finished session was simply not in that batch, so
    // there was no longer telling to prefer and nothing stored to shrink.
    //
    // The band's own score is the completeness flag, because it is computed when
    // the session is finalised rather than as it grows. It is a byte, so an
    // unscored session reads 0. Applied to today alone: an older date is settled
    // by definition, and a historic night that genuinely came back unscored
    // should not be locked out of the archive forever over it.
    const storedEntry = checkin.entryFor(dateKey);
    const stored = storedEntry?.sleep ?? null;
    const tooShortForANight = night.totalSleepMinutes < NIGHT_FLOOR_MINUTES;
    const wouldShrink = stored != null && hours < stored - 1 / 60;
    const stillSettling = dateKey === today() && !night.score;

    // A fourth guard, and the same idea as `wouldShrink` applied to the stage
    // detail rather than to the hours: a later revision is not automatically a
    // better one, so it must not replace something usable with nothing.
    //
    // Measured on 2026-08-10. The band offered this night at 09:19 with 49
    // stage segments and a score of 73, which decoded cleanly and was stored.
    // A later sync brought a revision scoring 72 whose segments did not add up
    // to its own footer totals, so `decodeStageTimeline` discarded them - and
    // because the hours had not shrunk, that empty timeline overwrote the good
    // one. The night then rendered with no hypnogram and no clock axis while
    // Zepp still showed both, which is what surfaced it.
    //
    // The whole session is skipped rather than merging the old timeline into the
    // new totals, because stages and totals must keep describing the same
    // telling of the night. That rule is directly below and predates this.
    const wouldLoseTimeline =
      !night.stageTimeline?.length && storedEntry?.sleepStages?.timeline?.length > 0;

    if (tooShortForANight || wouldShrink || stillSettling || wouldLoseTimeline) continue;
    // Stages ride along with the night they came from rather than being
    // stored separately, so a re-synced night can never leave the totals
    // describing one night and the stages another.
    const stages = {
      rem: night.remMinutes,
      light: night.lightMinutes,
      deep: night.deepMinutes,
      wake: night.wakeMinutes,
      score: night.score,
      // Epoch ms, not Dates: this object is persisted as JSON, and a Date would
      // come back a string. Stored because a timeline with no clock position can
      // only be drawn against elapsed time, which is what the page had to do
      // before, and because regularity is a fact about when you slept rather
      // than how long.
      bedTime: night.bedTime.getTime(),
      wakeTime: night.wakeTime.getTime(),
      // The band's own average heart rate across the sleep window, which is a
      // different figure from the resting HR BODY shows: that one is a property
      // of the day. Range-checked here rather than trusted, because the same
      // byte carries the device's "no reading" sentinel.
      avgHr: isMeaningful("hr", night.avgHr) ? night.avgHr : null,
      timeline: night.stageTimeline,
    };
    const previous = checkin.entryFor(dateKey);
    // Compared in whole minutes because the stored value is an exact division.
    const hoursDiffer =
      previous?.sleep == null || Math.round(previous.sleep * 60) !== Math.round(hours * 60);
    const stagesDiffer =
      JSON.stringify(previous?.sleepStages ?? null) !== JSON.stringify(stages);
    checkin.logMetric({ sleep: hours, sleepStages: stages }, dateKey);
    if (hoursDiffer || stagesDiffer) changed.add(dateKey);
  }
  return changed;
}
