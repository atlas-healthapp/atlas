<!--
  A short tour that points at things.

  **Built because a contextual prompt cannot solve the problem it was chosen to
  solve.** A prompt appears on a screen you have already found; nothing anywhere
  said "the app has settings, and they are behind your initials in the corner",
  which is exactly where this got stuck in use (2026-08-12). No number of
  prompts closes that, because the thing being missed is a way in.

  It points rather than describes: each step measures a real element and cuts a
  hole in the dimmer over it, so the target is the actual control rather than a
  drawing of it. A step whose target is not on screen is skipped rather than
  pointed at nothing, which is what makes it safe to run on a tab that has not
  been built yet.

  Replayable from Settings, because a tour you cannot re-run is one people skip
  in a hurry and never see again, and "how do I get back to that" is the same
  complaint one level up.
-->
<template>
  <Teleport to="body">
    <div v-if="current" class="tour" @click="next">
      <!-- One element does the dimming and the hole at once: an enormous
           spread shadow paints everything outside the box. Four separate
           dimming panels around a cutout is the obvious approach and it
           seams visibly at the corners on a real device. -->
      <div
        class="hole"
        :style="{
          top: box.top + 'px',
          left: box.left + 'px',
          width: box.width + 'px',
          height: box.height + 'px',
          borderRadius: current.radius ?? '10px',
        }"
      ></div>

      <div class="card" :style="cardStyle" @click.stop>
        <div class="count mono">{{ index + 1 }} / {{ steps.length }}</div>
        <div class="title mono">{{ current.title }}</div>
        <p class="body">{{ current.body }}</p>
        <div class="acts">
          <button class="skip mono" @click="finish">SKIP</button>
          <button class="next mono" @click="next">
            {{ index === steps.length - 1 ? "DONE" : "NEXT" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps({
  /** `[{ target, title, body, radius? }]`, target being a CSS selector. */
  steps: { type: Array, required: true },
});
const emit = defineEmits(["close"]);

const index = ref(0);
const box = ref({ top: 0, left: 0, width: 0, height: 0 });
const viewport = ref({ w: 0, h: 0 });

const current = computed(() => props.steps[index.value] ?? null);

/**
 * Above the target or below it, whichever has room.
 *
 * Measured against the target rather than fixed, because the two things most
 * worth pointing at sit at opposite ends of the screen: the profile chip is in
 * the top right and the create button is in the tab bar.
 */
const CARD_H = 170;

const cardStyle = computed(() => {
  const b = box.value;
  const vh = viewport.value.h;
  const below = b.top + b.height + 14;
  const above = b.top - 14;
  // Fits under the target, then over it, then pinned to the bottom. The third
  // case is not hypothetical: the last step highlights a whole settings page, so
  // there is no "beside" at all, and without this the card sat above the top of
  // the screen with only its bottom edge showing.
  if (below + CARD_H < vh) return { top: `${below}px` };
  if (above - CARD_H > 0) return { bottom: `${vh - above}px` };
  return { bottom: "16px" };
});

/**
 * How long a target gets to appear before its step is given up on.
 *
 * **Not zero, and this was measured rather than guessed.** The tour opens the
 * instant the boot animation ends, and Home mounts its profile chip a tick
 * later, so a single-frame check skipped step one - the step this whole feature
 * exists for - every single time. Half a second is far longer than a mount and
 * still short enough that a genuinely absent target does not stall the tour.
 */
const TARGET_WAIT_MS = 500;
let waitingSince = 0;

function measure() {
  viewport.value = { w: window.innerWidth, h: window.innerHeight };
  const step = current.value;
  if (!step) return;
  // A step may need a screen opened before it has anything to point at.
  if (step.open) step.open();
  // A step may name several things. The hole is then their union, which is how
  // "all of these are tappable" gets pointed at without wrapping four sibling
  // cards in a div that exists only for the tour.
  const els = step.target
    .split(",")
    .map((sel) => document.querySelector(sel.trim()))
    .filter(Boolean);
  const el = els[0];
  if (!el) {
    if (!waitingSince) waitingSince = performance.now();
    if (performance.now() - waitingSince < TARGET_WAIT_MS) {
      requestAnimationFrame(measure);
      return;
    }
    // Genuinely not there. Skipping beats a hole in the middle of the screen
    // with a caption about a control that does not exist.
    waitingSince = 0;
    advance();
    return;
  }
  waitingSince = 0;
  const pad = step.pad ?? 6;
  const rects = els.map((e) => e.getBoundingClientRect());
  const top = Math.min(...rects.map((r) => r.top));
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  // Clipped to the viewport: a card running below the fold would otherwise push
  // the hole off screen and take the callout with it.
  const bottom = Math.min(window.innerHeight - 12, Math.max(...rects.map((r) => r.bottom)));
  box.value = {
    top: top - pad,
    left: left - pad,
    width: right - left + pad * 2,
    height: Math.max(0, bottom - top) + pad * 2,
  };
}

function advance() {
  if (index.value >= props.steps.length - 1) {
    finish();
    return;
  }
  index.value += 1;
  requestAnimationFrame(measure);
}

function next() {
  advance();
}

function finish() {
  emit("close");
}

onMounted(() => {
  requestAnimationFrame(measure);
  window.addEventListener("resize", measure);
});
onBeforeUnmount(() => window.removeEventListener("resize", measure));
</script>

<style scoped>
.tour {
  position: fixed;
  inset: 0;
  z-index: 900;
}
.hole {
  position: absolute;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.78);
  border: 1.5px solid var(--acc);
  pointer-events: none;
  transition: all 180ms ease;
}
.card {
  position: absolute;
  left: 16px;
  right: 16px;
  padding: 15px 16px 13px;
  background: var(--bg1);
  border: 1px solid color-mix(in srgb, var(--acc) 40%, transparent);
  border-radius: 10px;
  color: var(--body);
}
.count {
  font-size: 13px;
  letter-spacing: 2px;
  color: var(--dim);
}
.title {
  margin-top: 4px;
  font-size: 14px;
  letter-spacing: 1.6px;
  color: var(--acc);
}
.body {
  margin: 7px 0 0;
  font-size: 15px;
  line-height: 1.5;
}
.acts {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}
.skip,
.next {
  min-height: 40px;
  padding: 0 14px;
  background: none;
  border: 0;
  font-size: 13.5px;
  letter-spacing: 1.8px;
  cursor: pointer;
}
.skip {
  color: var(--dim);
}
.next {
  color: var(--acc);
  border: 1px solid color-mix(in srgb, var(--acc) 50%, transparent);
  border-radius: 6px;
}
</style>
