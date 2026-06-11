# Heart Center Intranet — Technical Documentation

> **Document set version 1.1** · Current homelab state + production migration plan
> 
> This document describes the system **as it exists today** in the homelab test
> environment, and documents the **planned migration** to the Huntsville Hospital
> production environment. Each chapter ends with a "🔄 Production migration"
> callout listing what changes when the system moves to its production home.

This `docs/` directory is the canonical reference. Two audiences:

1. **Engineers** — understand the architecture or make changes.
2. **Operators** — keep the homelab running while preparing for production.

Read in order:

| # | Document | Audience | Read time |
|---|---|---|---|
| 1 | [`01-overview.md`](01-overview.md) — Executive summary, current and target architecture | Everyone | 5 min |
| 2 | [`02-infrastructure.md`](02-infrastructure.md) — Server, network, OS, services | Engineer / Ops | 15 min |
| 3 | [`03-application.md`](03-application.md) — Codebase, data model, request flow | Engineer | 20 min |
| 4 | [`04-deployment.md`](04-deployment.md) — Docker Compose, configuration, secrets | Engineer / Ops | 10 min |
| 5 | [`05-remote-access.md`](05-remote-access.md) — Tailscale, SSH, RDP, Cockpit | Engineer / Ops | 10 min |
| 6 | [`06-maintenance.md`](06-maintenance.md) — Red Hat maintenance guide for newcomers | Ops | 30 min |
| 7 | [`07-troubleshooting.md`](07-troubleshooting.md) — Known problems and fixes | Ops | reference |
| 8 | [`08-disaster-recovery.md`](08-disaster-recovery.md) — Backups and restore procedures | Ops | 10 min |
| 9 | [`09-glossary.md`](09-glossary.md) — Terminology reference | Everyone | reference |

---

## Deployment status — at-a-glance

| Property | Current (homelab) | Production target (Huntsville Hospital) |
|---|---|---|
| **Hypervisor** | Proxmox VE (KVM) | VMware vSphere |
| **VM** | RHEL 10.1, 4 vCPU / 7 GiB / 28 GiB | RHEL 10.1, 4 vCPU / 8 GiB / 80 GiB |
| **Reachable at** | `http://<lan-ip>:8080/` and `http://<tailscale-ip>:8080/` | `https://Intranet-HCI.heart.local/` |
| **TLS** | Plain HTTP (LAN only) | HTTPS with hospital internal CA cert |
| **Web port** | `8080/tcp` | `443/tcp` |
| **Backend framework** | Express 4 | Fastify |
| **Database** | SQLite (`/srv/intranet/data/intranet.db`) | PostgreSQL 17 (native systemd service on host) |
| **ORM / DB driver** | `better-sqlite3` (raw SQL) | Prisma Client + Prisma migrations |
| **Session store** | `connect-sqlite3` (SQLite-backed) | `@fastify/session` (PostgreSQL-backed) |
| **Remote access** | Tailscale overlay + LAN | Corporate network only (no Tailscale) |
| **Admin GUI** | RDP via gnome-remote-desktop + Cockpit | Cockpit only |
| **DBA access pattern** | `docker exec` into backend, run `sqlite3` | psql / DBeaver / pgAdmin directly to host port 5432 |

---

## Conventions used in this documentation

- Commands prefixed with `$` are run as your **regular user**.
- Commands prefixed with `#` require **root** — prefix with `sudo`.
- File paths are **absolute**.
- Diagrams use ASCII art so they render anywhere.
- **🔄 Production migration** callouts at the end of each chapter list
  what changes when the system moves to Huntsville Hospital.

---

## When something is broken

The fastest paths to recovery are documented in [`07-troubleshooting.md`](07-troubleshooting.md).
The most common issues:

1. **Website is down** → `docker compose up -d`
2. **Can't reach the VM remotely** → check Tailscale (`sudo systemctl status tailscaled`)
3. **Disk full** → see "Disk is full" in troubleshooting
4. **Lost the admin password** → see "Password reset" in troubleshooting

Bookmark this page.
