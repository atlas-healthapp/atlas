import { onMounted, onUnmounted } from "vue";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useHelioStore } from "@/stores/helio";

// How often the app checks while it is open and in front of you. The stores
// rate limit themselves, so a tick that finds nothing stale costs nothing; this
// only decides how soon after five minutes the check happens.
const TICK_MS = 5 * 60 * 1000;

/**
 * Keeps the numbers current while the app is open.
 *
 * Atlas used to sync exactly once, on Home's mount, and then never again for as
 * long as the app stayed in memory. Unlock the phone at six in the evening and
 * you were looking at whatever the strap had said that morning - which is how a
 * step count of 23 survives a whole day on screen.
 *
 * Two triggers, because one is not enough:
 *
 * - **resume**, which is the common case: the app was backgrounded, the phone
 *   was locked, and the first thing you do is look at it again.
 * - **a tick**, for the case where it never left the foreground. Gated on
 *   `visibilityState`, so a phone in a pocket with the screen off is not waking
 *   the strap every five minutes.
 *
 * Everything here is fire-and-forget by design: this runs from lifecycle hooks
 * with nowhere to surface an error, and a failed refresh must leave the app
 * exactly as it was.
 */
export function useAutoSync() {
  const helio = useHelioStore();

  let timer = null;
  let resumeHandle = null;

  function refresh() {
    // Nothing to talk to in a browser: the store drives a native plugin, and
    // attempting it on the dev server only manufactures a sync error that then
    // shows on Home as though the strap had failed.
    if (!Capacitor.isNativePlatform()) return;
    if (document.visibilityState !== "visible") return;
    helio.refresh().catch(() => null);
  }

  onMounted(async () => {
    timer = setInterval(refresh, TICK_MS);
    // Coming back to a tab is the browser's version of resume, and it is what
    // the dev server exercises. On the phone both fire, and the rate limit in
    // the store is what stops that being two syncs.
    document.addEventListener("visibilitychange", refresh);
    if (Capacitor.isNativePlatform()) {
      resumeHandle = await CapApp.addListener("resume", refresh);
    }
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
    document.removeEventListener("visibilitychange", refresh);
    resumeHandle?.remove();
  });
}
