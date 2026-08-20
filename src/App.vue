<template>
  <div id="app-shell">
    <!-- Masks the status-bar strip. The tabs are scroll containers whose top
         padding scrolls away with their content, so without this, scrolled
         content rides up underneath the clock and battery icons. -->
    <div class="statusmask" />
    <KeepAlive>
      <component :is="currentTab" />
    </KeepAlive>
    <TabBar
      :active="ui.activeTab"
      :class="{ 'boot-hidden': ui.bootActive }"
      @change="ui.setTab($event)"
    />
    <!-- Beside the tab bar rather than inside it: it is drawn over the bar and
         over the page, and it hides with the bar during boot for the same
         reason - the frame should not pre-exist the instrument. -->
    <CreateFab
      v-if="!ui.bootActive && profile.onboarded"
      @create="ui.startCreate($event)"
    />
    <!-- Beside the button rather than inside a tab: a deactivated KeepAlive tab
         takes its teleported sheets with it, and the tab underneath is supposed
         to stay where it was. -->
    <CreateSheets />
    <SettingsPage v-if="ui.settingsOpen" @close="ui.closeSettings()" />
    <!-- Last, and above everything: there is nothing behind it worth seeing,
         and the Home boot sequence should not play to a first-time user. -->
    <FirstRun v-if="!profile.onboarded" />
    <!-- After first run, never during it, and only on Home: every step points
         at something on that screen, and the boot animation has to have
         finished or the targets are still fading in. -->
    <Tour v-if="tourShowing" :steps="TOUR_STEPS" @close="ui.endTour()" />
  </div>
</template>

<script setup>
import { computed, onMounted } from "vue";
import { useUIStore } from "@/stores/ui";
import TabBar from "./components/layout/TabBar.vue";
import CreateFab from "./components/layout/CreateFab.vue";
import CreateSheets from "./components/create/CreateSheets.vue";
import HomeTab from "./components/home/HomeTab.vue";
import FoodTab from "./components/food/FoodTab.vue";
import BodyTab from "./components/body/BodyTab.vue";
import ActivityTab from "./components/activity/ActivityTab.vue";
import SettingsPage from "./components/settings/SettingsPage.vue";
import FirstRun from "./components/onboarding/FirstRun.vue";
import Tour from "./components/onboarding/Tour.vue";
import { TOUR_STEPS } from "./components/onboarding/tourSteps";
import { watch } from "vue";
import { useProfileStore } from "@/stores/profile";
import { useAutoSync } from "@/composables/useAutoSync";
import { useSessionsStore } from "@/stores/sessions";
import { useHelioStore } from "@/stores/helio";
import { useCheckinStore } from "@/stores/checkin";

// Ensures the theme store initialises (and applies data-theme) before first paint
import { useThemeStore } from "@/stores/theme";
useThemeStore();

const profile = useProfileStore();
const sessions = useSessionsStore();
const helio = useHelioStore();
const checkin = useCheckinStore();


// Keeps the numbers current while the app is open: a refresh on resume and a
// tick while it is in front of you. Lives here rather than on Home because
// coming back to the app on FITNESS should refresh it too.
useAutoSync();

/**
 * Fill in a manual session's heart rate and calories whenever a sync lands.
 *
 * **Here rather than in the sheet that stopped the session.** The readings are
 * not available at STOP - the band hands the window over later - so a sheet that
 * computed them once would compute them at the only moment they cannot be known.
 * Watching the sync means it fills in whenever it can, however the app got there:
 * a background run drained on resume, a pull-to-refresh, or the forced sync STOP
 * itself asks for.
 *
 * Failures are swallowed on purpose. This is an enrichment of rows that already
 * render correctly without it, and an archive read that throws must not take the
 * app down with it.
 */
watch(
  () => helio.lastSyncAt,
  async () => {
    try {
      const { measurePendingSessions, profileFor } = await import(
        "@/composables/useSessionMeasurements"
      );
      const { getWorkouts } = await import("@/utils/sampleDb");
      // The band's own records, only ever read, and only to fit the personal
      // calorie constant against figures it actually measured.
      const band = await getWorkouts(Date.now() - 120 * 86400_000, Date.now());
      await measurePendingSessions({
        sessionsStore: sessions,
        profile: profileFor(profile, checkin),
        bandSessions: band,
      });
    } catch {
      // Nothing here is load-bearing for what is already on screen.
    }
  }
);

