# Pepsi POS Platform

Unified POS system with synced web + mobile clients:
- Web POS (`apps/web`) responsive for desktop and iPhone Safari.
- Expo POS app (`apps/mobile`) for Android users.
- Shared realtime API (`apps/server`) with Socket.IO sync.

## Authentication
- Backend auth uses short-lived access JWT + rotating refresh tokens.
- Roles: `cashier`, `admin`.
- Default credentials:
  - `cashier` / `cash123`
  - `admin` / `admin123`
- Role permissions:
  - `cashier`: billing/checkout actions.
  - `admin`: dashboard + inventory update actions.
- User and refresh-token store is persisted in `apps/server/auth-data.json` (auto-created on first run).

## Implemented POS Behavior
- Product catalog with search.
- Cart add/remove quantity controls.
- Discount + tax calculation.
- Checkout with payment type, cashier, customer.
- Sales history feed.
- Inventory stock updates.
- Dashboard stats (total sales, today's sales, today's revenue, low-stock list).
- Realtime cross-device sync using Socket.IO (`state:sync`).
- Admin CRUD persistence:
  - Customers (`/customers`)
  - Staff (`/staff`)
  - Stock updates (`/products/:id`)

## Monorepo Structure
- `apps/server`: Express + Socket.IO + JSON persistence (`data.json`).
- `apps/web`: Vite + React responsive POS.
- `apps/mobile`: Expo + React Native POS.
- `packages/shared`: shared totals/event constants.

## Setup
1. Install deps:
   ```bash
   npm install
   ```
2. Server env:
   - Copy `apps/server/.env.example` to `.env` and adjust if needed.
   - Set a strong `JWT_SECRET` in production.
3. Web env:
   - Copy `apps/web/.env.example` to `.env`.
4. Mobile env:
   - Copy `apps/mobile/.env.example` to `.env`.
   - For Android emulator keep `http://10.0.2.2:4010`.
   - For real device, replace with your PC LAN IP (e.g. `http://192.168.1.20:4010`).

## Run
- Server: `npm run dev:server`
- Web: `npm run dev:web`
- Mobile (Expo): `npm run dev:mobile`
- Or all together: `npm run dev`

## Sync Model
- All clients read/write the same backend state.
- Checkout updates inventory and sales history on server.
- Server emits socket events and pushes full state snapshots.

## Build
- Web production build: `npm run build -w apps/web`

## Automatic Database Backups
This repo includes a GitHub Actions workflow that runs a daily PostgreSQL backup and stores it as a build artifact.

Files:
- `.github/workflows/db-backup.yml`
- `scripts/db-backup.sh`

Setup:
1. Open your GitHub repo: `Settings -> Secrets and variables -> Actions`.
2. Add a secret named `DATABASE_URL`.
3. Use your production Postgres connection string.
4. Go to `Actions -> Database Backup` and click `Run workflow` once to verify.

Restore example:
```bash
gunzip -c pepsi-pos-backup-YYYYMMDD-HHMMSS.sql.gz | psql "postgresql://USER:PASSWORD@HOST:PORT/DBNAME"
```

## Notes
- Initial data is auto-seeded in `apps/server/data.json` on first run.
- If you need exact parity with your previous POS's custom edge cases, send that feature list and I will map them 1:1 into this codebase.
