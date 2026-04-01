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

wait_for_http() {
  local name="$1"
  local url="$2"
  local extra_curl_arg="${3:-}"
  local attempts="${4:-30}"
  local sleep_seconds="${5:-2}"

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl --fail --silent ${extra_curl_arg:+$extra_curl_arg} "$url" >/dev/null; then
      echo "$name is ready."
      return 0
    fi

    echo "Waiting for $name ($attempt/$attempts)..."
    sleep "$sleep_seconds"
  done

  echo "$name did not become ready in time: $url" >&2
  return 1
}

if ! git diff --quiet || ! git diff --cached --quiet; then
  stash_label="codex-deploy-$(date +%Y%m%d%H%M%S)"
  echo "Remote working tree is dirty. Stashing changes as $stash_label before deploy."
  git stash push --include-untracked --message "$stash_label" >/dev/null
fi

git fetch origin main
git checkout main
git pull --ff-only origin main

pnpm install --no-frozen-lockfile
pnpm build:pwa
pnpm db:migrate

pm2 delete medvedsson-api medvedsson-pwa >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --update-env
pm2 save
pm2 status

wait_for_http "API health" "http://127.0.0.1:3001/health"
wait_for_http "PWA login" "https://c.semyonov.se/login" "--insecure"
EOF

echo "Production deploy finished."
