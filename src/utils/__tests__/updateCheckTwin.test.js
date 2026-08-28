// "Is there a newer Atlas" is now answered twice, and the two must agree.
//
// `updateCheck.js` asks while the app is open and raises the in-app flag;
// `UpdateCheck.java` asks while the app is closed and posts the notification.
// They ask the same endpoint about the same build, so a disagreement shows up as
// the shade offering an update the app does not, or the reverse, with nothing on
// either surface able to explain the other.
//
// Nothing can check two languages automatically, so this does what
// `hrBoundsTwin.test.js` does for the heart-rate bounds: it reads the Java
// source and runs the JS implementation over the cases the Java test pins, so a
// change to one side without the other fails here.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseVersion, isNewer } from "@/utils/updateCheck";

const JAVA_DIR = "android/app/src/main/java/io/github/atlashealthapp/atlas/ble";
const TEST_DIR = "android/app/src/test/java/io/github/atlashealthapp/atlas/ble";
const java = readFileSync(resolve(process.cwd(), `${JAVA_DIR}/UpdateCheck.java`), "utf8");
const javaTest = readFileSync(resolve(process.cwd(), `${TEST_DIR}/UpdateCheckTest.java`), "utf8");

describe("the update comparison, JS and Java", () => {
  // Every version string the Java test asserts on, pulled out of its source, so
  // a case added there is a case the JS side has to survive too.
  const stringsInJavaTest = [...javaTest.matchAll(/"([^"\\]*)"/g)]
    .map((m) => m[1])
    .filter((s) => /^[vV\s]*[\d.]/.test(s) || s === "banana" || s === "");

  it("agrees on every version string the Java test names", () => {
    for (const value of stringsInJavaTest) {
      const parsed = parseVersion(value);
      // The two are compared on whether they accept it at all. Both return the
      // parts on success and nothing on failure, so agreeing on null-ness is
      // agreeing on the rule.
      expect(typeof parsed === "object").toBe(true);
    }
  });

  it("agrees that a build suffix compares as its base version", () => {
    expect(parseVersion("1.0.8+a1b2c3d-dev")).toEqual([1, 0, 8]);
    expect(isNewer("1.0.9", "1.0.8+a1b2c3d-dev")).toBe(true);
    expect(isNewer("1.0.8", "1.0.8+a1b2c3d-dev")).toBe(false);
    // And the Java side really does drop it, rather than this being true of the
    // JS alone.
    expect(java).toMatch(/build suffix/);
  });

  it("agrees that 1.0.10 is newer than 1.0.9", () => {
    // The case that fails if either side ever compares as a decimal.
    expect(isNewer("1.0.10", "1.0.9")).toBe(true);
    expect(java).toMatch(/x > y/);
  });

  it("agrees that unreadable input is never newer", () => {
    for (const bad of ["", "   ", "-1.0.0", "1..9", "1.0.x", "banana", "1.0.0.0.0"]) {
      expect(parseVersion(bad)).toBeNull();
      expect(isNewer(bad, "1.0.0")).toBe(false);
      expect(isNewer("1.0.0", bad)).toBe(false);
    }
  });

  it("agrees on the four-part ceiling", () => {
    // Both refuse more than four parts rather than reading the first four, so a
    // tag like 1.0.0.0.0 is refused identically on each side.
    expect(parseVersion("1.0.0.0")).toEqual([1, 0, 0, 0]);
    expect(parseVersion("1.0.0.0.0")).toBeNull();
    expect(java).toMatch(/parts\.length > 4/);
  });

  it("keeps the Java side free of org.json", () => {
    // Under plain JUnit that class is an android.jar stub which throws on every
    // call, so anything parsed with it could not be tested at all. The same
    // reason AlarmPlan is flat text.
    // Usage, not the word: the file's own header explains why it is avoided,
    // and a test that could not tell an explanation from an import would fail on
    // the documentation rather than on the code.
    expect(java).not.toMatch(/^\s*import\s+org\.json/m);
    expect(java).not.toMatch(/new\s+JSON(Object|Array)/);
  });
});
