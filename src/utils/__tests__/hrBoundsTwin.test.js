// The heart-rate bounds exist twice, in JS and in Java, and nothing else can
// tell whether the two agree.
//
// `HelioFetch.java` drops the band's 0xff "no reading" sentinel at the decoder
// and `bodyMetrics.js` drops it again on ingest. Both need the same idea of what
// a heart rate is, or one of them starts storing or publishing something the
// other would refuse. That is not hypothetical: on 2026-08-19 the Java side had
// no bounds at all beyond `> 0`, and a strap on its charger published 255 BPM to
// the widgets while the archive stayed clean.
//
// So this reads the Java source the way `families.test.js` reads `style.css`,
// and fails if the numbers drift apart. A comment saying "change both or neither"
// is what the alarm byte layout had, and it is not a test.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidHr } from "@/utils/bodyMetrics";

const JAVA = resolve(
  process.cwd(),
  "android/app/src/main/java/io/github/atlashealthapp/atlas/ble/HelioFetch.java"
);

function javaConstant(name) {
  const source = readFileSync(JAVA, "utf8");
  const match = new RegExp(`static final int ${name}\\s*=\\s*(\\d+)\\s*;`).exec(source);
  if (!match) throw new Error(`${name} not found in HelioFetch.java`);
  return Number(match[1]);
}

describe("heart-rate bounds, JS and Java", () => {
  it("agree on the lowest reading that counts", () => {
    const min = javaConstant("HR_PLAUSIBLE_MIN");
    expect(isValidHr(min)).toBe(true);
    expect(isValidHr(min - 1)).toBe(false);
  });

  it("agree on the highest reading that counts", () => {
    const max = javaConstant("HR_PLAUSIBLE_MAX");
    expect(isValidHr(max)).toBe(true);
    expect(isValidHr(max + 1)).toBe(false);
  });

  it("both refuse the band's 0xff sentinel", () => {
    expect(javaConstant("HR_PLAUSIBLE_MAX")).toBeLessThan(255);
    expect(isValidHr(255)).toBe(false);
  });

  // The bug was not that the bounds disagreed, it was that Java had none. This
  // asserts the decoder actually consults them, so deleting the call fails here
  // rather than silently on somebody's home screen.
  it("the decoder filters heart rate through the check, not just `> 0`", () => {
    const source = readFileSync(JAVA, "utf8");
    expect(source).toMatch(/if \(isRealHeartRate\(hr\)\) \{/);
    expect(source).toMatch(/isRealHeartRate\(resting\)/);
  });
});
