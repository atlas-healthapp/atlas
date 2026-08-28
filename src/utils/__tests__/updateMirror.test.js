// The app asks GitHub; the background service only restates the answer.
//
// `updateCheck` caches what it found in localStorage, which Java cannot read, so
// it mirrors the version into SharedPreferences and `HelioSyncService` posts one
// notification about it. The mirror is the part that can silently stop working:
// nothing on screen depends on it, so if it stopped being written the in-app
// flag would carry on being right and the notification would simply never come.
//
// Its own file because it needs the native bridge mocked, and the comparison
// tests next door deliberately have no mocks at all.
import { describe, it, expect, beforeEach, vi } from "vitest";

const setSpy = vi.fn();
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({ refreshNotification: vi.fn() }),
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { set: (...args) => setSpy(...args) },
}));

const { checkForUpdate } = await import("@/utils/updateCheck");

function stubLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

/** The shape GitHub's releases API returns, trimmed to what is read. */
function githubReturns(tag) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ tag_name: tag, html_url: "https://example.invalid/r", body: "notes" }),
  }));
}

describe("mirroring the available version to native", () => {
  beforeEach(() => {
    stubLocalStorage();
    setSpy.mockClear();
  });

  const mirrored = () =>
    setSpy.mock.calls
      .filter(([arg]) => arg?.key === "atlas_update_native")
      .map(([arg]) => arg.value);

  it("publishes a version newer than the one running", async () => {
    // __APP_VERSION__ is 1.0.0 under test, set in vitest.config.js.
    githubReturns("v1.0.9");
    await checkForUpdate({ force: true });
    expect(mirrored()).toEqual(["1.0.9"]);
  });

  it("publishes nothing when the running build is already current", async () => {
    // The service must not be handed a version to announce when there is no
    // update: it would post "Atlas 1.0.0 is available" to somebody on 1.0.0.
    githubReturns("v1.0.0");
    await checkForUpdate({ force: true });
    expect(mirrored()).toEqual([]);
  });

  it("publishes nothing for a tag it cannot read", async () => {
    githubReturns("not-a-version");
    await checkForUpdate({ force: true });
    expect(mirrored()).toEqual([]);
  });

  // The service's watermark is keyed on the version string, so the app
  // republishing the same one on every check is what makes the notification fire
  // once rather than never: the value has to keep being written, and being
  // written again must not mean anything new.
  it("keeps publishing the same version while it stays unacted on", async () => {
    githubReturns("v1.0.9");
    await checkForUpdate({ force: true });
    await checkForUpdate({ force: true });
    expect(mirrored()).toEqual(["1.0.9", "1.0.9"]);
  });

  it("still publishes from the cache when GitHub cannot be reached", async () => {
    // A launch with no network still knows what it knew yesterday, and the
    // service should still be able to say it.
    githubReturns("v1.0.9");
    await checkForUpdate({ force: true });
    setSpy.mockClear();

    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    await checkForUpdate({ force: true });
    expect(mirrored()).toEqual(["1.0.9"]);
  });
});
