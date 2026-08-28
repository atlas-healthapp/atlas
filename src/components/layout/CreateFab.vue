<template>
  <div class="fabwrap" :class="{ open }">
    <div v-if="open" class="scrim" @click="open = false"></div>

    <svg class="stage" :viewBox="`0 0 ${STAGE_W} ${STAGE_H}`" role="presentation">
      <template v-if="open">
        <!-- The rail the nodes sit on, in pieces so it passes between the discs
             rather than under them. The arc is struck from a centre above the
             button rather than from the button itself, so raising it does not
             spread the nodes: the radius and the sweep are unchanged and
             everything simply sits higher. -->
        <path v-for="(d, i) in rail" :key="`r${i}`" class="orbit" :d="d" />

        <g
          v-for="(n, i) in nodes"
          :key="n.action"
          class="sat"
          :class="[`fam-${n.fam}`, { primary: n.primary }]"
          :style="{ animationDelay: `${i * 45}ms` }"
          @click="pick(n.action)"
        >
          <circle class="sat-ring" :cx="n.x" :cy="n.y" :r="n.radius" />
          <g
            class="sat-art"
            :transform="`translate(${n.x - 10} ${n.y - 10}) scale(0.833)`"
            v-html="n.icon"
          />
          <!-- A backing plate rather than a stroked halo. The halo had to be
               wide enough to close between the letters, and at 9.5px that meant
               4px of stroke swallowing the glyphs themselves. A plate is also
               the only version that survives all four themes: it takes the
               disc's own fill and the text takes --ink, so a light theme gets
               dark text on a light plate and a dark one gets the reverse,
               without either being tuned by hand.
               Offsets measure from the node's own radius, not the shared one:
               the primary disc is 3px bigger and a fixed offset printed its
               label across its own edge. -->
          <rect
            class="sat-plate"
            :x="n.x - n.labelW / 2"
            :y="n.y + n.radius + 4"
            :width="n.labelW"
            height="14"
            rx="3"
          />
          <text class="sat-label" :x="n.x" :y="n.y + n.radius + 14">{{ n.label }}</text>
        </g>
      </template>

      <circle
        class="fab-core"
        :cx="CX"
        :cy="FAB_CY"
        :r="FAB_R"
        @click="open = !open"
      />
      <!-- Two drawn lines, not a "+" character. A glyph is centred on the
           font's baseline rather than on its own ink, so it needed a fudge
           pixel and still pivoted about the wrong point - the cross visibly
           shifted as it rotated. Two lines crossing at the disc's centre are
           exact by construction, and rotate to a perfect x. -->
      <g
        class="fab-glyph"
        :class="{ open }"
        :style="{ transformOrigin: `${CX}px ${FAB_CY}px` }"
        @click="open = !open"
      >
        <line :x1="CX - GLYPH" :y1="FAB_CY" :x2="CX + GLYPH" :y2="FAB_CY" />
        <line :x1="CX" :y1="FAB_CY - GLYPH" :x2="CX" :y2="FAB_CY + GLYPH" />
      </g>
    </svg>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

// The one place anything is created, sitting in the middle of the tab bar.
//
// It replaces `FoodFab`, which was stranded on the Food tab even though two of
// its three actions were not food-specific in principle and the app had no
// other way to make anything.
//
// **The arc is back, and the old rejection does not apply.** A quarter-circle
// from the bottom-right corner crowded every node into the same corner and put
// labels inside neighbouring discs; every fix moved the collision somewhere
// else, which is why it became a vertical stack. From the middle of the bar
// there is a full semicircle, and the nodes separate horizontally and
// vertically at once. The geometry below was checked by arithmetic before it
// was drawn - label boxes against each other, discs against the screen edges,
// labels against the top of the bar.
const emit = defineEmits(["create"]);

// One unit is one pixel, and the stage is a fixed size rather than a share of
// the viewport, so the arc is physically the same on every phone. Same reason
// FoodFab pinned its own 220x220 box: a viewBox that scales with the screen
// scales the FAB with it.
const STAGE_W = 320;
const STAGE_H = 260;
const CX = STAGE_W / 2;

