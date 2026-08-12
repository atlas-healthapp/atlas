import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * The version, read from the same file the APK is built with.
 *
 * **Baked in at build time rather than asked of the platform.** `@capacitor/app`
 * could report it natively, but then the dev server has no version at all and
 * the number on screen would come from a different source than the number in the
 * APK. One file, `android/version.properties`, feeds both.
 */
function appVersion() {
  try {
    const props = readFileSync(resolve(__dirname, "android/version.properties"), "utf8");
    return props.match(/^versionName=(.+)$/m)?.[1].trim() ?? "dev";
  } catch {
    return "dev";
  }
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
