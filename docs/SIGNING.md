# Signing releases

This repository is public and holds no secrets. Signing is done by a separate **private** repository, `BarksAndBytes/signing`, which holds the Android key and a fine-grained token scoped to this repository.

## Each release

1. Tag the version here: `git tag v0.1.0` then `git push origin v0.1.0`.
2. The **Release build** workflow creates a draft release with the unsigned APK and the Windows installer.
3. In the signing repository, run **Actions → Sign Project-planner release** (tag blank = newest draft) and approve it.
4. It replaces the unsigned APK with the signed one and refreshes `SHA256SUMS.txt`.
5. Back here, review the draft release and publish it.

Setup steps (key, token, secrets) are in the signing repository's README.

## Why a separate repository

- Workflows in this public repo, including any from pull requests or a compromised dependency, have no path to the key.
- The signing workflow runs only Google's `apksigner` on an already-built file, after your approval.
- An optional fingerprint check refuses to sign if the key is ever swapped.

## Signing by hand (fallback)

`scripts/sign-android.ps1` signs an unsigned APK on your own computer with the same key. It needs the Android SDK build-tools and `ANDROID_HOME` set.

## Windows installer

Windows code-signing certificates trusted by SmartScreen are not free, so the `.msi` is unsigned for now and Windows shows "Windows protected your PC" (More info, then Run anyway). Free options for later:

- **SignPath Foundation:** free code signing for open-source projects (application required).
- **Microsoft Store:** free individual developer account; Store installs are signed by Microsoft.

The app's update check (spec 6.1) will use a separate, free Tauri update-signing key, which can live in the signing repository too.
