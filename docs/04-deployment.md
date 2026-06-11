# 04 — Deployment

This document covers **how the intranet is packaged and run today** — Docker
Compose, the two application containers, environment variables, and what
happens when the system boots. The "Production migration" callout at the end
lists the deployment changes planned for the Huntsville Hospital rollout.

## Two-container topology (current)

`/srv/intranet/docker-compose.yml` defines two services:

```yaml
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
   (`nginx:1.30-alpine` and `node:20-alpine`). The application is supplied
   via bind-mounted source code.

2. **`npm install` runs on every container start.** Adding a dependency to
   `app/package.json` only requires `docker compose restart backend`.

3. **All persistent state is bind-mounted from the host.** No Docker named
   volumes. The host filesystem is canonical.

4. **`restart: unless-stopped`** — both services survive Docker daemon
   restarts and start automatically at boot.

5. **The web container `depends_on: backend`** so Compose starts the
   backend first. `depends_on` only waits for container start, not
   application readiness — see "Health and readiness" below.

## Container lifecycle

```
   $ docker compose up -d
                    |
                    v
   +------------------------------------------------------+
   |  Pull images (if not cached)                         |
   +------------------------------------------------------+
                    |
                    v
   +------------------------------------------------------+
   |  Create network 'intranet_default'  (172.18.0.0/16)  |
   +------------------------------------------------------+
                    |
                    v
   +------------------------------------------------------+
   |  Start backend container                             |
   |    - mount ./app, ./data, ./uploads                  |
   |    - run npm install                                 |
   |    - run npm start  ->  node server.js               |
   |    - server binds 0.0.0.0:3000 inside container      |
   +------------------------------------------------------+
                    |
                    v
   +------------------------------------------------------+
   |  Start web container                                 |
   |    - mount frontend/dist, public/, nginx config      |
   |    - nginx binds 0.0.0.0:80                          |
   |    - Docker publishes host :8080  ->  container :80  |
   +------------------------------------------------------+
                    |
                    v
                READY
```

## Networking inside Compose

```
   intranet_nginx               intranet_backend
   (service: web)               (service: backend)
       |  proxy_pass                  ^
       |   http://backend:3000/  -----+
       |
       v
   host 0.0.0.0:8080  (exposed, HTTP)
```

The backend's port `3000` is **not** published to the host. It is reachable
only from `web` (nginx).

## Environment & secrets

One secret today: `SESSION_SECRET` in `/srv/intranet/.env`:

```
SESSION_SECRET=<hex string>
```

Compose reads `.env` automatically and substitutes `${SESSION_SECRET}` into
the backend's environment.

The backend **refuses to start** if `SESSION_SECRET` is empty. Startup log:
```
FATAL: SESSION_SECRET environment variable is not set. Refusing to start.
```

To rotate (invalidates all sessions):
```bash
$ openssl rand -hex 48                                # generate new
$ sudo nano /srv/intranet/.env                        # paste in
$ docker compose restart backend                      # apply
```

## Day-to-day operations cheatsheet

Run from `/srv/intranet/`:

```bash
$ docker compose ps                  # show container state
$ docker compose up -d               # start (idempotent)
$ docker compose down                # stop and remove containers
$ docker compose restart             # restart both
$ docker compose restart backend     # just the backend
$ docker compose restart web         # just nginx
$ docker compose logs -f backend     # tail backend logs
$ docker compose logs -f web         # tail nginx logs
$ docker compose logs --tail=100     # last 100 lines of each
$ docker compose exec backend sh     # shell into backend container
$ docker compose exec web sh         # shell into nginx container
$ docker compose pull                # fetch newer image tags
```

**Tip:** `docker compose` is *declarative* and *idempotent*. Running
`docker compose up -d` against an already-running stack is a no-op.

## What "restart" actually does

```
   docker compose restart backend
       |
       +- send SIGTERM to the running container
       |    (10-second grace, then SIGKILL)
       |
       +- start a new container from the same image
       |
       +- re-mount the volumes
       |
       +- run the start command:
              sh -c "npm install && npm start"
              -- re-runs every restart, ~10-20 seconds
