import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { Capacitor } from "@capacitor/core";
import { load, persist } from "@/utils/storage";

// Theme names must match the [data-theme] selectors in style.css
export const THEMES = [
  { id: "sentinel", label: "Sentinel", sub: "Cyan / void" },
  { id: "ember", label: "Ember", sub: "Amber / phosphor" },
  { id: "paper", label: "Paper", sub: "Sienna / ivory" },
  { id: "mission", label: "Mission", sub: "Blue / daylight" },
];

export const DEFAULT_THEME = "sentinel";

// A stored id that no longer has a [data-theme] block would set an attribute
// nothing styles, leaving the app on whatever :root defines and the native
// background out of step with it. Synth was removed in 2026-07, so any phone
// still holding it needs this. Cheap insurance against the next removal too.
export function resolveTheme(id) {
  return THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME;
}

// Light themes need dark status-bar icons (and vice versa) on device
const LIGHT_THEMES = new Set(["paper", "mission"]);

function applyStatusBar(id) {
  if (!Capacitor.isNativePlatform()) return;
  import("@capacitor/status-bar").then(({ StatusBar, Style }) => {
    StatusBar.setStyle({
      style: LIGHT_THEMES.has(id) ? Style.Light : Style.Dark,
    }).catch(() => {});
  });
}

// Mirrors the chosen theme into native SharedPreferences (via the
// Preferences plugin's default "CapacitorStorage" group) so MainActivity
// can read it synchronously in onCreate(), before the WebView is created -
// capacitor.config.json's backgroundColor is a static build-time value with
// no way to know the user's actual theme, so without this the WebView
// always paints its native background in whatever that static colour is
// (the dark Sentinel void) for a frame or two before the real theme's CSS
// loads, which shows as a stray dark rectangle for anyone on a light theme.
// Only meaningful for the *next* cold start - can't affect the one in
// progress, since native code runs before any of this JS exists yet.
function syncNativeTheme(id) {
  if (!Capacitor.isNativePlatform()) return;
  import("@capacitor/preferences").then(({ Preferences }) => {
    Preferences.set({ key: "atlas_theme_native", value: id })
      .then(() => {
        // **The widgets follow this theme too** (2026-08-19), and unlike the
        // launch background they are on screen right now: a card left in the
        // old palette while the app changed under it is the disagreement this
        // key exists to prevent. `refreshNotification` redraws every placed
        // widget as well as the shade, so one poke covers both.
        import("@capacitor/core").then(({ registerPlugin }) => {
          registerPlugin("HelioBle")
            .refreshNotification()
            .catch(() => {});
        });
      })
      .catch(() => {});
  });
}

export const useThemeStore = defineStore("theme", () => {
  const current = ref(resolveTheme(load("atlas_theme", DEFAULT_THEME)));

  // Apply immediately on store creation so there's no flash of the default theme
  document.documentElement.setAttribute("data-theme", current.value);
  applyStatusBar(current.value);
  syncNativeTheme(current.value);

  function setTheme(id) {
    current.value = resolveTheme(id);
  }

  watch(current, (id) => {
    document.documentElement.setAttribute("data-theme", id);
    persist("atlas_theme", id);
    applyStatusBar(id);
    syncNativeTheme(id);
  });

  return { current, setTheme };
});
