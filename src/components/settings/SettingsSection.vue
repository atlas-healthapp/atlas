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
  <div class="setsection" :class="{ open, nested, panel: !nested }">
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
  /**
   * Render as a row inside somebody else's card rather than as a card.
   *
   * **Not a second box.** The group this exists for (SETUP) needs its contents to
   * read as being *inside* it, and the app's one container rule says a container
   * is the surface alone - so drawing a card inside a card was never available.
   * Dropping the surface here instead means the group is one card whose rows
   * happen to open, which is what every other card in Atlas already is.
   */
  nested: { type: Boolean, default: false },
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
/* A row in the group's card: no surface of its own, separated by the same
   hairline every other multi-row card in the app uses, and inset so the group's
   own header stays the outermost thing on the left. The first row takes no
   hairline because the header above it already provides the edge. */
.setsection.nested {
  background: none;
  border-radius: 0;
  margin: 0;
  border-top: 1px solid var(--panel-line);
}
.setsection.nested .hd {
  padding-left: 26px;
}
.setsection.nested .body {
  padding-left: 26px;
}
/* The whole row is the target, at the 44pt minimum the rest of the app holds to.
 *
 * **Sized here rather than by moving a token** (2026-08-17, reported as "text
 * should be bigger on the settings panel"). It inherited `.panel-hd`, which is
 * 10px at 3px letter-spacing - right for a card header that labels a chart, too
 * small for a list of rows that IS the content. This component is used by settings
 * and nowhere else, so its own scoped rule is the exact scope of the change: the
 * global `--fs-label` would have moved rows across the whole app. Letter-spacing
 * comes down as the size goes up, because 3px tracking on 13px type sets a row
 * title wider than the phone.
 */
.hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  margin: 0;
  padding: 0 14px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-size: var(--set-value);
  letter-spacing: 1.6px;
}
/* One line, always. At 13px with 1.6px tracking "HOME DIALS" wrapped to two,
   which turned a 52px row into a 70px one and broke the rhythm of the list. The
   title is the fixed part and the summary is the part that gives way: it already
   ellipsises, and half a value still tells you which row you are looking at,
   where half a title does not. */
.title {
  color: var(--ink);
  white-space: nowrap;
  flex: none;
}
.right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--dim);
}
/* A step below the title, so the value reads as the answer to the row rather than
   as a second heading, but still up from the 10px it inherited. */
.summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--set-summary);
  letter-spacing: 1px;
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
/* **`.setsection.open`, not `.open`.** Scoped CSS only stamps the data attribute
   on the last selector in the chain, so a bare `.open .caret` matched any
   ancestor carrying that class - and once the SETUP group became a card with
   `.open` on it, every nested row's caret rendered upside down while closed.
   Builds clean, passes every test, visible only in a screenshot. */
.setsection.open > .hd .caret {
  transform: rotate(180deg);
}
.body {
  padding: 2px 14px 14px;
  /* So a wide child is constrained by the card rather than overflowing it. */
  min-width: 0;
}
</style>
