// Pure formatting for the SESSIONS card. Workouts live outside BODY_METRICS
// entirely - they are discrete sessions, not a scalar-per-day rollup, so they
// get their own small module rather than being forced into the metric-row
// shape utils/metricRow.js provides.

import { fmtHoursMins } from "@/utils/date";

const TIME_FMT = { hour: "numeric", minute: "2-digit" };
const DAY_FMT = { weekday: "short", day: "numeric", month: "short" };

export function workoutDateTimeLabel(startMillis) {
  const d = new Date(startMillis);
  const dateKey = d.toLocaleDateString("sv");
  const isToday = dateKey === new Date().toLocaleDateString("sv");
  const day = isToday
    ? "TODAY"
    : d.toLocaleDateString("en-AU", DAY_FMT).toUpperCase();
  const time = d.toLocaleTimeString("en-AU", TIME_FMT);
  return `${day}, ${time}`;
}

/**
 * Just the day, for the session list's label column.
 *
 * The full date-and-time label is 20-odd characters and wrapped to three lines
 * in a 94px column, which turned the list into a wall. The time moves to the
 * line underneath, where there is room for it.
 */
export function workoutDayLabel(startMillis) {
  const d = new Date(startMillis);
  const dateKey = d.toLocaleDateString("sv");
  const now = new Date();
  if (dateKey === now.toLocaleDateString("sv")) return "TODAY";
  now.setDate(now.getDate() - 1);
  if (dateKey === now.toLocaleDateString("sv")) return "YESTERDAY";
  return d
    .toLocaleDateString("en-AU", { weekday: "short", day: "numeric" })
    .toUpperCase()
    .replace(",", "");
}

export function workoutTimeLabel(startMillis) {
  return new Date(startMillis).toLocaleTimeString("en-AU", TIME_FMT).toUpperCase();
}

export function workoutDurationLabel(activeSeconds) {
  if (activeSeconds == null) return "—";
  return fmtHoursMins(activeSeconds / 3600);
}

// The row's secondary line. Never claims a category the type byte cannot
// actually support - see docs/backlog.md: every real session on this band so
// far carries the same unrecognised auto-detected type code, so what is
// genuinely known is duration/calories/HR, not "run" or "climb".
export function workoutStatsLabel(w) {
  const parts = [];
  if (w.caloriesKcal != null) parts.push(`${Math.round(w.caloriesKcal)} KCAL`);
  if (w.hrAvg != null) parts.push(`${Math.round(w.hrAvg)} AVG HR`);
  if (w.distanceMeters != null) {
    parts.push(`${(w.distanceMeters / 1000).toFixed(2)} KM`);
  }
  return parts.join(" · ");
}
