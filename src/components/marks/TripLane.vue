<template>
  <!-- Behind the data: the band is the ground showing through, not a series. -->
  <div v-if="gaps.length" class="gaps" :style="{ left: `${insetLeft}px`, bottom: `${LANE}px` }">
    <div
      v-for="(g, i) in gaps"
      :key="`${g.tripId}-${i}`"
      class="gap"
      :style="{ left: `${g.box.x}%`, width: `${g.box.width}%` }"
    ></div>
  </div>

  <div v-if="reach.length" class="rules" :style="{ left: `${insetLeft}px`, height: `${LANE}px` }">
    <div
      v-for="r in placedReach"
      :key="r.tripId"
      class="triprule"
      :style="{ left: `${r.box.x}%`, width: `${r.box.width}%` }"
    >
      <!-- The rule always draws; only its name stands down when two would
           collide. The rule is the fact, the label is what it is called. -->
      <span v-if="r.showLabel" class="rulelab mono">{{ r.label }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { placeTripLabels } from "@/utils/tripSpans";
// Where you were away, on a history chart.
//
// **Two marks, because they say two different things.** The rule under the axis
// says *you were away* and spans every day of the trip. The dim band says *and
// nothing was recorded*, and covers only the days that are actually empty.
//
// Both are needed, and real data is what settled it: the one trip logged on
// this phone (Gold Coast, 1-3 August) has readings on all three days, so a
// gap-only treatment drew nothing at all for it - which was the original
// complaint, a trip labelled and nothing visibly changing. What those days
// actually show is a movement, resting HR 48 to 53 and HRV 96 to 85, and an
// annotation that can only mark emptiness cannot point at that.
//
// The alternative, washing the whole span in the family colour, was rejected
// for drawing absence and presence the same way.
//
// The parent must be `position: relative` and must leave `LANE` px of padding
// at the bottom when `active` - see `useTripLane`.
const props = defineProps({
  gaps: { type: Array, default: () => [] },
  reach: { type: Array, default: () => [] },
  /**
   * Charts with a value gutter indent their plot, and an absolutely positioned
   * child resolves against the padding box, so it would otherwise start under
   * the axis labels rather than under the first bar.
   */
  insetLeft: { type: Number, default: 0 },
});

// Which trip names can be drawn without colliding. A label is allowed to
// overflow its own rule, which is right for a three-day trip on a ninety-day
// window and wrong the moment a second trip sits next to it.
const placedReach = computed(() => placeTripLabels(props.reach));

/** Shared with the parent's padding, which is why it is not just a CSS value. */
const LANE = 13;
</script>

<style scoped>
.gaps,
.rules {
  position: absolute;
  right: 0;
  pointer-events: none;
}
.gaps {
  top: 0;
}
.rules {
  bottom: 0;
}
.gap {
  position: absolute;
  top: 0;
  bottom: 0;
  /* Dimmer than a bar at its lowest opacity, so it can never be read as a
     reading of its own. */
  background: color-mix(in srgb, var(--dim) 13%, transparent);
  border-radius: 2px;
}
.triprule {
  position: absolute;
  top: 0;
  height: 2px;
  background: var(--dim);
  opacity: 0.85;
  border-radius: 1px;
}
/* Allowed to run past a short rule rather than being clipped inside it: three
   days of a ninety-day window is a 3% mark, narrower than its own label. Two
   trips close together would collide, which is a problem to have once a second
   trip exists. */
.rulelab {
  position: absolute;
  top: 3px;
  left: 0;
  font-size: 13px;
  letter-spacing: 0.6px;
  color: var(--dim);
  white-space: nowrap;
}
</style>
