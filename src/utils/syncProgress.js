/**
 * How far through a long save we are, said calmly.
 *
 * **Why a percentage rather than a count.** Both the sync and the drain used to
 * report `SAVING · 10234 OF 190450`. Reported as alarming, and fairly: six
 * digits against six digits reads as a machine struggling, the numbers change
 * too fast to follow, and the only thing anybody actually wants from it is
 * whether it is nearly done.
 *
 * A running count with no total is a different case and stays as it is:
 * `READING SAMPLES · 8412` is the band handing things over with no known end,
 * and there is no percentage to give. It also tops out around ten thousand,
 * where the figure is still legible. It is the six-digit denominator that made
 * this look like a fault.
 */

/**
 * @param prefix what the app is doing, already in the app's voice ("SAVING").
 * @returns `SAVING · 42%`, or just the prefix when there is no honest fraction.
 */
export function progressLabel(prefix, done, total) {
  const d = Number(done);
  const t = Number(total);
  // No total, no fraction. Saying 0% or 100% here would both be claims about a
  // denominator nobody has.
  if (!Number.isFinite(d) || !Number.isFinite(t) || t <= 0) return prefix;
  // Clamped, because a total that shifts mid-run (a second batch arriving) must
  // not print 104%.
  const pct = Math.max(0, Math.min(100, Math.round((d / t) * 100)));
  return `${prefix} · ${pct}%`;
}
