#!/usr/bin/env bash
# Applies project settings to the generated Android project (src-tauri/gen/android).
set -euo pipefail
gen=src-tauri/gen/android
pkg_dir="$gen/app/src/main/java/io/github/barksandbytes/workdashboard"
manifest="$gen/app/src/main/AndroidManifest.xml"

# 1. Android Keystore plugin for the data key.
mkdir -p "$pkg_dir"
cp src-tauri/android/KeystorePlugin.kt "$pkg_dir/"

# 2. No Android cloud backup or device-to-device copy of app data: data
#    stays only on this device (spec 6.1). allowBackup covers cloud backup;
#    dataExtractionRules covers device transfer on Android 12+.
mkdir -p "$gen/app/src/main/res/xml"
cp src-tauri/android/data_extraction_rules.xml "$gen/app/src/main/res/xml/"
sed -i -E 's/[[:space:]]android:(allowBackup|fullBackupContent|dataExtractionRules)="[^"]*"//g' "$manifest"
sed -i '0,/<application/s//<application android:allowBackup="false" android:fullBackupContent="false" android:dataExtractionRules="@xml\/data_extraction_rules"/' "$manifest"
grep -q 'android:allowBackup="false"' "$manifest" || { echo "::error::could not disable backup in AndroidManifest.xml"; exit 1; }
grep -q 'android:dataExtractionRules=' "$manifest" || { echo "::error::could not set dataExtractionRules"; exit 1; }
echo "Android project prepared."
