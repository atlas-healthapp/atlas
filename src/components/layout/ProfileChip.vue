<template>
  <button
    class="chip mono"
    type="button"
    :aria-label="`Settings${profile.name ? ', signed in as ' + profile.name : ''}`"
    @click.stop="ui.openSettings()"
  >
    {{ profile.initials }}
  </button>
</template>

<script setup>
import { useProfileStore } from "@/stores/profile";
import { useUIStore } from "@/stores/ui";

const profile = useProfileStore();
const ui = useUIStore();
</script>

<style scoped>
/* Solid fill, so both colours come from the theme and it inverts with it: the
   accent as the ground and the page background as the ink. Never hardcoded, so
   every theme gets a chip that matches without a per-theme rule.
   Letter-spacing is nearly zero: mono tracking that suits a label pushes two
   capitals off-centre inside a circle. */
.chip {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: var(--acc);
  color: var(--bg1);
  font-size: 14.5px;
  letter-spacing: 0.3px;
  line-height: 1;
  cursor: pointer;
  /* Deliberately identical to the avatar in SettingsPage's header: the chip
     should not appear to change size or move when the page it opens replaces
     the screen. The visual circle is 34px but the tap area needs 48dp, and
     padding would grow the circle, so the target is extended outward. */
  position: relative;
}
.chip::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 48px;
  height: 48px;
  transform: translate(-50%, -50%);
}
.chip:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
.chip:active {
  opacity: 0.75;
}
</style>
