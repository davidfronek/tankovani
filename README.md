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

1. Start PostgreSQL:
   ```bash
   docker compose up -d
   ```
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

## Production deployment (Docker + GitHub Actions)

Project includes a production deployment pipeline:

- `docker-compose.prod.yml` for app stack (PostgreSQL + API + web)
- `server/Dockerfile` for backend image
- `client/Dockerfile` + `client/nginx.conf` for frontend image and `/api` reverse proxy
- `.github/workflows/deploy.yml` for automatic deploy after push to `main`
- `deploy/deploy.sh` script executed on target server

### 1. Server bootstrap

On your server install Docker + Docker Compose plugin, then clone repository:

```bash
git clone https://github.com/davidfronek/tankovani.git /opt/tankovani
cd /opt/tankovani
cp .env.production.example .env.production
```

Edit `.env.production` with real values (domain, passwords, Google OAuth, etc.).

### 2. First manual start on server

```bash
cd /opt/tankovani
chmod +x deploy/deploy.sh
./deploy/deploy.sh /opt/tankovani
```

### 3. GitHub repository secrets

In GitHub repository settings add these Actions secrets:

- `SSH_HOST` server hostname or IP
- `SSH_USER` SSH username
- `SSH_PRIVATE_KEY` private key for SSH login
- `SSH_PORT` usually `22`
- `DEPLOY_PATH` path to project on server, e.g. `/opt/tankovani`

After this, every push to `main` triggers automatic deploy over SSH.

### 4. Optional HTTPS reverse proxy

`docker-compose.prod.yml` publishes app on port `80`. For public production, place Nginx/Traefik/Caddy in front and terminate HTTPS there.
