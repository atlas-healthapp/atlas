<template>
  <div class="binary">
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <rect
        x="0.6"
        y="0.6"
        width="10.8"
        height="10.8"
        rx="2.4"
        :fill="done ? color : 'none'"
        :fill-opacity="done ? 0.2 : 0"
        :stroke="done ? color : 'var(--dim)'"
        stroke-width="1.2"
      />
      <path
        v-if="done"
        d="M3 6.2 L5.2 8.4 L9 4"
        fill="none"
        :stroke="color"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <span class="label" :style="{ color: done ? color : 'var(--dim)' }">{{ label }}</span>
  </div>
</template>

<script setup>
// Done or not done. Creatine is 5g taken as one dose, a habit is ticked or it
// is not, and neither has a fraction to draw. A dot grid here would imply a
// running total that does not exist.
defineProps({
  done: { type: Boolean, default: false },
  label: { type: String, default: "" },
  color: { type: String, default: "var(--acc)" },
});
</script>

<style scoped>
.binary {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.binary svg {
  display: block;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.label {
  font-size: var(--fs-label);
  letter-spacing: 0.6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
