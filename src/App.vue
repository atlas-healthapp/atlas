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
import { computed } from "vue";
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

// Ensures the theme store initialises (and applies data-theme) before first paint
import { useThemeStore } from "@/stores/theme";
useThemeStore();

const profile = useProfileStore();


// Keeps the numbers current while the app is open: a refresh on resume and a
// tick while it is in front of you. Lives here rather than on Home because
// coming back to the app on FITNESS should refresh it too.
useAutoSync();

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
