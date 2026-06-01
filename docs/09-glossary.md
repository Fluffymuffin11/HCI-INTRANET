# 09 — Glossary

A reference for the terms used throughout this documentation. Skim it once,
then refer back as needed. Some terms apply only to the **current homelab**
deployment, others only to the **production target** — these are flagged
where relevant.

## Networking

**LAN** (Local Area Network) — the practice's internal network. Today the
homelab LAN; in production, the Huntsville Hospital corporate VLAN.

**Tailscale** (homelab only) — a mesh VPN that gives every authorized device
a `100.x.y.z` address. Used for remote admin access in the homelab.
Removed in production.

**Tailnet** (homelab only) — a Tailscale network owned by one account.

**Reverse proxy** — a server that accepts requests on behalf of another.
Here, nginx accepts HTTP (homelab) or HTTPS (production) requests and
forwards them to the backend on port 3000.

**Docker bridge network** — a virtual switch that lets containers talk to
each other by name. The intranet uses `intranet_default`.

**Docker bridge gateway** (target) — the host-side endpoint of the Docker
bridge (typically `172.18.0.1`). In production the Fastify backend uses it
to reach PostgreSQL on the host.

**`host.docker.internal`** (target) — hostname Docker can provide inside
containers, resolving to the host. The backend's `DATABASE_URL` uses this.

**Loopback** — `127.0.0.1`, "this machine."

## Operating system

**RHEL** — Red Hat Enterprise Linux. The OS this VM runs.

**dnf** — RHEL's package manager.

**rpm** — the low-level package format used by dnf.

**systemd** — RHEL's init system and service manager.

**systemctl** — the command to control systemd units.

**Unit / service** — a thing systemd manages.

**journald / journalctl** — systemd's log collector and query tool.

**SELinux** — Red Hat's mandatory access control system.

**firewalld** — RHEL's firewall manager.

**SSH** — Secure Shell. Encrypted remote-login protocol on port 22.

**Cockpit** — Red Hat's web-based system administration console (port 9090).

## Application stack

**SPA** (Single Page Application) — a web application where one HTML page
loads and JavaScript handles all subsequent navigation. The employee-facing
React app is an SPA.

**Express** (homelab) — the current Node.js web framework. Single-file
backend in `app/server.js`.

**Fastify** (target) — A fast, low-overhead web framework for Node.js.
Replaces Express in production. Modular plugins replace middleware.

**REST API** — the HTTP-based interface exposed by the backend. Verbs:
GET, POST, PATCH, DELETE.

**Session** — a server-side record that identifies a logged-in user.
Identified by a cookie the browser sends with every request.

**Session secret** — a random string used to cryptographically sign session
cookies. Stored in `/srv/intranet/.env` as `SESSION_SECRET`.

**bcrypt** — a password hashing algorithm. Slow on purpose, to resist
brute-force attacks.

**Middleware / Plugin** — A piece of functionality that runs in the request
pipeline. Express calls them middleware; Fastify calls them plugins. We use
them for authentication checks, session handling, file uploads, rate-limiting.

**ORM** — an Object-Relational Mapper. The current homelab implementation
does NOT use one; SQL is written directly via `better-sqlite3`. The
production target uses **Prisma**, a type-safe ORM.

**Prisma** (target) — A modern Node.js ORM. Schema in `prisma/schema.prisma`,
migrations under `prisma/migrations/`, generated client at `@prisma/client`.

**Migration** (target) — A versioned SQL file that brings the database
schema from one state to the next. Applied automatically on backend
startup via `prisma migrate deploy`.

## Database

**SQLite** (homelab) — A file-based SQL database. The whole database is one
`.db` file. No separate server process. Today's implementation uses
`better-sqlite3` for synchronous in-process access.

**PostgreSQL** (target) — A mature, open-source relational database. Runs
as a multi-process server on the host (not in a container). Listens on
TCP port 5432.

**psql** (target) — PostgreSQL's command-line client.

