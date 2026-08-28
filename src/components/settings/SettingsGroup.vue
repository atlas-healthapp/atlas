<!--
  A card holding several settings rows, with a header that opens the lot.

  **One card, not N.** Open, the group's rows have to read as being inside it
  rather than as more drawers that appeared at the same level, which is what a
  row of siblings looked like. So the group is a single `.panel`: its title is
  the header and the rows are rows in it, hairline-separated and inset, exactly
  like every other multi-row card in the app. The children pass `nested` to
  `SettingsSection`, which is what drops each row's own surface, so this stays
  one container rather than a card inside a card.

  Extracted from `SettingsPage` on 2026-08-25 when LOGS became the second group.
  The markup and the whole of the CSS below were written for SETUP and were
  about to be copied verbatim; two copies of a container treatment is precisely
  the drift `PageHeader` and `metricRegistry` were extracted to stop.

  **The group owns its own open flag rather than a value of `openSection`.** That
  ref is one-open-at-a-time, so opening a child would otherwise close the group
  the child lives in.
-->
<template>
  <div class="panel setgroup" :class="{ open }">
    <button
      class="grouprow"
      :class="{ open }"
      type="button"
      :aria-expanded="open"
      @click="$emit('toggle')"
    >
      <span class="grouptitle mono">{{ title }}</span>
      <span class="groupright">
        <span class="groupsum mono">{{ open ? openSummary : summary }}</span>
        <svg
          class="groupcaret"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
    </button>
    <slot v-if="open" />
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  /** What the row says while closed. Keep it to a value, not a sentence. */
  summary: { type: String, default: "" },
  /**
   * What it says once open, which is a different job: closed it names what is
   * inside, open the contents already do that and the header can count them.
   * Falls back to `summary` when there is nothing else to say.
   */
  openSummary: { type: String, default: "" },
  open: { type: Boolean, default: false },
});
defineEmits(["toggle"]);
</script>

<style scoped>
/* The group's card. One surface holding the header and its rows, so what is
   inside reads as inside it. Closed it is indistinguishable from any other
   settings row, which is the point: it only becomes a container once it has
   something to contain. */
.setgroup {
  padding: 0;
  margin-bottom: 10px;
  /* clip, not hidden, for the same reason SettingsSection gives: hidden would
     make this a scroll container and let a slightly-too-wide child scroll inside
     the card instead of being laid out to fit it. */
  overflow: clip;
}
/* Its header. Deliberately the same metrics and type as SettingsSection's own
   header, including the 2026-08-17 size bump, so the door looks like the rows it
   opens. If those move, these move with them. */
.grouprow {
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
/* Open, the header takes the accent its contents are gathered under, which is the
   one cue that survives being scrolled past. */
.grouprow.open .grouptitle {
  color: var(--acc);
}
/* Same nowrap reasoning as SettingsSection's .title. */
.grouptitle {
  color: var(--ink);
  white-space: nowrap;
  flex: none;
}
.groupright {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--dim);
}
/* A step below the title, matching SettingsSection's .summary. */
.groupsum {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--set-summary);
  letter-spacing: 1px;
}
.groupcaret {
  width: 15px;
  height: 15px;
  flex: none;
  transition: transform 140ms ease;
}
.grouprow.open .groupcaret {
  transform: rotate(180deg);
}
</style>
