# Tankování

Fullstack project where database tables are based on the structure of Sešit1.xlsx.

## Stack

- PostgreSQL
- Express (Node.js)
- React + Vite + TypeScript

## Data model origin

Workbook sheets used as schema reference:
- tankovani: refuel records
- ORLEN: fuel prices by station/date
- MOL: fuel prices by station/date

## Quick start

1. Start PostgreSQL locally (for example service on `localhost:5432`) and create database `tanko`.
2. Install dependencies:
   ```bash
   npm install
   npm --prefix server install
   npm --prefix client install
   ```
3. Configure backend:
   ```bash
   copy server/.env.example server/.env
   ```
4. Seed sample data:
   ```bash
   npm run seed
   ```
5. Start app:
   ```bash
   npm run dev
   ```

- Backend: http://localhost:4000
- Frontend: http://localhost:5173

## Notes

- Excel file is not imported at runtime; it was used only as a table design template.
- Seed uses SQL file at server/migrations/002_seed_sample_data.sql and is safe to run repeatedly.
- Price values from MOL and ORLEN sheets are represented by seed records and can be managed in the frontend menu Nastaveni cen.

## Authentication

- The app is protected by a database-backed session cookie.
- Registration is enabled by default. Set `AUTH_ALLOW_REGISTRATION=false` to close public registration.
- The first account can register even when `AUTH_ALLOW_REGISTRATION=false`; further closed registrations require the e-mail listed in `AUTH_ALLOWED_EMAILS`.
- Google login is enabled when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
- Forgotten password creates a single-use reset link valid for `AUTH_PASSWORD_RESET_MINUTES` minutes. Without an SMTP integration the server logs the link; non-production also returns it to the frontend for easy local use. Set `AUTH_PASSWORD_RESET_EXPOSE_TOKEN=true` only if you intentionally want that behavior outside local development.
- Signed-in users can change their password in Nastavení -> Účet. Users created through Google can set their first password there without entering an old one.
- Vehicles, fuels, fuel prices, and refuel logs are scoped by `user_id`; stations stay as a shared station-name directory.
- For production behind HTTPS, set `CLIENT_ORIGIN`, `PUBLIC_SERVER_URL`, `GOOGLE_CALLBACK_URL`, and `AUTH_COOKIE_SECURE=true`.

## Production deployment (Node + systemd + Nginx)

Deployment uses Node runtime directly. In this mode:

- backend runs as systemd service (`tankovani.service`)
- frontend static files are built and copied to web root (`/var/www/tankovani`)
- Nginx serves frontend and proxies `/api` to Node backend on port 4000

### 1. Server prerequisites

- Node.js 20+
- PostgreSQL
- Nginx
- systemd

### 2. Environment and service setup

```bash
cd /opt/tankovani
cp server/.env.production.example server/.env
sudo cp deploy/tankovani.service /etc/systemd/system/tankovani.service
sudo systemctl daemon-reload
sudo systemctl enable tankovani
sudo systemctl start tankovani
```

### 3. Nginx setup

```bash
sudo cp deploy/nginx.tankovani.conf /etc/nginx/sites-available/tankovani.conf
sudo ln -s /etc/nginx/sites-available/tankovani.conf /etc/nginx/sites-enabled/tankovani.conf
sudo nginx -t
sudo systemctl reload nginx
```

Adjust `server_name` and paths in `deploy/nginx.tankovani.conf` before enabling site.

### 4. GitHub Actions deploy

Set these repository secrets:

- `SSH_HOST`
- `SSH_USER`
- `SSH_PRIVATE_KEY`
- `SSH_PORT`
- `DEPLOY_PATH` (e.g. `/opt/tankovani`)

Optional secrets for node mode:

- `SERVICE_NAME` (default `tankovani`)
- `WEB_ROOT` (default `/var/www/tankovani`)

Workflow file `.github/workflows/deploy.yml` deploys this Node mode automatically.

### 5. One-shot preparation (server + GitHub)

On server (Ubuntu/Debian), run:

```bash
cd /opt/tankovani
chmod +x deploy/server-prepare-node.sh deploy/deploy.sh
DOMAIN=your-domain.tld DB_PASSWORD='strong_password' ./deploy/server-prepare-node.sh /opt/tankovani
```

On your local machine, configure GitHub secrets via CLI:

```bash
cd /opt/tankovani
chmod +x deploy/setup-github-secrets.sh
SSH_HOST=your.server.ip \
SSH_USER=deploy \
SSH_PRIVATE_KEY_FILE=~/.ssh/id_ed25519 \
DEPLOY_PATH=/opt/tankovani \
./deploy/setup-github-secrets.sh davidfronek/tankovani
```
