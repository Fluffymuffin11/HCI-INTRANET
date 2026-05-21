# 03 — Application Architecture

This document describes **what the intranet software actually is**, how its
pieces talk to one another, and how data flows through it.

## Codebase layout

```
   /srv/intranet/
   ├── docker-compose.yml          (the two-service definition)
   ├── .env                        (SESSION_SECRET — sensitive)
   │
   ├── app/                        ⮜  BACKEND
   │   ├── server.js               (≈1,244 lines, monolithic Express app)
   │   ├── package.json            (dependencies)
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
   │   ├── admin/
   │   │   ├── login.html
   │   │   └── dashboard.html
   │   └── manager/
   │       └── index.html
   │
   ├── nginx/
   │   └── default.conf            (reverse-proxy rules)
   │
   ├── data/                       ⮜  PERSISTENT DATA
   │   ├── intranet.db             (SQLite — primary database)
   │   └── sessions.db             (SQLite — session store)
   │
   ├── uploads/                    ⮜  UPLOADED FILES (photos, resources)
   │
   └── docs/                       (you are here)
```

## Component map

```
   ┌───────────────────────────────────────────────────────────────────────┐
   │                  EMPLOYEE BROWSER                                     │
   │                                                                       │
   │   ┌──────────────────────┐    ┌────────────────────┐                  │
   │   │  React 19 SPA        │    │  Admin/Manager     │                  │
   │   │  /  (Home, Dir, …)   │    │  portals (plain    │                  │
   │   │  Built with Vite     │    │  HTML + JS, no     │                  │
   │   │  Tailwind v4         │    │  framework)        │                  │
   │   │  React Router 7      │    │  /admin/, /manager │                  │
   │   └──────────┬───────────┘    └─────────┬──────────┘                  │
   └──────────────┼──────────────────────────┼─────────────────────────────┘
                  │ fetch(/api/...)          │ fetch(/api/...)
                  │ credentials: "include"   │
                  ▼                          ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │                  intranet_nginx  (nginx:1.30-alpine)                  │
   │                                                                       │
   │   location / ─────────────► frontend/dist/  (SPA + static)            │
   │   location /admin/ ───────► /admin/   (alias)                         │
   │   location /manager/ ─────► /manager/ (alias)                         │
   │   location /api/ ─────────► proxy_pass http://backend:3000/           │
   │                            (rewrites /api/foo  →  /foo)               │
   │   client_max_body_size 50M                                            │
   └─────────────────────────────────┬─────────────────────────────────────┘
                                     │ Docker bridge network
                                     ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │                  intranet_backend  (node:20-alpine)                   │
   │                                                                       │
   │   server.js                                                           │
   │   ├─ Express app (port 3000)                                          │
   │   ├─ express-session  (SQLite-backed via connect-sqlite3)             │
   │   ├─ better-sqlite3   (DB driver, synchronous, fast)                  │
   │   ├─ bcryptjs         (password hashing)                              │
   │   ├─ multer           (multipart file uploads → /uploads)             │
   │   ├─ express-rate-limit (login limiter: 20 / 15 min)                  │
   │   └─ nodemailer       (email, currently STUBBED — logs only)          │
   └─────────────────┬─────────────────────────────────────┬───────────────┘
                     │                                     │
                     ▼                                     ▼
   ┌──────────────────────────────┐      ┌──────────────────────────────┐
   │   /data/intranet.db          │      │   /uploads/                  │
   │   (SQLite primary DB)        │      │   Photos, attached files     │
   │   /data/sessions.db          │      │   Served via /files/ route   │
   │   (Express session store)    │      │   express.static('/uploads') │
   └──────────────────────────────┘      └──────────────────────────────┘
```

⚠️ Because nginx **strips the `/api` prefix** before proxying, every route
defined in `server.js` is written **without** the `/api/` prefix. For example,
`app.get('/posts')` is what the browser reaches at `/api/posts`. Forgetting
this is one of the most common mistakes when adding new endpoints.

