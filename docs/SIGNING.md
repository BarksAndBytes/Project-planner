# Signing releases

Tagged releases are built and signed by GitHub Actions. The Android key is stored in this repository's secrets:

| Secret | What it is |
| --- | --- |
| `ANDROID_KEYSTORE_B64` | the PKCS12 keystore, base64 |
| `ANDROID_KEYSTORE_PASSWORD` | its password (also the key password) |
| `ANDROID_KEY_ALIAS` | `work-dashboard` |

Optional variable `ANDROID_CERT_SHA256`: the certificate fingerprint. Signing is refused if the key doesn't match.

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

Windows code-signing certificates trusted by SmartScreen are not free, so the `.msi` is unsigned for now and Windows shows "Windows protected your PC" (More info, then Run anyway). Free options for later:

- **SignPath Foundation:** free code signing for open-source projects (application required).
- **Microsoft Store:** free individual developer account; Store installs are signed by Microsoft.

The app's update check (spec 6.1) will use a separate, free Tauri update-signing key, which can live in the signing repository too.
