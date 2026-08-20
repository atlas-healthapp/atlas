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

/**
 * The window a sleep has to sit entirely inside before it is called a nap.
 *
 * **Why this exists.** Naps were never excluded on purpose: they fell out of the
 * floor above and of longest-wins per wake date, and neither knows what a nap is.
 * A nap therefore loses to the night that ended the same morning, which is the
 * common case and reads as working. On a day the band recorded no night at all
 * it does not lose to anything, and a two-hour afternoon sleep was committed as
 * that date's *night*, carrying its hours, its stages and its score into the
 * sleep score, regularity and Recovery.
 *
 * **The same calendar day is the rule; the clock hours barely matter.** A sleep
 * counts as daytime if it begins at or after 09:00 and starts and ends on the
 * same date. A real night fails that outright, because it spans midnight, and
 * somebody who goes to bed at 03:00 and sleeps until 11:30 is untouched.
 *
 * **It used to also require the wake to be before 19:00, and that hour was
 * invented rather than measured.** Zepp showed a nap of 1:58 running 17:34 to
 * 19:32 on 2026-08-16. It failed that test by half an hour, was therefore
 * treated as a candidate for the NIGHT, lost longest-wins to the real night, and
 * vanished - so the feature shipped and the user's own screenshots were the
 * thing that disproved the rule. An evening doze that starts and ends before
 * midnight is still a nap; there is nothing about 19:00 that makes it a night.
 *
 * **Known cost, stated rather than discovered later**: a night-shift sleep from
 * 09:00 to 16:00 is genuinely a night and this calls it a nap. Atlas has no way
 * to tell those apart today and the cost of being wrong falls the safer way -
 * a missing figure rather than a wrong one. The cost is now smaller than it
 * was: such a sleep is stored as a nap rather than lost, it simply does not
 * count as that night.
 */
const NAP_EARLIEST_HOUR = 9;

/** Is this sleep wholly inside one daytime, ie a nap rather than a night? */
export function isDaytimeSleep(session) {
  const bed = session?.bedTime;
  const wake = session?.wakeTime;
  if (!(bed instanceof Date) || !(wake instanceof Date)) return false;
  if (bed.toLocaleDateString("sv") !== wake.toLocaleDateString("sv")) return false;
  return bed.getHours() >= NAP_EARLIEST_HOUR;
}

/**
 * The daytime sleeps, kept instead of thrown away.
 *
 * **Stored apart from the night, and that is the whole design.** A nap goes on
 * the entry as `naps`, never into `sleepStages` or `sleep`, so nothing in
 * `sleepScore.js` can reach it: every term there is defined over a night, and
 * adding nap minutes to a night's total is the wake-then-doze conflation the
 * NEXT ticket exists to tell apart. Keeping them in different fields means that
 * cannot be done by accident later.
 *
 * Filed under the day the nap happened, which for a daytime sleep is the same
 * date at both ends by definition - unlike a night, which is filed under the
 * date it *ends*.
 *
 * Deduped by bedtime keeping the longest, exactly as nights are, because the
 * band sends revisions of a session as it refines it. Two genuinely different
 * bedtimes in one day are two naps and both are kept.
 *
 * No floor. `NIGHT_FLOOR_MINUTES` exists to stop a truncated fetch being read as
 * a night, and a nap has nothing to be mistaken for. Inventing a second
 * threshold here would only decide which of the band's own sleeps to disbelieve.
 */
/**
 * How far a sleep has to stand clear of a night to be a nap at all.
 *
 * **The band's nap block is raw and includes the time you spent falling
 * asleep.** Measured 2026-08-19: it filed 00:01 to 00:25 as a nap, and the night
 * proper began at 00:53. Twenty-four minutes of sleep, twenty-eight minutes
 * awake, then eight hours. That is one going to bed, and calling it a nap put a
 * NAP card above a night it was part of. Zepp reads the same block and does not
 * show it, so the vendor filters it too.
 *
 * An hour, because "you were asleep again within the hour" is the same going to
 * bed rather than a separate event. Not fitted to the data: the twelve real naps
 * sit 0.9 to 8.4 hours clear of their night, a continuum with no natural split,
 * so the threshold is a decision. At an hour it reclassifies exactly two - the
 * one above and an evening doze 54 minutes before bed - and the nearest nap it
 * keeps stands 98 minutes clear.
 *
 * Applied at both ends. Going back to sleep twenty minutes after waking is the
 * tail of that night by the same argument.
 */
export const NAP_NIGHT_GAP_MS = 60 * 60 * 1000;

/** Is this sleep close enough to a night to be part of it? */
function adjoinsANight(nap, nights) {
  const bed = nap.bedTime.getTime();
  const wake = nap.wakeTime.getTime();
  for (const night of nights ?? []) {
    const nightBed = night?.bedTime instanceof Date ? night.bedTime.getTime() : night?.bedTime;
    const nightWake = night?.wakeTime instanceof Date ? night.wakeTime.getTime() : night?.wakeTime;
    if (!Number.isFinite(nightBed) || !Number.isFinite(nightWake)) continue;
    // Overlapping counts as adjoining: a gap of zero is the strongest version of
    // the case this exists for, not an exception to it.
    if (bed < nightWake + NAP_NIGHT_GAP_MS && wake > nightBed - NAP_NIGHT_GAP_MS) return true;
  }
  return false;
}