## Database schema

The schema is defined in-line at the top of `server.js` via `db.exec()` and
runs every time the backend starts. There are **no migration files**.

```
   intranet.db
   ┌─ users                       (login accounts, roles)
   │     id, username, password_hash, role, created_at
   │
   ├─ posts                       (announcements)
   │     id, title, content, photo_filename, author_id,
   │     status [pending|approved|rejected], reviewed_by, created_at
   │
   ├─ resources                   (HR / Policy / etc. file listings)
   │
   ├─ schedules                   (department schedules)
   │
   ├─ spotlight                   (Employee Spotlight history)
   │
   ├─ spotlight_nominations       (incoming nominations awaiting review)
   │
   ├─ directory                   (employee directory entries)
   │
   ├─ audit_log                   (super-admin actions for traceability)
   │
   ├─ site_settings               (site-wide configuration: key/value)
   │
   ├─ signup_sheets               (events open for signup)
   │
   ├─ signup_entries              (one row per person signed up)
   │
   └─ it_tickets                  (IT support requests)

   sessions.db                    ⮜  separate file managed by connect-sqlite3
   └─ sessions                    (active Express sessions, opaque to app code)
```

To inspect any table:
```bash
$ docker exec -it intranet_backend sh
/app # sqlite3 /data/intranet.db
sqlite> .tables
sqlite> .schema users
sqlite> SELECT * FROM users;
sqlite> .quit
```

## Roles and authorization

The application has **four authorization tiers**, implemented as middleware in
`server.js`:

```
                                  ┌──────────────────────────────────┐
                                  │  Public (no login)               │
                                  │  • Home, posts list, directory   │
                                  └────────────────┬─────────────────┘
                                                   │ login
                                                   ▼
                                  ┌──────────────────────────────────┐
                                  │  requireLogin                    │
                                  │  any authenticated user          │
                                  └────────────────┬─────────────────┘
                                                   │ role check
              ┌─────────────────┬──────────────────┼──────────────────────┐
              ▼                 ▼                  ▼                      ▼
   ┌────────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
   │ requireAdmin       │ │ requireApprover│ │ requireSuper-  │ │ (no further)   │
   │ manager OR admin   │ │ admin OR       │ │ Admin          │ │                │
   │ OR superadmin      │ │ superadmin     │ │ superadmin only│ │                │
   └────────────────────┘ └────────────────┘ └────────────────┘ └────────────────┘
   Used for:              Used for:           Used for:
   - creating posts       - approving/        - user management
   - editing directory      rejecting posts   - audit log
   - resources/sched mgr  - deleting          - site settings
                            destructive ops
```

⚠️ **Naming caveat:** `requireAdmin` *also lets managers in.* If you intend "no
managers allowed," use `requireApprover`. This trips up new developers — the
name does not match what the function does.

## Frontend (React SPA) — request lifecycle

```
   1. Browser visits  http://<LAN_IP>:8080/
   2. nginx returns  frontend/dist/index.html
   3. The HTML pulls /assets/index-xxxx.js  (the bundled React app)
   4. React renders <App />
   5. <SettingsContext> fires  fetch('/api/settings')  on mount
      → nginx proxies to backend → returns site-wide config (announcements
        enabled?  spotlight enabled?  etc.)
   6. React Router resolves the URL to a <Page> component
   7. Page mounts → calls one of the helpers in src/services/api.js, e.g.
        getPosts()  →  fetch('/api/posts', { credentials: 'include' })
   8. Backend reads session cookie, returns approved posts only
   9. React renders the data; user sees the page
```

All API calls go through `src/services/api.js`. It centralizes:

- The `/api` base path
- `credentials: 'include'` so the session cookie rides along
- Error normalization (throws `Error(message)` for non-2xx)

When adding a new API endpoint, put a wrapper here rather than calling `fetch`
from a component.

