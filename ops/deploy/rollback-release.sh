#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/marketing-automation}"
RELEASES_DIR="${APP_ROOT}/releases"
CURRENT_LINK="${APP_ROOT}/current"
SERVICE_NAME="${SERVICE_NAME:-marketing-automation.service}"

mapfile -t releases < <(ls -1dt "${RELEASES_DIR}"/*)
if (( ${#releases[@]} < 2 )); then
  echo "rollback requires at least two releases in ${RELEASES_DIR}" >&2
  exit 1
fi

previous_release="${releases[1]}"
ln -sfn "$previous_release" "$CURRENT_LINK"

systemctl daemon-reload
systemctl restart "$SERVICE_NAME"
"/opt/marketing-automation/current/ops/systemd/healthcheck.sh"

echo "rolled back to ${previous_release}"
