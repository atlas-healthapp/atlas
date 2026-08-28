<!--
  A log as a scrolling block, wherever one is shown.

  Takes its lines rather than reaching for a store, because Atlas keeps three
  logs and they are all this shape: the BLE exchange (`helio.logLines`), the
  sync trail, and whatever comes next. A component that named one of them would
  be copied for the second.

  Extracted 2026-08-25. This markup and its CSS existed twice already, in
  `DevicePanel` and `StrapConnect`, and LOGS would have made three.

  It follows the tail: a log you have to scroll to the bottom of to read the
  thing that just happened is a log nobody reads.
-->
<template>
  <div ref="el" class="log mono">
    <div v-for="(line, i) in lines" :key="i" :class="{ err: isError(line) }">
      {{ line }}
    </div>
    <div v-if="!lines.length" class="dim-text">{{ empty }}</div>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from "vue";

const props = defineProps({
  lines: { type: Array, default: () => [] },
  /**
   * What to say with nothing in it. Deliberately per-site: on the pairing screen
   * an empty log means the connect never reached the strap, and everywhere else
   * it means no sync has run yet, which are different facts.
   */
  empty: { type: String, default: "NOTHING YET. RUN A SYNC TO SEE THE EXCHANGE." },
});

/** The BLE log marks a failed line with `!`. Nothing else in Atlas does. */
const isError = (line) => String(line).includes("!");

const el = ref(null);

function toBottom() {
  nextTick(() => {
    if (el.value) el.value.scrollTop = el.value.scrollHeight;
  });
}

// Mounted as well as watched: this renders behind a v-if, so by the time it
// exists the interesting lines are usually already in the buffer.
onMounted(toBottom);
watch(() => props.lines.length, toBottom);
</script>

<style scoped>
.log {
  margin-top: 10px;
  max-height: 220px;
  overflow-y: auto;
  /* Frame dumps are wide and fixed-width; wrapping them makes the columns
     unreadable, so the log scrolls sideways instead of the page doing it. */
  overflow-x: auto;
  background: var(--bg0);
  border: 1px solid var(--dim);
  padding: 8px;
  font-size: var(--set-label);
  line-height: 1.5;
  white-space: pre;
  color: var(--body);
  /* Selectable, because a copy button can be refused by the WebView and hand
     selection is then the only way the log leaves the phone. */
  user-select: text;
}
.err {
  color: var(--bad);
}
.dim-text {
  color: var(--dim);
  white-space: normal;
}
</style>
