<template>
  <!-- The top of every drill-through page. One component rather than six copies
       of the same markup, which is how the pages drifted apart in the first
       place: three of them had a bordered BACK pill and a title, one had neither
       and one had both plus a stepper.

       The shape is fixed. Left: where this returns to, named. Right: what this
       page is about - a date, a range, a control for moving between them. The
       page's own name is deliberately absent by default, because you arrived
       here by tapping the thing it names and the hero underneath says it
       again. -->
  <div class="phd">
    <button class="back mono" type="button" @click="$emit('close')">
      <span class="chev" aria-hidden="true">‹</span>{{ from }}
    </button>
    <div class="phdright mono">
      <slot name="right">
        <span v-if="context" class="context">{{ context }}</span>
      </slot>
    </div>
  </div>
</template>

<script setup>
defineProps({
  /**
   * Where the back control returns to, in words. Passed by whoever opened the
   * page, because most of these are reachable from more than one place and
   * "BACK" tells you none of them.
   */
  from: { type: String, default: "BACK" },
  /** What this page is about: a date, or the range it covers. */
  context: { type: String, default: "" },
});
defineEmits(["close"]);
</script>

<style scoped>
.phd {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
/* No border. The pill was the heaviest thing on the screen and the one element
   nobody opened the page to use. */
/* Sized up 2026-08-05. At 12px against a 42px hero this row read as a caption
   rather than as the page's own controls, and it is the one thing on the page
   that is always tapped. */
.back {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  letter-spacing: 1.8px;
  color: var(--dim);
  background: none;
  border: none;
  padding: 8px 0;
  min-height: 44px;
  cursor: pointer;
}
.back .chev {
  font-size: 21px;
  line-height: 1;
}
.phdright {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.context {
  font-size: 14.5px;
  letter-spacing: 1.8px;
  color: var(--dim);
}
</style>
