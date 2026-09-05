#!/usr/bin/env bash
set -euo pipefail

APP_ENV_PATH="/opt/marketing-automation/shared/env/runtime.env"
SSM_PATH_PREFIX="${SSM_PATH_PREFIX:-/marketing-automation/prod}"

mkdir -p "$(dirname "$APP_ENV_PATH")"

if ! command -v aws >/dev/null 2>&1; then
  echo "awscli is required for env bootstrap" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for env bootstrap" >&2
  exit 1
fi

tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT

aws ssm get-parameters-by-path \
  --path "$SSM_PATH_PREFIX" \
  --with-decryption \
  --recursive \
  --output json \
  | jq -r '.Parameters[] | "\(.Name | split("/")[-1])=\(.Value)"' > "$tmp_file"

if ! rg -q '^PPOMPPU_USER_ID=' "$tmp_file"; then
  echo "missing required env key PPOMPPU_USER_ID in SSM path $SSM_PATH_PREFIX" >&2
  exit 1
fi

if ! rg -q '^PPOMPPU_USER_PW=' "$tmp_file"; then
  echo "missing required env key PPOMPPU_USER_PW in SSM path $SSM_PATH_PREFIX" >&2
  exit 1
fi

install -m 600 "$tmp_file" "$APP_ENV_PATH"
