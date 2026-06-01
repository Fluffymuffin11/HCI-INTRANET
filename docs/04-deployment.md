# 04 — Deployment

This document covers **how the intranet is packaged and run** in production
— Docker Compose for the application containers, PostgreSQL as a native
systemd service on the same VM, environment variables, and what happens
when the system boots.

## Single-VM topology

```
   +-------------------------------------------------------------------+
   |   Intranet-HCI.heart.local  (RHEL 10 VM on Huntsville vSphere)    |
   |                                                                   |
   |   +------------------+              +-----------------------+     |
   |   |  Docker Compose  |              |  PostgreSQL 16        |     |
   |   |                  |              |  (systemd service)    |     |
   |   |  intranet_nginx  |              |                       |     |
   |   |   :443           |              |  /var/lib/pgsql/data  |     |
   |   |                  |              |  listens :5432        |     |
   |   |  intranet_backend +-- 5432 ---->|                       |     |
   |   |   Fastify, Prisma|  via docker  |  users:                |     |
   |   |   :3000          |  bridge gw   |    intranet_app       |     |
   |   |                  |  172.18.0.1  |    intranet_ro        |     |
   |   +------------------+              |    <dba accounts>     |     |
   |                                     +-----------------------+     |
   |                                              ^                    |
   +----------------------------------------------|--------------------+
                                                  | TCP 5432
                                                  |
                          +---------------------+ |
                          |  DBA workstations   |-+
                          |  (psql / DBeaver /  |
                          |   pgAdmin)          |
                          +---------------------+
```

**Key point:** PostgreSQL is **not** in a container. It runs as a regular
systemd service on the host. The Fastify backend container reaches it via
the Docker bridge gateway IP (`172.18.0.1`) or, equivalently, via
`host.docker.internal` when Docker is configured for it.

## The Compose file

`/srv/intranet/docker-compose.yml`:

```yaml
services:
  web:
    image: nginx:1.30-alpine
    container_name: intranet_nginx
    ports:
      - "443:443"
    volumes:
      - ./frontend/dist:/usr/share/nginx/html:ro
      - ./public/admin:/admin:ro
      - ./public/manager:/manager:ro
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - ./nginx/tls:/etc/nginx/tls:ro
    depends_on:
      - backend
    restart: unless-stopped

  backend:
    image: node:20-alpine
    container_name: intranet_backend
    working_dir: /app
    extra_hosts:
      # Lets the container reach the host as 'host.docker.internal'
      - "host.docker.internal:host-gateway"
    environment:
      - TZ=America/Chicago
      - NODE_ENV=production
      - SESSION_SECRET=${SESSION_SECRET}
      - DATABASE_URL=${DATABASE_URL}
      - INITIAL_ADMIN_PASSWORD=${INITIAL_ADMIN_PASSWORD}
    volumes:
      - ./app:/app
      - ./uploads:/uploads
    command: sh -c "npm install && npx prisma migrate deploy && npm start"
    restart: unless-stopped
```

### Key design choices

1. **No custom Dockerfiles.** Stock public images (`nginx:1.30-alpine` and
   `node:20-alpine`). Application code is bind-mounted.

2. **`npm install` and `prisma migrate deploy` run on every container start.**
   Dependencies and schema stay in sync with the committed code at every restart.

3. **The database runs on the host, not in a container.** This is the
   deliberate production choice so DBAs can connect directly without
   container access. The backend reaches PostgreSQL through the Docker bridge.

4. **All persistent application state lives off-container.** Application
   code, uploads, and TLS certs are bind-mounted from the host filesystem.
   The database lives on the host filesystem at `/var/lib/pgsql/data`.

5. **`restart: unless-stopped` on both containers** — they survive Docker
   daemon restarts and boot automatically.

6. **`extra_hosts` adds `host.docker.internal`** so the connection string can
   read `host.docker.internal` instead of hard-coding `172.18.0.1`. Either
   form is acceptable.

## PostgreSQL setup (one-time)

The database is provisioned once during initial deployment of the VM:

```bash
# 1. Install PostgreSQL 16 from the Red Hat repos
$ sudo dnf install -y postgresql-server postgresql-contrib

# 2. Initialize the data directory
$ sudo /usr/bin/postgresql-setup --initdb

# 3. Enable at boot and start now
$ sudo systemctl enable --now postgresql

# 4. Configure listen_addresses
$ sudo sed -i "s/^#listen_addresses.*/listen_addresses = '*'/" /var/lib/pgsql/data/postgresql.conf

# 5. Configure host-based authentication (pg_hba.conf)
$ sudo tee -a /var/lib/pgsql/data/pg_hba.conf <<'HBA'
# Application backend (from Docker bridge)
host    intranet_hci   intranet_app    172.18.0.0/16    scram-sha-256
host    intranet_hci   intranet_ro     172.18.0.0/16    scram-sha-256
# DBAs on the corporate VLAN
host    intranet_hci   +dba_group      <corporate-vlan>/16  scram-sha-256
HBA

# 6. Reload PostgreSQL to pick up the new config
$ sudo systemctl reload postgresql

# 7. Create database, users, and grants
$ sudo -u postgres psql <<'SQL'
CREATE USER intranet_app WITH PASSWORD '<generated-strong-password>';
CREATE USER intranet_ro  WITH PASSWORD '<generated-strong-password>';
CREATE ROLE dba_group;
CREATE DATABASE intranet_hci OWNER intranet_app;
GRANT CONNECT ON DATABASE intranet_hci TO intranet_ro;
GRANT CONNECT ON DATABASE intranet_hci TO dba_group;
SQL

# 8. Open the firewall for DBA access (restricted to the corporate VLAN)
$ sudo firewall-cmd --permanent --add-port=5432/tcp
$ sudo firewall-cmd --reload
```

