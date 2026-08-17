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
  let onVisible = null;

  /**
   * @param trigger which of the three fired, recorded whatever happens next.
   *
   * **The trigger is logged before the visibility gate, not after.** On
   * 2026-08-14 the app was resumed after a night and did not fetch, and neither
   * `connected` nor the rate limit explained it - which left "the event never
   * fired" and "the event fired and something declined it" indistinguishable,
   * because nothing recorded either. Those are opposite fixes: one needs a
   * different trigger, the other needs a different rule.
   *
   * The gate itself is a real suspect. Android can deliver Capacitor's resume
   * before the WebView flips `visibilityState` to visible, and this returns on
   * that without a word.
   */
  function refresh(trigger) {
    // Nothing to talk to in a browser: the store drives a native plugin, and
    // attempting it on the dev server only manufactures a sync error that then
    // shows on Home as though the strap had failed.
    if (!Capacitor.isNativePlatform()) return;
    if (document.visibilityState !== "visible") {
      helio.noteRefresh(trigger, `skipped: document ${document.visibilityState}`);
      return;
    }
    helio.refresh({ trigger }).catch(() => null);
  }

  /**
   * Re-read the permissions the app can only be told about by the OS.
   *
   * **Deliberately not inside `refresh`.** That is gated on `visibilityState` and
   * rate limited to five minutes, and neither applies here: this costs one call
   * across the bridge, spends nothing on the strap, and the one moment it most
   * needs to run is the resume that arrives *before* the WebView is marked
   * visible, having just come back from the system settings screen where the user
   * granted the thing. Skipping it there would leave the panel warning about a
   * permission that had been granted seconds earlier.
   */
  function recheckPermissions() {
    if (!Capacitor.isNativePlatform()) return;
    helio.checkExactAlarm();
  }

  onMounted(async () => {
    timer = setInterval(() => refresh("tick"), TICK_MS);
    recheckPermissions();
    // Coming back to a tab is the browser's version of resume, and it is what
    // the dev server exercises. On the phone both fire, and the rate limit in
    // the store is what stops that being two syncs.
    onVisible = () => {
      refresh("visible");
      recheckPermissions();
    };
    document.addEventListener("visibilitychange", onVisible);
    if (Capacitor.isNativePlatform()) {
      resumeHandle = await CapApp.addListener("resume", () => {
        refresh("resume");
        recheckPermissions();
      });
    }
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
    if (onVisible) document.removeEventListener("visibilitychange", onVisible);
    resumeHandle?.remove();
  });
}