```

The backend takes ≈15–30 seconds to be ready after a restart because of
`npm install`.

## Building the frontend

The React app is **built ahead of time** and the artifacts in
`frontend/dist/` are what nginx serves. **No hot-reload in the deployed
stack.** After editing anything under `frontend/src/`:

```bash
$ cd /srv/intranet/frontend
$ npm run build           # produces fresh dist/  (10-30 s)
$ npm run lint            # optional, runs ESLint
```

⚠️ If you forget to rebuild, the website continues serving the old UI —
this is the #1 confusing symptom for new contributors.

## Editing the admin or manager portals

Plain HTML/JS files at:

```
   /srv/intranet/public/admin/dashboard.html
   /srv/intranet/public/admin/login.html
   /srv/intranet/public/manager/index.html
```

Edits are **immediately live** on the next page load.

## Health and readiness

No formal healthchecks in `docker-compose.yml`. The `GET /api/health`
endpoint exists for manual probing:

```bash
$ curl -i http://localhost:8080/api/health
HTTP/1.1 200 OK
…
{"ok":true}
```

## Cleanup recipes

```bash
$ docker compose down                # stop, keep data
$ docker system prune -f             # remove unused images / cache
$ sudo journalctl --vacuum-time=14d  # trim system logs
$ docker system df                   # Docker's disk footprint
```

---

## 🔄 Production migration

The deployment topology adds PostgreSQL and switches from HTTP:8080 to
HTTPS:443. The Compose file gains an `extra_hosts` entry so the backend
can reach the host's PostgreSQL through `host.docker.internal`.

### Compose changes

```yaml
# New ports section on the web service
ports:
  - "443:443"          # was "8080:80"
volumes:
  - ./nginx/tls:/etc/nginx/tls:ro    # NEW — mounts the TLS cert/key

# Backend changes
backend:
  image: node:22-alpine                       # bump from node:20-alpine
  extra_hosts:
    - "host.docker.internal:host-gateway"   # NEW — lets backend reach host
  environment:
    - DATABASE_URL=${DATABASE_URL}           # NEW — Postgres connection
    - INITIAL_ADMIN_PASSWORD=${INITIAL_ADMIN_PASSWORD}   # NEW
  command: sh -c "npm install && npx prisma migrate deploy && npm start"
```

### One-time PostgreSQL setup on the production VM

PostgreSQL 17 is not in the default RHEL 10 AppStream (which ships PG 16).
Install from the official PostgreSQL repository:

```bash
# 1. Add the official PostgreSQL repo
$ sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-10-x86_64/pgdg-redhat-repo-latest.noarch.rpm

# 2. Disable the built-in postgresql AppStream module (avoids version conflict)
$ sudo dnf -qy module disable postgresql

# 3. Install PostgreSQL 17
$ sudo dnf install -y postgresql17-server postgresql17-contrib
$ sudo /usr/pgsql-17/bin/postgresql-17-setup initdb
$ sudo systemctl enable --now postgresql-17
# Configure listen_addresses and pg_hba.conf in /var/lib/pgsql/17/data/, then:
$ sudo systemctl reload postgresql-17
$ sudo -u postgres psql <<'SQL'
CREATE USER intranet_app WITH PASSWORD '...';
CREATE USER intranet_ro  WITH PASSWORD '...';
CREATE ROLE dba_group;
CREATE DATABASE intranet_hci OWNER intranet_app;
SQL
$ sudo firewall-cmd --permanent --add-port=5432/tcp
$ sudo firewall-cmd --reload
```

### Updated `.env`

```
SESSION_SECRET=<48-byte hex>
DATABASE_URL=postgresql://intranet_app:<pw>@host.docker.internal:5432/intranet_hci?schema=public
INITIAL_ADMIN_PASSWORD=<seeds admin on first boot>
```

### Updated nginx config (TLS termination)

The container nginx config grows a `listen 443 ssl;` server block with
`ssl_certificate` and `ssl_certificate_key` pointing at the bind-mounted
cert from `/srv/intranet/nginx/tls/`.

### Data migration

A one-time script (`scripts/migrate-sqlite-to-pg.js` to be written as part
of the Fastify branch) reads from `intranet.db` and writes to PostgreSQL
via Prisma. Run once on cutover day, after stopping the Express backend
and before starting the Fastify backend.

## Where to go next

- [`05-remote-access.md`](05-remote-access.md) — getting into the box
- [`06-maintenance.md`](06-maintenance.md) — routine care
