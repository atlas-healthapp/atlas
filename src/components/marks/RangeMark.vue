<template>
  <div v-if="geo" class="wrap">
  <svg
    class="range"
    :viewBox="`0 0 100 ${height}`"
    preserveAspectRatio="none"
    :style="{ height: `${height}px` }"
    aria-hidden="true"
  >
    <!-- The usual range, as a segment of the axis rather than as the axis. -->
    <rect
      :x="geo.bandStart"
      :y="axisY - 1.5"
      :width="geo.bandWidth"
      height="3"
      rx="1.5"
      :fill="color"
      fill-opacity="0.24"
    />
    <line
      x1="0"
      :y1="axisY"
      x2="100"
      :y2="axisY"
      :stroke="color"
      stroke-opacity="0.18"
      stroke-width="1"
      vector-effect="non-scaling-stroke"
    />
    <!-- Every prior reading in the window, so the range has visible evidence
         behind it. Turn `rug` off for the plainer version. -->
    <template v-if="rug">
      <line
        v-for="x in geo.rug"
        :key="x"
        :x1="x"
        :y1="axisY + height * 0.08"
        :x2="x"
        :y2="axisY + height * 0.3"
        :stroke="color"
        stroke-opacity="0.4"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
    </template>
    <line
      v-if="geo.baselineX != null"
      :x1="geo.baselineX"
      :y1="axisY - height * 0.16"
      :x2="geo.baselineX"
      :y2="axisY + height * 0.16"
      :stroke="color"
      stroke-opacity="0.55"
      stroke-width="1"
      vector-effect="non-scaling-stroke"
    />
    <!-- Today, standing above the line rather than sitting on it. A dot on a
         rounded track is a slider, and this is not draggable. -->
    <path :d="caret" :fill="markColor" />
  </svg>

  <!-- The ends of the range, under the ends of the range.
       They used to sit at the far edges of the row, which asserted that the
       axis ran from one to the other when it does not: the axis is the whole
       window and the range is a segment of it. So the coloured section looked
       shorter than the numbers said it was, and nothing on screen explained
       what it actually spanned. Positioned here, the numbers label the thing
       they belong to and the mark reads without a caption. -->
  <div v-if="lowLabel || highLabel" class="ends mono">
    <span :style="edgeStyle(geo.bandStart)">{{ lowLabel }}</span>
    <span :style="edgeStyle(geo.bandStart + geo.bandWidth)">{{ highLabel }}</span>
  </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { rangeGeometry } from "@/components/marks/markGeometry";

// A metric with no target, only a personal normal. Replaced BaselineBand on
// 2026-08-05: see rangeGeometry for why the old one drew the same picture for
// every reading, which is the defect this exists to fix.
//
// Renders nothing at all until a range exists. A band computed from three
// nights looks identical to one computed from thirty while meaning far less,
// so the row shows its bare value instead until the window fills.
const props = defineProps({
  value: { type: Number, default: null },
  low: { type: Number, default: null },
  high: { type: Number, default: null },
  /** The personal normal, ticked on the axis. */
  baseline: { type: Number, default: null },
  /** The readings before today, which set the axis. */
  series: { type: Array, default: () => [] },
  color: { type: String, default: "var(--acc)" },
  height: { type: Number, default: 18 },
  /**
   * The window's readings as ticks under the axis. Off by default: they are
   * placed by value rather than by date, so they bunch where you land often
   * and gap where you rarely do, and with nothing on screen saying the axis is
   * values that clustering reads as randomness rather than as a distribution.
   * The band and the caret already carry the finding without it.
   */
  rug: { type: Boolean, default: false },
  /** Printed under the ends of the range. Omitted at row size, where there is
      no room and the value beside the row carries the number. */
  lowLabel: { type: String, default: "" },
  highLabel: { type: String, default: "" },
});

/**
 * A label sits under the edge it names, pulled back inside the box at the
 * extremes so it cannot hang off the side of the phone.
 */
function edgeStyle(pct) {
  const x = Math.max(0, Math.min(100, pct));
  return {
    left: `${x}%`,
    transform: `translateX(${x < 12 ? "0" : x > 88 ? "-100%" : "-50%"})`,
  };
}

const geo = computed(() =>
  rangeGeometry(props.value, {
    low: props.low,
    high: props.high,
    baseline: props.baseline,
    series: props.series,
  })
);

// Low in the box, because the caret needs the room above it.
const axisY = computed(() => props.height * 0.68);

const caret = computed(() => {
  if (!geo.value) return "";
  const x = geo.value.valueX;
  const y = axisY.value;
  const top = y - props.height * 0.52;
  const tip = y - props.height * 0.14;
  return `M${(x - 3.2).toFixed(2)} ${top.toFixed(2)} L${x.toFixed(2)} ${tip.toFixed(2)} L${(x + 3.2).toFixed(2)} ${top.toFixed(2)} Z`;
});

// Outside the range gets a colour change as well as a position, so a reading
// worth noticing is never signalled by position alone.
const markColor = computed(() => (geo.value?.outside ? "var(--bad)" : props.color));
</script>

<style scoped>
.wrap {
  position: relative;
}
.range {
  display: block;
  width: 100%;
  overflow: visible;
}
.ends {
  position: relative;
  height: 13px;
  margin-top: 5px;
}
.ends span {
  position: absolute;
  white-space: nowrap;
  font-size: 13px;
  letter-spacing: 1.2px;
  color: var(--dim);
}
</style>
