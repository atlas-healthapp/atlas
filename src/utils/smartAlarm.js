// When to actually wake you, given a time you asked for and what the strap
// currently thinks you are doing.
//
// Pure and tested, because this is the one decision in the alarm that can be
// wrong in a way you would only discover by being woken badly, and there is no
// way to try it except by sleeping.
//
// ── What the three modes are ────────────────────────────────────────────────
//
//   fixed       The time you set. What has shipped since 2026-08-07.
//   afterOnset  A set number of hours after the strap decided you fell asleep,
//               bounded by a latest time you are willing to accept.
//   smart       The first light-sleep reading inside a window BEFORE the set
//               time. Never later than it, never earlier than the window.
//
// ── Why the window is 20 minutes and the checks are 10 ──────────────────────
//
// Simulated against three recorded nights, every 15 minutes from 06:00 to 09:15,
// replaying each sync's live picture as it stood at that moment rather than the
// morning's corrected version:
//
//   WINDOW   FIRED EARLY   MEDIAN EARLY   CORRECT   REM   DEEP   FELL BACK
//     10m         5/15          1m           3       2      0        10
//     15m         9/15         11m           7       2      0         6
//     20m        10/15         11m           8       2      0         5
//     30m        11/15         21m           8       2      1         4
//
// Thirty buys one extra early wake out of fifteen and costs ten more minutes of
// sleep at the median, plus the only deep-sleep wake in the whole dataset.
// Across the full grid at twenty minutes - 42 alarm-nights - there were **no
// deep-sleep wakes at all**, 8 REM and 22 correct.
//
// **Checking more often makes it worse, which is worth stating because it is
// counterintuitive.** More frequent checks find the first `light` sooner and so
// wake you earlier. Ten-minute spacing inside a twenty-minute window gives two
// decision points and biases naturally toward the later one. Do not "improve"
// this by polling every minute.
//
// ── Why it reads the band's stage rather than deriving its own ──────────────
//
// The band rewrites a fifth to a third of its own stage verdicts, provisionally
// calling things light and later deciding otherwise. In the wake window that is
// far safer than it sounds: of 461 minutes it called light live, 21% were
// rewritten but only eleven turned out to be deep, because slow-wave sleep is
// front-loaded into the early night. Waking from REM is close to a natural
// awakening; waking from deep sleep is where real grogginess comes from. So the
// live reading is good enough for this specific question at this specific hour,
// and deriving stages from raw heart rate - which is the alternative - needs
// beat-to-beat intervals Atlas does not have.

/** How far before the set time the smart window opens. */
export const SMART_WINDOW_MINUTES = 20;

/** Spacing of the checks inside it. Deliberately not smaller. See above. */
export const SMART_CHECK_MINUTES = 10;

/**
 * The earliest an onset-based alarm is allowed to commit to a time.
 *
 * Measured 2026-08-10: the band revised its idea of when this user fell asleep
 * from 22:01 to 00:19 between 01:38 and 02:08, then moved it by only eleven
 * minutes across the following seven hours. An alarm computing from onset before
 * it settles would have been over two hours wrong; one that waits is not.
 */
export const ONSET_COMMIT_HOUR = 2;

/** A stage the band reports that is safe to be woken from. */
const WAKEABLE = new Set(["light", "awake"]);

const MIN_MS = 60 * 1000;

/**
 * The stage the band currently believes you are in, and how stale that is.
 *
 * `session` is a decoded sleep session. Returns null when there is nothing
 * usable, which every caller must treat as "do not act", never as "not asleep":
 * a missing read is the commonest outcome of all - about a quarter of overnight
 * syncs came back with no session at all.
 */
