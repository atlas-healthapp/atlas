import { defineStore } from "pinia";
import { ref } from "vue";

// Tab/nav state - mirrors v10's ui.js pattern (flat refs, no nested reactive state)
export const useUIStore = defineStore("ui", () => {
  const activeTab = ref("home");
  // true while the Home boot sequence is playing - TabBar hides itself until
  // the instrument is online, so the frame doesn't pre-exist the boot
  const bootActive = ref(true);
  // which of Food's own sub-views is showing - a computed writable in
  // FoodTab.vue reads/writes this directly, same pattern as v10's
  // activitySubTab, so external code (Home's VIEW ALL) can set the target
  // sub-tab before switching to the Food tab itself.
  const foodSubTab = ref("diary");
  // Settings is opened from a chip in every tab header, so the flag lives here
  // rather than in App.vue: four components need to open it and none of them
  // are App.vue's children in a way that makes an event practical.
  const settingsOpen = ref(false);

  // ── Android back button plumbing ──────────────────────────────────────
  // Open overlays push a closer onto this stack (via useBackClose); the
  // hardware back button pops the topmost one first, then walks tab
  // history, then minimises the app. Mirrors v10's remembered-tab back.
  const tabHistory = [];
  const _backStack = [];

  function setTab(id) {
    if (id === activeTab.value) return;
    tabHistory.push(activeTab.value);
    if (tabHistory.length > 20) tabHistory.shift();
    activeTab.value = id;
  }

  function goToFood(subTab = "diary") {
    foodSubTab.value = subTab;
    setTab("food");
  }

  // ── the create button ─────────────────────────────────────────────────
  //
  // **The tab underneath does not move while you are creating something.** The
  // button used to switch tabs and let the owning tab open its own sheet, so
  // the page behind the scrim changed the instant you pressed a node, on the
  // way to a sheet that covers it anyway. You go back to where you were far
  // more often than you go on to the tab you just added to.
  //
  // That forces the sheets up out of the tabs: an inactive tab inside
  // `<KeepAlive>` is deactivated and a sheet it teleports leaves the DOM with
  // it, so one owned by FoodTab could not be shown over HOME. They live in
  // `components/create/CreateSheets.vue` now, mounted beside the tab bar. The
  // tab changes **after** something is added, which is when you want to see it.
  const createSheet = ref(null);
  // The section chosen in the add sheet, carried to whichever sheet replaces it
  // so neither asks a question the other just answered.
  const createMealType = ref(null);

  function startCreate(action) {
    createMealType.value = null;
    createSheet.value = action;
  }

  /** Hand off from one create sheet to another, keeping the section. */
  function openCreateSheet(name, mealType = null) {
    if (mealType != null) createMealType.value = mealType;
    createSheet.value = name;
  }

  function closeCreate() {
    createSheet.value = null;
    createMealType.value = null;
  }

  // The day the diary is browsing. Up here rather than inside FoodTab, because
  // the add sheets are no longer inside FoodTab either and something logged
  // from HOME still has to land on the day you were looking at.
  const diaryDate = ref(null);

  function backTab() {
    const prev = tabHistory.pop();
    if (!prev) return false;
    activeTab.value = prev;
    return true;
  }

  function pushBack(closeFn) {
    _backStack.push(closeFn);
    return () => {
      const i = _backStack.indexOf(closeFn);
      if (i >= 0) _backStack.splice(i, 1);
    };
  }

  function popBack() {
    const fn = _backStack.at(-1);
    if (!fn) return false;
    fn();
    return true;
  }

  // Which section to have open on arrival, or null to open the page closed.
  // First run's SET IT UP NOW lands on the strap panel already expanded: sending
  // somebody to a list of nine collapsed rows after they said yes to one of
  // them makes them find it a second time.
  const settingsSection = ref(null);

  function openSettings(section = null) {
    settingsSection.value = section;
    settingsOpen.value = true;
  }

  function closeSettings() {
    settingsOpen.value = false;
  }

  // ── the tour ──────────────────────────────────────────────────────────
  //
  // Offered once, and re-runnable from settings for ever after. The seen flag
  // is in localStorage rather than in this store because it has to survive a
  // reload; the running flag is not, because a tour half-finished when the app
  // was closed should start again rather than resume at step three with no
  // memory of the first two.
  const TOUR_SEEN = "atlas_tour_seen";
  const tourRunning = ref(false);
  const tourSeen = ref(localStorage.getItem(TOUR_SEEN) === "1");

  /** Offer it once, and only from Home: every step points at something there. */
  function maybeStartTour() {
    if (tourSeen.value) return;
    // Not while settings is already open. First run's SET IT UP NOW finishes
    // onboarding and opens settings on the strap panel, which is exactly the
    // moment this would otherwise fire, and the tour draws above - so the page
    // you asked for would be replaced by a tour of the screen behind it. The
    // tour opens settings itself on its last step, which is why this is guarded
    // at the start rather than at every render.
    if (settingsOpen.value) return;
    tourRunning.value = true;
  }

  function startTour() {
    settingsOpen.value = false;
    activeTab.value = "home";
    tourRunning.value = true;
  }

  function endTour() {
    tourRunning.value = false;
    tourSeen.value = true;
    localStorage.setItem(TOUR_SEEN, "1");
  }

  return {
    activeTab,
    bootActive,
    foodSubTab,
    settingsOpen,
    openSettings,
    closeSettings,
    settingsSection,
    tourRunning,
    tourSeen,
    maybeStartTour,
    startTour,
    endTour,
    setTab,
    goToFood,
    createSheet,
    createMealType,
    diaryDate,
    startCreate,
    openCreateSheet,
    closeCreate,
    backTab,
    pushBack,
    popBack,
  };
});
