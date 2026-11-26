# Security

Work Dashboard keeps your data only on your own devices. Every release goes through the 12-point checklist in spec section 7. Results are recorded in [docs/VERSION_LOG.md](docs/VERSION_LOG.md).

## How the checklist is enforced

| # | Check | How |
| --- | --- | --- |
| 1 | Output escaping | Screens build the DOM with text nodes only. `tests/static-scan.test.js` fails the build if `innerHTML`, `eval` or similar appear. |
| 2 | No secrets in code | `.gitignore` blocks key files; GitHub secret scanning with push protection (enable in repo settings). |
| 3 | Dependencies locked and audited | No runtime JavaScript dependencies. Rust: `tauri` only. Dependabot for npm, cargo and Actions. |
| 4 | Signed builds | Tagged releases are signed in CI by a separate job in the protected `release` environment: build jobs get no secrets, signing needs your approval, and the certificate fingerprint is checked ([docs/SIGNING.md](docs/SIGNING.md)). Windows installer unsigned until a free OSS certificate is arranged. |
| 5 | Network lockdown | Strict CSP; only `core:default` permissions; static scan blocks `fetch`, WebSocket and external URLs in the screens. |
| 6 | Pairing and sync | Phase 2. |
| 7 | Incoming data validated | Saved data is re-validated record by record on load (`store.load`). |
| 8 | Export safety | Phase 3. |
| 9 | Automated code scan | CodeQL workflow on every change. |
| 10 | Data safety | Data encrypted at rest; tampered files are refused. Atomic saves with a `.bak` copy; a vault whose key can't be unlocked never overwrites data; newer-schema files are refused rather than overwritten. Migrations arrive with the first schema change. |
| 11 | Smoke test, contrast | `tests/themes.test.js` checks 4.5:1 for all six looks. Manual device smoke test per release. |
| 12 | Version log | `docs/VERSION_LOG.md`. |

## Reporting a problem

Open a private security advisory on this repository (Security tab, "Report a vulnerability").
