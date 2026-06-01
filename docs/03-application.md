# 03 — Application Architecture

This document describes **what the intranet software actually is today**, how its
pieces talk to one another, and how data flows through it. The application's
current implementation is Express + SQLite; the planned production
implementation is Fastify + PostgreSQL + Prisma. Both are documented; the
"Production migration" callout at the end of this chapter spells out the
mapping.

## Codebase layout (current)

```
   /srv/intranet/
   ├── docker-compose.yml          (two-service definition)
   ├── .env                        (SESSION_SECRET — sensitive)
   │
   ├── app/                        ⮜  BACKEND
   │   ├── server.js               (≈1,244 lines, monolithic Express app)
   │   ├── package.json            (dependencies — see below)
   │   └── node_modules/           (installed on container boot)
   │
   ├── frontend/                   ⮜  EMPLOYEE-FACING SPA
   │   ├── src/                    (React 19 source)
   │   │   ├── main.jsx
   │   │   ├── App.jsx             (routes)
   │   │   ├── layouts/            (MainLayout)
   │   │   ├── pages/              (Home, Announcements, Directory, …)
   │   │   ├── components/         (AnnouncementCard, EmployeeSpotlight)
   │   │   ├── context/            (SettingsContext)
   │   │   ├── services/api.js     (centralized fetch wrapper)
   │   │   └── hooks/, utils/
   │   ├── dist/                   ⮜  PRODUCTION BUILD (served by nginx)
   │   ├── vite.config.js
   │   └── package.json
   │
   ├── public/                     ⮜  STATIC PORTALS (no build step)
   │   ├── admin/  (login.html, dashboard.html)
   │   └── manager/ (index.html)
   │
   ├── nginx/
   │   └── default.conf            (reverse-proxy rules)
   │
   ├── data/                       ⮜  PERSISTENT SQLite DATA
   │   ├── intranet.db             (primary database, ~70 KB current size)
   │   └── sessions.db             (Express session store, ~12 KB)
   │
   ├── uploads/                    ⮜  UPLOADED FILES (photos, resources)
   │
   └── docs/                       (you are here)
```

## Backend dependencies (current)

From `app/package.json`:

```json
{
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "better-sqlite3": "^11.8.1",
    "connect-sqlite3": "^0.9.16",
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "express-session": "^1.18.1",
    "multer": "^1.4.5-lts.1",
    "express-rate-limit": "^7.5.0",
    "nodemailer": "^8.0.7"
  }
}
```

## Component map (current)

```
   +-----------------------------------------------------------------------+
   |                  EMPLOYEE BROWSER                                     |
   |                                                                       |
   |   +----------------------+    +--------------------+                  |
   |   |  React 19 SPA        |    |  Admin/Manager     |                  |
   |   |  /  (Home, Dir, …)   |    |  portals (plain    |                  |
   |   |  Built with Vite     |    |  HTML + JS, no     |                  |
   |   |  Tailwind v4         |    |  framework)        |                  |
   |   |  React Router 7      |    |  /admin/, /manager |                  |
   |   +----------+-----------+    +---------+----------+                  |
   +--------------|--------------------------|-----------------------------+
                  | fetch(/api/...)          | fetch(/api/...)
                  | credentials: "include"   |
                  v                          v
   +-----------------------------------------------------------------------+
   |                  intranet_nginx  (nginx:1.30-alpine)                  |
   |                                                                       |
   |   location / ---------> frontend/dist/  (SPA + static)                |
   |   location /admin/ ---> /admin/   (alias)                             |
   |   location /manager/ -> /manager/ (alias)                             |
   |   location /api/ -----> proxy_pass http://backend:3000/               |
   |                         (rewrites /api/foo  ->  /foo)                 |
   |   client_max_body_size 50M                                            |
   |   listens :80 (container)  ->  host :8080                             |
   +---------------------------------+-------------------------------------+
                                     | Docker bridge network
                                     v
   +-----------------------------------------------------------------------+
   |                  intranet_backend  (node:20-alpine)                   |
   |                                                                       |
   |   server.js                                                           |
   |   |- Express app (port 3000)                                          |
   |   |- express-session  (SQLite-backed via connect-sqlite3)             |
   |   |- better-sqlite3   (DB driver, synchronous, fast)                  |
   |   |- bcryptjs         (password hashing)                              |
   |   |- multer           (multipart file uploads -> /uploads)            |
   |   |- express-rate-limit (login limiter: 20 / 15 min)                  |
   |   +- nodemailer       (email, currently STUBBED - logs only)          |
   +-----------------+-------------------------------------+---------------+
                     |                                     |
                     v                                     v
   +------------------------------+      +------------------------------+
   |   /data/intranet.db          |      |   /uploads/                  |
   |   (SQLite primary DB)        |      |   Photos, attached files     |
   |   /data/sessions.db          |      |   Served via /files/ route   |
   |   (Express session store)    |      |   express.static('/uploads') |
   +------------------------------+      +------------------------------+
```

