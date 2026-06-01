# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Internal employee intranet for The Heart Center. Three audiences share one deployment: regular employees (React SPA), admins/managers (static HTML portals), and a superadmin (user management + audit log).

The system is currently running in a **homelab test environment** on Proxmox. A migration to **Huntsville Hospital VMware vSphere** is planned for production. See `docs/README.md` for the side-by-side current/target table.

## Running the stack (current)

Everything runs via Docker Compose from `/srv/intranet/`:

```bash
docker compose up -d              # start
docker compose down               # stop
docker compose restart backend    # restart just the API after server.js changes
docker compose logs -f backend    # tail backend logs
docker compose exec backend sh    # shell into the node container
```

The backend container runs `npm install && npm start` on every boot, so adding a dependency to `app/package.json` only requires `docker compose restart backend`.

`SESSION_SECRET` is read from `/srv/intranet/.env` — the backend refuses to start without it.

## Frontend dev loop

The React app is built ahead-of-time and served statically by nginx from `frontend/dist/`. There is **no hot reload in the deployed stack** — after editing `frontend/src/`, rebuild:

```bash
cd /srv/intranet/frontend
npm run build                     # writes to dist/ which nginx serves read-only
npm run lint                      # eslint
```

The admin (`public/admin/`) and manager (`public/manager/`) portals are hand-written static HTML/JS — no build step, edits are live immediately.

## Architecture (current)

### Request flow

```
browser → nginx:80 (host :8080) ─┬─ /            → frontend/dist/ (React SPA, fallback to index.html)
                                 ├─ /admin/      → public/admin/   (static admin portal)
                                 ├─ /manager/    → public/manager/ (static manager portal)
                                 └─ /api/*       → backend:3000/*  (Express, /api prefix stripped)
```

Because nginx strips `/api`, routes in `server.js` are defined **without** the `/api` prefix. `app.get("/posts")` is reached as `/api/posts` from the browser.

### Backend (`app/server.js`, ~1,244 lines, Express)

- **Express + better-sqlite3 + express-session** (SQLite-backed via connect-sqlite3). Databases live at `/data/intranet.db` and `/data/sessions.db` — both on the `./data` bind mount.
- All tables are created inline at boot via `db.exec(...)` — schema lives in `server.js` itself, not migrations. Adding a column means editing the `CREATE TABLE` block AND writing an `ALTER TABLE` guard if the table may already exist in production.
- **Auth model** — four middleware tiers, all session-based:
  - `requireLogin` — any authenticated user
  - `requireAdmin` — `manager`, `admin`, or `superadmin` (the **broadest** non-public tier despite its name)
  - `requireApprover` — `admin` or `superadmin` only (gatekeeps approve/reject/destructive actions)
  - `requireSuperAdmin` — `superadmin` only (user management, site settings, audit log)
  - The naming is counterintuitive: `requireAdmin` lets managers in. Use `requireApprover` when you actually mean "no managers."
- **`audit(req, action, detail)`** writes to `audit_log`. Call it from any state-changing superadmin/approver action.
- **Posts have a moderation workflow**: `status = 'pending' | 'approved' | 'rejected'`. Public `GET /posts` only returns approved.
- **Email is stubbed** (`nodemailer.createTransport({ jsonTransport: true })`). Real SMTP creds are in a commented block at the top of `server.js`.
- **Rate limiting** is applied only to `/auth/login` (20 / 15 min).

### Frontend (`frontend/src/`)

- React 19 + React Router 7 + Tailwind v4 (via `@tailwindcss/vite`).
- `services/api.js` is the single fetch wrapper — all API calls use `credentials: "include"`. Add new endpoints there.
- `context/SettingsContext.jsx` loads `/api/settings` once and exposes site-wide settings.
- Routing is centralized in `App.jsx`; `layouts/MainLayout.jsx` wraps the employee pages.

### Admin & manager portals (`public/admin/`, `public/manager/`)

Plain HTML + vanilla JS — no framework. Mounted read-only into nginx at `/admin/` and `/manager/`.

## Database tables (current — defined in `server.js`)

`users`, `posts`, `resources`, `schedules`, `spotlight`, `directory`, `audit_log`, `site_settings`, `signup_sheets`, `signup_entries`, `it_tickets`, `spotlight_nominations`.

To inspect prod data:

```bash
docker compose exec backend sh -c "sqlite3 /data/intranet.db '.tables'"
docker compose exec backend sh -c "sqlite3 /data/intranet.db 'SELECT * FROM users'"
```

## Planned production migration

When the system moves to Huntsville Hospital production, the application code is rewritten:

- `express` → `fastify`
- `express-session` → `@fastify/session`
- `better-sqlite3` → `@prisma/client` (Prisma ORM, PostgreSQL)
- `multer` → `@fastify/multipart`
- `express-rate-limit` → `@fastify/rate-limit`
- Inline schema in `server.js` → `prisma/schema.prisma` + `prisma/migrations/`
- HTTP `:8080` → HTTPS `:443` (internal CA cert)
- Tailscale + RDP → corporate network only

The migration is a single branch; old and new cannot be partially deployed. Data migration from SQLite to PostgreSQL is a one-time script that ships with the Fastify branch.

## Things to watch out for

- The admin user is seeded on first boot from `INITIAL_ADMIN_PASSWORD` in `.env`. Rotate via the website's user-management UI before any non-local exposure.
- `intranet-backup.tar.gz` in the project root is a 50 MB snapshot; don't accidentally commit or re-tar it into itself.
- `frontend/dist/` is checked in (nginx serves it) — remember to rebuild and commit after frontend changes, or the deployed UI won't reflect your edits.
- `cookies.txt` in the project root is leftover from manual `curl` testing — safe to ignore.
- Tailscale is part of the homelab setup; do not configure it on the production VM.
