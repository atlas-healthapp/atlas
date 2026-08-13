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
  define: { __APP_VERSION__: JSON.stringify("test") },
  test: {
    environment: "node",
    // scripts/ as well as src/, because the publish audit is the one test whose
    // absence would be expensive: it is what stands between the private repo and
    // a public push, and a check nobody runs provides nothing.
    include: ["src/**/__tests__/**/*.test.js", "scripts/**/__tests__/**/*.test.js"],
  },
});
