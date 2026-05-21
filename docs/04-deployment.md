# 04 — Deployment

This document covers **how the intranet is packaged and run** — Docker Compose,
the two containers, environment variables, and what happens when the system
boots.

## The Compose file

`/srv/intranet/docker-compose.yml` is the single source of truth for runtime
topology. It defines two services:

```yaml
version: "3.8"

services:
  web:
    image: nginx:1.30-alpine
    container_name: intranet_nginx
    ports:
      - "8080:80"
    volumes:
      - ./frontend/dist:/usr/share/nginx/html:ro
      - ./public/admin:/admin:ro
      - ./public/manager:/manager:ro
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - backend
    restart: unless-stopped

  backend:
    image: node:20-alpine
    container_name: intranet_backend
    working_dir: /app
    environment:
      - TZ=America/Chicago
      - NODE_ENV=production
      - SESSION_SECRET=${SESSION_SECRET}
    volumes:
      - ./app:/app
      - ./data:/data
      - ./uploads:/uploads
    command: sh -c "npm install && npm start"
    restart: unless-stopped
```

### Key design choices

1. **No custom Dockerfiles.** Both services use stock public images
   (`nginx:1.30-alpine` and `node:20-alpine`). The application is supplied via
   bind-mounted source code. This means upgrading Node is as simple as bumping
   the image tag.

2. **`npm install` runs on every container start.** The backend's command is
   `sh -c "npm install && npm start"`. Adding a dependency to
   `app/package.json` therefore requires only a `docker compose restart backend`
   — no image rebuild.

3. **All persistent state is bind-mounted from the host.** There are no Docker
   *named volumes*. The host filesystem is canonical.

4. **`restart: unless-stopped` on both services** — they survive Docker daemon
   restarts and crashes, and start automatically at boot when
   `docker.service` comes up.

5. **The nginx container `depends_on: backend`** so Compose starts the backend
   first. (Note: `depends_on` only waits for container start, not application
   readiness — see "Health checks" below.)

## Container lifecycle

```
   $ docker compose up -d
                    │
                    ▼
   ┌──────────────────────────────────────────────────────┐
   │  Pull images (if not cached)                         │
   │     docker.io/library/nginx:1.30-alpine              │
   │     docker.io/library/node:20-alpine                 │
   └──────────────────────────────────────────────────────┘
                    │
                    ▼
   ┌──────────────────────────────────────────────────────┐
   │  Create network 'intranet_default'                   │
   │  (172.18.0.0/16 bridge)                              │
   └──────────────────────────────────────────────────────┘
                    │
                    ▼
   ┌──────────────────────────────────────────────────────┐
   │  Start backend container                             │
   │    - mount ./app, ./data, ./uploads                  │
   │    - run npm install                                 │
   │    - run npm start  →  node server.js                │
   │    - server binds 0.0.0.0:3000 inside container      │
   └──────────────────────────────────────────────────────┘
                    │
                    ▼
   ┌──────────────────────────────────────────────────────┐
   │  Start web container                                 │
   │    - mount frontend/dist, public/, nginx config      │
   │    - nginx starts, binds 0.0.0.0:80                  │
   │    - Docker publishes host :8080 → container :80     │
   └──────────────────────────────────────────────────────┘
                    │
                    ▼
                READY
```

## Networking inside Compose

Compose creates a private bridge network (`intranet_default`). Within it,
containers reach each other by **service name** as a DNS host:

```
   intranet_nginx               intranet_backend
   (service: web)               (service: backend)
       │  proxy_pass                  ▲
       │   http://backend:3000/  ─────┘
       │
       ▼
   host 0.0.0.0:8080  (exposed)
```

The backend's port `3000` is **not** published to the host. It is reachable
only from `web` (nginx), which is the security boundary.

## Environment & secrets

There is one secret: `SESSION_SECRET`. It lives in `/srv/intranet/.env`:

```
   SESSION_SECRET=79b0459f31b1d9aae11be530f8d64e8d8769214568334b8085dadda12f0988b0…
```

Compose automatically reads `.env` from the project directory and substitutes
`${SESSION_SECRET}` into the backend service's environment.

⚠️ The backend **refuses to start** if `SESSION_SECRET` is empty or missing.
The startup log will show:
```
FATAL: SESSION_SECRET environment variable is not set. Refusing to start.
```

To rotate the secret (this invalidates all active sessions):
```bash
$ openssl rand -hex 48                                     # generate new value
$ vim /srv/intranet/.env                                   # paste it in
$ cd /srv/intranet && docker compose restart backend       # apply
```