// The bar's height is **measured, never assumed**. It is intrinsic - icon plus
// label plus padding plus the safe-area inset - so it is neither a constant nor
// the same on two devices. Hardcoding 46 put the core 14px below the bar's top
// edge on a real 390px viewport, where the bar is 61: the button ended up
// buried in the bar instead of straddling it.
const navH = ref(56);
// The bar's box is taller than the row you can see: it carries
// `padding-bottom: env(safe-area-inset-bottom)` to clear the gesture bar. That
// padding is empty, so the icons are centred in what is left above it.
const navPadBottom = ref(0);
// Dead centre of the **visible row**, which is not the centre of the bar's box.
//
// Centring on the box was wrong on the phone and right in a browser, which is
// exactly why it shipped: `env(safe-area-inset-bottom)` is 0 on a desktop and
// about 24px on a device with a gesture bar, so the box is that much taller
// than the row of icons sitting in it. Centring on the box put the button ~19px
// below the icons, hanging into the gesture area.
//
// Both numbers are measured rather than assumed, for the same reason: the bar's
// height is intrinsic and the inset differs per device. Earlier stops, each
// argued for: 18 stood proud of the bar, 23.5 sat level with the icons.
const rowH = computed(() => navH.value - navPadBottom.value);
const FAB_CY = computed(() => STAGE_H - navH.value + rowH.value / 2);
// 46px across, down from 54. The tab icons are 20px, and at 54 the button read
// as a different order of object sitting in the row rather than as the loudest
// thing in it. **This is the floor**: 46 still clears the 44pt minimum every
// other target in Atlas is held to, and it is now the entry point for
// everything you create, so it cannot be the one control that misses it.
const FAB_R = 23;
/** Half the cross's arm, kept in proportion to the disc. */
const GLYPH = 7.5;

function measureNav() {
  const nav = document.querySelector(".nav");
  if (!nav) return;
  const h = nav.getBoundingClientRect().height;
  if (h) navH.value = h;
  navPadBottom.value = parseFloat(getComputedStyle(nav).paddingBottom) || 0;
}
onMounted(measureNav);

const R = 112;
const DISC_R = 22;

// **The ring is anchored to the bar, not to the button.** They used to share a
// centre, which quietly made "lower the button" mean "lower the menu": sinking
// the FAB dragged the whole orbit down with it and walked the outer labels into
// the tab bar, where there is nowhere left to go. Two settings now - SINK moves
// the button, LIFT moves the ring - and neither disturbs the other.
const LIFT = 11;
const ARC_CY = computed(() => STAGE_H - navH.value - LIFT);

// Both ends kept well off the horizontal, or a node lies flat on the bar. Two
// nodes need less of the semicircle than four did, and spreading them to the
// full sweep would have thrown them out to the screen edges for no reason.
const SWEEP_FROM = 56;
const SWEEP_TO = 124;

// Line icons rather than typeset characters. Nothing else in Atlas is drawn
// with unicode, and four glyphs sit at four different optical weights inside
// identical discs. These are 1.6 stroke with round caps, to sit beside
// TabBar's - see its note about the icons carrying the identity.
const ICONS = {
  // The tab bar's bowl, shrunk to make room for a plus. The bowl alone *is* the
  // FOOD tab's icon, and would read as "go to food" rather than "add food".
  addFood:
    '<path d="M3.4 11.8h13.2a6.6 6.6 0 0 1-13.2 0Z"/>' +
    '<path d="M7.6 9c0-1 .8-1.3.8-2.3M11.2 9c0-1 .8-1.3.8-2.3"/>' +
    '<path d="M17.8 3.6v5M15.3 6.1h5"/>',
  // The tab bar's runner, unchanged: this node creates something that belongs
  // to that tab, so it should be the same drawing.
  activity:
    '<circle cx="15.2" cy="4.3" r="1.9" fill="currentColor" stroke="none"/>' +
    '<path d="M14.6 7.9 10.6 12.3"/><path d="M14.3 8.6 17.4 10.4 19.2 8.4"/>' +
    '<path d="M13.3 8.3 10.2 6.9 8.1 8.7"/><path d="M10.6 12.3 13.9 14.9 13.1 19.8"/>' +
    '<path d="M10.6 12.3 7.1 14.2 4.1 18.6"/>',
};

