/**
 * Reading the background service's morning log.
 *
 * The service writes one flat record per morning (see `AlarmLog.java`) because
 * the same string has to be readable by a person over `run-as cat` and pasteable
 * into a bug report. This turns one of those records into something a screen can
 * render, and nothing more: no judgement lives here that the service did not
 * already make.
 *
 * **Why the app cannot compute any of this itself.** The decision happens at
 * 08:40 while the phone is asleep and the WebView does not exist. Everything on
 * this screen is a report of something already decided, which is exactly why it
 * has to be recorded at the time rather than derived later.
 */

/** The band's own stage vocabulary, matching `huamiSleep.js`'s `STAGE_CODES`. */
const STAGE_NAMES = { 4: "LIGHT", 5: "DEEP", 7: "AWAKE", 8: "REM" };

/**
 * A day key back into a date.
 *
 * The service stamps `YEAR-DAYOFYEAR` because that is what `Calendar` hands it
 * and it needs no formatting on a phone with an unknown locale. Day 1 is
 * 1 January, so the offset is one day short of the day number.
 */
export function dateFromDayKey(key) {
  const [year, dayOfYear] = String(key ?? "").split("-");
  const y = Number(year);
  const d = Number(dayOfYear);
  if (!Number.isFinite(y) || !Number.isFinite(d) || d < 1 || d > 366) return null;
  const at = new Date(y, 0, 1);
  at.setDate(at.getDate() + (d - 1));
  return at;
}

/** One record into fields. Unknown keys are kept, so a newer service still reads. */
export function parseMorning(record) {
  const parts = String(record ?? "").split("|");
  const out = { day: parts[0] ?? "", date: dateFromDayKey(parts[0]) };
  for (const part of parts.slice(1)) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at)] = part.slice(at + 1);
  }
  return out;
}

/** The stage the band had them in, as a word. */
export function stageName(code) {
  const n = Number(code);
  if (!Number.isFinite(n) || n < 0) return null;
  return STAGE_NAMES[n] ?? `STAGE ${n}`;
}

/**
 * What happened that morning, in the four terms that were actually asked for:
 * did it fire, what stage, what was set against when it went off, and whether
 * it was smart at all.
 *
 * `outcome` is a key rather than a sentence so the caller decides the wording
 * and the colour; `reason` is the part only the service could know.
 */
export function describeMorning(record) {
  const m = typeof record === "string" ? parseMorning(record) : record;
  const fired = m.fired ?? null;
  const stage = stageName(m.stage);
  const stale = Number(m.stale);
  const sessions = Number(m.sessions);

  let outcome = "watched";
  let reason = "";

  if (fired) {
    outcome = m.ack === "ok" ? "fired" : "fired-unconfirmed";
    reason =
      m.ack === "ok"
        ? `Woke you early in ${stage ? stage.toLowerCase() : "a wakeable"} sleep.`
        : "Atlas wrote the early wake but the strap never confirmed it.";
  } else if (m.mode && m.mode !== "smart") {
    outcome = "not-watching";
    // Both other modes ring the time on the strap's own face. Nothing is wrong
    // on these mornings and the readout must not imply there is.
    reason =
      m.mode === "onset"
        ? "Set for a fixed time after you fell asleep, so no early wake was looked for."
        : "A fixed alarm, rung by the strap itself.";
  } else if (!m.checks) {
    outcome = "never-looked";
    reason = "The window was never checked. That is a fault worth reporting.";
  } else if (Number.isFinite(sessions) && sessions === 0) {
    outcome = "no-data";
    reason = "The strap handed over no sleep at all, so there was nothing to read.";
  } else if (!stage) {
    outcome = "stale";
    reason = Number.isFinite(stale)
      ? `The strap's newest reading was ${stale} minutes old, too old to describe the moment.`
      : "The strap's sleep record could not be read.";
  } else {
    outcome = "not-wakeable";
    reason = `You were in ${stage.toLowerCase()} sleep, which Atlas will not wake you out of.`;
  }

  return {
    ...m,
    outcome,
    reason,
    stageName: stage,
    // The two times the question is really about, side by side.
    setFor: m.set ?? null,
    firedAt: fired,
    smart: m.mode === "smart",
  };
}

/** Newest first, which is the order anybody wants to read them in. */
export function describeMornings(records) {
  return (records ?? [])
    .map((r) => describeMorning(r))
    .sort((a, b) => String(b.day).localeCompare(String(a.day), undefined, { numeric: true }));
}

/**
 * The whole log as one block of text to paste into a report.
 *
 * Deliberately the **raw records** under a short header rather than the
 * rendered sentences: the person receiving it needs what the service actually
 * wrote, and a paraphrase of a diagnostic is not a diagnostic. Carries no
 * identity of any kind - there is nothing in a morning record but times and
 * stage codes.
 */
export function alarmReport({ mornings, mode, enabled, hour, minute, version } = {}) {
  const lines = [];
  lines.push(`ATLAS ALARM LOG${version ? ` ${version}` : ""}`);
  const time =
    Number.isFinite(hour) && hour >= 0
      ? `${String(hour).padStart(2, "0")}:${String(minute ?? 0).padStart(2, "0")}`
      : "not set";
  lines.push(`now: ${enabled ? "on" : "off"} ${mode ?? "?"} ${time}`);
  lines.push(`mornings: ${(mornings ?? []).length}`);
  lines.push("");
  for (const record of mornings ?? []) lines.push(record);
  return lines.join("\n");
}
