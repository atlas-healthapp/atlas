// **Nobody who can already connect may be affected by any of this.**
//
// The device picker was added for people whose strap Atlas cannot find. Every
// existing user has an empty `strap_address`, and for them `findBondedStrap` has
// to behave exactly as it did before: exact name wins, then a loose name match,
// then the four separated failure messages. A change that helped new users by
// breaking working installs would be a bad trade, and on Atlas a user who cannot
// connect has no route back except a reinstall, which destroys the archive.
//
// Java is not reachable from Vitest, so this reads the source and asserts the
// shape of the guard rather than executing it. That is weaker than running it and
// it is the strongest thing available here: the alternative is an assertion in a
// comment, which is what this codebase has repeatedly paid for.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LINK = resolve(
  process.cwd(),
  "android/app/src/main/java/io/github/atlashealthapp/atlas/ble/HelioLink.java"
);

function findBondedStrapBody() {
  const src = readFileSync(LINK, "utf8");
  const start = src.indexOf("private BluetoothDevice findBondedStrap()");
  expect(start, "findBondedStrap not found").toBeGreaterThan(-1);
  // To the next method at the same indentation, which is enough to bound it.
  const after = src.indexOf("\n    private ", start + 10);
  return src.slice(start, after === -1 ? src.length : after);
}

describe("the chosen-device override is additive", () => {
  it("does nothing at all when no device has been chosen", () => {
    const body = findBondedStrapBody();
    // The whole override sits behind a null/empty check, so an install that has
    // never picked one cannot enter it.
    expect(body).toMatch(/if \(chosen != null && !chosen\.isEmpty\(\)\)/);
  });

  it("still prefers an exact name match, and still falls back to a loose one", () => {
    const body = findBondedStrapBody();
    expect(body).toContain("if (DEVICE_NAME.equals(name)) return device;");
    expect(body).toContain("matchesStrapName(name)");
  });

  it("keeps the name rules AFTER the override rather than replacing them", () => {
    const body = findBondedStrapBody();
    const override = body.indexOf("chosen != null");
    const exact = body.indexOf("DEVICE_NAME.equals(name)");
    expect(override).toBeGreaterThan(-1);
    expect(exact).toBeGreaterThan(override);
  });

  it("still separates the failure causes it separated before", () => {
    const body = findBondedStrapBody();
    // Each of these needs a different action from the person reading it, which
    // is why one collapsed "device not found" was replaced in the first place.
    expect(body).toContain("bluetooth is off");
    expect(body).toContain("no bluetooth manager");
    expect(body).toContain("device has no bluetooth adapter");
    expect(body).toMatch(/nothing is paired to this phone/);
  });

  it("resolves a chosen address without requiring it to be bonded", () => {
    // A BLE device can be connected and never bonded, so looking the choice up
    // among getBondedDevices would reject exactly the device the picker exists
    // to allow.
    const body = findBondedStrapBody();
    expect(body).toContain("adapter.getRemoteDevice(chosen)");
  });
});