export function collectNaps(sessions, bandNaps, nights) {
  const candidates = [];
  // The band's own nap block, read off the raw record by `decodeNaps` - which is
  // where every nap has actually come from since 2026-08-18. A daytime *session*
  // record has never once been seen, so the branch below is a guard rather than
  // a source: if one ever arrives it is a nap, not a night.
  for (const nap of bandNaps ?? []) {
    if (!(nap?.bedTime instanceof Date) || !(nap?.wakeTime instanceof Date)) continue;
    candidates.push({
      bedTime: nap.bedTime,
      wakeTime: nap.wakeTime,
      minutes: nap.minutes ?? null,
      stageTimeline: nap.stageTimeline ?? null,
    });
  }
  for (const session of sessions ?? []) {
    if (!session || !isDaytimeSleep(session)) continue;
    candidates.push({
      bedTime: session.bedTime,
      wakeTime: session.wakeTime,
      minutes: session.totalSleepMinutes ?? null,
    });
  }

  const byDate = new Map();
  for (const nap of candidates) {
    // Dropped rather than stored and hidden. A sleep that adjoins a night is not
    // a nap by any reading, and keeping it under another name would only give a
    // later screen something to get wrong. What it actually is - time spent
    // falling asleep - belongs to the night, and deriving that is the
    // wake-then-doze ticket's job rather than this function's.
    if (adjoinsANight(nap, nights)) continue;
    const dateKey = nap.bedTime.toLocaleDateString("sv");
    const byBed = byDate.get(dateKey) ?? new Map();
    const bedKey = nap.bedTime.getTime();
    const seen = byBed.get(bedKey);
    if (!seen || (nap.minutes ?? 0) > (seen.minutes ?? 0)) {
      byBed.set(bedKey, nap);
    }
    byDate.set(dateKey, byBed);
  }

  const out = new Map();
  for (const [dateKey, byBed] of byDate) {
    out.set(
      dateKey,
      [...byBed.values()]
        .sort((a, b) => a.bedTime - b.bedTime)
        .map((s) => ({
          // Epoch ms for the same reason the night stores them that way: this is
          // persisted as JSON and a Date comes back a string.
          bedTime: s.bedTime.getTime(),
          wakeTime: s.wakeTime.getTime(),
          minutes: s.minutes ?? null,
          // The nap's own stages, in the same shape the night's timeline uses.
          // Null when the band sent none, which is a different thing from a nap
          // with no stages in it and is what the card keys on.
          stageTimeline: s.stageTimeline ?? null,
        }))
    );
  }
  return out;
}

export function commitSleepSessions(sessions, checkin, bandNaps) {
  const byDate = new Map();
  for (const session of sessions) {
    if (!session) continue;
    // Dropped here rather than at the guards below, so a nap never competes for
    // the date at all. Filtering later would still let a three-hour afternoon
    // sleep out-rank a genuinely bad two-hour night, since the winner is picked
    // by length. Naps are collected separately below and stored as `naps`, so
    // this drops it from the NIGHT contest rather than discarding it.
    if (isDaytimeSleep(session)) continue;
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

  // **Written separately from the nights, and deliberately not added to
  // `changed`.** That set is what callers count as "sleep days", and a day whose
  // only sleep was an afternoon nap is not a night's worth of sleep. The store
  // is reactive, so a screen showing naps still updates without being told.
  // **The nights are read back from the store rather than taken from this
  // batch**, and this loop runs after the one above, so every night committed a
  // moment ago is included. A routine sync carries two or three nights; the
  // night a nap has to be measured against is often not one of them, and a nap
  // kept only because its night was outside the fetch window would be a nap
  // whose classification depended on when you opened the app.
  const knownNights = (checkin.entries ?? [])
    .map((e) => e.sleepStages)
    .filter((s) => s?.bedTime && s?.wakeTime)
    .map((s) => ({ bedTime: s.bedTime, wakeTime: s.wakeTime }));

  const collected = collectNaps(sessions, bandNaps, knownNights);
  for (const [dateKey, naps] of collected) {
    const previous = checkin.entryFor(dateKey)?.naps ?? null;
    if (JSON.stringify(previous) === JSON.stringify(naps)) continue;
    checkin.logMetric({ naps }, dateKey);
  }

  // **A rejected nap has to clear the one already stored.** The loop above only
  // visits dates that still have a nap, so tightening the rule would otherwise
  // leave every nap it now rejects on the phone for ever - which is exactly what
  // happened to the 2026-08-19 doze the hour rule was written for. Every date
  // the band offered a nap for is reconsidered, and one that no longer has any
  // is emptied rather than left.
  // **Every date the batch covers is reconsidered, not only the dates that came
  // back with a nap.** Driving this off the naps alone left a stored nap
  // unclearable the moment the band stopped reporting it, which is not a corner
  // case: the band REVISES its records. Measured on 2026-08-19 - it filed a
  // 00:01 doze as a nap in the morning, and by lunchtime the same record came
  // back with an empty nap block, the band having folded it into the night it
  // preceded. Zepp had never shown it. So the phone kept a nap that neither the
  // band nor Atlas believed in any more, and a rule change could not shift it.
  //
  // A record's nap block describes the day around its own night, so the night's
  // wake date is the date to reconsider.
  const offered = new Set();
  for (const nap of bandNaps ?? []) {
    if (nap?.bedTime instanceof Date) offered.add(nap.bedTime.toLocaleDateString("sv"));
  }
  for (const session of sessions ?? []) {
    if (!session?.wakeTime) continue;
    offered.add(session.wakeTime.toLocaleDateString("sv"));
    if (isDaytimeSleep(session)) offered.add(session.bedTime.toLocaleDateString("sv"));
  }
  for (const dateKey of offered) {
    if (collected.has(dateKey)) continue;
    if (!checkin.entryFor(dateKey)?.naps?.length) continue;
    checkin.logMetric({ naps: [] }, dateKey);
  }

  return changed;
}
