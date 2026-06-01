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

In production it is deployed as a single Red Hat Enterprise Linux 10 virtual
machine running on **Huntsville Hospital's VMware vSphere** infrastructure,
reached over the hospital's internal corporate network at the HTTPS endpoint
**`https://Intranet-HCI.heart.local`**.

## High-level architecture

The entire platform runs on a single VM. The Fastify application runs inside
Docker; PostgreSQL runs natively on the host so DBAs can reach it directly
without any container access.

```
                                  +-------------------------------------------+
                                  |  RHEL 10 VM   (vSphere guest, ESXi)       |
                                  |  hostname: Intranet-HCI                   |
                                  |                                           |
   +--------------------+   HTTPS |   +------------------------------------+  |
   |  Hospital staff    |  ------>|   |  firewalld (public zone)           |  |
   |  workstations on   |   :443  |   |  ingress: 22, 443, 5432*, 9090     |  |
   |  internal corp net |         |   |  *5432 restricted to DBA group     |  |
   +--------------------+         |   +-----------------+------------------+  |
                                  |                     |                     |
   +--------------------+   SSH   |                     v                     |
   |  IT Operations     |  ------>|   +------------------------------------+  |
   |  jump host         |         |   |  nginx (TLS termination)           |  |
   |                    |  Cockpit|   |  serves SPA, proxies /api -> :3000 |  |
   +--------------------+   :9090 |   +-----------------+------------------+  |
                                  |                     |                     |
   +--------------------+         |   +-----------------v------------------+  |
   |  Database          |  TCP    |   |  Docker bridge network             |  |
   |  Administrators    |  5432   |   |   intranet_default (172.18.0.0/16) |  |
   |  (DBeaver, pgAdmin)|  ------>|   |                                    |  |
   +--------------------+         |   |   +-------------+ +-------------+  |  |
                                  |   |   | intranet_   | | intranet_   |  |  |
                                  |   |   |  nginx      |->  backend    |  |  |
                                  |   |   | nginx:alpine| | Fastify     |  |  |
                                  |   |   +-------------+ | Prisma      |  |  |
                                  |   |                   +------+------+  |  |
                                  |   +--------------------------+---------+  |
                                  |                              | UNIX/TCP   |
                                  |                              v            |
                                  |   +------------------------------------+  |
                                  |   |  PostgreSQL 16  (systemd service,  |  |
                                  |   |    NOT a container)                |  |
                                  |   |  /var/lib/pgsql/data               |  |
                                  |   |  listens on 0.0.0.0:5432           |  |
                                  |   |  - intranet_app  (app user)        |  |
                                  |   |  - intranet_ro   (read-only)       |  |
                                  |   |  - <dba accounts>                  |  |
                                  |   +------------------------------------+  |
                                  +-------------------------------------------+
```

## Service layers

The production system is organized in **five concentric layers**:

```
   +--------------------------------------------------------------+
   |                  (5)  USER EXPERIENCE                        |
   |  React 19 SPA  *  Admin HTML portal  *  Manager HTML portal  |
   +--------------------------------------------------------------+
   |                  (4)  APPLICATION                            |
   |  Fastify backend (Node.js 20)  *  @fastify/session  *  Prisma|
   |  REST API  *  4 role tiers  *  audit logging                 |
   +--------------------------------------------------------------+
   |                  (3)  DATA                                   |
   |  PostgreSQL 16 (native systemd service, queryable externally)|
   |  Session store inside same Postgres database                 |
   |  Uploaded files on bind-mounted host filesystem (/uploads)   |
   +--------------------------------------------------------------+
   |                  (2)  PLATFORM                               |
   |  nginx reverse proxy (TLS)  *  Docker  *  bind-mount volumes |
   +--------------------------------------------------------------+
   |                  (1)  INFRASTRUCTURE                         |
   |  RHEL 10  *  VMware vSphere  *  firewalld  *  Cockpit        |
   +--------------------------------------------------------------+
```

## Why the database runs on the host instead of in a container

**Direct external access for DBAs.** PostgreSQL listening on the host's
network interface means database administrators connect from their normal
workstation tools (psql, DBeaver, pgAdmin) without any `docker exec` or
container-specific knowledge.

**Independent lifecycle.** The database starts at boot via systemd before
Docker comes up. Container rebuilds, image updates, or `docker compose down`
operations do not touch the database.

**Standard hospital backup integration.** Backup agents and monitoring
that the hospital already operates against PostgreSQL clusters work
unchanged against this instance.

**Simpler disaster recovery.** Restoring PostgreSQL from a `pg_dump` or
file-system snapshot does not require any container orchestration.

## Audiences served

| Audience | How they reach the system | Where they land |
|---|---|---|
| Hospital staff (any device, internal network) | Browser to `https://Intranet-HCI.heart.local/` | React SPA (employee view) |
| Managers | Browser to `https://Intranet-HCI.heart.local/manager/` | Static manager portal |
| Admins / Super-admins | Browser to `https://Intranet-HCI.heart.local/admin/` | Static admin portal |
| Technical operators | SSH from the IT-Ops jump host | Linux shell |
| System maintenance | HTTPS to `https://Intranet-HCI.heart.local:9090/` | Cockpit web console |
| Database administrators | psql / DBeaver / pgAdmin to `Intranet-HCI.heart.local:5432` | Direct SQL access |

## Data-flow at a glance

A typical "employee views the home page" request:

```
   Browser              nginx                 Fastify backend           PostgreSQL
     |                   |                          |                       |
     |  GET /            |                          |                       |
     |------------------>| serves dist/index.html   |                       |
     |<------------------|                          |                       |
     |                   |                          |                       |
     |  GET /api/posts   |                          |                       |
     |------------------>|  proxy_pass strips /api  |                       |
     |                   |  ---- GET /posts ------->|                       |
     |                   |                          |  Prisma -> SQL via    |
     |                   |                          |  docker bridge gw     |
     |                   |                          |  172.18.0.1:5432      |
     |                   |                          |---------------------->|
     |                   |                          |<----------------------|
     |                   |  <---- 200 JSON ---------|                       |
     |<------------------|                          |                       |
```

## Where this lives in production

```
   Huntsville Hospital vSphere Cluster
                 |
                 +- ESXi host(s)
                       |
                       +- VM: Intranet-HCI  (single production VM)
                             +- vCPU:  4
                             +- vRAM:  8 GiB
                             +- vDisk: 80 GiB (OS + uploads + database)
                             +- vNIC:  corporate VLAN
                             +- DNS:   Intranet-HCI.heart.local
                             +- Services:
                                 - Docker  (nginx + Fastify containers)
                                 - PostgreSQL 16 (systemd, on host)
                                 - sshd, cockpit, chronyd, firewalld
```

Continue to [`02-infrastructure.md`](02-infrastructure.md) for the server-side
details, or jump to [`06-maintenance.md`](06-maintenance.md) for operations.
