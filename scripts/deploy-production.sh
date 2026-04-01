#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_HOST="medvedssoncrypto@c.semyonov.se"
REMOTE_APP_DIR="~/htdocs/c.semyonov.se"
BRANCH="main"

cd "$ROOT_DIR"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is not clean. Commit or stash your changes before deploying." >&2
  exit 1
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"

if [[ "$current_branch" != "$BRANCH" ]]; then
  echo "Deploys must run from '$BRANCH'. Current branch: '$current_branch'." >&2
  exit 1
fi

echo "Pushing local $BRANCH to origin..."
git push origin "$BRANCH"

echo "Deploying on $REMOTE_HOST..."
ssh -T "$REMOTE_HOST" <<'EOF'
set -euo pipefail

source /home/semyonov-c/.nvm/nvm.sh
cd ~/htdocs/c.semyonov.se

git fetch origin main
git checkout main
git pull --ff-only origin main

pnpm install --no-frozen-lockfile
pnpm build:pwa
pnpm db:migrate

pm2 startOrRestart ecosystem.config.cjs --update-env
pm2 save
pm2 status

curl --fail --silent http://127.0.0.1:3001/health >/dev/null
curl --fail --silent --insecure https://c.semyonov.se/login >/dev/null
EOF

echo "Production deploy finished."
