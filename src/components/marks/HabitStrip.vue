<template>
  <div class="strip" aria-hidden="true">
    <i v-for="d in days" :key="d.date" :class="d.state" :style="dotStyle(d.state)"></i>
  </div>
</template>

<script setup>
// A binary thing over time: one dot per day, oldest left, today at the right,
// the same direction every chart in the app runs.
//
// The other marks all describe one reading. This one exists because a habit's
// rate says 71% while the pattern says whether it is 71% steady or 71% because
// last fortnight collapsed, and those are different findings.
//
// Laid out with flex rather than an SVG viewBox, matching GoalDots: a scaled
// viewBox would grow the dots along with the gaps, and at thirty of them the
// dots have to stay small while only the spacing stretches.
const props = defineProps({
  // [{ date, state }] from habitRows.js - hit / miss / due / off.
  days: { type: Array, required: true },
  color: { type: String, default: "var(--acc)" },
});

// Only the two states that carry the family colour take an inline style. A
// missed or not-due day is deliberately grey, and an inline colour would
// outrank the rule that makes it so.
function dotStyle(state) {
  if (state === "hit") return { background: props.color, borderColor: props.color };
  if (state === "due") return { borderColor: props.color };
  return null;
}
</script>

<style scoped>
.strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.strip i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1.2px solid transparent;
  box-sizing: border-box;
  flex-shrink: 0;
}
/* Today, still open: a ring in the family colour. It has to read as different
   from a miss, because the day has not been missed yet. */
.strip i.due {
  opacity: 0.85;
}
.strip i.miss {
  border-color: var(--dim);
  opacity: 0.55;
}
/* A day the habit was not due, or did not exist yet. Kept in place rather than
   dropped so the pitch stays a calendar: a strip that closed its gaps would
   put a Monday-only habit's dots under the wrong days. */
.strip i.off {
  background: var(--dim);
  border-color: transparent;
  opacity: 0.22;
  transform: scale(0.45);
}
</style>
