// The auto-session floor exists twice, in JS and in Java, and nothing else can
// tell whether the two agree.
//
// `resolveSessions.js` hides a band-detected session under five minutes from
// every surface in the app; `HelioSyncService.announceSessions` decides whether
// to post a notification about one. Both need the same idea of what counts as
// the band guessing, or the phone announces something the app will not show.
// That is not hypothetical: on 2026-08-28 the Java side had no floor at all, and
// a three-minute session arrived as a notification pointing at an app where it
// could not be found anywhere.
//
// So this reads the Java source the way `hrBoundsTwin.test.js` reads
// `HelioFetch.java` and `families.test.js` reads `style.css`. A comment saying
// "change both or neither" is what the smart alarm has, and it is not a test.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MIN_AUTO_SESSION_SECONDS } from "@/components/activity/resolveSessions";

const JAVA = resolve(
  process.cwd(),
  "android/app/src/main/java/io/github/atlashealthapp/atlas/ble/HelioSyncService.java"
);

const source = readFileSync(JAVA, "utf8");

describe("the auto-session floor, JS and Java", () => {
  it("is the same number of seconds on both sides", () => {
    // Written `5 * 60` in both files rather than as 300, so the match is on the
    // expression: a reader of either one should see the minutes.
    const match = /static final int MIN_AUTO_SESSION_SECONDS\s*=\s*([\d\s*]+);/.exec(source);
    expect(match).not.toBeNull();
    // eslint-disable-next-line no-eval
    const java = Number(eval(match[1]));
    expect(java).toBe(MIN_AUTO_SESSION_SECONDS);
  });

  it("still guards the announcement it was added for", () => {
    // The constant agreeing is worth nothing if nothing consults it. This is the
    // shape of the bug rather than its arithmetic: `announceSessions` counted
    // every record newer than its watermark and asked no further questions.
    expect(source).toMatch(/!isDetectionNoise\(w\)/);
  });

  it("keeps the watermark moving over a record it will not announce", () => {
    // A skipped session still has to advance `newest`, or it is reconsidered on
    // every run for good. The two are deliberately separate statements in the
    // loop, so this checks the one that must NOT be gated is not.
    const loop = source.slice(source.indexOf("for (final HelioFetch.Workout w : workouts)"));
    const body = loop.slice(0, loop.indexOf("if (newest <= seen)"));
    const watermark = body.indexOf("newest = w.startMillis;");
    const announce = body.indexOf("!isDetectionNoise(w)");
    expect(watermark).toBeGreaterThan(-1);
    expect(announce).toBeGreaterThan(watermark);
  });
});
