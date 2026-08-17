import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { parseVersion, isNewer } from "@/utils/updateCheck";

/**
 * The comparison, which is the whole feature.
 *
 * A wrong answer here is worse than no feature at all in both directions: a false
 * positive nags every user forever about a version that does not exist, and a
 * false negative leaves somebody stuck on a build whose bug has been fixed -
 * which is exactly the situation that prompted this.
 */
describe("parseVersion", () => {
  it("reads the shapes the releases page actually produces", () => {
    expect(parseVersion("1.0.6")).toEqual([1, 0, 6]);
    expect(parseVersion("v1.0.6")).toEqual([1, 0, 6]);
    expect(parseVersion("V1.0.6")).toEqual([1, 0, 6]);
    expect(parseVersion(" 1.0.6 ")).toEqual([1, 0, 6]);
  });

  it("drops the build suffix a debug build carries", () => {
    // vite stamps 1.0.5+a1b2c3d-dev on anything that is not a release, so a dev
    // build has to compare as its base version or it would never be offered an
    // update.
    expect(parseVersion("1.0.5+a1b2c3d-dev")).toEqual([1, 0, 5]);
    // A build off a dirty tree carries no commit, since it is not that commit.
    expect(parseVersion("1.0.5+dev")).toEqual([1, 0, 5]);
    expect(parseVersion("1.0.5+unknown-dev")).toEqual([1, 0, 5]);
  });

  it("refuses what it cannot read rather than guessing", () => {
    for (const bad of [null, undefined, 106, "", "latest", "1.0.x", "-1.0.0", "1.2.3.4.5"]) {
      expect(parseVersion(bad)).toBeNull();
    }
  });
});

describe("isNewer", () => {
  it("offers a genuinely newer release", () => {
    expect(isNewer("1.0.6", "1.0.5")).toBe(true);
    expect(isNewer("1.1.0", "1.0.9")).toBe(true);
    expect(isNewer("2.0.0", "1.9.9")).toBe(true);
  });

  it("does not offer the version already running", () => {
    expect(isNewer("1.0.5", "1.0.5")).toBe(false);
    expect(isNewer("v1.0.5", "1.0.5")).toBe(false);
    expect(isNewer("1.0.5", "1.0.5+a1b2c3d-dev")).toBe(false);
  });

  it("does not offer an older one", () => {
    expect(isNewer("1.0.4", "1.0.5")).toBe(false);
    expect(isNewer("0.9.9", "1.0.0")).toBe(false);
  });

  it("compares parts as numbers, not as text", () => {
    // The bug this exists to prevent: 1.0.10 sorts below 1.0.9 as a string, so
    // the tenth release would never be offered to anyone on the ninth.
    expect(isNewer("1.0.10", "1.0.9")).toBe(true);
    expect(isNewer("1.0.9", "1.0.10")).toBe(false);
    expect(isNewer("1.10.0", "1.9.0")).toBe(true);
  });

  it("treats a missing part as zero", () => {
    expect(isNewer("1.1", "1.0.9")).toBe(true);
    expect(isNewer("1.0", "1.0.0")).toBe(false);
  });

  it("never says yes on input it cannot parse", () => {
    // A malformed tag must not nag every user forever, and an unreadable local
    // version must not make the app think it is out of date with itself.
    expect(isNewer("latest", "1.0.5")).toBe(false);
    expect(isNewer("1.0.6", "not-a-version")).toBe(false);
    expect(isNewer(null, "1.0.5")).toBe(false);
    expect(isNewer("1.0.6", null)).toBe(false);
  });
});

describe("checkForUpdate", () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
  });
  afterEach(() => vi.unstubAllGlobals());

  it("never throws when the network is gone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { checkForUpdate } = await import("@/utils/updateCheck");
    await expect(checkForUpdate({ force: true })).resolves.toBeNull();
  });

  it("never throws on a non-200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const { checkForUpdate } = await import("@/utils/updateCheck");
    await expect(checkForUpdate({ force: true })).resolves.toBeNull();
  });

  it("never throws on a body it cannot read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: "nightly" }) })
    );
    const { checkForUpdate } = await import("@/utils/updateCheck");
    await expect(checkForUpdate({ force: true })).resolves.toBeNull();
  });

  it("reports a newer release and remembers it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ tag_name: "v9.9.9", html_url: "https://example.test/r", body: "notes" }),
      })
    );
    const { checkForUpdate, cachedUpdate } = await import("@/utils/updateCheck");
    const out = await checkForUpdate({ force: true });
    expect(out.latest).toBe("9.9.9");
    expect(out.url).toBe("https://example.test/r");
    // Survives a reload without another request, which is the point of caching.
    expect(cachedUpdate().latest).toBe("9.9.9");
  });

  it("does not report a release that is not newer than this build", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: "v0.0.1" }) })
    );
    const { checkForUpdate } = await import("@/utils/updateCheck");
    expect(await checkForUpdate({ force: true })).toBeNull();
  });

  it("does not call out again inside the cache window", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v9.9.9" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { checkForUpdate } = await import("@/utils/updateCheck");
    await checkForUpdate({ force: true });
    await checkForUpdate();
    await checkForUpdate();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
