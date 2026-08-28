/**
 * More than one alarm, and which of them tonight belongs to.
 *
 * Atlas held exactly one alarm until 2026-08-24. The ask was a weekday alarm
 * and a different weekend one, and the shape it landed on is a list rather than
 * two named schedules, because "weekday" and "weekend" are an arbitrary split
 * and a list is the model every phone already uses.
 *
 * **The band really does have slots.** Proven on the device rather than assumed:
 * a write to slot 1 was accepted, the strap buzzed for it, and Zepp showed both
 * alarms afterwards. So each alarm gets its own slot and the band rings each one
 * itself - nothing has to be rewritten as the week turns.
 *
 * <h2>The one rule everything rests on</h2>
 *
 * **No two enabled alarms may claim the same day.** The smart window, the
 * fired-once mark and the re-arm debt are all single values in the background
 * service, and they can stay that way only while at most one alarm is due on
 * any given night. Allowing two would mean the window has two answers and the
 * service has to keep per-alarm state through a night it is not awake for.
 *
 * That is a real restriction and it is enforced here rather than explained
 * away: a day already spoken for is refused at the point of editing.
 */

/**
 * The cap, and why it is not larger.
 *
 * Slot 1 is proven; how many the firmware actually has is not. Atlas has never
 * read the band's own config, so the honest number is "more than one, unknown
 * how many". Five is comfortably inside any plausible count and there are only
 * seven days to spread across anyway. Raise it once the read side exists.
 */
export const MAX_ALARMS = 5;

/** Sunday 0, matching `Date.getDay()` and what the app mirrors to the band. */
export const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
export const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** A blank alarm, for the ADD row. Defaults match the old single-alarm ones. */
export function emptyAlarm(id) {
  return {
    id,
    hour: 8,
    minute: 30,
    days: [],
    enabled: true,
    mode: "fixed",
    onsetHours: 8,
    latestHour: null,
    latestMinute: null,
  };
}

/**
 * Which days are claimed by more than one enabled alarm.
 *
 * Returns day numbers, so a caller can both refuse the save and light the
 * offending letters rather than printing a sentence about them.
 */
export function clashingDays(alarms, { ignoreId = null } = {}) {
  const seen = new Map();
  const clashes = new Set();
  for (const a of alarms ?? []) {
    if (!a?.enabled || a.id === ignoreId) continue;
    for (const day of a.days ?? []) {
      if (seen.has(day)) clashes.add(day);
      seen.set(day, a.id);
    }
  }
  return [...clashes].sort((x, y) => x - y);
}

/** The days another enabled alarm already owns, for greying them while editing. */
export function daysTakenBy(alarms, exceptId) {
  const taken = new Set();
  for (const a of alarms ?? []) {
    if (!a?.enabled || a.id === exceptId) continue;
    for (const day of a.days ?? []) taken.add(day);
  }
  return taken;
}

/**
 * Whether a list can be saved, and what is wrong when it cannot.
 *
 * An alarm with no days at all is a one-off, which the band understands and
 * which cannot clash with anything, so it is allowed.
 */
export function validate(alarms) {
  const list = alarms ?? [];
  const errors = [];
  if (list.length > MAX_ALARMS) {
    errors.push(`ATLAS HOLDS ${MAX_ALARMS} ALARMS`);
  }
  const clashes = clashingDays(list);
  if (clashes.length) {
    errors.push(
      `${clashes.map((d) => DAY_NAMES[d]).join(", ")} HAS TWO ALARMS`
    );
  }
  for (const a of list) {
    if (!Number.isInteger(a?.hour) || a.hour < 0 || a.hour > 23) {
      errors.push("AN ALARM HAS NO VALID TIME");
      break;
    }
  }
  return { ok: errors.length === 0, errors, clashes };
}

/**
 * The alarm due on a given date, or null.
 *
 * An empty day list is a one-off and counts as due every day, which matches
 * how the band reads {@code REPEAT_ONCE} and how the service already treats it.
 */
export function alarmDueOn(alarms, date) {
  const day = date.getDay();
  for (const a of alarms ?? []) {
    if (!a?.enabled) continue;
    const days = a.days ?? [];
    if (days.length === 0 || days.includes(day)) return a;
  }
  return null;
}

/**
 * The time an alarm's face shows, which is not always the time it computes.
 *
 * An onset alarm hands the band the *latest* time the user was willing to
 * accept, because the strap is holding a backstop rather than the answer. This
 * is the same split `hardHour`/`hardMinute` make on the Java side and the two
 * must agree, or a re-arm puts a fixed alarm at the onset cap.
 */
export function hardTime(alarm) {
  if (!alarm) return null;
  const useLatest = alarm.mode === "onset" && alarm.latestHour != null;
  return {
    hour: useLatest ? alarm.latestHour : alarm.hour,
    minute: useLatest ? (alarm.latestMinute ?? 0) : alarm.minute,
  };
}

/**
 * The next alarm that will actually go off, and when.
 *
 * Walks forward a week from `now`, which is the only way to answer it when the
 * days are a mask: today's alarm may already have passed, and the next one may
 * be six days out.
 */
export function nextDue(alarms, now = new Date()) {
  for (let ahead = 0; ahead <= 7; ahead++) {
    const day = new Date(now);
    day.setDate(day.getDate() + ahead);
    const alarm = alarmDueOn(alarms, day);
    if (!alarm) continue;
    const time = hardTime(alarm);
    const at = new Date(day);
    at.setHours(time.hour, time.minute, 0, 0);
    if (at.getTime() <= now.getTime()) continue;
    return { alarm, at };
  }
  return null;
}

