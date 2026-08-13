import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * The version, read from the same file the APK is built with.
 *
 * **Baked in at build time rather than asked of the platform.** `@capacitor/app`
 * could report it natively, but then the dev server has no version at all and
 * the number on screen would come from a different source than the number in the
 * APK. One file, `android/version.properties`, feeds both.
 *
 * **Only a release build gets the bare number, and that is the whole point.**
 * `version.properties` promises that "a bug report naming 1.0.7 identifies
 * exactly one APK", and until 2026-08-13 that was untrue: a debug build carries
 * whatever versionName happened to be in the file when it was built, so the
 * author's phone read 1.0.4 while holding a day of fixes that the released 1.0.4
 * did not have. The strap diagnostic's COPY DETAILS reported that same string,
 * so a bug report would have named the wrong build.
 *
 * A non-release build therefore appends the commit it was built from, and marks
 * a dirty tree, giving `1.0.5+a1b2c3d-dev` or `1.0.5+a1b2c3d-dirty`. Release
 * builds are unchanged: `npm run release` sets ATLAS_RELEASE and gets `1.0.5`.
 */
function appVersion() {
  let name = "dev";
  try {
    const props = readFileSync(resolve(__dirname, "android/version.properties"), "utf8");
    name = props.match(/^versionName=(.+)$/m)?.[1].trim() ?? "dev";
  } catch {
    return "dev";
  }
  if (process.env.ATLAS_RELEASE) return name;

  // Never fatal. A build outside a git checkout still has to produce something,
  // and "unknown" is honest where a bare version number would be a lie.
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
    return `${name}+${sha}${dirty ? "-dirty" : "-dev"}`;
  } catch {
    return `${name}+unknown-dev`;
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
