<template>
  <div class="row" :class="{ tappable: tappable }">
    <!-- The streak sits under the metric's name, in the column that already
         belongs to it. Out on the right it either pushed the value off the
         rail or had to hold a gap open that stayed empty on every row without
         one, and that gap was more noticeable than the streak. -->
    <span class="nmwrap">
      <span class="nm mono">{{ label }}</span>
      <span
        v-if="streak !== null && streak >= MIN_SHOWN"
        class="stk mono"
        :style="{ color: streakColor }"
        >{{ streak }}D STREAK</span
      >
    </span>
    <span class="mk"><slot /></span>
    <span class="val">{{ value }}</span>
    <!-- Two different things wore the same chevron: opening a detail page you
         can back out of, and switching to another tab, which you cannot. `goes`
         names the destination so the second kind announces itself instead of
         looking like the first and then moving the ground.
         Reserved even when the row cannot be tapped, so a row without a
         chevron does not sit its value further right than one with. -->
    <span v-if="goes" class="goes mono">{{ goes }}</span>
    <span class="chev" :class="{ ghost: !tappable }" aria-hidden="true">›</span>
  </div>
</template>

<script setup>
// Label, mark, value. The label stays neutral rather than taking the family
// colour: at this size it needs maximum contrast, and it is the fallback
// channel that makes a fully coloured interface safe for anyone who cannot
// separate the hues.
//
// 44px minimum height is not padding for looks. These rows are tap targets and
// the dense draft had them at 18px, less than half the platform minimum.
import { MIN_SHOWN } from "@/utils/streak";

defineProps({
  label: { type: String, required: true },
  value: { type: String, default: "" },
  tappable: { type: Boolean, default: false },
  /**
   * Name of the tab this row leaves for, when it leaves for one. Rows that open
   * an overlay leave this empty: those have a BACK button of their own, and
   * this is the label that stands in for one where there cannot be.
   */
  goes: { type: String, default: "" },
  // null means this metric has no target and so cannot have a streak; 0 means
  // it has one and the run is currently broken.
  streak: { type: Number, default: null },
  streakColor: { type: String, default: "var(--dim)" },
});
</script>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: var(--row-h);
}
.tappable {
  cursor: pointer;
}
.nmwrap {
  width: var(--row-label-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
/* Inherits its card's family colour, falling back to grey for any row used
   outside a HomeCard. The value beside it stays neutral ink, which is what
   keeps the reading legible without relying on hue. */
.nm {
  font-size: var(--fs-label);
  letter-spacing: 1.1px;
  color: var(--row-label, var(--dim));
}
.mk {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}
.val {
  font-size: var(--fs-value);
  color: var(--ink);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}
.stk {
  font-size: var(--fs-micro);
  letter-spacing: 0.9px;
  font-variant-numeric: tabular-nums;
}
.goes {
  flex-shrink: 0;
  font-size: var(--fs-micro);
  letter-spacing: 1.4px;
  color: var(--row-label, var(--dim));
}
.chev {
  color: var(--dim);
  font-size: 15px;
  flex-shrink: 0;
  width: 8px;
  text-align: right;
}
/* Still occupies its column, so a row you cannot tap does not push its value
   further right than one you can. */
.chev.ghost {
  visibility: hidden;
}
</style>
