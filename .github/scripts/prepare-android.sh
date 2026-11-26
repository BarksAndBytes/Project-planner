#!/usr/bin/env bash
# Applies project settings to the generated Android project (src-tauri/gen/android).
set -euo pipefail
gen=src-tauri/gen/android
pkg_dir="$gen/app/src/main/java/io/github/barksandbytes/workdashboard"
manifest="$gen/app/src/main/AndroidManifest.xml"

# 1. Kotlin plugins: Android Keystore for the data key; share sheet for exports.
mkdir -p "$pkg_dir"
cp src-tauri/android/KeystorePlugin.kt src-tauri/android/SharePlugin.kt src-tauri/android/SpeechPlugin.kt "$pkg_dir/"

# 2. No Android cloud backup or device-to-device copy of app data: data
#    stays only on this device (spec 6.1). allowBackup covers cloud backup;
#    dataExtractionRules covers device transfer on Android 12+.
mkdir -p "$gen/app/src/main/res/xml"
cp src-tauri/android/data_extraction_rules.xml "$gen/app/src/main/res/xml/"
sed -i -E 's/[[:space:]]android:(allowBackup|fullBackupContent|dataExtractionRules)="[^"]*"//g' "$manifest"
sed -i '0,/<application/s//<application android:allowBackup="false" android:fullBackupContent="false" android:dataExtractionRules="@xml\/data_extraction_rules"/' "$manifest"
grep -q 'android:allowBackup="false"' "$manifest" || { echo "::error::could not disable backup in AndroidManifest.xml"; exit 1; }
grep -q 'android:dataExtractionRules=' "$manifest" || { echo "::error::could not set dataExtractionRules"; exit 1; }
# 3. File provider for sharing exported files (only cache/exports).
cp src-tauri/android/wd_export_paths.xml "$gen/app/src/main/res/xml/"
if ! grep -q 'ExportFileProvider' "$manifest"; then
  provider='        <provider android:name="io.github.barksandbytes.workdashboard.ExportFileProvider" android:authorities="${applicationId}.exports" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/wd_export_paths" /></provider>'
  awk -v p="$provider" '/<\/application>/ && !done { print p; done=1 } { print }' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
fi
grep -q 'ExportFileProvider' "$manifest" || { echo "::error::could not add the export file provider"; exit 1; }
# 4. Let the app find the phone's speech recognizer (Android 11+ package visibility).
if ! grep -q 'android.speech.action.RECOGNIZE_SPEECH' "$manifest"; then
  q='    <queries><intent><action android:name="android.speech.action.RECOGNIZE_SPEECH" /></intent></queries>'
  awk -v q="$q" '/<application/ && !done { print q; done=1 } { print }' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
fi
grep -q 'RECOGNIZE_SPEECH' "$manifest" || { echo "::error::could not add speech queries"; exit 1; }
echo "Android project prepared."
