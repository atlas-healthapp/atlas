<template>
  <!-- In selecting mode the whole row toggles instead of opening the editor: two
       different things on one tap target is how you lose an edit to a stray tick,
       or a tick to an editor you did not want. -->
  <div
    class="row"
    :class="{ picking: selectable, picked: selected }"
    @click="selectable ? $emit('pick') : $emit('edit')"
  >
    <span v-if="selectable" class="tick" :class="{ on: selected }" aria-hidden="true">
      <svg v-if="selected" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 13l4 4L19 7" />
      </svg>
    </span>
    <span class="name">{{ item.name }}</span>
    <span
      v-if="item.ingredients?.length"
      class="tag-slot mono"
      >C</span
    >
  </div>
</template>

<script setup>
// One shared row layout for every library list (QUICK ACCESS + the merged
// A-Z list in LibraryView.vue). Just the name + a composite tag - a protein
// bar was tried and dropped (it put 20+ full-strength accent-colored
// elements on screen at once, which competed with the FAB even worse than
// a single LOG button had). Full macros show in the edit sheet on tap.
// The composite tag sits at the END of the row now, not the start - leading
// with "C" before the name broke the visual rhythm of scanning an
// alphabetized list (a "C" glyph landing under the "P" section header reads
// as visually wrong even though the actual sort is unaffected, since it's
// sorted on item.name, not the rendered row). Tapping a row opens edit -
// logging happens exclusively through the Food tab's FAB now, not a
// per-row action.
defineProps({
  item: { type: Object, required: true },
  /** Selecting mode is on, so this row ticks rather than opens. */
  selectable: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
});
defineEmits(["edit", "pick"]);
</script>

<style scoped>
.row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  column-gap: 8px;
  padding: 7px 0;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 1px solid color-mix(in srgb, var(--fam-intake) 10%, transparent);
}
/* **The column count changes with the child count.** Selecting adds a third
   child, and left at `1fr auto` the composite tag wrapped onto a line of its own.
   Both shapes fit `auto 1fr auto`, since a row with no tag just leaves the last
   column empty. */
.row.picking {
  grid-template-columns: auto 1fr auto;
  align-items: center;
}
.tick {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--dim) 55%, transparent);
  display: grid;
  place-items: center;
  color: var(--bg1);
}
.tick.on {
  background: var(--fam-intake);
  border-color: var(--fam-intake);
}
.tick svg {
  width: 13px;
  height: 13px;
}
/* The picked row itself lifts, so a long list of ticks still reads as a set
   rather than as twenty identical rows with small marks on some of them. */
.row.picked {
  background: color-mix(in srgb, var(--fam-intake) 8%, transparent);
}
.name {
  overflow-wrap: anywhere;
  min-width: 0;
}
.tag-slot {
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--fam-intake);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 40%, transparent);
  padding: 1px 4px;
  line-height: 1.4;
}
</style>
