#!/usr/bin/env bash
#
# Rebuild and restart the production container from this working tree (PR-004).
#
# Stamps the image with the commit it was built from, so GET /api/health answers
# "what is running". `-dirty` means files the image uses differed from that
# commit: the build context is the working tree, not the commit.
#
# Before restarting it keeps the running image as a rollback tag and waits for
# an in-flight publisher run to finish, so a deploy never cuts a submit short.
#
# Usage: bash scripts/deploy.sh   (or npm run deploy)

set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=marketing-automation-app
BASE_URL="http://localhost:3000"
# What the Dockerfile copies into the image, plus the frontend build inputs.
RUNTIME_PATHS=(Dockerfile docker-entrypoint.sh package.json package-lock.json tsconfig.json
  server.ts mcp config contracts lib routes ops src index.html vite.config.ts
  .planning/spec-kit/manifest .planning/spec-kit/contracts .agent/contracts)

sha="$(git rev-parse --short HEAD)"
if [[ -n "$(git status --porcelain -- "${RUNTIME_PATHS[@]}" 2>/dev/null)" ]]; then
  sha="${sha}-dirty"
  echo "deploy: runtime files differ from HEAD; image will report ${sha}" >&2
fi

running_sha="$(curl -fsS "$BASE_URL/api/health" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).gitSha??"unknown")}catch{console.log("unknown")}})' || echo unknown)"
if docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
  rollback="$IMAGE:rollback-$(date +%Y%m%d-%H%M)-${running_sha}"
  docker tag "$IMAGE:latest" "$rollback"
  echo "deploy: previous image kept as $rollback"
fi

GIT_SHA="$sha" docker compose build app

for _ in $(seq 1 100); do
  busy="$(curl -fsS "$BASE_URL/api/publisher-status" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).running===true)}catch{console.log(false)}})' || echo false)"
  [[ "$busy" == "true" ]] || break
  echo "deploy: publisher run in progress; waiting" >&2
  sleep 3
done

GIT_SHA="$sha" docker compose up -d app

for _ in $(seq 1 40); do
  live="$(curl -fsS "$BASE_URL/api/health" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).gitSha)}catch{}})' || true)"
  if [[ "$live" == "$sha" ]]; then
    echo "deploy: running ${sha}"
    exit 0
  fi
  sleep 3
done
echo "deploy: container did not report ${sha} within 2 minutes; check docker logs" >&2
exit 1
