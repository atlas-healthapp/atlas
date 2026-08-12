export function today() {
  // Swedish locale reliably returns YYYY-MM-DD in local time (toISOString is UTC, wrong in AEST)
  return new Date().toLocaleDateString("sv");
}

export function fmtHoursMins(hours) {
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  // "10h 07m", not "10H07". The unlabelled second number read as a clock time,
  // so a ten hour night looked like seven minutes past ten. Lower case because
  // these sit among sentence-case values, not among the mono labels.
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}

export function fmtTime(hhmm) {
  // "19:00" -> "7:00 PM" style display, single formatter so it never gets inlined per-component
  const [h, m] = hhmm.split(":").map(Number);
  const dt = new Date();
  dt.setHours(h, m, 0, 0);
  return dt.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

/**
 * "11 AUG", the label under the end of a history chart.
 *
 * Shared because every history chart is now trimmed to where its readings start,
 * so the fixed labels those axes used to carry ("30 DAYS AGO") name a day that
 * is no longer drawn, and four pages needed the same formatter at once.
 */
export function fmtAxisDate(dateKey) {
  if (!dateKey) return "";
  return new Date(`${dateKey}T00:00:00`)
    .toLocaleDateString("en-AU", { day: "numeric", month: "short" })
    .toUpperCase();
}

export function uid() {
  return String(Date.now()) + String(Math.floor(Math.random() * 1e6));
}

export function addDays(d, n) {
  const dt = new Date(d + "T12:00:00");
  dt.setDate(dt.getDate() + n);
  return dt.toLocaleDateString("sv");
}
