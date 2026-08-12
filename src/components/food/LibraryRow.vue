<template>
  <div class="row" @click="$emit('edit')">
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
});
defineEmits(["edit"]);
</script>

<style scoped>
.row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  column-gap: 8px;
  padding: 7px 0;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 1px solid color-mix(in srgb, var(--fam-intake) 10%, transparent);
}
.name {
  overflow-wrap: anywhere;
  min-width: 0;
}
.tag-slot {
  font-size: 8px;
  letter-spacing: 1px;
  color: var(--fam-intake);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 40%, transparent);
  padding: 1px 4px;
  line-height: 1.4;
}
</style>
