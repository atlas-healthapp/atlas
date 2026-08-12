<template>
  <div v-if="geo" class="wrap">
    <!-- Tappable. Stepping a two-hour correction fifteen minutes at a time is
         eight taps; pointing at the place the line comes down is one. The
         stepper stays for the fine adjustment afterwards. -->
    <svg
      ref="svgEl"
      class="chart"
      :class="{ dragging }"
      :viewBox="`0 0 ${geo.width} ${geo.height}`"
      preserveAspectRatio="none"
      :style="{ height: `${geo.height}px` }"
      role="img"
      :aria-label="`Heart rate from ${clockLabel(geo.viewStart)} to ${clockLabel(geo.viewEnd)}`"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <!-- The chosen session, behind the line. Drawn as a band rather than by
           splitting the line in two: a split implies the reading stopped, and
           it did not. -->
      <rect
        class="band"
        :x="geo.bandStart"
        y="0"
        :width="Math.max(0, geo.bandWidth)"
        :height="geo.height"
      />
      <polyline class="line" :points="geo.line" vector-effect="non-scaling-stroke" />
      <line
        class="endline"
        :x1="geo.endX"
        y1="0"
        :x2="geo.endX"
        :y2="geo.height"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <div class="axis mono">
      <span>{{ clockLabel(geo.viewStart) }}</span>
      <span class="hi">TAP TO SET THE END</span>
      <span>{{ clockLabel(geo.viewEnd) }}</span>
    </div>
  </div>
  <div v-else class="empty mono">NO HEART RATE RECORDED AROUND THIS SESSION.</div>
</template>

<script setup>
import { computed, ref } from "vue";
import { heartGeometry, clockLabel, timeAtFraction } from "./sessionHeart";

const props = defineProps({
  samples: { type: Array, default: () => [] },
  startMillis: { type: Number, required: true },
  endMillis: { type: Number, required: true },
  height: { type: Number, default: 64 },
});
const emit = defineEmits(["pick-end"]);

const svgEl = ref(null);

const geo = computed(() =>
  heartGeometry(props.samples, {
    startMillis: props.startMillis,
    endMillis: props.endMillis,
    height: props.height,
  })
);

const dragging = ref(false);

/**
 * Where along the chart a pointer is, as a time.
 *
 * Measured against the rendered box rather than the viewBox: the chart is
 * stretched with preserveAspectRatio="none", so SVG user units are not pixels
 * and reading offsetX against the viewBox would be wrong by whatever the
 * stretch factor happens to be.
 */
function timeAt(event) {
  if (!geo.value || !svgEl.value) return null;
  const box = svgEl.value.getBoundingClientRect();
  if (!box.width) return null;
  return timeAtFraction(geo.value, (event.clientX - box.left) / box.width);
}

// A tap is a drag that never moved, so both go through the same path. Pointer
// capture is what keeps a drag alive once the finger leaves the chart: without
// it the move events stop at the edge and the handle sticks there.
function onPointerDown(event) {
  const t = timeAt(event);
  if (t == null) return;
  dragging.value = true;
  svgEl.value.setPointerCapture?.(event.pointerId);
  emit("pick-end", t);
}

function onPointerMove(event) {
  if (!dragging.value) return;
  // The sheet scrolls, and a horizontal drag on a chart inside it would
  // otherwise scroll the page instead of moving the handle.
  event.preventDefault();
  const t = timeAt(event);
  if (t != null) emit("pick-end", t);
}

function onPointerUp(event) {
  if (!dragging.value) return;
  dragging.value = false;
  svgEl.value?.releasePointerCapture?.(event.pointerId);
}
</script>

<style scoped>
.wrap {
  margin-top: 12px;
}
.chart {
  display: block;
  width: 100%;
  overflow: visible;
}
.chart {
  cursor: pointer;
  /* The line is 64px tall, which is a small target for a fingertip, so the tap
     area is extended above and below without moving the drawing. */
  padding: 10px 0;
  margin: -10px 0;
  /* Claims horizontal gestures so a drag along the chart moves the handle
     instead of scrolling the sheet underneath it. */
  touch-action: pan-y;
}
.chart.dragging {
  cursor: grabbing;
}
.band {
  fill: color-mix(in srgb, var(--fam-activity) 16%, transparent);
}
.line {
  fill: none;
  stroke: var(--fam-activity);
  stroke-width: 1.4;
  stroke-linejoin: round;
  stroke-linecap: round;
}
/* The handle you are effectively dragging with the stepper. Solid, because it
   is the one thing on the chart that answers the question. */
.endline {
  stroke: var(--ink);
  stroke-width: 1.5;
  stroke-dasharray: 3 3;
}
.axis {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 5px;
  font-size: 9.5px;
  letter-spacing: 0.8px;
  color: var(--dim);
}
.axis .hi {
  color: var(--fam-activity);
}
.empty {
  margin-top: 12px;
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--dim);
}
</style>
