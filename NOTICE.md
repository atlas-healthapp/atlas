# Third-party notices

Atlas bundles or depends on the work below. Apache-2.0 and the SIL Open Font
License both require this file to exist and to travel with the app, which is why
it is here rather than in the docs.

Versions are the ones the app currently builds against. Where a licence requires
its full text to be distributed, the copy in `node_modules/<package>/LICENSE`
is the authoritative one.

## Runtime, shipped inside the app

| Component | Version | Licence |
|---|---|---|
| Vue | 3.5 | MIT |
| Pinia | 3.0 | MIT |
| Capacitor (`core`, `android`, `app`, `filesystem`, `preferences`, `splash-screen`, `status-bar`) | 8.x | MIT |
| `@capacitor-mlkit/barcode-scanning` | 8.1 | Apache-2.0 |
| SheetJS (`xlsx`) | 0.18.5 | Apache-2.0 |
| IBM Plex Mono | - | SIL Open Font License 1.1 |

**IBM Plex Mono is bundled, not fetched** (`public/fonts/`), so the OFL applies
to a font actually being distributed here rather than merely linked. The
reserved font name must not be used for a modified version.

The body typeface is the platform's own (Roboto on Android, SF Pro on iOS). It
is not bundled and carries no obligation here.

## Build and test only, not shipped

Vite, `@vitejs/plugin-vue`, Capacitor CLI and `@capacitor/assets` (MIT);
Vitest (MIT); `fake-indexeddb` and Playwright (Apache-2.0).

## Cryptography

`android/app/src/main/java/io.github.atlashealthapp.atlas/ble/EcdhB163.java` is a port of
[tiny-ECDH-c](https://github.com/kokke/tiny-ECDH-c), **released into the public
domain**, reduced to the single B-163 curve the strap's handshake needs. No
obligation attaches; it is named because a reader deserves to know where the
curve arithmetic came from.

## Protocol knowledge

Atlas talks to the strap over Bluetooth LE and had to learn that protocol from
somewhere. **Where a comment in `android/.../ble/` names Gadgetbridge, it is
citing how a fact was checked, not marking copied code**: endpoint numbers,
record sizes, field numbers in the band's own protobuf, and the byte layout of
an alarm. Those are facts about a device, established by reading a published
implementation and then verified against the strap itself.

Gadgetbridge is licensed AGPLv3. Nothing in this repository is derived from its
source.