Because nginx **strips the `/api` prefix** before proxying, every route
defined in `server.js` is written **without** the `/api/` prefix. For example,
`app.get('/posts')` is what the browser reaches at `/api/posts`. Keep this in
mind when adding new endpoints.

## Database schema (current — SQLite)

The schema is defined inline at the top of `server.js` via `db.exec()` and
runs every time the backend starts. There are **no migration files** in the
current implementation.

```
   intranet.db (SQLite)
   |- users                       (login accounts, roles)
   |- posts                       (announcements with moderation workflow)
   |- resources                   (HR / Policy / etc. file listings)
   |- schedules                   (department schedules)
   |- spotlight                   (Employee Spotlight history)
   |- spotlight_nominations       (incoming nominations awaiting review)
   |- directory                   (employee directory entries)
   |- audit_log                   (super-admin actions for traceability)
   |- site_settings               (site-wide configuration: key/value)
   |- signup_sheets               (events open for signup)
   |- signup_entries              (one row per person signed up)
   +- it_tickets                  (IT support requests)

   sessions.db (SQLite, separate file)
   +- sessions                    (active Express sessions)
```

To inspect any table (current SQLite version):

```bash
$ docker compose exec backend sh
/app # apk add --no-cache sqlite     # one-time per container life
/app # sqlite3 /data/intranet.db
sqlite> .tables
sqlite> .schema users
sqlite> SELECT id, username, role FROM users;
sqlite> .quit
```

## Roles and authorization

Four authorization tiers, implemented as middleware in `server.js`:

```
                                  +----------------------------------+
                                  |  Public (no login)               |
                                  |  • Home, posts list, directory   |
                                  +----------------+-----------------+
                                                   | login
                                                   v
                                  +----------------------------------+
                                  |  requireLogin                    |
                                  |  any authenticated user          |
                                  +----------------+-----------------+
                                                   | role check
              +-----------------+------------------+-----------------+
              v                 v                  v                 v
   +------------------+ +----------------+ +----------------+ +--------------+
   | requireAdmin     | | requireApprover| | requireSuper-  | |              |
   | manager+admin    | | admin or       | | Admin          | |              |
   | +superadmin      | | superadmin     | | superadmin only| |              |
   +------------------+ +----------------+ +----------------+ +--------------+
   Used for:            Used for:           Used for:
   - creating posts     - approving posts   - user management
   - editing directory  - rejecting posts   - audit log
   - resources/schedules- destructive ops   - site settings
```

⚠️ **Naming caveat:** `requireAdmin` *also lets managers in.* If you intend
"no managers allowed," use `requireApprover`. This trips up new developers
— the name does not match what the function does.

## Frontend request lifecycle

```
   1. Browser visits  http://<vm-ip>:8080/
   2. nginx returns  frontend/dist/index.html
   3. The HTML pulls /assets/index-xxxx.js  (the bundled React app)
   4. React renders <App />
   5. <SettingsContext> fires  fetch('/api/settings')  on mount
      -> nginx proxies to backend -> returns site-wide config
   6. React Router resolves the URL to a <Page> component
   7. Page mounts -> calls one of the helpers in src/services/api.js
      e.g.  getPosts()  ->  fetch('/api/posts', { credentials: 'include' })
   8. Backend reads session cookie, returns approved posts only
   9. React renders the data; user sees the page
```

All API calls go through `src/services/api.js`. It centralizes:

- The `/api` base path
- `credentials: 'include'` so the session cookie rides along
- Error normalization (throws `Error(message)` for non-2xx)

When adding a new API endpoint, put a wrapper here rather than calling `fetch`
from a component.

## Admin / manager portals

Intentionally **not** part of the React SPA:

- Plain HTML + vanilla JS — no build tool, no `npm install`
- Edits are immediately live; just refresh
- Zero dependencies — survive npm-ecosystem rot

Both portals call the same `/api/*` endpoints as the SPA. Mounted read-only
into nginx at `/admin/` and `/manager/`.

## REST API surface (high-level)

A non-exhaustive list — see `server.js` for complete signatures.