// Two nodes, one per family.
//
// SCAN and the estimate used to sit here as siblings of ADD FOOD, which gave
// the two rarest ways in the same billing as much the commonest: you log a meal
// daily and scan a barcode or type raw macros occasionally. They moved into the
// add sheet, which already stops to ask which section you are logging under, so
// it was already the "what kind of entry is this" moment and asking "how" there
// costs no extra tap.
const ACTIONS = [
  { action: "add-food", label: "ADD FOOD", fam: "intake", icon: ICONS.addFood, primary: true },
  { action: "add-activity", label: "ACTIVITY", fam: "activity", icon: ICONS.activity },
];

const open = ref(false);

const nodes = computed(() => {
  const count = ACTIONS.length;
  const step = count === 1 ? 0 : (SWEEP_TO - SWEEP_FROM) / (count - 1);
  return ACTIONS.map((a, i) => {
    const deg = SWEEP_FROM + i * step;
    const rad = (deg * Math.PI) / 180;
    return {
      ...a,
      // Kept, because the rail has to know where each disc sits on the ring in
      // order to break around it.
      a: deg,
      radius: a.primary ? DISC_R + 3 : DISC_R,
      // IBM Plex Mono at 9.5px with 1.3px tracking measures ~6.9px a character,
      // plus 5px of padding each side. Computed rather than measured because
      // the plate is drawn in the same pass as the text.
      labelW: a.label.length * 6.9 + 10,
      x: +(CX + R * Math.cos(rad)).toFixed(2),
      y: +(ARC_CY.value - R * Math.sin(rad)).toFixed(2),
    };
  });
});

/**
 * The rail the nodes sit on, **broken around each disc** rather than drawn
 * behind it.
 *
 * How wide a break is computed rather than guessed: a disc of radius `r`
 * centred on a ring of radius `R` covers `asin((r + pad) / R)` either side of
 * its own angle, about 14 degrees here. A single arc straight through both
 * showed under the discs' own translucent fill and read as a line nobody had
 * trimmed.
 *
 * No spokes from the button. They were drawn and dropped: with two nodes the
 * rail alone says they belong together, and two more lines converging on a
 * button that is already the brightest thing on screen only added ink.
 */
const rail = computed(() => {
  const list = nodes.value;
  if (list.length < 2) return [];

  const holes = list
    .map((n) => {
      const half = (Math.asin(Math.min(1, (n.radius + 5) / R)) * 180) / Math.PI;
      return [n.a - half, n.a + half];
    })
    .sort((p, q) => p[0] - q[0]);

  const from = Math.min(...list.map((n) => n.a));
  const to = Math.max(...list.map((n) => n.a));

  const segments = [];
  let cursor = from;
  for (const [h0, h1] of holes) {
    if (h0 > cursor + 1) segments.push([cursor, Math.min(h0, to)]);
    cursor = Math.max(cursor, h1);
  }
  if (to > cursor + 1) segments.push([cursor, to]);

  // Anything under a degree would draw as a speck rather than a line.
  return segments
    .filter(([s, e]) => e - s > 1)
    .map(([s, e]) => {
      const p0 = pointAt(R, s);
      const p1 = pointAt(R, e);
      return `M ${p0.x} ${p0.y} A ${R} ${R} 0 0 0 ${p1.x} ${p1.y}`;
    });
});

function pointAt(r, deg) {
  const a = (deg * Math.PI) / 180;
  return {
    x: +(CX + r * Math.cos(a)).toFixed(2),
    y: +(ARC_CY.value - r * Math.sin(a)).toFixed(2),
  };
}

function pick(action) {
  open.value = false;
  emit("create", action);
}

defineExpose({ close: () => (open.value = false) });
</script>

<style scoped>
/* Fixed and centred, above the tab bar. pointer-events only on the shapes that
   are actually controls, or the transparent stage would eat taps on the page
   underneath it - the same trap FoodFab documented. */
/* Centred with a calc, **never with a transform**. A transformed ancestor
   becomes the containing block for `position: fixed` descendants, so
   `translateX(-50%)` here silently shrank the full-screen scrim to this box:
   the menu opened over undimmed content and read as broken. */
