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
 * A non-release build therefore appends the commit it was built from, giving
 * `1.0.5+a1b2c3d-dev`. Release builds are unchanged: `npm run release` sets
 * ATLAS_RELEASE and gets `1.0.5`.
 *
 * **A dirty tree gets no commit at all**, only `1.0.5+dev`. The sha is a promise
 * that the build is that commit, and a build carrying uncommitted edits is not:
 * naming one would be the same wrong-build bug in a new form, since the commit
 * could be read back and would not contain what was running. Nothing is lost that
 * was true - a dirty build is not identifiable, and saying so is the point.
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
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
    if (dirty) return `${name}+dev`;
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    return `${name}+${sha}-dev`;
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
