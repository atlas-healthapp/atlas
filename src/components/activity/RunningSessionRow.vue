<!--
  The session running right now, on whichever tab you are looking at.

  **Every tab, not just Home** (2026-08-19). It started as a Home row on the
  reasoning that the shade answers "is it still running" without opening the app.
  That is true and it is not the whole job: inside the app, a session that is
  invisible on three of the four tabs is a session you can forget you started,
  and forgetting is the failure mode this feature has no auto-stop for. So it
  goes under the header line, which is the one piece of furniture every tab
  shares.

  One component, mounted twice, rather than markup in `AppHeader` and again in
  `HomeTab`: those two deliberately do not share structure (Home's header types
  itself during boot and carries a second line), and a row copied into both is
  precisely the drift `AppHeader` was extracted to stop.
-->
<template>
  <button v-if="sessions.running" class="runrow mono" type="button" @click="open">
    <span class="runpip" aria-hidden="true"></span>
    <span class="runwhat">{{ label }}</span>
    <span class="runel">{{ elapsed }}</span>
  </button>
</template>

<script setup>
import { computed, onUnmounted, ref, watch } from "vue";
import { useSessionsStore } from "@/stores/sessions";
import { useUIStore } from "@/stores/ui";

const sessions = useSessionsStore();
const ui = useUIStore();

/**
 * **No status word after the name.** This read `INDOOR CLIMBING RUNNING`, and
 * "running" after an activity name parses as the activity: a running session
 * rather than a session that is running. The live pip and the counting clock
 * already say it is in progress, so the word was carrying no meaning it had not
 * already lost. An untyped session has nothing else to say, so it says the one
 * thing it knows.
 */
const label = computed(() => {
  const name = sessions.typeById(sessions.running?.typeId)?.name;
  return name ? name.toUpperCase() : "SESSION IN PROGRESS";
});

const now = ref(Date.now());
let timer = null;

const seconds = computed(() =>
  sessions.running
    ? Math.max(0, Math.floor((now.value - sessions.running.startMillis) / 1000))
    : 0
);

/**
 * **Seconds for the first minute, then minutes.**
 *
 * A row that reads `0M` for the first sixty seconds after you press START looks
 * like a row that did not work, which is the one moment you are watching it to
 * find out whether it did. After that nobody is reading this to the second and
 * a per-second tick is a re-render a minute would have covered.
 */
const elapsed = computed(() => {
  const s = seconds.value;
  if (s < 60) return `${s}S`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}M`;
  return `${Math.floor(m / 60)}H ${String(m % 60).padStart(2, "0")}M`;
});

/**
 * The tick rate follows the label: every second while it is showing seconds,
 * every fifteen after that. Home runs a `requestAnimationFrame` boot sequence
 * that a needless re-render every second would compete with, and this component
 * is mounted on Home too.
 */
function schedule() {
  clearInterval(timer);
  timer = null;
  if (!sessions.running) return;
  now.value = Date.now();
  const fast = seconds.value < 60;
  timer = setInterval(() => {
    now.value = Date.now();
    // Crossing the minute changes the rate, so the fast timer retires itself
    // rather than running for the whole session.
    if (fast && seconds.value >= 60) schedule();
  }, fast ? 1000 : 15_000);
}

watch(() => Boolean(sessions.running), schedule, { immediate: true });
onUnmounted(() => clearInterval(timer));

function open() {
  ui.openCreateSheet("add-activity");
}
</script>

<style scoped>
/* ACTIVITY teal because a session is an ACTIVITY thing, and 44px because that is
   the floor every tappable row in Atlas is held to. Its own surface rather than
   a card, since on Home it sits between the dials and the card stack and must
   not read as a sixth card. */
.runrow {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  margin-bottom: 12px;
  padding: 0 13px;
  background: color-mix(in srgb, var(--fam-activity) 11%, transparent);
  border: 1px solid color-mix(in srgb, var(--fam-activity) 34%, transparent);
  border-radius: 10px;
  color: var(--ink);
  font-size: var(--fs-label);
  letter-spacing: 0.09em;
  cursor: pointer;
}
.runwhat {
  text-transform: uppercase;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.runel {
  margin-left: auto;
  padding-left: 10px;
  color: var(--fam-activity);
  font-variant-numeric: tabular-nums;
}
/* Slow, and off entirely under reduced motion: on Home this shares a screen
   with the boot sequence, and a second thing moving competes with it. */
.runpip {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--fam-activity);
  animation: runpulse 2.6s ease-out infinite;
}
@keyframes runpulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--fam-activity) 55%, transparent);
  }
  70% {
    box-shadow: 0 0 0 7px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}
@media (prefers-reduced-motion: reduce) {
  .runpip {
    animation: none;
  }
}
</style>
