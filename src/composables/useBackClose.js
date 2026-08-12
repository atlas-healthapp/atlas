import { onMounted, onUnmounted } from "vue";
import { useUIStore } from "@/stores/ui";

// Overlays call this with their close action so the Android back button
// dismisses them (topmost first) instead of leaving the screen - the
// "stuck at the protocols screen" problem. Overlays are v-if mounted, so
// mount/unmount exactly brackets their open state.
export function useBackClose(close) {
  const ui = useUIStore();
  let unregister = null;
  onMounted(() => {
    unregister = ui.pushBack(close);
  });
  onUnmounted(() => unregister?.());
}