export function currentStage(session, nowMillis) {
  const timeline = session?.stageTimeline;
  if (!timeline?.length || !session?.bedTime) return null;

  // **A bedtime that is neither a Date nor a number must refuse, not compute.**
  // It used to be taken as-is, and the arithmetic below then ran on a string:
  // `bedMs + minutes` concatenates, every `>` comparison against a number is
  // false, and `staleMinutes` comes out NaN - which passes the staleness gate in
  // smartDecision, because NaN fails every comparison including the one meant to
  // reject it. So a session with a bedtime in the wrong shape did not fail
  // safely. It reported whichever stage the loop happened to land on, with the
  // "READING TOO OLD" guard silently disabled, in the one piece of code that runs
  // while you are asleep and cannot be watched.
  //
  // Both real shapes still work: the decoder hands over a Date, and a night that
  // has been through storage comes back as epoch ms, because sleepStages is
  // persisted as JSON. Anything else returns null, which every caller already
  // treats as "do nothing".
  const bedMs = session.bedTime instanceof Date ? session.bedTime.getTime() : session.bedTime;
  if (!Number.isFinite(bedMs)) return null;
  const first = timeline[0].startMinute ?? 0;

  let best = null;
  for (const seg of timeline) {
    const startMs = bedMs + ((seg.startMinute ?? 0) - first) * MIN_MS;
    const endMs = startMs + (seg.minutes ?? 0) * MIN_MS;
    if (startMs > nowMillis) continue;
    if (!best || endMs > best.endMs) best = { stage: seg.stage, endMs };
  }
  if (!best) return null;
  return { stage: best.stage, staleMinutes: Math.max(0, (nowMillis - best.endMs) / MIN_MS) };
}

/**
 * Should the alarm fire right now?
 *
 * `alarmMillis` is the time the user asked for. Returns a decision object rather
 * than a boolean so the caller can log why, which matters for something that
 * runs while you are asleep and cannot be observed.
 *
 * **Firing at the set time is not this function's job.** The strap holds that
 * time itself as a hard alarm, so if the phone is dead, the app was reinstalled
 * or BLE fails, the alarm still goes off. This only ever decides whether to wake
 * you EARLY, which means the worst thing it can do is nothing.
 */
export function smartDecision({
  session,
  nowMillis,
  alarmMillis,
  windowMinutes = SMART_WINDOW_MINUTES,
  maxStaleMinutes = 15,
} = {}) {
  if (alarmMillis == null || nowMillis == null) {
    return { fire: false, reason: "NO ALARM SET" };
  }
  const minutesToAlarm = (alarmMillis - nowMillis) / MIN_MS;

  // Past it already: the strap's own alarm has this, and firing again would be a
  // second buzz for one alarm.
  if (minutesToAlarm <= 0) return { fire: false, reason: "ALARM TIME PASSED" };
  if (minutesToAlarm > windowMinutes) {
    return { fire: false, reason: "BEFORE THE WINDOW", minutesToAlarm };
  }

  const now = currentStage(session, nowMillis);
  if (!now) return { fire: false, reason: "NO READING", minutesToAlarm };
  if (now.staleMinutes > maxStaleMinutes) {
    return { fire: false, reason: "READING TOO OLD", minutesToAlarm, staleMinutes: now.staleMinutes };
  }
  if (!WAKEABLE.has(now.stage)) {
    return { fire: false, reason: "DEEP OR REM", stage: now.stage, minutesToAlarm };
  }
  return {
    fire: true,
    reason: "LIGHT SLEEP IN THE WINDOW",
    stage: now.stage,
    minutesToAlarm: Math.round(minutesToAlarm),
  };
}

/**
 * When an "N hours after falling asleep" alarm should go off.
 *
 * Returns `{ millis, committed }`. Uncommitted means the band's idea of onset is
 * still moving and the figure must be treated as provisional - the UI says so
 * rather than showing a time that will change under the reader.
 *
 * `latestMillis` is the backstop the user sets, and it is a hard ceiling: a late
 * night must not push an alarm past the time you have to be up. Without one this
 * mode is unusable on exactly the night it matters most.
 */
export function onsetAlarmTime({ onsetMillis, hours, latestMillis, nowMillis } = {}) {
  if (onsetMillis == null || !hours) return null;

  const target = onsetMillis + hours * 60 * MIN_MS;
  const capped = latestMillis != null ? Math.min(target, latestMillis) : target;

  // Committed once the clock is past the hour the band's onset stops moving.
  const committed =
    nowMillis == null ? false : new Date(nowMillis).getHours() >= ONSET_COMMIT_HOUR;

  return {
    millis: capped,
    committed,
    cappedByLatest: latestMillis != null && target > latestMillis,
  };
}
