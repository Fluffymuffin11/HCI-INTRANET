# 01 — System Overview

## What this system is

The **Heart Center Intranet** is an internal-only web platform for The Heart Center
medical practice. It provides employees with:

- Company announcements and news posts (with administrative moderation)
- Employee directory and search
- HR resources, policies, IT support requests
- Shared schedules, sign-up sheets, and event coordination
- Recognition programs (Employee Spotlight nominations)
- Centralized links to web applications used by the practice

## Current deployment (homelab)

The system today runs in a **homelab test environment** as a single Red Hat
Enterprise Linux 10 virtual machine on a Proxmox hypervisor. Remote access
is via Tailscale or the local LAN. The site is reached at
**`http://<vm-ip>:8080/`** over plain HTTP.

```
                                  +-------------------------------------------+
                                  |  RHEL 10 VM   (Proxmox guest, KVM)        |
                                  |  4 vCPU  ·  7 GiB RAM  ·  28 GiB disk     |
                                  |                                           |
   +--------------------+   HTTP  |   +------------------------------------+  |
   |  Workstation       |  ------>|   |  firewalld (public zone)           |  |
   |  on LAN            |  :8080  |   |  ingress: 22, 8080, 3389, 9090     |  |
   +--------------------+         |   +-----------------+------------------+  |
                                  |                     |                     |
   +--------------------+ Tailscale                     v                     |
   |  Admin Mac /       |  -----> |   +------------------------------------+  |
   |  remote device     |  :8080  |   |  Docker bridge network             |  |
   +--------------------+   :22   |   |                                    |  |
                                  |   |   +-------------+ +-------------+  |  |
                                  |   |   | intranet_   | | intranet_   |  |  |
                                  |   |   |  nginx      |->  backend    |  |  |
                                  |   |   | :80         | | Express 4   |  |  |
                                  |   |   | host :8080  | | Node 20     |  |  |
                                  |   |   +-------------+ | :3000       |  |  |
                                  |   |                   +------+------+  |  |
                                  |   +--------------------------+---------+  |
                                  |                              |            |
                                  |   +--------------------------v---------+  |
                                  |   |  Host bind mount                   |  |
                                  |   |  /srv/intranet/data/intranet.db    |  |
                                  |   |  (SQLite, file-based)              |  |
                                  |   +------------------------------------+  |
                                  +-------------------------------------------+
```

## Service layers (current)

```
   +--------------------------------------------------------------+
   |                  (5)  USER EXPERIENCE                        |
   |  React 19 SPA  *  Admin HTML portal  *  Manager HTML portal  |
   +--------------------------------------------------------------+
   |                  (4)  APPLICATION                            |
   |  Express 4 backend (Node.js 20)  *  express-session          |
   |  better-sqlite3  *  4 role tiers  *  audit logging           |
   +--------------------------------------------------------------+
   |                  (3)  DATA                                   |
   |  SQLite databases (intranet.db, sessions.db)                 |
   |  Bind-mounted from host /srv/intranet/data/                  |
   |  Uploaded files in /srv/intranet/uploads/                    |
   +--------------------------------------------------------------+
   |                  (2)  PLATFORM                               |
   |  nginx reverse proxy (HTTP)  *  Docker  *  bind-mount volumes|
   +--------------------------------------------------------------+
   |                  (1)  INFRASTRUCTURE                         |
   |  RHEL 10  *  Proxmox VE  *  firewalld  *  Tailscale  *  GDM  |
   +--------------------------------------------------------------+
```

## Audiences served (current)

| Audience | How they reach the system | Where they land |
|---|---|---|
| Employees on LAN | `http://<lan-ip>:8080/` | React SPA (employee view) |
| Managers | `http://<lan-ip>:8080/manager/` | Static manager portal |
| Admins / Super-admins | `http://<lan-ip>:8080/admin/` | Static admin portal |
| Remote operator (over Tailscale) | SSH or RDP to `<tailscale-ip>` | Linux shell or GNOME desktop |
| System maintenance | `https://<vm-ip>:9090/` | Cockpit web console |

## Data-flow at a glance

A typical "employee views the home page" request:

```
   Browser              nginx                 Express backend           SQLite
     |                   |                          |                      |
     |  GET /            |                          |                      |
     |------------------>| serves dist/index.html   |                      |
     |<------------------|                          |                      |
     |                   |                          |                      |
     |  GET /api/posts   |                          |                      |
     |------------------>|  proxy_pass strips /api  |                      |
     |                   |  ---- GET /posts ------->|                      |
     |                   |                          |  SELECT ... WHERE    |
     |                   |                          |  status='approved'   |
     |                   |                          |  (better-sqlite3,    |
     |                   |                          |   synchronous)       |
     |                   |                          |--------------------->|
     |                   |                          |<---------------------|
     |                   |  <---- 200 JSON ---------|                      |
     |<------------------|                          |                      |
```

---

## 🔄 Production migration

When this system moves from the homelab to the Huntsville Hospital production
environment, the following components change. The application code, frontend,
nginx configuration topology, and overall architecture stay the same; only the
specific implementations of each layer change.

| Layer | Homelab (today) | Production target |
|---|---|---|
| Hypervisor | Proxmox VE (KVM) | VMware vSphere / ESXi (Huntsville cluster) |
| Network access | Tailscale + LAN | Corporate network only |
| Web entrypoint | `http://<ip>:8080` | `https://Intranet-HCI.heart.local` |
| TLS | None (plain HTTP) | Internal-CA-issued cert in nginx, port 443 |
| Backend framework | Express 4 (`server.js`) | Fastify (modular `src/`) |
| Backend dependencies | `express`, `express-session`, `better-sqlite3` | `fastify ^5`, `@fastify/session`, `@prisma/client` |
| Database | SQLite (file in `data/`) | PostgreSQL 17 (native systemd service on host) |
| Schema management | Inline `db.exec()` in `server.js` | Prisma migrations under `prisma/migrations/` |
| Session store | SQLite via `connect-sqlite3` | PostgreSQL via `@fastify/session` |
| DBA query path | `docker exec` + `sqlite3` | `psql` / DBeaver / pgAdmin to host:5432 |
| Remote admin GUI | RDP + Cockpit | Cockpit only |

The migration plan tracks these changes in [`08-disaster-recovery.md`](08-disaster-recovery.md)
under the "Migration plan" section. Until the migration is complete, this
documentation describes both states.

Continue to [`02-infrastructure.md`](02-infrastructure.md) for the server-side
details.
