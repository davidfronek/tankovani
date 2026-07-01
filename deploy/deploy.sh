#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-/opt/tankovani}"
cd "$REPO_DIR"

if [ ! -f .env.production ]; then
  echo "Missing .env.production in $REPO_DIR"
  exit 1
fi

echo "Pulling latest changes..."
git pull origin main

echo "Building and starting containers..."
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build --remove-orphans

echo "Deployment finished."
