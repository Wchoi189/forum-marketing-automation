#!/usr/bin/env bash
# Copy the versioned hooks in scripts/hooks/ into .git/hooks/.
#
# .git/hooks/ is not versioned, so this is the only way a hook reaches another clone.
# Run: npm run hooks:install
#
# Exits 0 without doing anything outside a git working tree (Docker build context,
# tarball install) so it is safe to call from an npm lifecycle script.
set -euo pipefail

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "install-hooks: not a git working tree, skipping."
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$(git rev-parse --git-path hooks)"
SOURCE_DIR="$REPO_ROOT/scripts/hooks"

mkdir -p "$HOOKS_DIR"

for hook in "$SOURCE_DIR"/*; do
  [ -f "$hook" ] || continue
  name="$(basename "$hook")"
  install -m 755 "$hook" "$HOOKS_DIR/$name"
  echo "install-hooks: installed $name"
done
