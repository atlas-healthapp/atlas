// The device picker in StrapConnect.vue appears on exactly one failure: the one
// where nothing bonded to the phone looked like the strap. It recognises that
// failure by matching the message text, because `onClosed` carries a sentence
// and not a code.
//
// That is a string coupling across two languages, and its failure mode is silent
// in the worst way: reword the Java sentence and the picker simply never appears
// again, for the only people who need it, with nothing failing anywhere. The
// person affected cannot connect at all, so they are also the person least able
// to report that a screen they have never seen did not appear.
//
// So this reads the Java and checks the two still agree, the same approach
// hrBoundsTwin.test.js takes for the heart-rate bounds.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const JAVA = resolve(
  process.cwd(),
  "android/app/src/main/java/io/github/atlashealthapp/atlas/ble/HelioLink.java"
);
const VUE = resolve(process.cwd(), "src/components/settings/StrapConnect.vue");

/** What StrapConnect looks for, kept here so the test states it once. */
const MARKER = "NOT PAIRED TO THIS PHONE";

describe("the not-paired failure and the device picker", () => {
  it("the Vue side still keys the picker off the same marker", () => {
    const vue = readFileSync(VUE, "utf8");
    expect(vue).toContain(`failure.value.includes("${MARKER}")`);
  });

  it("the message Java sends still contains it once uppercased", () => {
    const java = readFileSync(JAVA, "utf8");
    // The sentence is split across string concatenations in the source, so the
    // literals are joined before matching rather than matched one at a time.
    const literals = [...java.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
    const joined = literals.join(" ").toUpperCase();
    expect(joined).toContain(MARKER);
  });

  it("StrapConnect uppercases the failure, which is what makes the match work", () => {
    const vue = readFileSync(VUE, "utf8");
    expect(vue).toMatch(/failure\.value\s*=\s*"COULD NOT CONNECT: "\s*\+\s*\(.*\)\.toUpperCase\(\)/s);
  });

  it("the picker offers a way to undo a wrong pick", () => {
    // A chosen address survives restarts exactly as well as a correct one, so
    // without this a mistake is only fixable by reinstalling, and on Atlas a
    // reinstall costs the entire sample archive.
    const vue = readFileSync(VUE, "utf8");
    expect(vue).toContain("clearDevice");
    expect(vue).toContain("FORGET THE ONE I PICKED");
  });
});
