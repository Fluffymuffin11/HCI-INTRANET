# Heart Center Intranet — Technical Documentation

> **Production deployment of the Heart Center employee intranet platform**
> Document set version 1.0 · Generated 2026-05-20

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
| 3 | [`03-application.md`](03-application.md) — Intranet codebase, data model, request flow | Engineer | 20 min |
| 4 | [`04-deployment.md`](04-deployment.md) — Docker Compose, configuration, secrets | Engineer / Ops | 10 min |
| 5 | [`05-remote-access.md`](05-remote-access.md) — Tailscale, SSH, RDP, Cockpit | Engineer / Ops | 10 min |
| 6 | [`06-maintenance.md`](06-maintenance.md) — **Maintenance guide for Red Hat newcomers** | Ops | 30 min |
| 7 | [`07-troubleshooting.md`](07-troubleshooting.md) — Known problems and fixes | Ops | reference |
| 8 | [`08-disaster-recovery.md`](08-disaster-recovery.md) — Backups and restore procedure | Ops | 10 min |
| 9 | [`09-glossary.md`](09-glossary.md) — Terminology reference | Everyone | reference |

---

## At-a-glance facts

| Property | Value |
|---|---|
| **Project** | Heart Center Intranet |
| **Host OS** | Red Hat Enterprise Linux 10.1 (Coughlan) |
| **Virtualization** | KVM (Proxmox VE on `<proxmox-hostname>`) |
| **CPU / RAM / Disk** | 4 vCPU / 7 GiB / 28 GiB |
| **Application stack** | nginx · Node.js / Express · SQLite · React 19 |
| **Container runtime** | Docker 29.5.0 with Compose v5.1.3 |
| **Public web URL (LAN)** | `http://<LAN_IP>:8080/` |
| **Tailscale IP** | `<TAILSCALE_IP>` (`<vm-hostname>` on `<tailnet-owner>@` tailnet) |
| **Code repository on host** | `/srv/intranet/` |
| **Application data** | `/srv/intranet/data/intranet.db` (SQLite) |
| **Uploaded files** | `/srv/intranet/uploads/` |

---

## Conventions used in this documentation

- Commands prefixed with `$` are run as your **regular user** (`bryant`).
- Commands prefixed with `#` require **root** — prefix them with `sudo`.
- File paths are **absolute**.
- Diagrams use ASCII art so they render in any terminal or editor.
- "⚠️" calls out actions that can cause downtime if done wrong.
- "💡" marks shortcuts and tips.

---

## When something is broken

The fastest paths to recovery are documented in [`07-troubleshooting.md`](07-troubleshooting.md).
The most common issues, in order of frequency:

1. **Website is down** → `cd /srv/intranet && docker compose up -d`
2. **Can't connect via RDP** → `sudo systemctl restart gnome-remote-desktop`
3. **Disk full** → see "Disk fills up" in troubleshooting
4. **Lost the admin password** → see "Password reset" in troubleshooting

Bookmark this page.
