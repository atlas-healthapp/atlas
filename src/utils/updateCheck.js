// Is there a newer Atlas than the one running?
//
// **The first thing in Atlas that talks to a server, and the README has to
// change with it.** Until now the only outbound request was a barcode lookup the
// user initiates. This one fires on its own, so it is worth being exact about
// what leaves the phone: a GET to GitHub's public releases API for a public
// repository, with no query string, no body, no identifier, and no account. It
// is the same request anyone loading the releases page in a browser makes.
//
// **Why it exists.** A user on 1.0.5 could not pair their strap because the app
// matched one exact Bluetooth name. That was fixed the same day, and the only way
// they would ever learn is if the author messaged them personally. Every future
// fix has the same problem, so the cost compounds.

import { load, persist } from "@/utils/storage";
import { publishAvailableVersion } from "@/utils/nativeSummary";

const LATEST_URL = "https://api.github.com/repos/atlas-healthapp/atlas/releases/latest";
const RELEASES_PAGE = "https://github.com/atlas-healthapp/atlas/releases/latest";

/** What was found last time, so a launch with no network still knows. */
const CACHE_KEY = "atlas_update_check";

/**
 * How long a result is trusted.
 *
 * GitHub allows 60 unauthenticated requests an hour per IP, which is not a
 * constraint for one call a day, but a release is not something that happens
 * hourly either. Six hours means a fix published in the morning is offered by the
 * evening without the app ever behaving like a poller.
 */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Give up rather than hang a settings screen on a dead network. */
const TIMEOUT_MS = 8000;

/**
 * `1.0.6` -> [1, 0, 6]. Tolerates a `v` prefix, which is how the tags are named,
 * and drops any build suffix, which is how debug builds identify themselves
 * (`1.0.5+a1b2c3d-dev`). A dev build therefore compares as its base version, so
 * it is offered the same update a release would be.
 */
export function parseVersion(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/^v/i, "").split(/[+\-\s]/)[0];
  const parts = cleaned.split(".");
  if (!parts.length || parts.length > 4) return null;
  // **Digits only, and every part non-empty.** `Number("")` is 0, not NaN, so a
  // bare "" and a leading-dash "-1.0.0" (whose split leaves an empty first part)
  // both parsed as version [0] and would have been treated as older than
  // everything - meaning any garbage tag on the releases page would nag every
  // user forever. Caught by the test, not by reading it back.
  if (parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.map((p) => Number(p));
}

/**
 * Is `candidate` newer than `current`? Compares part by part rather than as a
 * number, or 1.0.10 would sort below 1.0.9.
 *
 * Unparseable input is never "newer". A malformed tag on the releases page must
 * not nag every user forever, and an unrecognised local version must not make
 * the app think it is out of date with itself.
 */
export function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** The cached answer, whatever its age. Used to paint before a fetch returns. */
export function cachedUpdate() {
  const cached = load(CACHE_KEY, null);
  if (!cached || typeof cached !== "object") return null;
  // A cached hit is only still a hit if this build is still older than it. After
  // updating, the stale entry would otherwise offer the version now running.
  if (!isNewer(cached.latest, __APP_VERSION__)) return null;
  return { latest: cached.latest, url: cached.url || RELEASES_PAGE, notes: cached.notes ?? "" };
}

/**
 * Hand the answer to native, so the background service can say so once.
 *
 * **Here rather than at the two call sites.** Home and Settings both ask, and a
 * mirror written by one of them is a mirror the other forgets: the same defect
 * `metricRegistry` and `resolveSessions` exist to prevent, one file over. This
 * runs wherever the question is answered, including from the cache, because a
 * launch with no network still knows what it knew yesterday and the service
 * should still be able to say it.
 *
 * Deliberately not awaited by callers and never allowed to throw. Whether there
 * is a newer Atlas is not worth failing a settings screen over, which is the
 * rule the whole module already runs on.
 */
function mirrorToNative(found) {
  if (!found?.latest) return;
  publishAvailableVersion(found.latest).catch(() => null);
}

/**
 * Ask GitHub, at most once every six hours.
 *
 * **Never throws and never rejects.** It is called from app startup and from a
 * settings panel, and no failure here is worth a visible error: not knowing
 * whether an update exists is the normal state, not a fault. Returns the same
 * shape as `cachedUpdate`, or null.
 */
export async function checkForUpdate({ force = false } = {}) {
  const cached = load(CACHE_KEY, null);
  const age = cached?.at ? Date.now() - cached.at : Infinity;
  if (!force && age < MAX_AGE_MS) {
    const found = cachedUpdate();
    mirrorToNative(found);
    return found;
  }

  let controller = null;
  let timer = null;
  try {
    controller = new AbortController();
    timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const response = await fetch(LATEST_URL, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      const found = cachedUpdate();
      mirrorToNative(found);
      return found;
    }
    const body = await response.json();
    const latest = String(body?.tag_name ?? "").replace(/^v/i, "");
    if (!parseVersion(latest)) {
      const found = cachedUpdate();
      mirrorToNative(found);
      return found;
    }

    persist(CACHE_KEY, {
      at: Date.now(),
      latest,
      url: body?.html_url || RELEASES_PAGE,
      // Trimmed hard. The panel shows a line, not a changelog, and a release body
      // can run to several screens.
      notes: String(body?.body ?? "").slice(0, 400),
    });
    const found = cachedUpdate();
    mirrorToNative(found);
    return found;
  } catch {
    // Offline, aborted, rate limited, or GitHub having a bad day. The last known
    // answer is still the best one available.
    const found = cachedUpdate();
    mirrorToNative(found);
    return found;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const RELEASES_URL = RELEASES_PAGE;
