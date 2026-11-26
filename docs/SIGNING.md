# Signing releases

Tagged releases are built and signed by GitHub Actions. The Android key is stored in this repository's secrets:

| Secret | What it is |
| --- | --- |
| `ANDROID_KEYSTORE_B64` | the PKCS12 keystore, base64 |
| `ANDROID_KEYSTORE_PASSWORD` | its password (also the key password) |
| `ANDROID_KEY_ALIAS` | `work-dashboard` |

Certificate SHA-256 fingerprint (public): `55:71:21:B2:6E:5E:FF:D7:FC:2F:93:F9:06:98:70:63:CA:59:CF:D6:6D:DC:51:41:B2:16:1A:2F:26:0C:03:6A`. The release workflow refuses to sign if the key in the secrets doesn't match it. A repository variable `ANDROID_CERT_SHA256` overrides it if the key is ever deliberately replaced.

The key was created by the one-time **Generate Android release key** workflow in the private `BarksAndBytes/signing` repository. It refuses to replace an existing key and leaves a 1-day backup artifact on its run: download it, keep it offline, delete the artifact.

## How the key is protected

- GitHub never passes secrets to workflows from forks' pull requests.
- The build jobs (npm, cargo) get no secrets. Signing is a separate job that only runs `apksigner` on the built APK.
- Only `v*` tags start the release workflow.

## Each release

1. Tag the version: `git tag v0.1.0` then `git push origin v0.1.0`.
2. The **Release build** workflow builds both installers, signs the APK, and creates a draft release with `SHA256SUMS.txt`.
3. Review the draft and publish it.

## Signing by hand (fallback)

`scripts/sign-android.ps1` signs an unsigned APK on your own computer with the same key. It needs the Android SDK build-tools and `ANDROID_HOME` set.

## Windows installer

Plan (decided Nov 26): Windows ships through the **Microsoft Store as an MSIX package**. Microsoft signs it for free and Windows keeps it updated; the release workflow will publish each tagged version. This comes after a few test iterations.

Until then, test builds use the unsigned `.msi` from CI, and Windows shows "Windows protected your PC" (More info, then Run anyway).

To check before the Store release:

- MSIX packaging step for the Tauri build
- Local-network permission in the package, needed for QR sync (phase 2)
- A short privacy policy page (the Store requires one)
- One manual first submission in Partner Center; CI handles updates after that