## Day-to-day operations cheatsheet

All commands are run from `/srv/intranet/`:

```bash
$ docker compose ps                  # show container state
$ docker compose up -d               # start (idempotent)
$ docker compose down                # stop and remove containers
$ docker compose restart             # restart both
$ docker compose restart backend     # restart just the backend
$ docker compose restart web         # restart just nginx
$ docker compose logs -f backend     # tail backend logs
$ docker compose logs -f web         # tail nginx logs
$ docker compose logs --tail=100     # last 100 lines of each
$ docker compose exec backend sh     # shell into backend container
$ docker compose exec web sh         # shell into nginx container
$ docker compose pull                # fetch newer image tags (no upgrade yet)
```

💡 **Tip — running the same command twice is safe.** Compose is *declarative*
and *idempotent*. `docker compose up -d` against an already-running stack is a
no-op.

## What "restart" actually does

```
   docker compose restart backend
       │
       ├─►  send SIGTERM to the running container
       │    (10-second grace, then SIGKILL)
       │
       ├─►  start a new container from the same image
       │
       ├─►  re-mount the volumes
       │
       └─►  run the start command:
                sh -c "npm install && npm start"
                       └─ re-runs every restart, ~10–20 seconds
```

The backend startup includes a fresh `npm install`. This is convenient (you
can edit `package.json` and just restart) but means **the backend takes
≈15–30 seconds to be ready after a restart.**

## Building the frontend

The React app is **built ahead of time** and the artifacts in
`frontend/dist/` are what nginx serves. There is **no hot-reload** in the
deployed stack.

After editing anything under `frontend/src/`:

```bash
$ cd /srv/intranet/frontend
$ npm run build           # produces fresh dist/  (takes 10–30 s)
$ npm run lint            # optional, runs ESLint
```

⚠️ If you forget to rebuild, the website will continue serving the old UI —
this is the #1 confusing symptom for new contributors.

For development with hot reload, you *can* run `npm run dev` (Vite dev server
on port 5173), but it doesn't proxy `/api` requests by default — you'd have
to configure a Vite proxy or set CORS in the backend.

## Editing the admin or manager portals

These are plain HTML/JS files at:

```
   /srv/intranet/public/admin/dashboard.html
   /srv/intranet/public/admin/login.html
   /srv/intranet/public/manager/index.html
```

Edits are **immediately live** on the next page load. The mounts are read-only
inside the container, but nginx re-reads the files for each request, so no
container restart is needed.

## What happens at host boot

```
   power on
       ▼
   systemd starts docker.service
       ▼
   Docker daemon scans for containers with restart policies
       ▼
   intranet_backend  (unless-stopped)  ─►  starts
       npm install  →  npm start  →  binds :3000
       ▼
   intranet_nginx    (unless-stopped)  ─►  starts
       nginx binds host :8080  →  proxy_pass backend:3000
       ▼
   Site live at  http://<LAN_IP>:8080/
```

If a container crashes, Docker restarts it (because of `restart: unless-stopped`).
Crash loops are visible via `docker compose ps` (status will flicker between
`Up` and `Restarting`).

## Image upgrades

The pinned image tags are:
- `nginx:1.30-alpine`
- `node:20-alpine`

To upgrade to a newer minor version (e.g., Node 22):

```bash
$ vim /srv/intranet/docker-compose.yml          # change 20-alpine → 22-alpine
$ cd /srv/intranet
$ docker compose pull                           # fetch new image
$ docker compose up -d                          # recreate containers
$ docker compose logs -f backend                # verify it boots cleanly
```

⚠️ Test on a maintenance window — a major Node version may break dependencies.

## Health and readiness

There are **no formal health checks** defined in `docker-compose.yml`. The
`GET /api/health` endpoint exists for manual probing:

```bash
$ curl -i http://localhost:8080/api/health
HTTP/1.1 200 OK
…
{"ok":true}
```

A future enhancement is to add `healthcheck:` blocks to the Compose file so
Docker auto-restarts unresponsive containers.

## Cleanup recipes

```bash
# Stop the stack but keep data
$ docker compose down

# Remove orphaned images / build cache (safe — reclaims disk)
$ docker system prune -f

# Remove old log data from journald (system-wide, see 06-maintenance)
$ sudo journalctl --vacuum-time=14d

# Inspect docker disk usage
$ docker system df
```

## Where to go next

- [`05-remote-access.md`](05-remote-access.md) — getting into the box to run these commands
- [`06-maintenance.md`](06-maintenance.md) — routine care
