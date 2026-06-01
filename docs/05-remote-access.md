# 05 — Remote Access

This document covers **all the ways into the server today** in the homelab
environment — SSH, the desktop via RDP, the Cockpit web console, and the
Tailscale overlay that secures remote access. Production access (Huntsville
Hospital) drops Tailscale and RDP; see the migration callout at the end.

## Access matrix (current homelab)

```
                +----------------------------------------------------------+
                |                  RHEL 10 VM                              |
                |                                                          |
                |   Port   Method            Purpose                       |
                |   ----   ----------------  ----------------------------- |
   any device   |   22     SSH (OpenSSH)     Shell, file transfer, scripts |
   ----->------>|  8080    HTTP (nginx)      The intranet itself           |
                |  3389    RDP (g-r-d)       Full GNOME desktop, headless  |
                |  9090    HTTPS (Cockpit)   Web-based admin console       |
                |                                                          |
                |   *g-r-d = gnome-remote-desktop                          |
                +----------------------------------------------------------+

   All four ports are reachable on BOTH the LAN address AND the Tailscale
   address. SQLite-style DB inspection is via `docker compose exec backend`.
```

## Tailscale (the secure overlay, homelab only)

Tailscale is a peer-to-peer encrypted mesh VPN that gives each authorized
device a `100.x.y.z` address. Used here so the homelab VM can be reached
from the admin's Mac without exposing any ports publicly.

```
   Internet
       |
       v
   +---------------------------------------------------------+
   |  Tailscale coordination server  (login.tailscale.com)   |
   |  authenticates devices, never sees traffic              |
   +---------------------------------------------------------+
                          |  authentication only
                          v
   +---------------------------------------------------------+
   |  Tailnet                                                |
   |                                                         |
   |  +--------------+    encrypted     +-------------+      |
   |  | Admin Mac    | <--------------> | RHEL VM     |      |
   |  +--------------+                  +-------------+      |
   |                                                         |
   |  +----------------+                                     |
   |  | Proxmox host   |                                     |
   |  +----------------+                                     |
   +---------------------------------------------------------+
```

### Why we use it (homelab)

- No port-forwarding required on the homelab router
- End-to-end encrypted (WireGuard)
- Identity-based access — devices are authorized in the Tailscale admin console
- DNS works — devices can be reached by hostname (MagicDNS)

### On the server: check Tailscale status

```bash
$ tailscale status              # list peers + self IP
$ tailscale ip                  # just our IPs
$ sudo systemctl status tailscaled
```

If Tailscale fails to come up:
```bash
$ sudo systemctl restart tailscaled
$ sudo tailscale up                # may prompt for login URL
```

## SSH access

```bash
$ ssh <user>@<tailscale-ip>        # via Tailscale (anywhere)
$ ssh <user>@<lan-ip>              # via LAN (in the homelab)
```

Password: the local Linux password.

### Recommended: switch to key-based SSH

```bash
$ ssh-keygen -t ed25519                                       # on your Mac
$ ssh-copy-id <user>@<tailscale-ip>                           # installs your pubkey
$ ssh <user>@<tailscale-ip>                                   # no password needed
```

## RDP — full GNOME desktop

The server runs **gnome-remote-desktop in headless (system) mode**. Every
RDP connection spawns a fresh GNOME session.

### Connection details

| Setting | Value |
|---|---|
| Host | `<tailscale-ip>` or `<lan-ip>` |
| Port | `3389` |
| Username | local Linux user |
| Password | local Linux password |
| Security | Ignore self-signed certificate warnings |

### Recommended client: Royal TSX (free, native macOS)

Compatibility findings during homelab setup:

| Client | Works? | Notes |
|---|---|---|
| **Royal TSX** (royalapps.com) | ✅ | Native, free, handles RDP server redirection |
| Microsoft "Windows App" (App Store) | ⚠️ | Cannot handle redirection used in headless mode |
| Jump Desktop | ❌ | NLA / NTLM incompatibility with gnome-remote-desktop |
| xfreerdp via Homebrew | ⚠️ | Renders through XQuartz — looks rough |
| virt-viewer + SPICE | ❌ | Bypassed in favor of RDP |

To toggle full-screen in Royal TSX: **⌥⌘F** (Connection Full Screen).

### What "headless mode" means

```
   Royal TSX connects to :3389
       |
       v
   gnome-remote-desktop daemon authenticates (TLS + credentials)
       |
       v
   Daemon spawns a fresh GDM session for the configured user
       |
       v
   Mutter creates a virtual monitor at the resolution Royal TSX requested
       |
       v
   You see the desktop. Settings persist (same ~/.config), display layout doesn't.
```

