#!/usr/bin/env bash
# Assemble and push the Hugging Face Space that hosts the Pit Wall API.
#
#   ./deploy/space/push.sh <hf-user>/<space-name>
#
# Needs: `hf auth login` (a write token from https://huggingface.co/settings/tokens).
# The staging repo lives outside the source tree so this repo never nests a git repo.
set -euo pipefail

SPACE="${1:-}"
if [ -z "$SPACE" ]; then
    echo "usage: $0 <hf-user>/<space-name>" >&2
    exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
STAGE="${PITWALL_SPACE_STAGE:-$HOME/.cache/pitwall-space}"

echo "==> staging $SPACE in $STAGE"
mkdir -p "$STAGE"
rsync -a --delete --exclude .git "$HERE"/ "$STAGE"/
rm -f "$STAGE/push.sh" "$STAGE/.gitignore"

rsync -a --delete --exclude '__pycache__' "$ROOT/api/app"/ "$STAGE/app"/
cp "$ROOT/api/requirements.txt" "$STAGE/requirements.txt"

# Seed data: the precomputed JSON caches, so a cold Space serves real data at once.
mkdir -p "$STAGE/seed/jsoncache"
rsync -a --delete "$ROOT/data/jsoncache"/ "$STAGE/seed/jsoncache"/

cd "$STAGE"
[ -d .git ] || git init -q -b main
git remote remove space 2>/dev/null || true
git remote add space "https://huggingface.co/spaces/$SPACE"
git add -A
git commit -q -m "deploy: sync Pit Wall API from source repo" || echo "==> nothing changed"
echo "==> pushing to https://huggingface.co/spaces/$SPACE"
git push -f space main
echo "==> live at https://${SPACE/\//-}.hf.space  (first build takes a few minutes)"