.fabwrap {
  position: fixed;
  left: calc(50% - 160px);
  bottom: 0;
  width: 320px;
  height: 260px;
  z-index: 110;
  pointer-events: none;
}
/* Deeper than the 0.55 every other Atlas sheet uses, and deliberately so. A
   sheet lays an opaque panel over its scrim and its text sits on that panel;
   this menu has no panel, so every label sits directly on the scrim with
   whatever the page was showing underneath it. On the light themes 0.62 over a
   near-white page is only a mid grey, and a light label on mid grey is the case
   that fails. */
.scrim {
  position: fixed;
  inset: 0;
  background: rgba(2, 5, 9, 0.74);
  pointer-events: auto;
  z-index: 105;
}
.stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  /* Must outrank the scrim, or the whole control vanishes behind it the moment
     it opens. FoodFab shipped that bug once. */
  z-index: 106;
}

/* A solid hairline rather than a dashed accent trace: the rail is structure,
   not a reading. Brighter than the arc it replaced, because it no longer runs
   under the discs and can afford to be seen. Round caps so each segment ends
   cleanly where it meets a disc. */
.orbit {
  fill: none;
  stroke: color-mix(in srgb, var(--dim) 26%, transparent);
  stroke-width: 1;
  stroke-linecap: round;
}

/* Hollow, so the accent is spent once - on the thing you pressed - rather than
   five times over. Its own dark fill is what covers the bar's top hairline
   where the disc crosses it, so the button reads as set into the bar rather
   than resting on the line. */
.fab-core {
  fill: color-mix(in srgb, var(--bg1) 88%, black);
  pointer-events: auto;
  cursor: pointer;
  stroke: var(--acc);
  stroke-width: 1.6;
  filter: drop-shadow(0 0 14px color-mix(in srgb, var(--acc) 40%, transparent));
}
.fab-glyph {
  stroke: var(--acc);
  stroke-width: 2;
  stroke-linecap: round;
  pointer-events: auto;
  cursor: pointer;
  transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.fab-glyph.open {
  transform: rotate(45deg);
}

.sat {
  cursor: pointer;
  pointer-events: auto;
  transform-box: fill-box;
  transform-origin: center;
  animation: satin 0.22s cubic-bezier(0.22, 1, 0.36, 1) backwards;
}
/* Along the arc rather than straight out, which is the whole reason this is an
   orbit and not a menu. */
@keyframes satin {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.7);
  }
}
@media (prefers-reduced-motion: reduce) {
  .sat {
    animation: none;
  }
  .fab-glyph {
    transition: none;
  }
}

/* A dim hairline, and no glow. The colour is carried by the icon alone, which
   is how everything in src/components/marks/ is drawn: the disc is a container,
   not a reading, and four glowing rings over a dimmed screen made the menu the
   brightest thing in the app. */
.sat-ring {
  fill: color-mix(in srgb, var(--bg1) 92%, black);
  stroke: color-mix(in srgb, var(--dim) 34%, transparent);
  stroke-width: 1;
}
/* The primary is louder by one notch of the same material, not by a different
   one - a brighter edge rather than a fill or a glow nothing else has. */
.sat.primary .sat-ring {
  stroke: color-mix(in srgb, var(--dim) 60%, transparent);
}
.sat-art {
  fill: none;
  stroke: currentColor;
  /* 1.6 at the icon's own scale, divided back out by the 0.833 the group is
     scaled by, so it lands at the tab bar's weight rather than 17% thinner. */
  stroke-width: 1.92;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}
.fam-intake {
  color: var(--fam-intake);
}
.fam-activity {
  color: var(--fam-activity);
}
.fam-body {
  color: var(--fam-body);
}

/* A fixed light value, not --ink and not the family colour: this sits on the
   scrim, which is a fixed dark navy on every theme rather than a theme token,
   so the text over it cannot be theme-derived either. The one deliberate
   exception to routing every colour through a custom property, and FoodFab
   reached the same conclusion after trying both. */
/* The plate carries the contrast, so the text can be the theme's own ink and
   stops needing a fixed light value that only ever worked on the dark themes. */
.sat-plate {
  fill: color-mix(in srgb, var(--bg1) 88%, black);
  stroke: color-mix(in srgb, var(--dim) 22%, transparent);
  stroke-width: 1;
}
.sat-label {
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 1.3px;
  text-anchor: middle;
  fill: var(--ink);
  pointer-events: none;
}
</style>
