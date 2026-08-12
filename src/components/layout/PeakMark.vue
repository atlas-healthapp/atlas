<template>
  <!-- The A with no crossbar: a peak, which is what Atlas is named after.
       Sized in em so it scales with whatever type it sits in. -->
  <svg class="peak" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <path d="M50 0 L100 88 L100 100 L50 36 L0 100 L0 88 Z" />
  </svg>
</template>

<style scoped>
/* The art fills the viewBox edge to edge, so the height set here IS the drawn
   height. An earlier version stroked two lines inside the box and came out at
   roughly 56% of the em, which read as a small letter beside a full-size word.
   0.72em is Roboto's cap height, so the peak stands level with the TLAS. */
.peak {
  height: 0.72em;
  width: 0.7em;
  /* .wordmark's 7px tracking applies between characters and an SVG is not one,
     so the same gap has to be set by hand or the peak sits tight against the T. */
  margin-right: 7px;
  flex-shrink: 0;
}
.peak path {
  fill: var(--acc);
}
</style>
