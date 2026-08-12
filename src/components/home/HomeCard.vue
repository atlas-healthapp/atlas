<template>
  <!-- The card publishes its family colour as a custom property so every row
       inside picks it up by inheritance. Passing it down as a prop meant
       repeating the same value on ten rows, and one of them would eventually
       be missed and sit grey among its own family. -->
  <section class="card" :style="{ '--row-label': inkColor || color }">
    <header class="card-hd mono">
      <span :style="{ color: inkColor || color }">{{ title }}</span>
      <span v-if="meta" class="meta" :style="{ color: metaColor || 'var(--dim)' }">{{ meta }}</span>
    </header>
    <slot />
  </section>
</template>

<script setup>
// A card is one family, header included. A gold header sitting over violet
// rows was the specific defect that produced this rule: the title was
// announcing a different thing from its own contents.
defineProps({
  title: { type: String, required: true },
  meta: { type: String, default: "" },
  color: { type: String, default: "var(--acc)" },
  inkColor: { type: String, default: "" },
  metaColor: { type: String, default: "" },
});
</script>

<style scoped>
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
