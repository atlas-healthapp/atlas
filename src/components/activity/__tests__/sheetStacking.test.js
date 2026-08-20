// **A sheet below the tab bar looks perfect and cannot be tapped.**
//
// SessionSheet shipped its first draft at z-index 60. The tab bar is 100 and the
// create button is 110, so the STOP and DISCARD buttons at the bottom of the
// sheet sat underneath them: the sheet rendered completely correctly, and a tap
// on STOP went to the tab bar. Nothing failed, nothing logged, and the only
// symptom was a button that did nothing.
//
// It was found by asking `elementFromPoint` what was actually on top of the
// button rather than by looking at the screen, which is the same class of defect
// as the widget's negative margin: a touch target outside its parent, where
// Android delivers the tap somewhere else entirely.
//
// This is a source check rather than a rendered one, because there is no Vue
// component test harness in this project. It cannot prove the sheet is tappable;
// it can prove nobody quietly drops one below the furniture again.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function topZIndex(file) {
  const css = readFileSync(resolve(process.cwd(), file), "utf8");
  const values = [...css.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]));
  expect(values.length, `no z-index found in ${file}`).toBeGreaterThan(0);
  return Math.max(...values);
}

const TAB_BAR = "src/components/layout/TabBar.vue";
const CREATE_FAB = "src/components/layout/CreateFab.vue";

// Every full-screen sheet the create button can open. Each has to clear the
// furniture, and each has been checked by hand at least once.
const SHEETS = [
  "src/components/activity/SessionSheet.vue",
  "src/components/activity/ManualSessionSheet.vue",
  "src/components/food/MealPickSheet.vue",
];

describe("sheets sit above the tab bar and the create button", () => {
  const furniture = Math.max(topZIndex(TAB_BAR), topZIndex(CREATE_FAB));

  it("the furniture is where we think it is", () => {
    // If either of these moves up, every sheet below needs rechecking, so the
    // number is asserted rather than merely read.
    expect(furniture).toBeGreaterThanOrEqual(110);
  });

  for (const sheet of SHEETS) {
    it(`${sheet.split("/").pop()} clears it`, () => {
      expect(topZIndex(sheet)).toBeGreaterThan(furniture);
    });
  }
});
