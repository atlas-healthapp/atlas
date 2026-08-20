<template>
  <!-- The card publishes its family colour as a custom property so every row
       inside picks it up by inheritance. Passing it down as a prop meant
       repeating the same value on ten rows, and one of them would eventually
       be missed and sit grey among its own family. -->
  <section class="card" :style="{ '--row-label': inkColor || color }">
    <!-- **The header is a button only when the card collapses.** A header that is
         always a button says everything on the page can be folded away, which is
         not true and invites the tap that finds out. -->
    <component
      :is="collapsible ? 'button' : 'header'"
      class="card-hd mono"
      :class="{ foldable: collapsible, folded: collapsible && !open }"
      :type="collapsible ? 'button' : undefined"
      :aria-expanded="collapsible ? open : undefined"
      @click="collapsible && (open = !open)"
    >
      <span :style="{ color: inkColor || color }">{{ title }}</span>
      <span class="hdright">
        <span v-if="meta" class="meta" :style="{ color: metaColor || 'var(--dim)' }">{{ meta }}</span>
        <!-- The DOWN caret, matching the terms inside this card and the collapsed
             sections further down the page. Not the chevron, which means "opens
             a page" everywhere in Atlas. -->
        <svg
          v-if="collapsible"
          class="foldcaret"
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
    </component>
    <slot v-if="!collapsible || open" />
  </section>
</template>

<script setup>
import { ref } from "vue";
// A card is one family, header included. A gold header sitting over violet
// rows was the specific defect that produced this rule: the title was
// announcing a different thing from its own contents.
const props = defineProps({
  title: { type: String, required: true },
  meta: { type: String, default: "" },
  color: { type: String, default: "var(--acc)" },
  inkColor: { type: String, default: "" },
  metaColor: { type: String, default: "" },
  /**
   * Fold the card away behind its own header.
   *
   * The header keeps its meta while folded, so the card still answers its own
   * question - on the sleep page that is the score out of 100, which is the
   * whole point of the section underneath it.
   */
  collapsible: { type: Boolean, default: false },
  /** Whether a collapsible card starts open. Collapsed is the reason to use it. */
  startOpen: { type: Boolean, default: false },
});

const open = ref(props.startOpen);
</script>

<style scoped>
.hdright {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
/* Sized and reset so a button header is indistinguishable from a plain one. */
.card-hd.foldable {
  width: 100%;
  background: none;
  border: none;
  font: inherit;
  letter-spacing: inherit;
  text-align: left;
  cursor: pointer;
}
.foldcaret {
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--dim);
  transition: transform 140ms ease;
}
.card-hd.folded .foldcaret {
  transform: rotate(-90deg);
}
/* The app's one container treatment: the surface separates, nothing is drawn
   around it. Kept in step with `.panel` in style.css, which is the same rule
   for the screens that were written before this component existed. */
.card {
  border-radius: 10px;
  background: var(--panel);
  /* none on the dark themes, where the raised surface is legible on its own;
     on a light ground this is the only thing marking where the card stops.
     See the light-surface note in style.css. */
  box-shadow: var(--panel-shadow);
  padding: 11px 12px 8px;
  margin-top: 11px;
}
.card-hd {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  font-size: var(--fs-cardhd);
  letter-spacing: 1.8px;
  margin-bottom: 6px;
}
.meta {
  letter-spacing: 1px;
}
</style>