After step 7 the Prisma schema is applied automatically by the backend on
its first start (`npx prisma migrate deploy`).

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
   |    - mount ./app, ./uploads                          |
   |    - run npm install                                 |
   |    - run npx prisma migrate deploy                   |
   |       (connects to PostgreSQL on the host)           |
   |    - run npm start  ->  node server.js               |
   |    - server binds 0.0.0.0:3000 inside container      |
   +------------------------------------------------------+
                    |
                    v
   +------------------------------------------------------+
   |  Start web container (TLS termination, port 443)     |
   +------------------------------------------------------+
                    |
                    v
                READY
```

## Environment & secrets

Secrets live in `/srv/intranet/.env` on the VM:

```
SESSION_SECRET=<48-byte hex string>
DATABASE_URL=postgresql://intranet_app:<password>@host.docker.internal:5432/intranet_hci?schema=public&sslmode=disable
INITIAL_ADMIN_PASSWORD=<set once for first-boot seeding, then rotated via UI>
```

Note that `sslmode=disable` is acceptable here because the connection never
leaves the VM — the Docker bridge interface is internal to the host kernel.
For DBA workstations connecting from elsewhere on the network, configure
client-side TLS or `sslmode=require` depending on hospital policy.

The backend **refuses to start** if `SESSION_SECRET` or `DATABASE_URL` is
empty.

To rotate the session secret (invalidates all active sessions):
```bash
$ openssl rand -hex 48                                     # generate new value
$ sudo nano /srv/intranet/.env                             # paste in
$ docker compose restart backend                           # apply
```

To rotate the application user's database password:
```bash
$ sudo -u postgres psql -c "ALTER USER intranet_app WITH PASSWORD '<new>';"
$ sudo nano /srv/intranet/.env       # update DATABASE_URL with new password
$ docker compose restart backend
```

## Day-to-day operations cheatsheet

```bash
# Application containers
$ docker compose ps                  # show container state
$ docker compose up -d               # start (idempotent)
$ docker compose down                # stop and remove containers
$ docker compose restart             # restart both
$ docker compose restart backend     # just the backend
$ docker compose restart web         # just nginx
$ docker compose logs -f backend     # tail backend logs

# PostgreSQL (native, not in a container)
$ sudo systemctl status postgresql        # health
$ sudo systemctl restart postgresql       # restart database
$ sudo -u postgres psql intranet_hci      # local shell as DB owner
$ sudo journalctl -u postgresql -n 100    # PostgreSQL logs
```

## Database migrations (Prisma)

Schema changes are managed in version control as Prisma migrations under
`/srv/intranet/app/prisma/migrations/`. The deployment flow:

```
   1. Developer edits  app/prisma/schema.prisma
       |
       v
   2. Locally: npx prisma migrate dev --name <change>
       (creates a new SQL migration file under migrations/)
       |
       v
   3. Commit  schema.prisma + the new migrations folder
       |
       v
   4. Code review + change-management approval
       |
       v
   5. On production:
        cd /srv/intranet && docker compose restart backend
      (which runs `prisma migrate deploy` on startup)
```

Manual schema changes via `psql` **bypass this flow and will create drift.**
DBAs should treat the schema as code-owned.

## Building the frontend

```bash
$ cd /srv/intranet/frontend
$ npm run build           # produces fresh dist/
$ npm run lint            # ESLint
```

If you forget to rebuild after a frontend edit, the website continues to
serve the old UI — the most common source of "I deployed but I don't see
my change."

## Editing the admin or manager portals

Plain HTML/JS files:

```
   /srv/intranet/public/admin/dashboard.html
   /srv/intranet/public/admin/login.html
   /srv/intranet/public/manager/index.html
```

Edits are **immediately live** on the next page load; no container restart
is needed.

## Health and readiness

The backend exposes `GET /api/health`:
```bash
$ curl -sk https://Intranet-HCI.heart.local/api/health
{"ok":true,"db":"connected"}
```

## Cleanup recipes

```bash
# Stop containers (database untouched)
$ docker compose down

# Remove orphaned images / build cache
$ docker system prune -f

# Trim journald
$ sudo journalctl --vacuum-time=14d

# PostgreSQL maintenance
$ sudo -u postgres vacuumdb --all --analyze
$ sudo -u postgres reindexdb intranet_hci
```

## Where to go next

- [`05-remote-access.md`](05-remote-access.md) — getting into the box and the DB
- [`06-maintenance.md`](06-maintenance.md) — routine care
