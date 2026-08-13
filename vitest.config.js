import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Mirrors vite.config.js, which bakes the real version in from
  // android/version.properties. Without it anything reading the constant throws
  // "__APP_VERSION__ is not defined" under test only - which is how the strap
  // diagnostic ended up untestable, since reporting the version is most of what
  // it does.
  // A real version shape, not the word "test". updateCheck compares the running
  // build against the newest release, and an unparseable local version makes
  // every such comparison vacuously false - so with "test" here the update tests
  // passed by never comparing anything.
  define: { __APP_VERSION__: JSON.stringify("1.0.0") },
  test: {
    environment: "node",
    // scripts/ as well as src/, because the publish audit is the one test whose
    // absence would be expensive: it is what stands between the private repo and
    // a public push, and a check nobody runs provides nothing.
    include: ["src/**/__tests__/**/*.test.js", "scripts/**/__tests__/**/*.test.js"],
  },
});
