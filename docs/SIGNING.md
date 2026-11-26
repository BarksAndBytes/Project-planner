# Signing releases

GitHub Actions builds and signs each release from a version tag. The Android signing key is held as encrypted secrets in a protected GitHub **environment** called `release`. That keeps it safe because:

- The jobs that run npm and cargo (where a bad dependency could try to steal secrets) get no secrets at all.
- Signing is a separate job that only downloads the built APK and runs Google's `apksigner`.
- That job only runs for version tags, and only after you approve it on GitHub.
- An optional fingerprint check stops a release if the key in the secrets is ever swapped.

## One-time setup

### 1. Create the release key (on your computer)

`keytool` comes with Java; Android Studio includes one under `jbr\bin`.

```powershell
mkdir $HOME\work-dashboard-keys
keytool -genkeypair -v -keystore $HOME\work-dashboard-keys\work-dashboard-release.jks `
  -alias work-dashboard -keyalg RSA -keysize 4096 -validity 10000
```

**Back up the `.jks` file and both passwords offline** (a USB stick in a drawer, a password manager). Phones only accept updates signed with the same key. If it's lost, each phone must uninstall the app, which deletes that phone's copy, and re-sync from another device.

### 2. Turn the key into text for GitHub

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\work-dashboard-keys\work-dashboard-release.jks")) | Set-Clipboard
```

This copies it to the clipboard. Paste it straight into GitHub in step 3; don't save it in a file.

### 3. Create the `release` environment on GitHub

Repository **Settings → Environments → New environment**, name it `release`, then:

1. **Required reviewers:** add yourself. Every signing run then waits for your approval.
2. **Deployment branches and tags:** choose "Selected branches and tags" and add the tag rule `v*`.
3. **Environment secrets** (Add secret):

   | Name | Value |
   | --- | --- |
   | `ANDROID_KEYSTORE_B64` | the text from step 2 |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
   | `ANDROID_KEY_ALIAS` | `work-dashboard` |
   | `ANDROID_KEY_PASSWORD` | the key password (the same as the keystore password unless you set a different one) |

4. **Environment variable** (recommended): `ANDROID_CERT_SHA256` = the certificate's SHA-256 fingerprint, from:

   ```powershell
   keytool -list -v -keystore $HOME\work-dashboard-keys\work-dashboard-release.jks -alias work-dashboard
   ```

   It's public information, and the signing job refuses to sign if it doesn't match.

## Each release

1. Tag the version: `git tag v0.1.0` then `git push origin v0.1.0`.
2. On the Actions tab, open the **Release build** run and approve the `sign-android` job when it asks.
3. A draft release appears with the signed APK, the Windows installer, and `SHA256SUMS.txt`. Check it, then **Publish**.

## Signing by hand (fallback)

If you'd rather not keep the key on GitHub, or GitHub is unavailable, `scripts/sign-android.ps1` signs an unsigned APK on your own computer with the same key. It needs the Android SDK build-tools and `ANDROID_HOME` set.

## Windows installer

Windows code-signing certificates trusted by SmartScreen are not free, so the `.msi` is unsigned for now and Windows shows "Windows protected your PC" (More info, then Run anyway). Free options for later:

- **SignPath Foundation:** free code signing for open-source projects (application required). It plugs into GitHub Actions.
- **Microsoft Store:** free individual developer account; Store installs are signed by Microsoft.

The app's update check (spec 6.1) will use a separate, free Tauri update-signing key when updates are built. It can be added to the same `release` environment.
