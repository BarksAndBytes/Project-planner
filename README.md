# Work Dashboard

A personal project dashboard that installs as a native app on Android and Windows, works offline, and (from phase 2) syncs directly between your devices by QR code, with no server and no account. Built with [Tauri 2](https://tauri.app). Free and open source under the MIT license.

The full design is in the application spec (kept as a Claude doc; section numbers below refer to it).

## Status: phase 1 in progress

| Area | State |
| --- | --- |
| Projects: four types with their own fields and stage tracks | Done |
| Tasks, work log (6 entry types, impact chips, highlights), measurements | Done |
| Dashboard: status counts, due soon, recent wins, open blockers | Done |
| Themes: Shop Steel, Datasheet Cobalt, Survey Magenta × light/dark/follow | Done |
| Local storage: atomic saves, encrypted at rest (XChaCha20-Poly1305; key protected by Windows Data Protection or Android Keystore) | Done, needs a device test |
| Android cloud backup and device transfer turned off for app data | Done |
| Release builds from tags, APK signed in CI from repository secrets ([docs/SIGNING.md](docs/SIGNING.md)) | Done; needs your key set up. Windows installer unsigned for now |
| Sync (phase 2), export (3), voice (4), polish (5), teams (6) | Later |

## Try it

**Newest test build:** every push publishes a rolling pre-release called [Test build](https://github.com/BarksAndBytes/Project-planner/releases/tag/test-build), with fixed download links:

- Android: [WorkDashboard-test.apk](https://github.com/BarksAndBytes/Project-planner/releases/download/test-build/WorkDashboard-test.apk) (signed with the release key, installs over earlier builds and keeps data)
- Windows: [WorkDashboard-test-x64.msi](https://github.com/BarksAndBytes/Project-planner/releases/download/test-build/WorkDashboard-test-x64.msi) (unsigned: More info, then Run anyway)

**In a browser (screens only, data stays in that browser):**

```sh
npm run dev:browser   # then open http://localhost:5173
```

**Native, on your own machine:** install [Rust](https://rustup.rs), Node 20+, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/), then:

```sh
npm install
npx tauri dev                 # Windows desktop
npx tauri android init        # once, needs Android Studio + NDK
npx tauri android dev         # phone over USB
```

## Device testing

[docs/TESTING.md](docs/TESTING.md) lists what still needs checking on real phones, PCs and networks.

## Tests

```sh
npm test                                                        # model, store, contrast, static security scan
rustc --edition 2021 --test src-tauri/src/storage.rs -o /tmp/st && /tmp/st   # storage
```

## Layout

```
src/            screens (plain JavaScript modules, no build step, no runtime dependencies)
  js/model.js   data model, limits, validation
  js/store.js   records, tombstoned deletes, dashboard figures
  js/themes.js  palettes and contrast checks
  js/views.js   screens
src-tauri/      native core (Rust): encrypted storage, app config, permissions
  android/      Keystore plugin and backup rules, copied into the generated Android project
scripts/        manual APK signing (fallback)
tests/          node:test suites
docs/           version log
```

See [SECURITY.md](SECURITY.md) for how each item of the per-update security checklist is enforced.
