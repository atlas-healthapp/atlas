import { onMounted, onUnmounted, ref } from "vue";

// How far the finger has to travel before the pull counts, and how far the
// content is allowed to follow it. The travel is deliberately more than the
// trigger: past the threshold the sheet keeps giving a little, which is what
// makes the gesture feel like it is holding rather than stuck.
const TRIGGER_PX = 64;
const MAX_PULL_PX = 96;
// The content moves at less than the finger's speed, so the pull feels weighted
// rather than like the page is loose.
const RESISTANCE = 0.5;
/** Long enough to read a short line without holding the screen hostage. */
const NOTE_MS = 2200;

/**
 * Pull down at the top of a scroller to refresh it.
 *
 * Attached per scroller rather than to the page, because every tab in Atlas
 * scrolls in its own container - each one overscanning past the visible edge to
 * hide Android's overlay scroll bar - so there is no single element a page-level
 * gesture could live on.
 *
 * Only ever starts when the scroller is already at the top. Anywhere else the
 * touch is left completely alone: intercepting a downward drag mid-list is how
 * a pull-to-refresh ends up fighting the scroll it is sitting on.
 *
 * @param elRef    ref to the scrolling element
 * @param onRefresh async function to run; the indicator stays until it settles
 */
export function usePullToRefresh(elRef, onRefresh) {
  // 0 while idle, otherwise how far the content has been dragged down.
  const pull = ref(0);
  const refreshing = ref(false);
  const armed = ref(false);
  // Why the last pull did nothing, held briefly after the spinner stops.
  const note = ref(null);

  let startY = null;

  function onTouchStart(event) {
    const el = elRef.value;
    if (!el || refreshing.value || event.touches.length !== 1) return;
    // Anywhere but the very top, this gesture is a scroll and not ours.
    startY = el.scrollTop <= 0 ? event.touches[0].clientY : null;
  }

  function onTouchMove(event) {
    const el = elRef.value;
    if (startY == null || !el || refreshing.value) return;
    const delta = event.touches[0].clientY - startY;
    if (delta <= 0) {
      // Turned into an upward scroll: hand the gesture back rather than
      // holding it open at zero.
      pull.value = 0;
      armed.value = false;
      startY = null;
      return;
    }
    // The browser would otherwise start an overscroll bounce underneath this.
    if (event.cancelable) event.preventDefault();
    pull.value = Math.min(delta * RESISTANCE, MAX_PULL_PX);
    armed.value = pull.value >= TRIGGER_PX;
  }

  async function onTouchEnd() {
    if (startY == null) return;
    startY = null;
    if (!armed.value) {
      pull.value = 0;
      return;
    }
    armed.value = false;
    refreshing.value = true;
    // Held at the trigger height while the work runs, so the indicator has
    // somewhere to sit and the release does not snap shut before anything
    // visibly happened.
    pull.value = TRIGGER_PX;
    try {
      // A refresh that declined to do anything can say why, and that message is
      // held on screen for a moment after the spinner stops. Snapping shut with
      // nothing changed is indistinguishable from a pull that never registered,
      // which is exactly the confusion this reports out of.
      const reason = await onRefresh();
      refreshing.value = false;
      if (typeof reason === "string" && reason) {
        note.value = reason;
        await new Promise((r) => setTimeout(r, NOTE_MS));
        note.value = null;
      }
    } finally {
      refreshing.value = false;
      note.value = null;
      pull.value = 0;
    }
  }

  onMounted(() => {
    const el = elRef.value;
    if (!el) return;
    // Not passive: the move handler has to be able to cancel the browser's own
    // overscroll, and a passive listener may not.
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
  });

  onUnmounted(() => {
    const el = elRef.value;
    if (!el) return;
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
    el.removeEventListener("touchcancel", onTouchEnd);
  });

  return { pull, refreshing, armed, note, TRIGGER_PX };
}