/**
 * The band slot an alarm owns.
 *
 * The list index, which means reordering the list would rewrite slots. Nothing
 * reorders it: alarms are appended and removed, and a removed one leaves its
 * slot to be reclaimed by the next add. That is deliberate - a slot is a
 * physical thing on the band, and shuffling them would silently write over
 * alarms the user did not touch.
 */
export function slotOf(alarms, id) {
  const at = (alarms ?? []).findIndex((a) => a?.id === id);
  return at < 0 ? null : at;
}

/**
 * The old single alarm as a list.
 *
 * Runs once, on the first read after the update. The old record has no `id`,
 * which is exactly how it is recognised.
 */
export function migrateSingle(old) {
  if (!old) return [];
  return [{ ...emptyAlarm("alarm-1"), ...old, id: old.id ?? "alarm-1" }];
}

/**
 * When the next alarm rings, in words.
 *
 * **The countdown is the useful half.** `NEXT` on its own repeats what the day
 * letters already imply; what nobody can work out at 23:00 on a Sunday is how
 * long they have got.
 *
 * Returns null when nothing will ring, so a caller renders nothing rather than
 * an empty row.
 */
export function describeNext(alarms, now = new Date()) {
  const due = nextDue(alarms, now);
  if (!due) return null;

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const dayMidnight = new Date(due.at);
  dayMidnight.setHours(0, 0, 0, 0);
  const daysAhead = Math.round((dayMidnight - midnight) / 86_400_000);

  let when;
  if (daysAhead === 0) when = "TODAY";
  else if (daysAhead === 1) when = "TOMORROW";
  else when = DAY_NAMES[due.at.getDay()];

  const totalMinutes = Math.max(0, Math.round((due.at - now) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  // Minutes alone under an hour, because "0H 45M" is a worse way of saying 45
  // minutes. Hours alone once it is far enough out that the minutes are noise.
  let gap;
  if (hours === 0) gap = `${mins}M`;
  else if (hours >= 24) gap = `${Math.round(hours / 24)}D`;
  else if (mins === 0) gap = `${hours}H`;
  else gap = `${hours}H ${mins}M`;

  return { alarm: due.alarm, at: due.at, when, gap, text: `${when} · IN ${gap}` };
}

/**
 * Which alarm owns a given day, for naming it rather than saying "another one".
 *
 * "Greyed days belong to another alarm" raises the question it does not answer.
 * This is what lets the panel say `MON-FRI BELONG TO YOUR 07:00 ALARM`.
 */
export function ownerOfDays(alarms, exceptId) {
  const owners = new Map();
  for (const a of alarms ?? []) {
    if (!a?.enabled || a.id === exceptId) continue;
    for (const day of a.days ?? []) owners.set(day, a);
  }
  return owners;
}

/**
 * A run of day numbers as people say it: `MON-FRI`, `SAT SUN`, `WED`.
 *
 * Monday-first, because a week reads that way even though the numbers are
 * Sunday-first. Contiguous runs of three or more collapse to a dash; anything
 * else is listed, since `SUN-MON` for a weekend is worse than naming both.
 */
export function describeDayRun(days) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const present = order.filter((d) => days.includes(d));
  if (!present.length) return "";
  const runs = [];
  let run = [present[0]];
  for (let i = 1; i < present.length; i++) {
    const prevAt = order.indexOf(present[i - 1]);
    if (order.indexOf(present[i]) === prevAt + 1) run.push(present[i]);
    else {
      runs.push(run);
      run = [present[i]];
    }
  }
  runs.push(run);
  return runs
    .map((r) =>
      r.length >= 3
        ? `${DAY_NAMES[r[0]]}-${DAY_NAMES[r[r.length - 1]]}`
        : r.map((d) => DAY_NAMES[d]).join(" ")
    )
    .join(" ");
}

/**
 * The list as the background service reads it.
 *
 * Fixed field order, `|` separated, alarms separated by `;`:
 * `hour|minute|enabled|mode|days|onsetHours|latestHour|latestMinute`.
 *
 * **Flat text rather than JSON, and `AlarmPlan.java` is the twin that parses
 * it.** `org.json` is an android.jar stub under plain JUnit, so a JSON plan
 * could not be unit tested on the Java side without a new dependency - and the
 * same argument `AlarmLog` makes applies, that this gets read by `run-as cat`
 * as often as by code. **Change this and change the Java parser.**
 *
 * Order is the slot order, so this must serialise the list as it stands rather
 * than sorting it: a slot is a physical thing on the band.
 */
export function serialisePlan(alarms) {
  return (alarms ?? [])
    .map((a) =>
      [
        a.hour ?? -1,
        a.minute ?? 0,
        a.enabled ? 1 : 0,
        a.mode ?? "fixed",
        (a.days ?? []).join(","),
        Number(a.onsetHours ?? 8).toFixed(1),
        a.latestHour ?? -1,
        a.latestMinute ?? 0,
      ].join("|")
    )
    .join(";");
}

/** What the closed settings row says. */
export function planSummary(alarms) {
  const on = (alarms ?? []).filter((a) => a?.enabled);
  if (!on.length) return "NONE SET";
  const times = on
    .map((a) => {
      const t = hardTime(a);
      return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
    })
    .sort();
  return times.join(" · ");
}
