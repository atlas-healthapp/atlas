import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./style.css";

if (import.meta.env.DEV) {
  /**
   * `?fresh` wipes everything and skips the seed, which is the only way to see
   * what a new user sees.
   *
   * A plain empty browser profile does NOT do it: `seedIfEmpty` fires precisely
   * when storage is empty, so the fresh install case is the one path the dev
   * server could never show you. Onboarding, the goal defaults and the
   * short-history states are all invisible without this.
   *
   * The wipe covers IndexedDB as well as localStorage, or the sample archive
   * survives and the app opens with months of history and no profile, which is
   * a state no real user can ever be in.
   */
  if (new URLSearchParams(location.search).has("fresh")) {
    localStorage.clear();
    const { clearAll } = await import("./utils/sampleDb.js");
    await clearAll().catch(() => null);
  } else {
    const { seedIfEmpty } = await import("./dev/seed.js");
    // Awaited: the IndexedDB half used to land after mount, so anything reading
    // a sample store once on mount rendered its empty state on first paint.
    await seedIfEmpty();
  }
}

createApp(App).use(createPinia()).mount("#app");