```
   PUBLIC
   GET    /api/health                       liveness
   POST   /api/auth/login                   { username, password }
   POST   /api/auth/logout
   GET    /api/auth/me                      current user info
   GET    /api/posts                        approved posts only
   GET    /api/directory                    employee directory
   GET    /api/resources, /schedules, /settings, /spotlight, /search
   POST   /api/it-request                   open IT ticket
   POST   /api/spotlight/nominations        submit nomination
   GET    /api/signup-sheets[/:id]          list/view sign-up sheets

   REQUIRE LOGIN (manager / admin / superadmin)
   POST   /api/posts                        create new (status=pending)
   POST   /api/resources                    upload resource
   POST   /api/schedules                    create schedule

   REQUIRE APPROVER (admin / superadmin)
   GET    /api/admin/posts/pending          moderation queue
   POST   /api/admin/posts/:id/approve
   POST   /api/admin/posts/:id/reject

   REQUIRE SUPERADMIN
   GET    /api/admin/stats / audit / users
   POST   /api/admin/users                  create user
   PATCH  /api/admin/users/:id              update role/password
```

## Rate limiting and security (current)

- **Login** endpoint is rate-limited to **20 attempts per 15 minutes** per IP.
- Passwords are hashed with **bcrypt** before storage.
- Sessions are HTTP-only cookies (`httpOnly: true`, `sameSite: 'lax'`).
- `secure: false` is set because nginx serves over plain HTTP today.
- nginx forwards `X-Real-IP` to the backend for accurate per-IP rate limiting.

⚠️ **Today's deployment is plain HTTP on a trusted LAN/Tailscale only.**
Credentials cross the network in cleartext. This is acceptable in the
homelab but **must be replaced with TLS before any production exposure**
(see the migration plan below).

## Email

`nodemailer` is configured with `jsonTransport` — emails are logged to
stdout instead of being delivered. The intended Exchange SMTP block is
commented out at the top of `server.js`. To enable real email, fill in
the SMTP credentials there and `docker compose restart backend`.

## State that lives outside the container

| Host path | Container path | Why |
|---|---|---|
| `/srv/intranet/app/` | `/app/` | source code (live-mounted) |
| `/srv/intranet/data/` | `/data/` | SQLite databases |
| `/srv/intranet/uploads/` | `/uploads/` | uploaded files |
| `/srv/intranet/frontend/dist/` | `/usr/share/nginx/html/` (RO) | built SPA |
| `/srv/intranet/public/admin/` | `/admin/` (RO) | static admin portal |
| `/srv/intranet/public/manager/` | `/manager/` (RO) | static manager portal |
| `/srv/intranet/nginx/default.conf` | `/etc/nginx/conf.d/default.conf` (RO) | proxy config |

---

## 🔄 Production migration

The application code is the largest single change between homelab and production.
Planned changes:

### Backend rewrite

| Today (Express) | Target (Fastify) |
|---|---|
| `express` | `fastify` |
| `express-session` + `connect-sqlite3` | `@fastify/session` + `@fastify/cookie` |
| `multer` (multipart uploads) | `@fastify/multipart` |
| `express-rate-limit` | `@fastify/rate-limit` |
| `cors` | `@fastify/cors` |
| `better-sqlite3` (raw SQL) | `@prisma/client` (type-safe ORM) |
| Manual middleware functions | Fastify plugins + hooks |
| `app.get('/posts', ...)` route style | `fastify.get('/posts', { schema }, ...)` with JSON-schema validation |

The route handlers and business logic translate one-to-one. The schema
validation added by Fastify catches malformed payloads earlier; the
type-safe Prisma queries replace handwritten SQL.

### Database migration

| Today (SQLite) | Target (PostgreSQL) |
|---|---|
| `/srv/intranet/data/intranet.db` (file) | `Intranet-HCI.heart.local:5432`, database `intranet_hci` |
| Schema in `db.exec()` inline | `prisma/schema.prisma` (typed) |
| No migrations | `prisma/migrations/` versioned |
| Inspect with `sqlite3` | Inspect with `psql` or DBeaver from any DBA workstation |
| Session store in `sessions.db` | Session store in the same Postgres DB |
| Backups: copy the `.db` file | Backups: `pg_dump -Fc` |

### TLS

| Today | Target |
|---|---|
| Plain HTTP, port 8080 | HTTPS on port 443, internal CA cert |
| `secure: false` on session cookie | `secure: true` on session cookie |
| No HSTS header | HSTS enabled in nginx |

The migration is a single code branch — old and new cannot be partially
deployed. Once the Fastify branch is approved through change management,
the cutover replaces the entire backend container in one step. Data
migration from SQLite to PostgreSQL is a one-time script that ships with
the Fastify branch.

## Where to go next

- [`04-deployment.md`](04-deployment.md) — Docker Compose mechanics
- [`06-maintenance.md`](06-maintenance.md) — backup, rotate, and monitor the application