## Admin / manager portals — why they exist

These are intentionally **not** part of the React SPA:

- They are plain HTML + vanilla JS — no build tool, no `npm install`
- Edits are immediately live; just refresh
- They have zero dependencies — survive npm-ecosystem rot

Both portals call the same `/api/*` endpoints as the SPA. They are mounted
read-only into nginx at `/admin/` and `/manager/`.

| Portal | Path on disk | URL |
|---|---|---|
| Admin | `/srv/intranet/public/admin/`     | `http://.../admin/` |
| Manager | `/srv/intranet/public/manager/` | `http://.../manager/` |

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
   GET    /api/manager/my-posts             my own pending/approved
   GET/POST/PATCH/DEL  /api/manager/directory/...

   REQUIRE APPROVER (admin / superadmin)
   GET    /api/admin/posts/pending          moderation queue
   POST   /api/admin/posts/:id/approve
   POST   /api/admin/posts/:id/reject
   DELETE /api/admin/posts/:id
   GET    /api/admin/spotlight/nominations
   DELETE /api/admin/spotlight/nominations/:id
   DELETE /api/signup-sheets/:id

   REQUIRE SUPERADMIN
   GET    /api/admin/stats                  dashboard counters
   GET    /api/admin/audit                  audit log entries
   GET    /api/admin/users                  user management
   POST   /api/admin/users                  create user
   PATCH  /api/admin/users/:id              update role/password
   DELETE /api/admin/users/:id
   POST   /api/admin/settings               site-wide settings
```

## Rate limiting and security

- **Login** endpoint is rate-limited to **20 attempts per 15 minutes** per IP.
- Passwords are hashed with **bcrypt** before storage.
- Sessions are HTTP-only cookies (`httpOnly: true`, `sameSite: 'lax'`).
  `secure: false` is set because nginx fronts the app over plain HTTP — see
  the security note below.
- nginx is configured with `trust proxy = 1` so the backend honors
  `X-Real-IP` for accurate per-IP rate limiting.

⚠️ **Security gap to be aware of:** the site is currently served over plain
HTTP on port 8080. Credentials traverse the local network in cleartext.
Acceptable on a trusted LAN, but **adding TLS is a recommended next step**
(see [`06-maintenance.md`](06-maintenance.md) → *Hardening checklist*).

## Email

`nodemailer` is configured with `jsonTransport` — emails are logged to
stdout instead of being delivered. The intended Exchange SMTP block is
**commented out at the top of `server.js`**. To enable real email:

1. Edit `/srv/intranet/app/server.js`
2. Replace the `jsonTransport` line with one of the templates in the comment block
3. Fill in `host`, `port`, `auth`
4. `cd /srv/intranet && docker compose restart backend`

## State that lives outside the container

Anything that should survive container restarts is bind-mounted from the host:

| Host path | Container path | Persists | Why |
|---|---|---|---|
| `/srv/intranet/app/`       | `/app/`       | yes | source code (live-mounted for easy edits) |
| `/srv/intranet/data/`      | `/data/`      | yes | SQLite databases |
| `/srv/intranet/uploads/`   | `/uploads/`   | yes | uploaded files |
| `/srv/intranet/frontend/dist/` | `/usr/share/nginx/html/` | yes (R/O) | built SPA |
| `/srv/intranet/public/admin/`  | `/admin/`  | yes (R/O) | static admin portal |
| `/srv/intranet/public/manager/`| `/manager/`| yes (R/O) | static manager portal |
| `/srv/intranet/nginx/default.conf` | `/etc/nginx/conf.d/default.conf` | yes (R/O) | proxy config |

This means: **if the containers are destroyed, no data is lost** — only the
runtime is rebuilt. The host filesystem is the source of truth.

## Where to go next

- [`04-deployment.md`](04-deployment.md) — how the containers are orchestrated
- [`06-maintenance.md`](06-maintenance.md) — backup, rotate, and monitor the application
