# 09 — Glossary

A reference for the terms used throughout this documentation. Skim it once,
then refer back as needed.

## Networking

**LAN** (Local Area Network) — the practice's internal network, on the
Huntsville Hospital corporate VLAN. Devices on the LAN can reach the
intranet directly.

**Reverse proxy** — a server that accepts requests on behalf of another.
Here, nginx accepts HTTPS requests on port 443 and forwards them to the
Fastify backend on port 3000.

**Docker bridge network** — a virtual switch that lets containers talk to
each other by name. The intranet uses `intranet_default`.

**Docker bridge gateway** — the host-side endpoint of the Docker bridge
(typically `172.18.0.1`). Containers reach the host's networking through
this address. The Fastify backend uses it to reach PostgreSQL on the host.

**`host.docker.internal`** — a hostname Docker can be configured to provide
inside containers, resolving to the host machine. The backend's
`DATABASE_URL` uses this to find PostgreSQL.

**Loopback** — `127.0.0.1`, the address that always means "this machine."

## Operating system

**RHEL** — Red Hat Enterprise Linux. The OS this VM runs.

**dnf** — RHEL's package manager. Equivalent to `apt` on Debian/Ubuntu.

**rpm** — the low-level package format used by dnf. You will rarely call
`rpm` directly.

**systemd** — RHEL's init system and service manager. Started at boot,
runs everything else (PostgreSQL, Docker, sshd, etc.).

**systemctl** — the command to control systemd units (start, stop,
enable, status).

**Unit / service** — a thing systemd manages. Lives in `/usr/lib/systemd/`
or `/etc/systemd/`.

**journald / journalctl** — systemd's log collector and the tool to
query it.

**SELinux** — Red Hat's mandatory access control system. Adds an extra
layer of security on top of file permissions. Modes: `Enforcing`,
`Permissive`, `Disabled`.

**firewalld** — RHEL's firewall manager. Wraps `nftables`.

**SSH** — Secure Shell. The encrypted remote-login protocol on port 22.

**Cockpit** — Red Hat's web-based system administration console,
typically on port 9090.

## Application stack

**SPA** (Single Page Application) — a web application where one HTML page
loads and JavaScript handles all subsequent navigation. The employee-facing
React app is an SPA.

**Fastify** — A fast, low-overhead web framework for Node.js. Used here in
place of Express for better performance and built-in schema validation.

**REST API** — the HTTP-based interface exposed by the backend. Verbs:
GET, POST, PATCH, DELETE.

**Session** — a server-side record that identifies a logged-in user.
Identified by a cookie the browser sends with every request. Stored in
the PostgreSQL Session table.

**Session secret** — a random string used to cryptographically sign session
cookies. Stored in `/srv/intranet/.env` as `SESSION_SECRET`.

**bcrypt** — a password hashing algorithm. Slow on purpose, to resist
brute-force attacks.

**Plugin** (Fastify) — a piece of functionality registered onto the Fastify
instance (auth, session handling, file uploads, rate-limiting). Replaces
"middleware" terminology used by Express.

**ORM** — an Object-Relational Mapper. **This project uses Prisma** as its
ORM; the application reads and writes the database through Prisma's
generated type-safe client rather than handwritten SQL.

**Prisma** — A modern Node.js ORM. The schema is defined in
`prisma/schema.prisma`, migrations live in `prisma/migrations/`, and the
generated client (`@prisma/client`) is what the Fastify routes call.

**Migration** (Prisma) — A versioned SQL file that brings the database
schema from one state to the next. Applied automatically on backend
startup via `prisma migrate deploy`.

## Database

**PostgreSQL** — A mature, open-source relational database. Runs as a
multi-process server on the RHEL host (not in a container in this
deployment). Listens on TCP port 5432.

**psql** — PostgreSQL's command-line client. DBAs and operators use it
to run queries.

**pg_dump / pg_restore** — PostgreSQL's logical backup and restore tools.
Used for nightly database backups (`-Fc` produces a compressed
custom-format dump that `pg_restore` can apply selectively).

