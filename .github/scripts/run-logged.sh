#!/usr/bin/env bash
# Runs a command. If it fails, the last lines of its output are posted as a
# single error annotation, so the failure can be read from the run summary
# (and the public checks API) without opening the full log.
set -o pipefail
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  msg="$(grep -E 'error(\[|:)|warning: unused|^\s+-->|FAILURE|What went wrong|Exception|cannot find|unresolved|expected' "$log" | head -60)"
  [ -z "$msg" ] && msg="$(tail -60 "$log")"
  msg="${msg//'%'/'%25'}"; msg="${msg//$'\r'/'%0D'}"; msg="${msg//$'\n'/'%0A'}"
  echo "::error title=$1 failed::${msg:0:60000}"
fi
exit "$status"
