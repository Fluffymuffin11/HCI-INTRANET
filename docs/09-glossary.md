# 09 — Glossary

A reference for the terms used throughout this documentation. Skim it once,
then refer back as needed.

## Networking

**LAN** (Local Area Network) — the practice's internal network, addresses
in `<LAN_SUBNET>`. Devices on the LAN can reach the intranet directly.

**Tailscale** — a mesh VPN that gives every authorized device a `100.x.y.z`
address. Used for remote admin access. See <https://tailscale.com>.

**Tailnet** — a Tailscale network owned by one account. Ours is owned by
`<tailnet-owner-email>`.

**Reverse proxy** — a server that accepts requests on behalf of another. Here,
nginx accepts requests on port 8080 and forwards them to the Node.js backend
on port 3000.

**Bridge network (Docker)** — a virtual switch that lets containers talk to
each other by name. The intranet uses `intranet_default`.

**Loopback** — `127.0.0.1`, the address that always means "this machine."

## Operating system

**RHEL** — Red Hat Enterprise Linux. The OS this VM runs.

**dnf** — RHEL's package manager. Equivalent to `apt` on Debian/Ubuntu.

**rpm** — the low-level package format used by dnf. You will rarely call `rpm`
directly.

**systemd** — RHEL's init system and service manager. Started at boot, runs
everything else.

**systemctl** — the command to control systemd units (start, stop, enable,
status).

**Unit / service** — a thing systemd manages (a daemon, a one-shot job, a
timer). Lives in `/usr/lib/systemd/` or `/etc/systemd/`.

**journald / journalctl** — systemd's log collector and the tool to query it.
Replaces `/var/log/messages` from old Linux.

**SELinux** — Red Hat's mandatory access control system. Adds an extra layer
of security on top of file permissions. Modes: `Enforcing`, `Permissive`,
`Disabled`.

**firewalld** — RHEL's firewall manager. Wraps `nftables` (modern iptables).

**dconf / gsettings** — GNOME's per-user configuration store. Replaces the
older GConf.

**SSH** — Secure Shell. The encrypted remote-login protocol on port 22.

## Application

**SPA** (Single Page Application) — a web application where one HTML page
loads and JavaScript handles all subsequent navigation. The employee-facing
React app is an SPA.

**REST API** — the HTTP-based interface exposed by the backend. Verbs:
`GET`, `POST`, `PATCH`, `DELETE`.

**Session** — a server-side record that identifies a logged-in user.
Identified by a cookie the browser sends with every request.

**Session secret** — a random string used to cryptographically sign session
cookies. Stored in `/srv/intranet/.env` as `SESSION_SECRET`.

**bcrypt** — a password hashing algorithm. Slow on purpose, to resist
brute-force attacks.

**Middleware** (Express) — a function that runs before a route handler. We use
middleware for authentication checks (`requireLogin`, `requireAdmin`, etc.).

**ORM** — an Object-Relational Mapper. This project does **not** use one;
SQL is written directly via `better-sqlite3`.

**SQLite** — a file-based SQL database. The whole database is one `.db` file.
No separate server process.

**WAL** (Write-Ahead Logging) — SQLite's journaling mode. Allows readers and
one writer to operate concurrently.

## Containers and Docker

**Container** — a sandboxed process running on the host kernel with its own
filesystem and network namespace. Not a VM.

**Image** — a snapshot of a filesystem used to start containers. Built from
a `Dockerfile`. We use stock public images, no custom Dockerfile.

**Docker Compose** — a tool that defines and runs multi-container apps from a
single `docker-compose.yml` file.

**Bind mount** — exposing a host directory inside a container. The host
filesystem is canonical; the container sees a window into it.

**Volume** (named) — a Docker-managed storage area. We don't use named
volumes — only bind mounts.

**Restart policy** — Docker's instruction for what to do when a container
stops. We use `unless-stopped` (auto-restart unless explicitly stopped).

## Authentication

**NLA** (Network Level Authentication) — an RDP feature where the client
authenticates *before* a session is created. Adds security but causes
compatibility issues with some servers.

**CredSSP** — the protocol RDP uses for NLA. Wraps NTLM or Kerberos.

**NTLM** — a Microsoft authentication protocol. Used inside CredSSP.

**Server redirection** (RDP) — a mechanism where an RDP server tells the
client to reconnect to a different port for the actual session. Used by
gnome-remote-desktop in headless mode.

**TLS** (Transport Layer Security) — the protocol behind HTTPS. Encrypts
traffic and verifies server identity.

**Self-signed certificate** — a TLS certificate not signed by a public CA.
Trusted only by clients told to accept it. We use one for RDP.

## Remote desktop

**SPICE** — a Linux remote-display protocol used by Proxmox and KVM. Faster
than VNC but client support is limited.

**VNC / noVNC** — older remote-display protocol. noVNC is a browser-based
VNC client built into Proxmox.

**RDP** — Microsoft's Remote Desktop Protocol. Widely supported clients,
good performance.

**gnome-remote-desktop** — the GNOME project's RDP server. Two modes:
- *Headless / system* — spawns a fresh GNOME session per connection
- *Screen sharing / user* — shares the active console session

**Wayland** — the modern Linux display server protocol. Successor to X11.
GNOME on RHEL 10 runs on Wayland by default.

**Mutter** — GNOME's window manager / compositor. Runs on top of Wayland.

## Storage

**LVM** (Logical Volume Manager) — a Linux abstraction over physical disks.
Our root filesystem is on the LVM logical volume `rhel-root`.

**ext4 / xfs** — filesystems. Red Hat 10 typically uses XFS by default.

**inode** — a filesystem object that holds metadata. Filesystems can run out
of inodes even with disk space free (rare).

## Misc

**Tailwind** — a CSS framework that uses utility classes. Used in the React
frontend.

**Vite** — a modern frontend build tool. Replaces Webpack. We use it to
build the React app.

**JSX / TSX** — JavaScript / TypeScript with embedded XML-like syntax. React
component files.

**dotfile** — a file or directory whose name starts with `.`. Hidden by
default in `ls`.

**heredoc** — a shell construct for embedding multi-line strings:
```bash
cat <<EOF > file.txt
line one
line two
EOF
```

**SIGTERM / SIGKILL** — process signals. SIGTERM asks a process to clean up
and exit; SIGKILL terminates immediately. `docker compose stop` sends SIGTERM.

## Common abbreviations in this doc

- `cwd` — current working directory
- `pid` — process ID
- `uid / gid` — user / group ID
- `env` — environment (variables)
- `pkg` — package
- `db` — database
- `fs` — filesystem
- `q` — quit / query (varies)
- `ro / rw` — read-only / read-write
