<!--
  One row of settings, closed until you ask for it.

  Settings had grown to six panels all fully expanded, so the page was a long
  scroll of controls with no way to see what was on it. The header row is now the
  whole of a section until you open it, which makes the page a list of what
  Atlas can be told rather than a wall of every control at once.

  **The summary is the point of the closed state.** A row that only said "THEME"
  would make you open it to learn anything; "THEME  SENTINEL" answers the
  commonest question without a tap, which is the same reasoning the drill-through
  pages use for their card metas.

  One open at a time is enforced by the parent, which owns `open`: two open
  sections put the second one's controls below the fold and the page went back to
  being a scroll.
-->
<template>
  <div class="panel setsection" :class="{ open }">
    <button
      class="hd panel-hd"
      type="button"
      :aria-expanded="open"
      @click="$emit('toggle')"
    >
      <span class="title">{{ title }}</span>
      <span class="right">
        <span v-if="summary" class="summary" :class="{ err: danger }">{{ summary }}</span>
        <svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
    </button>
    <div v-if="open" class="body">
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  /** What the row says while closed. Keep it to a value, not a sentence. */
  summary: { type: String, default: "" },
  /** Colours the summary as a fault, for a strap that is not talking. */
  danger: { type: Boolean, default: false },
  open: { type: Boolean, default: false },
});
defineEmits(["toggle"]);
</script>

<style scoped>
.setsection {
  padding: 0;
  /* clip, not hidden: hidden makes this a scroll container, which lets a child
     that is slightly too wide scroll inside the card instead of being laid out
     to fit it. */
  overflow: clip;
}
/* The whole row is the target, at the 44pt minimum the rest of the app holds to. */
.hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 48px;
  margin: 0;
  padding: 0 14px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
}
.title {
  color: var(--ink);
}
.right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--dim);
}
.summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.summary.err {
  color: var(--bad);
}
.caret {
  width: 15px;
  height: 15px;
  flex: none;
  transition: transform 140ms ease;
}
.open .caret {
  transform: rotate(180deg);
}
.body {
  padding: 2px 14px 14px;
  /* So a wide child is constrained by the card rather than overflowing it. */
  min-width: 0;
}
</style>