**WAL** (Write-Ahead Log) — PostgreSQL's transaction log. Every change is
written to the WAL before being applied to data files, allowing crash
recovery and replication.

**Role / User** (PostgreSQL) — A database principal. The intranet uses:
- `intranet_app` — application backend (read/write)
- `intranet_ro` — read-only for reporting
- `dba_group` — DBA role with full privileges, granted to individual DBA accounts

**pg_hba.conf** — PostgreSQL's host-based authentication file. Decides
which network ranges and which users can connect, and with what
authentication method (`scram-sha-256` in production).

## Containers and Docker

**Container** — a sandboxed process running on the host kernel with its
own filesystem and network namespace. Not a VM.

**Image** — a snapshot of a filesystem used to start containers. Built
from a `Dockerfile`. We use stock public images, no custom Dockerfile.

**Docker Compose** — a tool that defines and runs multi-container apps
from a single `docker-compose.yml` file.

**Bind mount** — exposing a host directory inside a container. The host
filesystem is canonical; the container sees a window into it.

**Volume** (named) — a Docker-managed storage area. We do not use named
volumes; only bind mounts.

**Restart policy** — Docker's instruction for what to do when a container
stops. We use `unless-stopped` (auto-restart unless explicitly stopped).

**`extra_hosts`** — A Compose directive that injects entries into a
container's `/etc/hosts`. We use it to give the backend container a
reachable name for the host (`host.docker.internal`).

## Security and TLS

**TLS** (Transport Layer Security) — the protocol behind HTTPS. Encrypts
traffic and verifies server identity.

**Certificate** — A cryptographic document binding a hostname to a public
key. Ours is issued by the Huntsville Hospital internal Certificate
Authority and trusted by domain-joined workstations.

**Private key** — the secret half of a TLS certificate. Lives at
`/etc/nginx/tls/intranet-hci.key`, mode 0600, owned by root.

**HSTS** (HTTP Strict Transport Security) — A response header that tells
browsers to use HTTPS only for a given host.

**CSRF** (Cross-Site Request Forgery) — An attack class where a malicious
site tricks an authenticated user's browser into making requests to the
application. Mitigated by the SameSite=Lax cookie attribute used for
session cookies.

## Virtualization

**vSphere** — VMware's enterprise virtualization platform. Huntsville
Hospital's production hypervisor environment.

**ESXi** — The hypervisor itself, the bare-metal OS that runs VMs.

**vCenter** — The management interface for one or more ESXi hosts. Where
operators go to manage the VM (snapshots, console, power).

**Snapshot** (vSphere) — A point-in-time copy of a VM's disk and memory
state. Reverting to a snapshot rolls the VM back to that point.

**OVA / OVF** — Portable VM image formats. Used to migrate VMs between
vSphere clusters or to other hypervisors.

## Storage

**LVM** (Logical Volume Manager) — A Linux abstraction over physical
disks. Our root filesystem is on the LVM logical volume `rhel-root`.

**xfs** — The default filesystem on RHEL 10.

**inode** — A filesystem object that holds metadata. Filesystems can run
out of inodes even with disk space free (rare).

## Frontend

**React** — A JavaScript library for building user interfaces. The
employee-facing site is a React 19 application.

**React Router** — Routing for single-page apps. Maps URL paths to React
components without a full page reload.

**Tailwind** — A utility-class CSS framework. Used in the React frontend.

**Vite** — A modern frontend build tool. We use it to build the React
app for production.

**JSX** — JavaScript with embedded XML-like syntax. React component files
use this.

## Miscellaneous

**dotfile** — A file or directory whose name starts with `.`. Hidden by
default in `ls`.

**SIGTERM / SIGKILL** — Process signals. SIGTERM asks a process to clean
up and exit; SIGKILL terminates immediately. `docker compose stop` sends
SIGTERM, then SIGKILL after 10 seconds if the container has not exited.

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
