#!/usr/bin/env bash
set -euo pipefail

# Convenience wrapper: clone into ./riven-dev and run devbox setup.
#
# Usage (from e.g. /home/landmin):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/mariof1/riven/dev/dev/clone-and-setup.sh)"
# or locally:
#   bash dev/clone-and-setup.sh

REPO_URL="${REPO_URL:-https://github.com/mariof1/riven.git}"
TARGET_DIR="${TARGET_DIR:-riven-dev}"
BRANCH="${BRANCH:-dev}"

if [ -e "$TARGET_DIR" ]; then
  echo "Target directory already exists: $TARGET_DIR" >&2
  exit 1
fi

git clone --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
cd "$TARGET_DIR"

bash dev/setup-devbox.sh
