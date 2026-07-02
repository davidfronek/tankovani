#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-/opt/tankovani}"
SERVICE_NAME="${SERVICE_NAME:-tankovani}"
WEB_ROOT="${WEB_ROOT:-/var/www/tankovani}"

cd "$REPO_DIR"

echo "Pulling latest changes..."
git pull origin main

if [ ! -f server/.env ]; then
  echo "Missing server/.env in $REPO_DIR/server"
  exit 1
fi

echo "Installing dependencies..."
npm ci
npm --prefix server ci
npm --prefix client ci

echo "Building frontend..."
npm --prefix client run build

echo "Publishing frontend to $WEB_ROOT..."
mkdir -p "$WEB_ROOT"
find "$WEB_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -r client/dist/. "$WEB_ROOT"/

echo "Restarting systemd service $SERVICE_NAME..."
if command -v systemctl >/dev/null 2>&1; then
  if systemctl restart "$SERVICE_NAME" >/dev/null 2>&1; then
    :
  elif command -v sudo >/dev/null 2>&1; then
    sudo systemctl restart "$SERVICE_NAME"
  else
    echo "Failed to restart service $SERVICE_NAME. Ensure permissions for systemctl."
    exit 1
  fi
else
  echo "systemctl not found. Install systemd service management or adjust deploy script."
  exit 1
fi

echo "Deployment finished."
