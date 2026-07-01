#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-/opt/tankovani}"
DOMAIN="${DOMAIN:-}"
SERVICE_NAME="${SERVICE_NAME:-tankovani}"
WEB_ROOT="${WEB_ROOT:-/var/www/tankovani}"
DB_NAME="${DB_NAME:-tanko}"
DB_USER="${DB_USER:-tanko_user}"
DB_PASSWORD="${DB_PASSWORD:-change_me}"

if [ -z "$DOMAIN" ]; then
  echo "Missing DOMAIN environment variable (example: DOMAIN=app.example.com)"
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script currently supports Debian/Ubuntu only (apt-get required)."
  exit 1
fi

echo "Installing system dependencies..."
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git nginx postgresql postgresql-contrib

if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "Preparing PostgreSQL role and database..."
sudo -u postgres psql <<SQL
DO
\$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';
  END IF;
END
\$\$;
SQL

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

if [ ! -f "$REPO_DIR/server/.env" ]; then
  echo "Creating server/.env from production example..."
  cp "$REPO_DIR/server/.env.production.example" "$REPO_DIR/server/.env"
fi

echo "Updating server/.env defaults..."
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME|" "$REPO_DIR/server/.env"
sed -i "s|^CLIENT_ORIGIN=.*|CLIENT_ORIGIN=https://$DOMAIN|" "$REPO_DIR/server/.env"
sed -i "s|^PUBLIC_SERVER_URL=.*|PUBLIC_SERVER_URL=https://$DOMAIN|" "$REPO_DIR/server/.env"
sed -i "s|^GOOGLE_CALLBACK_URL=.*|GOOGLE_CALLBACK_URL=https://$DOMAIN/api/auth/google/callback|" "$REPO_DIR/server/.env"

mkdir -p "$WEB_ROOT"
sudo chown -R "$USER":"$USER" "$WEB_ROOT"

TMP_SERVICE="$(mktemp)"
sed "s|/opt/tankovani|$REPO_DIR|g; s|^Description=.*|Description=$SERVICE_NAME API (Node.js)|" \
  "$REPO_DIR/deploy/tankovani.service" > "$TMP_SERVICE"
sudo cp "$TMP_SERVICE" "/etc/systemd/system/$SERVICE_NAME.service"
rm -f "$TMP_SERVICE"

TMP_NGINX="$(mktemp)"
sed "s|your-domain.tld|$DOMAIN|g; s|/var/www/tankovani|$WEB_ROOT|g" \
  "$REPO_DIR/deploy/nginx.tankovani.conf" > "$TMP_NGINX"
sudo cp "$TMP_NGINX" "/etc/nginx/sites-available/$SERVICE_NAME.conf"
rm -f "$TMP_NGINX"

sudo ln -sf "/etc/nginx/sites-available/$SERVICE_NAME.conf" "/etc/nginx/sites-enabled/$SERVICE_NAME.conf"
sudo nginx -t
sudo systemctl reload nginx

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

cd "$REPO_DIR"
DEPLOY_MODE=node SERVICE_NAME="$SERVICE_NAME" WEB_ROOT="$WEB_ROOT" ./deploy/deploy.sh "$REPO_DIR"

echo "Server preparation finished."
echo "Next step: enable HTTPS (recommended) using certbot/caddy/traefik."
