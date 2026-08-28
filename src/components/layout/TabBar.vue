<template>
  <div class="nav">
    <template v-for="(t, i) in tabs" :key="t.id">
      <!-- The hole the create button sits in, after the second tab. It takes
           the same flex basis as a tab so the four stay evenly spaced rather
           than being pushed to the ends. -->
      <div v-if="i === 2" class="fabslot" aria-hidden="true"></div>
      <button
        type="button"
        :class="{ on: active === t.id }"
        :aria-current="active === t.id ? 'page' : undefined"
        @click="$emit('change', t.id)"
      >
        <svg
          class="ic"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          v-html="t.icon"
        />
        <span>{{ t.label }}</span>
      </button>
    </template>
  </div>
</template>

<script setup>
defineProps({ active: String });
defineEmits(["change"]);

// Line icons at 1.6, the same weight across all four, so the bar reads as one
// set. A solid figure was drawn for FITNESS (Bevel's is solid) and rejected: it
// would have been the only filled glyph in the row.
//
// The icons carry the identity, which is what let ACTIVITY become FITNESS and
// TODAY become HOME without the longest label dominating the bar. Before them,
// ACTIVITY at 3px tracking ran about 40% wider than BODY.
//
// Head circles are deliberately fill="currentColor" stroke="none": a 1.6 stroke
// circle at r≈1.9 renders as a smudge at 20px.
const ICONS = {
  home:
    '<path d="M3.4 11.3 12 4.2l8.6 7.1"/>' +
    '<path d="M5.6 10.2V20h12.8v-9.8"/>' +
    '<path d="M9.8 20v-5.6h4.4V20"/>',
  food:
    '<path d="M3.2 11.4h17.6a8.8 8.8 0 0 1-17.6 0Z"/>' +
    '<path d="M9 7.8c0-1.2 1-1.6 1-2.8M13 7.8c0-1.2 1-1.6 1-2.8"/>',
  body:
    '<path d="M12 19.8s-7.4-4.4-7.4-9.4a4.2 4.2 0 0 1 7.4-2.6 4.2 4.2 0 0 1 7.4 2.6c0 5-7.4 9.4-7.4 9.4Z"/>',
  // Every limb bends at its joint. A straight forward arm reads as a third leg,
  // which is the difference between a running figure and a starfish.
  activity:
    '<circle cx="15.2" cy="4.3" r="1.9" fill="currentColor" stroke="none"/>' +
    '<path d="M14.6 7.9 10.6 12.3"/>' +
    '<path d="M14.3 8.6 17.4 10.4 19.2 8.4"/>' +
    '<path d="M13.3 8.3 10.2 6.9 8.1 8.7"/>' +
    '<path d="M10.6 12.3 13.9 14.9 13.1 19.8"/>' +
    '<path d="M10.6 12.3 7.1 14.2 4.1 18.6"/>',
};

// Four tabs, each one a colour family, so the bar is the legend for the colour
// system in families.js. The FITNESS tab keeps the id "activity" because that
// is the family's name in families.js and in --fam-activity; the word changed,
// the family did not.
const tabs = [
  { id: "home", label: "HOME", icon: ICONS.home },
  { id: "food", label: "FOOD", icon: ICONS.food },
  { id: "body", label: "BODY", icon: ICONS.body },
  { id: "activity", label: "FITNESS", icon: ICONS.activity },
];
</script>

<style scoped>
.nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  border-top: 1px solid color-mix(in srgb, var(--acc) 25%, transparent);
  background: color-mix(in srgb, var(--bg2) 92%, black);
  padding-bottom: env(safe-area-inset-bottom);
  z-index: 100;
  transition: opacity 0.5s ease-out, transform 0.5s ease-out;
}
/* hidden while the boot sequence plays; rises in with the Up Next panel */
.nav.boot-hidden {
  opacity: 0;
  transform: translateY(12px);
  pointer-events: none;
}
.nav button {
  flex: 1;
  background: none;
  border: 0;
  font: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  /* Still clears 44pt with the icon and label stacked. */
  padding: 10px 0 12px;
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 1.4px;
  font-weight: 600;
  color: var(--dim);
  white-space: nowrap;
}
.ic {
  width: 20px;
  height: 20px;
  display: block;
}
/* Empty on purpose: CreateFab draws itself over this, and its disc carries a
   ring in the bar's own colour so it notches the bar rather than sitting on
   the hairline. Nothing is rendered here, only reserved. */
.fabslot {
  flex: 1;
}
/* drop-shadow rather than text-shadow: the glow has to come off the icon too,
   or the label lights up above a flat drawing. */
.nav .on {
  color: var(--acc);
  border-top: 2px solid var(--acc);
  margin-top: -1px;
  filter: drop-shadow(0 0 7px color-mix(in srgb, var(--acc) 55%, transparent));
}
.nav button:focus-visible {
  outline: 2px solid var(--acc);
  outline-offset: -3px;
}
</style>
