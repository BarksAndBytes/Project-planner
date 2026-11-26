#!/usr/bin/env bash
# Signs every unsigned APK in the given folder with the release key held in
# GitHub secrets. Runs in its own job, in the protected "release"
# environment, after the build: the job that runs npm and cargo never sees
# the key.
set -euo pipefail
dir="${1:?usage: sign-apk.sh <folder>}"
: "${ANDROID_KEYSTORE_B64:?secret ANDROID_KEYSTORE_B64 is not set}"
: "${ANDROID_KEYSTORE_PASSWORD:?secret ANDROID_KEYSTORE_PASSWORD is not set}"
: "${ANDROID_KEY_ALIAS:?secret ANDROID_KEY_ALIAS is not set}"
: "${ANDROID_KEY_PASSWORD:?secret ANDROID_KEY_PASSWORD is not set}"

bt="$(ls -d "$ANDROID_HOME"/build-tools/* | grep -E '/[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)"
[ -n "$bt" ] || { echo "::error::no Android build-tools found"; exit 1; }

umask 077
ks="$RUNNER_TEMP/release.jks"
trap 'rm -f "$ks"' EXIT
printf '%s' "$ANDROID_KEYSTORE_B64" | base64 -d > "$ks"

shopt -s nullglob
apks=("$dir"/*-unsigned.apk)
[ ${#apks[@]} -gt 0 ] || { echo "::error::no unsigned APK found in $dir"; exit 1; }

for apk in "${apks[@]}"; do
  base="${apk%.apk}"
  aligned="$base-aligned.apk"
  signed="${base/-unsigned/}-signed.apk"
  "$bt/zipalign" -f -p 4 "$apk" "$aligned"
  "$bt/apksigner" sign --ks "$ks" --ks-key-alias "$ANDROID_KEY_ALIAS" \
    --ks-pass env:ANDROID_KEYSTORE_PASSWORD --key-pass env:ANDROID_KEY_PASSWORD \
    --out "$signed" "$aligned"
  certs="$("$bt/apksigner" verify --print-certs "$signed")"
  echo "$certs"
  # Optional guard: the signing certificate must match the fingerprint
  # stored as the repository variable ANDROID_CERT_SHA256 (public, not secret).
  if [ -n "${EXPECTED_CERT_SHA256:-}" ]; then
    want="$(echo "$EXPECTED_CERT_SHA256" | tr -d ': ' | tr 'A-F' 'a-f')"
    echo "$certs" | grep -qi "SHA-256 digest: $want" || { echo "::error::signing certificate does not match ANDROID_CERT_SHA256"; exit 1; }
  fi
  rm -f "$aligned" "$apk"
  echo "Signed: $signed"
done
