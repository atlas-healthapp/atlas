// The six months of rollups the condition half of Recovery is judged against.
//
// **A store rather than each screen loading its own.** `recoveryFor` is called
// from four places - Home, BODY, the Recovery page and its history chart - and
// each of them loads a different window: 14 days, 30, and 37. A ceiling derived
// from whatever history each screen happened to have would give the same day
// three different scores on three screens. That is the exact failure the sleep
// score's regularity window had on 2026-08-07, which is why `sleepResultFor`
// now owns its window, and this is the same fix one metric over.
//
// **Loaded once, lazily, and never during boot.** 186 days is 186 reads out of
// IndexedDB, which is an order more than any screen was doing; running that
// while the boot animation is playing would be felt. So nothing awaits it: the
// score falls back to the deviation-only shape until it arrives, which is a
// state it has to handle anyway for a user with under 30 nights.
import { defineStore } from "pinia";
import { ref } from "vue";
import { dailyValuesForRange } from "@/utils/dailyRollup";
import { today, addDays } from "@/utils/date";
import { CEILING_DAYS, LEVEL_WINDOW } from "@/utils/level";

/**
 * A few days past the ceiling window, so the oldest trailing average in it is
 * built from a full seven nights rather than from however many happen to be
 * inside the window's first week.
 */
const LOAD_DAYS = CEILING_DAYS + LEVEL_WINDOW;

export const useLevelsStore = defineStore("levels", () => {
  /** Rollups, oldest first, in the shape dailyValuesForRange returns. */
  const window = ref([]);
  const loadedFor = ref(null);
  const loading = ref(false);

  /**
   * Load the window unless it is already loaded for today.
   *
   * Keyed on the date rather than a boolean so it refreshes once a day without
   * anything having to invalidate it, and re-entrant so four screens mounting at
   * once cannot start four reads.
   */
  async function ensure({ force = false } = {}) {
    const key = today();
    if (!force && loadedFor.value === key) return window.value;
    if (loading.value) return window.value;
    loading.value = true;
    try {
      const to = key;
      const from = addDays(to, -(LOAD_DAYS - 1));
      window.value = await dailyValuesForRange(from, to);
      loadedFor.value = key;
    } catch {
      // A failed read leaves the score on its deviation-only fallback, which is
      // a worse score rather than a broken screen. Retried on the next mount.
      window.value = [];
      loadedFor.value = null;
    } finally {
      loading.value = false;
    }
    return window.value;
  }

  return { window, loading, loadedFor, ensure };
});