When you disconnect, the GNOME session is torn down. Next connect = new session.

## Cockpit (web console)

The friendliest way to manage the server:

```
   https://<tailscale-ip>:9090/      <- via Tailscale
   https://<lan-ip>:9090/            <- via LAN
```

Self-signed certificate — accept the warning. Log in with the local Linux
user.

From Cockpit:

```
   +---------------------------------------------------------------+
   |  Cockpit (web)                                                |
   |                                                               |
   |  Overview          live CPU / memory / disk / network graphs  |
   |  Logs              browse journald with search and filters    |
   |  Storage           disk partitions, free space                |
   |  Networking        interfaces, firewall, VPN                  |
   |  Podman / Docker   running containers, restart, view logs     |
   |  Software updates  list and install dnf updates with a UI     |
   |  Services          systemd unit list, start/stop/enable       |
   |  Accounts          list/create users, change passwords        |
   |  Terminal          full shell access in the browser           |
   +---------------------------------------------------------------+
```

For an operator who is not a Linux expert, **Cockpit is the single best
tool to learn.** Most maintenance tasks in [`06-maintenance.md`](06-maintenance.md)
can be performed through Cockpit.

## Local console (Proxmox)

If all remote paths fail, get into the VM via the Proxmox web UI:

1. Browse to the Proxmox host
2. Log in to Proxmox
3. Select VM **101** in the left tree
4. Click **Console** in the top right (use noVNC; SPICE is broken)

## Quick reference: which tool when

| You want to... | Use |
|---|---|
| Run a one-line command | SSH |
| Edit a file in vim/nano | SSH |
| Restart a container | SSH or Cockpit |
| Watch system metrics | Cockpit |
| Read logs with a search box | Cockpit |
| Use a graphical app (Firefox, Files) | RDP |
| Tweak GNOME settings | RDP |
| Update Red Hat packages | Cockpit or `sudo dnf upgrade` |
| Recover from boot problems | Proxmox noVNC console |
| Inspect the database | `docker compose exec backend` + `sqlite3` |

---

## 🔄 Production migration

Remote access changes substantially when moving to Huntsville Hospital:

| Item | Homelab (today) | Production target |
|---|---|---|
| Network reach | Tailscale + LAN | Hospital corporate network only |
| Tailscale | Active, all four ports reachable through it | Not installed |
| RDP via gnome-remote-desktop | On port 3389 | Removed entirely; Cockpit-only |
| Web port | HTTP :8080 | HTTPS :443 |
| Cockpit | Self-signed cert, open from any LAN device | Hospital-issued cert, source-restricted to IT-Ops jump host |
| SSH | Password OR key | Key-only, source-restricted to IT-Ops jump host |
| Local console | Proxmox noVNC | vSphere Client (vCenter) → Open Console |
| New: DBA access | (n/a — SQLite inside container) | `psql` / DBeaver / pgAdmin direct to `Intranet-HCI.heart.local:5432` |

### What DBAs gain in production

Once PostgreSQL is in place, DBAs connect directly from their workstations
without any container access. This is a major upgrade over today's
`docker compose exec backend sqlite3` workflow, which requires shell access
to the application VM.

### DBA connection details (target)

| Field | Value |
|---|---|
| Host | `Intranet-HCI.heart.local` |
| Port | `5432` |
| Database | `intranet_hci` |
| Authentication | as configured (LDAP / password / certificate, per hospital policy) |
| SSL mode | `require` |

### What DBAs can do (target)

- Run ad-hoc `SELECT` queries against any table
- Build reports against the read-only `intranet_ro` user
- Take logical backups with `pg_dump`
- Inspect query plans with `EXPLAIN ANALYZE`
- Tune indexes and statistics

### What DBAs should NOT do (target, without coordination)

- Run `ALTER TABLE` or other schema changes — the application uses **Prisma
  migrations**; manual changes will drift from the codebase
- Drop or truncate tables on the live DB
- Change column types or constraints without a corresponding code change
- Run long blocking transactions during business hours

Schema changes flow through the codebase:
```
   Developer edits prisma/schema.prisma
       |
       v
   npx prisma migrate dev --name <change>
       |
       v
   Commit migration file + schema.prisma
       |
       v
   Code review + change-management approval
       |
       v
   Production deploy applies via `prisma migrate deploy`
```

## Where to go next

- [`06-maintenance.md`](06-maintenance.md) — routine maintenance procedures
- [`07-troubleshooting.md`](07-troubleshooting.md) — when something is broken
