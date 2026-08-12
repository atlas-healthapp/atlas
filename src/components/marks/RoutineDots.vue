<template>
  <div class="rd" aria-hidden="true">
    <span v-for="band in shown" :key="band.id" class="grp">
      <i
        v-for="row in band.rows"
        :key="row.id"
        :class="{ on: row.doneToday }"
        :style="row.doneToday ? { background: color, borderColor: color } : { borderColor: color }"
      ></i>
    </span>
  </div>
</template>

<script setup>
// Today's routine at row size: one dot per habit due today, filled when it is
// ticked, with the four bands set slightly apart.
//
// The gaps are the whole point. A flat run of nine dots says how many are left;
// grouping them says the morning is done and the evening has not started, which
// is the thing worth knowing at a glance and the reason the routine is banded
// at all. Bands with nothing due today are dropped rather than drawn empty:
// here there is no room for an absence to read as one.
import { computed } from "vue";

const props = defineProps({
  // The output of routineModel's routineBands().
  bands: { type: Array, required: true },
  color: { type: String, default: "var(--acc)" },
});

const shown = computed(() =>
  props.bands
    .map((b) => ({ ...b, rows: b.rows.filter((r) => r.dueToday) }))
    .filter((b) => b.rows.length)
);
</script>

<style scoped>
.rd {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.grp {
  display: flex;
  align-items: center;
  gap: 4px;
}
.rd i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.1px solid transparent;
  box-sizing: border-box;
  flex-shrink: 0;
  opacity: 0.38;
}
.rd i.on {
  opacity: 1;
}
</style>
