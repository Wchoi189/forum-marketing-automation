#!/usr/bin/env bash
#
# Prune regenerable files from the workspace.
#
# Everything removed here is rebuilt by a build, a bot run, or a script. Durable
# state — artifacts/competitor-ads/, artifacts/kakao-history/, data/, and the
# loose artifacts/*.json state files — is never touched.
#
# Usage: npm run clean:all [-- --dry-run]

set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

freed_total=0

prune() {
  local target="$1" label="$2"
  [[ -e "$target" ]] || return 0
  local size
  size=$(du -sh "$target" 2>/dev/null | cut -f1)
  if $DRY_RUN; then
    echo "  would remove  $label ($size)"
  else
    rm -rf "$target"
    echo "  removed       $label ($size)"
  fi
}

echo "Pruning regenerable files..."

prune dist                          "dist/ (vite build output)"
prune artifacts/publisher-runs      "artifacts/publisher-runs/ (debug screenshots and traces)"
prune node_modules/.vite            "node_modules/.vite/ (vite dep cache)"
prune test-results                  "test-results/ (playwright)"
prune playwright-report             "playwright-report/ (playwright)"

# Orphaned atomic-write temp files. writeFileAtomic names them
# <file>.<pid>.<timestamp>.tmp and a crashed write leaks one.
tmp_count=$(find artifacts -maxdepth 1 -name '*.tmp' -type f 2>/dev/null | wc -l)
if [[ "$tmp_count" -gt 0 ]]; then
  if $DRY_RUN; then
    echo "  would remove  $tmp_count orphaned .tmp file(s) in artifacts/"
  else
    find artifacts -maxdepth 1 -name '*.tmp' -type f -delete
    echo "  removed       $tmp_count orphaned .tmp file(s) in artifacts/"
  fi
fi

# tsbuildinfo caches
find . -name '*.tsbuildinfo' -not -path './node_modules/*' -print0 2>/dev/null |
  while IFS= read -r -d '' f; do
    if $DRY_RUN; then echo "  would remove  $f"; else rm -f "$f"; echo "  removed       $f"; fi
  done

echo "Done."
$DRY_RUN && echo "(dry run — nothing was deleted)"
exit 0
