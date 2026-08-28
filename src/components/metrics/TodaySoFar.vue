<template>
  <div>
    <div class="plotwrap">
    <svg
      class="plotbox"
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <!-- The days around today, as a 25th-to-75th band. Drawn first so
           everything else sits over it. -->
      <path v-if="geo.band" :d="geo.band" :fill="color" opacity="0.13" />

      <!-- The axis, then its ticks. The line is what stops the band appearing to
           float when the early hours are all near zero. -->
      <line :x1="0" :x2="W" :y1="geo.axisY" :y2="geo.axisY" class="axis" />
      <line
        v-for="t in geo.ticks"
        :key="t.h"
        :x1="t.x"
        :x2="t.x"
        :y1="geo.axisY"
        :y2="geo.axisY + 2.4"
        class="axis"
      />

      <path v-if="geo.median" :d="geo.median" class="median" fill="none" />

      <!-- The target. Ink rather than the family colour, because it is not a
           reading and everything else on this chart is. -->
      <line
        v-if="geo.goalY != null"
        :x1="0"
        :x2="W"
        :y1="geo.goalY"
        :y2="geo.goalY"
        class="goal"
      />

      <path v-if="geo.today" :d="geo.today" :stroke="color" class="today" fill="none" />
      <path
        v-if="geo.projection"
        :d="geo.projection"
        :stroke="color"
        class="projection"
        fill="none"
      />
    </svg>

    <!-- The dots are HTML over the plot, not SVG inside it: the chart is
         stretched with preserveAspectRatio="none", which would draw an oval
         wherever a circle was meant. Same reason the y labels are HTML on every
         other chart in this app.

         **They sit inside the plot's own box.** A percentage `top` resolves
         against the positioned parent's height, so an overlay of height zero
         put every dot at the top of the card, on the goal line - which read as
         the goal being annotated. -->
      <span
        class="nowdot"
        :style="{
          left: `${(geo.now.x / W) * 100}%`,
          top: `${(geo.now.y / H) * 100}%`,
          background: color,
        }"
      ></span>
      <span
        v-if="geo.end"
        class="enddot"
        :style="{
          left: `${(geo.end.x / W) * 100}%`,
          top: `${(geo.end.y / H) * 100}%`,
          borderColor: color,
        }"
      ></span>
    </div>

    <div class="hours mono">
      <span v-for="t in geo.ticks" :key="t.h">{{ t.label }}</span>
    </div>

    <div class="key mono">
      <span><i :style="{ background: color }"></i>TODAY</span>
      <span v-if="model.band"><i class="dash"></i>USUAL</span>
      <span v-if="model.goal"><i class="goalkey"></i>GOAL</span>
    </div>
  </div>
</template>

<script setup>
/**
 * Today's steps against the shape your own days usually make.
 *
 * **What it is for.** The page led with a total against a target and nothing
 * else, so 1,456 against 8,000 read as 18% of a bad day. Measured on the real
 * archive it was the opposite: the median by that hour was 519. A total with no
 * sense of the hour cannot tell a slow day from an early one.
 *
 * All the arithmetic is in `intradaySteps.js` and all the geometry in
 * `todayChart.js`, both tested. What is left here is markup, which in this repo
 * can only be checked by running it.
 */
import { computed } from "vue";
import { stepsChart } from "@/components/metrics/todayChart";

const props = defineProps({
  /** Whatever `intradayModel` returned. */
  model: { type: Object, required: true },
  color: { type: String, default: "var(--acc)" },
});

const W = 100;
const H = 46;

const geo = computed(() => stepsChart(props.model, { width: W, height: H, padBottom: 5 }));
</script>

<style scoped>
.plotwrap {
  position: relative;
  height: 128px;
}
.plotbox {
  display: block;
  width: 100%;
  height: 100%;
}
.axis {
  stroke: var(--dim);
  stroke-width: 0.3;
  opacity: 0.35;
}
/* Dashed, because it is a median of fourteen days rather than a reading, and a
   solid second line beside today's would read as another measurement. */
.median {
  stroke: var(--dim);
  stroke-width: 0.5;
  stroke-dasharray: 1.6 1.2;
  vector-effect: non-scaling-stroke;
}
.goal {
  stroke: var(--ink);
  stroke-width: 0.5;
  stroke-dasharray: 2.4 1.6;
  opacity: 0.8;
  vector-effect: non-scaling-stroke;
}
/* `vector-effect` on every stroke, or preserveAspectRatio="none" gives a
   horizontal line and a vertical one different weights. */
.today {
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.projection {
  stroke-width: 1.2;
  stroke-dasharray: 1 2.4;
  opacity: 0.75;
  vector-effect: non-scaling-stroke;
}

.nowdot,
.enddot {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.enddot {
  background: var(--bg1);
  border: 1.5px solid;
  width: 7px;
  height: 7px;
}

.hours {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  color: var(--dim);
}

.key {
  display: flex;
  gap: 14px;
  margin-top: 10px;
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  color: var(--dim);
}
.key i {
  display: inline-block;
  width: 13px;
  height: 3px;
  border-radius: 2px;
  margin-right: 6px;
  vertical-align: middle;
}
.key i.dash {
  background: repeating-linear-gradient(
    90deg,
    var(--dim) 0 4px,
    transparent 4px 7px
  );
}
.key i.goalkey {
  background: repeating-linear-gradient(
    90deg,
    var(--ink) 0 5px,
    transparent 5px 8px
  );
}
</style>
