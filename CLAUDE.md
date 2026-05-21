# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Internal employee intranet for The Heart Center (`<company-domain>`). Three audiences share one deployment: regular employees (React SPA), admins/managers (static HTML portals), and a superadmin (user management + audit log).

## Running the stack

Everything runs via Docker Compose from `/srv/intranet/`:

```bash
docker-compose up -d              # start
docker-compose down               # stop
docker-compose restart backend    # restart just the API after server.js changes
docker-compose logs -f backend    # tail backend logs
docker-compose exec backend sh    # shell into the node container
```

The backend container runs `npm install && npm start` on every boot, so adding a dependency to `app/package.json` only requires a `docker-compose restart backend`.

`SESSION_SECRET` is read from `/srv/intranet/.env` — the backend refuses to start without it.

## Frontend dev loop

The React app is built ahead-of-time and served statically by nginx from `frontend/dist/`. There is **no hot reload in the deployed stack** — after editing `frontend/src/`, rebuild:

```bash
cd /srv/intranet/frontend
npm run build                     # writes to dist/ which nginx serves read-only
npm run lint                      # eslint
npm run dev                       # optional: vite dev server (not wired to /api by default)
```

The admin (`public/admin/`) and manager (`public/manager/`) portals are hand-written static HTML/JS — no build step, edits are live after `docker-compose restart web` (or immediately, since the mount is read-only but nginx re-reads on request).

## Architecture

### Request flow

```
browser → nginx:80 (host :8080) ─┬─ /            → frontend/dist/ (React SPA, fallback to index.html)
                                 ├─ /admin/      → public/admin/   (static admin portal)
                                 ├─ /manager/    → public/manager/ (static manager portal)
                                 └─ /api/*       → backend:3000/*  (Express, /api prefix stripped)
```

Because nginx strips `/api`, routes in `server.js` are defined **without** the `/api` prefix (e.g. `app.get("/posts")` is reached as `/api/posts` from the browser). Keep this in mind when adding endpoints.

### Backend (`app/server.js`, single file, ~1244 lines)

- **Express + better-sqlite3 + express-session** (SQLite-backed via `connect-sqlite3`). DB lives at `/data/intranet.db`, sessions at `/data/sessions.db` — both on the `./data` volume.
- **`app.set("trust proxy", 1)`** is required because nginx is in front; don't remove it.
- All tables are created inline at boot via `db.exec(...)` — schema lives in `server.js` itself, not migrations. Adding a column means editing the `CREATE TABLE` block AND writing an `ALTER TABLE IF NOT EXISTS`-style guard if the table may already exist in production.
- **Auth model** — four middleware tiers, all session-based:
  - `requireLogin` — any authenticated user
  - `requireAdmin` — `manager`, `admin`, or `superadmin` (named "admin" but the **broadest** non-public tier)
  - `requireApprover` — `admin` or `superadmin` only (gatekeeps approve/reject/destructive actions)
  - `requireSuperAdmin` — `superadmin` only (user management, site settings, audit log)
  - The naming is counterintuitive: `requireAdmin` lets managers in. Use `requireApprover` when you actually mean "no managers."
- **`audit(req, action, detail)`** writes to `audit_log`. Call it from any state-changing superadmin/approver action — existing routes already follow this pattern.
- **Posts have a moderation workflow**: `status = 'pending' | 'approved' | 'rejected'`. Public `GET /posts` only returns approved; pending lives behind `/admin/posts/pending`.
- **Email is stubbed** (`nodemailer.createTransport({ jsonTransport: true })`) — SMTP credentials for the Exchange server are not yet filled in. The `sendMail()` wrapper currently just logs. See the commented block at the top of `server.js` for the intended config.
- **Rate limiting** is applied only to `/auth/login` (20/15min).

### Frontend (`frontend/src/`)

- React 19 + React Router 7 + Tailwind v4 (via `@tailwindcss/vite`, no separate config file).
- `services/api.js` is the single fetch wrapper — all API calls use `credentials: "include"` so the session cookie rides along. Add new endpoints there rather than calling `fetch` directly from components.
- `context/SettingsContext.jsx` loads `/api/settings` once and exposes site-wide settings (announcements config, etc.) — components consume it via the provided hook.
- Routing is centralized in `App.jsx`; `layouts/MainLayout.jsx` wraps the employee pages with the shared nav/header.

### Admin & manager portals (`public/admin/`, `public/manager/`)

These are intentionally **not** part of the React app — plain HTML + vanilla JS that call the same `/api/*` endpoints. Keep them dependency-free. They're mounted into nginx read-only at `/admin/` and `/manager/`.

## Database tables (defined in `server.js` lines 85–230)

`users`, `posts`, `resources`, `schedules`, `spotlight`, `directory`, `audit_log`, `site_settings`, `signup_sheets`, `signup_entries`, `it_tickets`, `spotlight_nominations`.

To inspect prod data:

```bash
docker-compose exec backend sh -c "sqlite3 /data/intranet.db '.tables'"
docker-compose exec backend sh -c "sqlite3 /data/intranet.db 'SELECT * FROM users'"
```

## Things to watch out for

- The admin user is seeded on first boot from `INITIAL_ADMIN_PASSWORD` in `.env`. Rotate via the website's user-management UI before any non-local exposure.
- `intranet-backup.tar.gz` in the project root is a 50 MB snapshot; don't accidentally commit or re-tar it into itself.
- `frontend/dist/` is checked in (nginx serves it) — remember to rebuild and commit after frontend changes, or the deployed UI won't reflect your edits.
- `cookies.txt` in the project root is leftover from manual `curl` testing — safe to ignore, not used by the app.