// Status-bar icon style lives in the theme store now (light themes need
// dark icons); it applies on store init and on every theme change.
import { Capacitor } from "@capacitor/core";

// Hardware back: close the topmost overlay if any, else step back through
// tab history, else hand the app to the launcher (v10's back behaviour)
if (Capacitor.isNativePlatform()) {
  import("@capacitor/app").then(({ App: CapApp }) => {
    CapApp.addListener("backButton", () => {
      const uiStore = useUIStore();
      if (uiStore.popBack()) return;
      if (uiStore.backTab()) return;
      CapApp.minimizeApp();
    });
  });
}

const ui = useUIStore();

/**
 * Arriving from a widget: land on the thing the widget was showing.
 *
 * **The target is read here and routed here, but opened by whichever tab owns
 * the page.** App.vue cannot open a drill-through - they are mounted inside the
 * tabs, and a tab inside `<KeepAlive>` takes anything it teleports with it - so
 * this switches to the owning tab and leaves the target for it to claim.
 *
 * Read on mount and on every resume, because a widget tap on a running app is a
 * resume rather than a launch. `MainActivity` writes it into the same
 * SharedPreferences group the theme already travels in; nothing native can
 * reach the app any other way round.
 */
const OPEN_TAB = { steps: "activity", heart: "body", sleep: "home", home: "home" };

async function readWidgetTarget() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key: "atlas_widget_open" });
    if (!value) return;
    // Cleared immediately, so a target can never be acted on twice - once by
    // the tab that owns it and again on the next resume.
    await Preferences.set({ key: "atlas_widget_open", value: "" });
    // **The running session opens its sheet rather than a tab**, because the
    // thing you came here to do is stop it, and the sheet is the only place that
    // can. It is not in OPEN_TAB for the same reason: there is no tab that owns
    // a running session now that the row appears under every one of them.
    //
    // Native cannot end a session itself - the record lives in localStorage,
    // which Java cannot reach - so the notification's STOP brings you to the app
    // and the app does it. That is the same division the widgets run on: the app
    // is the authority, native restates it.
    if (value === "session") {
      ui.openCreateSheet("add-activity");
      return;
    }
    const tab = OPEN_TAB[value];
    if (!tab) return;
    ui.setTab(tab);
    // HOME needs no claim: it is where the TODAY card already points.
    if (value !== "home") ui.pendingOpen = value;
  } catch {
    // A widget that cannot say where it came from still opens the app.
  }
}

onMounted(readWidgetTarget);
if (Capacitor.isNativePlatform()) {
  import("@capacitor/app").then(({ App: CapApp }) => {
    CapApp.addListener("resume", readWidgetTarget);
  });
}

/**
 * Only on Home, and only once the boot animation has ended.
 *
 * Both conditions are load-bearing. Every step points at something on Home, and
 * during boot the cards stagger in, so a tour starting on the same tick would
 * measure a target still fading and cut its hole around the wrong box.
 */
const tourShowing = computed(
  () =>
    ui.tourRunning &&
    ui.activeTab === "home" &&
    !ui.bootActive
);

// Offered the first time the app is genuinely usable: after first run, and
// after the boot has played. Watching rather than firing on mount, because on a
// first launch onboarding is still on screen when App mounts.
watch(
  () => [profile.onboarded, ui.bootActive],
  ([onboarded, booting]) => {
    if (onboarded && !booting) ui.maybeStartTour();
  },
  { immediate: true }
);


const tabs = { home: HomeTab, food: FoodTab, body: BodyTab, activity: ActivityTab };
// Falls back to Home rather than rendering nothing, the same guard
// resolveTheme() gives a stored theme id that no longer exists. "trends" is
// exactly that case: the tab was retired on 2026-07-29.
const currentTab = computed(() => tabs[ui.activeTab] ?? HomeTab);
</script>

<style>
#app-shell {
  height: 100%;
  /* The frame that clips each tab's overscan, hiding the Android overlay
     scroll bar. See --sb-overscan in style.css. */
  overflow: hidden;
}
.statusmask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: env(safe-area-inset-top);
  /* The page gradient, anchored to the viewport so this is a seamless
     continuation of it rather than a flat fill sitting on top. A flat --bg1
     here read as an obvious band across the top in every light theme. */
  background-image: var(--page-bg);
  background-size: 100vw 100vh;
  background-position: 0 0;
  background-repeat: no-repeat;
  /* Above tab content, below the tab bar (100) and the settings drawer. */
  z-index: 90;
  pointer-events: none;
}
</style>
