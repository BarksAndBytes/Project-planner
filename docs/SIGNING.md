# Signing releases

Signing keys never go to GitHub (spec 7, items 2, 4 and 9). GitHub Actions builds unsigned installers from a version tag. You sign them on your own computer, then upload and publish.

## One-time setup (Android key)

1. Install [Android Studio](https://developer.android.com/studio) (free), or just its command-line tools, so the SDK **build-tools** are available. Set `ANDROID_HOME` to the SDK folder (usually `%LOCALAPPDATA%\Android\Sdk`).
2. Create your release key. `keytool` comes with Java (Android Studio includes one under `jbr\bin`):

   ```powershell
   mkdir $HOME\work-dashboard-keys
   keytool -genkeypair -v -keystore $HOME\work-dashboard-keys\work-dashboard-release.jks `
     -alias work-dashboard -keyalg RSA -keysize 4096 -validity 10000
   ```

3. **Back up the `.jks` file and its password somewhere offline** (a USB stick in a drawer, a password manager). If it's lost, phones with the app installed can't take updates; you'd have to uninstall, which deletes that phone's copy of the data, and re-sync from another device.

## Each release

1. Tag the version: `git tag v0.1.0 && git push origin v0.1.0`.
2. Wait for the **Release build** workflow. It creates a draft release with the unsigned `.msi`, the unsigned `.apk`, and their checksums.
3. Download the APK and sign it:

   ```powershell
   .\scripts\sign-android.ps1 -Apk .\app-universal-release-unsigned.apk
   ```

   The script aligns, signs, verifies, and prints the SHA-256 of the signed file.
4. Upload the signed APK to the draft release, delete the unsigned APK, add the SHA-256 to the notes, and publish.

## Windows installer

Windows code-signing certificates trusted by SmartScreen are not free. Until there is one, the `.msi` is unsigned and Windows shows "Windows protected your PC" (More info, then Run anyway). Options for later:

- **SignPath Foundation**: free code signing for open-source projects (application required).
- **Microsoft Store**: free individual developer account; Store installs are signed by Microsoft.

The app's own update check (spec 6.1) will use a separate, free Tauri update-signing key, created the same offline way when updates are built.
