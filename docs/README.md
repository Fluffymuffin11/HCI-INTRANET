# Heart Center Intranet — Technical Documentation

> **Production deployment of the Heart Center employee intranet platform**
> Document set version 1.0

This `docs/` directory is the canonical reference for the system. It is intended for
two audiences:

1. **Engineers** who need to understand the architecture or make changes.
2. **Operators** (administrative or office IT staff) who need to keep the system
   running day-to-day without deep Linux expertise.

If you are new to this system, read in order:

| # | Document | Audience | Read time |
|---|---|---|---|
| 1 | [`01-overview.md`](01-overview.md) — Executive summary and architecture diagram | Everyone | 5 min |
| 2 | [`02-infrastructure.md`](02-infrastructure.md) — Server, network, OS, services | Engineer / Ops | 15 min |
| 3 | [`03-application.md`](03-application.md) — Application codebase, data model, request flow | Engineer | 20 min |
| 4 | [`04-deployment.md`](04-deployment.md) — Docker Compose, configuration, secrets, database | Engineer / Ops | 15 min |
| 5 | [`05-remote-access.md`](05-remote-access.md) — SSH, Cockpit, direct DB access | Engineer / Ops | 10 min |
| 6 | [`06-maintenance.md`](06-maintenance.md) — **Maintenance guide for Red Hat newcomers** | Ops | 30 min |
| 7 | [`07-troubleshooting.md`](07-troubleshooting.md) — Known problems and fixes | Ops | reference |
| 8 | [`08-disaster-recovery.md`](08-disaster-recovery.md) — Backups and restore procedure | Ops | 10 min |
| 9 | [`09-glossary.md`](09-glossary.md) — Terminology reference | Everyone | reference |

---

## At-a-glance facts

| Property | Value |
|---|---|
| **Project** | Heart Center Intranet |
| **Production URL** | `https://Intranet-HCI.heart.local` |
| **Host OS** | Red Hat Enterprise Linux 10.1 |
| **Virtualization** | VMware vSphere (Huntsville Hospital cluster) |
| **Production VM** | `Intranet-HCI` · 4 vCPU · 8 GiB · 80 GiB disk (single VM) |
| **Database** | PostgreSQL 16 (native systemd service on the same VM) |
| **Application stack** | nginx · Node.js / Fastify · PostgreSQL · Prisma · React 19 |
| **Container runtime** | Docker with Compose |
| **Code repository on host** | `/srv/intranet/` |
| **Uploaded files** | `/srv/intranet/uploads/` |

---

## Conventions used in this documentation

- Commands prefixed with `$` are run as your **regular user**.
- Commands prefixed with `#` require **root** — prefix them with `sudo`.
- File paths are **absolute**.
- Diagrams use ASCII art so they render in any terminal or editor.

---

## When something is broken

The fastest paths to recovery are documented in [`07-troubleshooting.md`](07-troubleshooting.md).
The most common issues, in order of frequency:

1. **Website is down** → `docker compose up -d`
2. **Backend can't reach database** → check `sudo systemctl status postgresql`
3. **Disk full** → see "Disk fills up" in troubleshooting
4. **TLS certificate near expiry** → coordinate with hospital PKI team

Bookmark this page.
