# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Internal employee intranet for The Heart Center. Three audiences share one deployment: regular employees (React SPA), admins/managers (static HTML portals), and a superadmin (user management + audit log).

The system is currently running in a **homelab test environment** on Proxmox (RHEL 10.1, KVM guest). A migration to **Huntsville Hospital VMware vSphere** is planned for production.

## Running the stack (current)

Everything runs via Docker Compose from `/srv/intranet/`:

```bash
docker compose up -d              # start
docker compose down               # stop
docker compose restart backend    # restart just the API after server-fastify.js changes
docker compose logs -f backend    # tail backend logs
docker compose exec backend sh    # shell into the node container
```

The backend container runs `npm install && npm start` on every boot, so adding a dependency to `app/package.json` only requires `docker compose restart backend`.

`SESSION_SECRET` and `DATABASE_URL` are read from `/srv/intranet/.env` — the backend refuses to start without them.

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
                                 └─ /api/*       → backend:3000/*  (Fastify, /api prefix stripped)
```

Because nginx strips `/api`, routes in `server-fastify.js` are defined **without** the `/api` prefix. `fastify.get("/posts", ...)` is reached as `/api/posts` from the browser.

### Backend (`app/server-fastify.js`, ~450 lines, Fastify 5)

- **Fastify 5 + Prisma ORM + PostgreSQL 17** (hosted on RHEL 10.1 via PGDG, reachable from Docker as `host.docker.internal`).
- Schema lives in `prisma/schema.prisma` — apply changes with `prisma db push` (NOT `migrate dev` — the `intranet_app` DB user lacks CREATEDB, which `migrate dev` needs for a shadow database).
- Sessions are stored in the `sessions` Postgres table via a custom `PrismaSessionStore` class in `server-fastify.js`. TTL = 8 hours.
- **Auth model** — four middleware tiers, all session-based:
  - `requireLogin` — any authenticated user
  - `requireAdmin` — `manager`, `admin`, or `superadmin` (the **broadest** non-public tier despite its name)
  - `requireApprover` — `admin` or `superadmin` only (gatekeeps approve/reject/destructive actions)
  - `requireSuperAdmin` — `superadmin` only (user management, site settings, audit log)
  - The naming is counterintuitive: `requireAdmin` lets managers in. Use `requireApprover` when you actually mean "no managers."
- **`audit(req, action, detail)`** writes to `audit_log`. Call it from any state-changing superadmin/approver action.
- **Posts have a moderation workflow**: `status = 'pending' | 'approved' | 'rejected'`. Public `GET /posts` only returns approved posts.
- **File uploads** are handled by `handleMultipart()` — a streaming helper using `@fastify/multipart` + `pipeline()`. Uploads land in `/uploads/` (bind-mounted into the container).
- **Email is stubbed** (`nodemailer.createTransport({ jsonTransport: true })`). Real SMTP creds go in the transporter config block at the top of `server-fastify.js`.
- **Rate limiting** is applied globally via `@fastify/rate-limit` and tightened on `/auth/login` (20 / 15 min).

### Frontend (`frontend/src/`)

- React 19 + React Router 7 + Tailwind v4 (via `@tailwindcss/vite`).
- `services/api.js` is the single fetch wrapper — all API calls use `credentials: "include"`. Add new endpoints there.
- `context/SettingsContext.jsx` loads `/api/settings` once and exposes site-wide settings.
- Routing is centralized in `App.jsx`; `layouts/MainLayout.jsx` wraps the employee pages.

### Admin & manager portals (`public/admin/`, `public/manager/`)

Plain HTML + vanilla JS — no framework. Mounted read-only into nginx at `/admin/` and `/manager/`.

## Database (PostgreSQL 17)

Database: `intranet_hci`, user: `intranet_app`. Schema managed by Prisma (`prisma/schema.prisma`).

Tables: `users`, `posts`, `resources`, `schedules`, `spotlight`, `spotlight_nominations`, `directory`, `audit_log`, `site_settings`, `signup_sheets`, `signup_entries`, `it_tickets`, `sessions`.

To inspect prod data:

```bash
# From the host (PostgreSQL on RHEL):
psql -U intranet_app -d intranet_hci

# From inside the backend container:
docker compose exec backend sh -c "npx prisma studio"
```

To apply schema changes:
```bash
docker compose exec backend sh -c "npx prisma db push"
```

## Things to watch out for

- The admin user is seeded on first boot from `INITIAL_ADMIN_PASSWORD` in `.env`. Rotate via the website's user-management UI before any non-local exposure.
- `intranet-backup.tar.gz` in the project root is a 50 MB snapshot; don't accidentally commit or re-tar it into itself.
- `frontend/dist/` is checked in (nginx serves it) — remember to rebuild and commit after frontend changes, or the deployed UI won't reflect your edits.
- `cookies.txt` in the project root is leftover from manual `curl` testing — safe to ignore.
- DB passwords (`CHANGEME_app` in `.env`) must be rotated before production deployment.
- Tailscale is part of the homelab setup; do not configure it on the production VM.
- `server.js` (the old Express entry point) is archived in the repo for reference only — do not start it.
