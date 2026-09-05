#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/marketing-automation}"
RELEASES_DIR="${APP_ROOT}/releases"
CURRENT_LINK="${APP_ROOT}/current"
SERVICE_NAME="${SERVICE_NAME:-marketing-automation.service}"
BUNDLE_PATH="${1:-}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

if [[ -z "$BUNDLE_PATH" || ! -f "$BUNDLE_PATH" ]]; then
  echo "usage: $0 <release-tar-gz-path>" >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%d-%H%M%S)"
release_dir="${RELEASES_DIR}/${timestamp}"
mkdir -p "$release_dir"

tar -xzf "$BUNDLE_PATH" -C "$release_dir"
ln -sfn "$release_dir" "$CURRENT_LINK"

systemctl daemon-reload
systemctl restart "$SERVICE_NAME"
"/opt/marketing-automation/current/ops/systemd/healthcheck.sh"

# Prune old releases — keep only the ${KEEP_RELEASES} most recent
# shellcheck disable=SC2012
mapfile -t old_releases < <(ls -1dt "${RELEASES_DIR}"/*/ 2>/dev/null | tail -n +"$((KEEP_RELEASES + 1))")
for old in "${old_releases[@]:-}"; do
  [[ -z "$old" ]] && continue
  echo "pruning old release: $old"
  rm -rf "$old"
done

echo "deployed release ${timestamp}"