**pg_dump / pg_restore** (target) — PostgreSQL's logical backup and restore
tools. `-Fc` produces a compressed custom-format dump.

**WAL** (Write-Ahead Log) — A journal of pending changes. Both SQLite and
PostgreSQL use it for crash recovery.

**Role / User** (PostgreSQL, target) — A database principal. The intranet
plans to use `intranet_app`, `intranet_ro`, and `dba_group`.

**pg_hba.conf** (target) — PostgreSQL's host-based authentication file.

## Containers and Docker

**Container** — a sandboxed process running on the host kernel.

**Image** — a snapshot of a filesystem used to start containers. We use
stock public images.

**Docker Compose** — a tool that defines and runs multi-container apps
from a single `docker-compose.yml` file.

**Bind mount** — exposing a host directory inside a container. The host
filesystem is canonical.

**Volume (named)** — a Docker-managed storage area. We do not use these;
only bind mounts.

**Restart policy** — Docker's instruction for what to do when a container
stops. We use `unless-stopped`.

**`extra_hosts`** (target) — A Compose directive that injects entries into
a container's `/etc/hosts`. Used in production to give the backend a way
to reach the host as `host.docker.internal`.

## Security and TLS

**TLS** (Transport Layer Security) — the protocol behind HTTPS.

**Certificate** — A cryptographic document binding a hostname to a public
key. In production, issued by the Huntsville Hospital internal CA.

**Private key** — the secret half of a TLS certificate.

**HSTS** (HTTP Strict Transport Security) — A response header that tells
browsers to use HTTPS only for a given host. Enabled in production.

**CSRF** (Cross-Site Request Forgery) — An attack class mitigated by the
SameSite=Lax cookie attribute used for session cookies.

## Virtualization

**Proxmox VE** (homelab) — The hypervisor today. KVM-based.

**vSphere** (target) — VMware's enterprise virtualization platform.
Huntsville Hospital's production hypervisor environment.

**ESXi** (target) — The hypervisor itself.

**vCenter** (target) — The management interface for ESXi hosts.

**Snapshot** — A point-in-time copy of a VM. Both Proxmox and vSphere offer
this; rolling back discards changes made after the snapshot.

**OVA / OVF** (target) — Portable VM image formats used for migrating
between vSphere clusters.

## Remote desktop (homelab only)

**SPICE** — A Linux remote-display protocol. We attempted this with Proxmox
and abandoned it for RDP.

**RDP** — Microsoft's Remote Desktop Protocol. Used in the homelab via
`gnome-remote-desktop` on port 3389.

**gnome-remote-desktop** — The GNOME project's RDP server. Used in headless
mode here, which spawns a fresh GNOME session per connection.

**Wayland** — The modern Linux display server protocol. GNOME on RHEL 10
runs on Wayland by default.

**Mutter** — GNOME's window manager / compositor.

## Storage

**LVM** (Logical Volume Manager) — A Linux abstraction over physical disks.

**xfs** — The default filesystem on RHEL 10.

**inode** — A filesystem object that holds metadata.

## Frontend

**React** — A JavaScript library for building user interfaces. The
employee-facing site is a React 19 application.

**React Router** — Routing for SPAs.

**Tailwind** — A utility-class CSS framework.

**Vite** — A modern frontend build tool.

**JSX** — JavaScript with embedded XML-like syntax.

## Miscellaneous

**dotfile** — A file or directory whose name starts with `.`.

**SIGTERM / SIGKILL** — Process signals. SIGTERM asks a process to clean
up and exit; SIGKILL terminates immediately.

## Common abbreviations used in this document

- `cwd` — current working directory
- `pid` — process ID
- `uid / gid` — user / group ID
- `env` — environment (variables)
- `pkg` — package
- `db` — database
- `fs` — filesystem
- `ro / rw` — read-only / read-write
- `FQDN` — fully qualified domain name
- `DBA` — database administrator
- `CA` — certificate authority
- `RDBMS` — relational database management system
