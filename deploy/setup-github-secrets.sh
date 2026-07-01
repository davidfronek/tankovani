#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-davidfronek/tankovani}"

require_var() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required env var: $name"
    exit 1
  fi
}

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required. Install it and run: gh auth login"
  exit 1
fi

require_var SSH_HOST
require_var SSH_USER
require_var DEPLOY_PATH

if [ -z "${SSH_PRIVATE_KEY:-}" ] && [ -z "${SSH_PRIVATE_KEY_FILE:-}" ]; then
  echo "Missing SSH key. Set SSH_PRIVATE_KEY or SSH_PRIVATE_KEY_FILE"
  exit 1
fi

if [ -n "${SSH_PRIVATE_KEY_FILE:-}" ]; then
  if [ ! -f "$SSH_PRIVATE_KEY_FILE" ]; then
    echo "SSH_PRIVATE_KEY_FILE does not exist: $SSH_PRIVATE_KEY_FILE"
    exit 1
  fi
  SSH_PRIVATE_KEY="$(cat "$SSH_PRIVATE_KEY_FILE")"
fi

SSH_PORT="${SSH_PORT:-22}"
DEPLOY_MODE="${DEPLOY_MODE:-node}"
SERVICE_NAME="${SERVICE_NAME:-tankovani}"
WEB_ROOT="${WEB_ROOT:-/var/www/tankovani}"

echo "$SSH_HOST" | gh secret set SSH_HOST --repo "$REPO"
echo "$SSH_USER" | gh secret set SSH_USER --repo "$REPO"
echo "$SSH_PRIVATE_KEY" | gh secret set SSH_PRIVATE_KEY --repo "$REPO"
echo "$SSH_PORT" | gh secret set SSH_PORT --repo "$REPO"
echo "$DEPLOY_PATH" | gh secret set DEPLOY_PATH --repo "$REPO"
echo "$DEPLOY_MODE" | gh secret set DEPLOY_MODE --repo "$REPO"
echo "$SERVICE_NAME" | gh secret set SERVICE_NAME --repo "$REPO"
echo "$WEB_ROOT" | gh secret set WEB_ROOT --repo "$REPO"

echo "GitHub secrets configured for $REPO"
