# 02 — Infrastructure

This document describes the **server, operating system, network, and supporting
services** that the intranet runs on. If you are responsible for keeping the
server itself healthy, this is the foundational read.

## Host inventory

| Property | Value |
|---|---|
| Operating system | Red Hat Enterprise Linux 10.1 (Coughlan) |
| Kernel | `6.12.0-124.8.1.el10_1.x86_64` |
| Virtualization | KVM guest under Proxmox VE (Proxmox host: `<proxmox-hostname>`) |
| VMID on Proxmox | 101 |
| Hostname | `localhost` (transient — not formally set) |
| Time zone | Set inside containers to `America/Chicago` |
| vCPU | 4 |
| vRAM | 7 GiB total · approx 3.7 GiB used · 3.2 GiB available |
| vDisk | 28 GiB single LVM volume `/dev/mapper/rhel-root` · 40 % used |
| Subscription | Red Hat Enterprise Linux subscription is **registered** |

💡 To check current numbers at any time:
```bash
$ hostnamectl              # OS and machine identity
$ free -h                  # memory
$ df -h /                  # disk
$ uptime                   # how long up, load average
```

## Disk layout

```
   /dev/mapper/rhel-root  ◄── single LVM logical volume
       │
       └─ mounted at /
              │
              ├─ /home/bryant/             ← admin user's home directory
              │     └─ .claude/            ← Claude Code state (sessions, settings)
              │
              ├─ /srv/intranet/            ← APPLICATION (this project)
              │     ├─ app/                ← Node backend source + node_modules
              │     ├─ frontend/           ← React source + built dist/
              │     ├─ nginx/              ← reverse-proxy config
              │     ├─ public/             ← admin/ and manager/ static portals
              │     ├─ data/               ← SQLite databases (live)
              │     ├─ uploads/            ← uploaded files (live)
              │     ├─ docs/               ← this documentation
              │     └─ intranet-backup.tar.gz ← 48 MB snapshot
              │
              ├─ /var/lib/docker/          ← Docker images and overlay storage
              ├─ /var/log/                 ← System logs (journald + legacy)
              └─ /etc/                     ← System configuration
```

⚠️ **Everything important fits on one volume.** There is no separate `/var`
partition. If the root filesystem fills up, the system stops working. See
[`06-maintenance.md`](06-maintenance.md) → *Disk space checks* for monitoring.

## Network topology

The VM has **three logical network presences**:

```
   ┌─────────────────────────────────────────────────────────┐
   │                  RHEL 10 VM                             │
   │                                                         │
   │  lo            127.0.0.1/8        ◄── localhost only    │
   │                                                         │
   │  ens18         <LAN_IP>/24   ◄── practice LAN      │
   │                IPv6:  <LAN_IPV6>          │
   │                                                         │
   │  tailscale0    <TAILSCALE_IP>/32  ◄── Tailscale overlay │
   │                Hostname on tailnet: <vm-hostname>         │
   │                Tailnet owner: <tailnet-owner-email>      │
   │                                                         │
   │  br-a5cc...    172.18.0.1/16      ◄── Docker bridge     │
   │                (container-to-container only)            │
   └─────────────────────────────────────────────────────────┘
```

| Interface | Purpose | Reachable from |
|---|---|---|
| `lo` | Loopback | the VM itself |
| `ens18` | Primary NIC, bridged onto the practice LAN | Anything on `<LAN_SUBNET>` |
| `tailscale0` | Encrypted overlay for remote admin access | Authorized devices on the `<tailnet-owner>@` tailnet |
| `br-…` (docker0-style) | Inter-container traffic | Containers only |

### Tailscale peer list (current)

| Tailscale IP | Name | OS | State |
|---|---|---|---|
| `<TAILSCALE_IP>` | `<vm-hostname>` (this VM) | linux | online |
| `<PROXMOX_TAILSCALE_IP>` | `<proxmox-hostname>` (Proxmox hypervisor) | linux | online |
| `<TAILSCALE_PEER_1>` | `<peer-1>` | windows | offline |
| `<TAILSCALE_PEER_2>` | `<peer-2>` | windows | offline |
| `<TAILSCALE_PEER_3>` | `<peer-3>` | windows | offline |

Tailscale is administered by the account `<tailnet-owner-email>`. To onboard a new
admin device, that account adds the device to the tailnet via the Tailscale admin
console at <https://login.tailscale.com>.

## Firewall

`firewalld` is active using the default `public` zone, bound to `ens18`. Open
ingress ports:

| Port | Protocol | Service | Allowed from |
|---|---|---|---|
| `22/tcp` | TCP | OpenSSH | LAN + Tailscale |
| `8080/tcp` | TCP | Intranet web (nginx) | LAN + Tailscale |
| `3389/tcp` | TCP | RDP (gnome-remote-desktop) | LAN + Tailscale |
| `9090/tcp` | TCP | Cockpit web console | LAN + Tailscale |
| `546/udp` | UDP | DHCPv6 client | LAN |
| `icmp` | — | ping / discovery | LAN |

To inspect or modify:
```bash
$ sudo firewall-cmd --list-all                        # show current
$ sudo firewall-cmd --permanent --add-port=N/tcp      # open a port persistently
$ sudo firewall-cmd --reload                          # apply changes
```

## Services running on the host

```
   systemd ─┬─ docker.service              ◄── runs the intranet containers
            ├─ firewalld.service           ◄── packet filtering
            ├─ gdm.service                 ◄── GNOME display manager
            ├─ gnome-remote-desktop.service ◄── RDP server (headless mode)
            ├─ sshd.service                ◄── SSH access
            ├─ tailscaled.service          ◄── Tailscale agent
            ├─ rhsm.service / rhsmcertd    ◄── Red Hat subscription
            └─ cockpit.socket              ◄── on-demand Cockpit (port 9090)
```

To list all running services:
```bash
$ systemctl list-units --type=service --state=running
```

## Listening sockets (current state)

```
   PORT    BIND ADDRESS                  SERVICE
   22      0.0.0.0  +  [::]              sshd
   631     127.0.0.1  +  [::1]           CUPS (printing — local only)
   3389    *                              gnome-remote-desktop (RDP)
   8080    0.0.0.0  +  [::]              nginx (intranet web)
   9090    *                              cockpit
   44237   <TAILSCALE_IP> (dynamic)      tailscaled
   53784   [Tailscale IPv6] (dynamic)    tailscaled
```

To check anytime:
```bash
$ sudo ss -tlnp
```

## Boot-time service order

When the VM powers on, this is roughly the sequence:

```
   BIOS  →  GRUB  →  kernel  →  systemd  ─┬─►  network.target
                                          ├─►  firewalld
                                          ├─►  tailscaled        (joins tailnet)
                                          ├─►  sshd              (accepts SSH)
                                          ├─►  docker            (starts containers
                                          │                       via Compose unit-style
                                          │                       restart policy)
                                          ├─►  graphical.target
                                          │     └─►  gdm         (login screen on tty1)
                                          └─►  gnome-remote-desktop
                                                                 (RDP ready on :3389)
```

Containers auto-start because they have `restart: unless-stopped` in
`docker-compose.yml`, and the Docker daemon starts at boot.

## Cockpit (web admin)

Cockpit is a Red Hat web console that lets you do most maintenance through a
browser instead of SSH. Access it at:

```
   https://<LAN_IP>:9090/
```

Sign in with the same Linux user/password (`bryant` / your password). It will
warn about a self-signed certificate — accept and proceed. From Cockpit you can:

- Watch CPU/memory/disk graphs
- Read system logs
- Update software packages (`dnf` operations with a UI)
- Restart services
- Open a terminal (same as SSH)

💡 Cockpit is the **easiest path** for someone unfamiliar with the command line.

## Updates and subscription

The VM is registered with Red Hat. To check status and apply updates:
```bash
$ sudo subscription-manager status                    # is it registered?
$ sudo dnf check-update                               # list pending updates
$ sudo dnf upgrade                                    # apply them
```

⚠️ **Do not run `dnf upgrade` blindly during business hours.** Kernel updates
require a reboot to take effect. Schedule updates during a maintenance window
and reboot after with `sudo systemctl reboot`. See [`06-maintenance.md`](06-maintenance.md)
→ *Updating the OS*.

## Where to go next

- [`03-application.md`](03-application.md) — the intranet code itself
- [`04-deployment.md`](04-deployment.md) — Docker Compose mechanics
- [`05-remote-access.md`](05-remote-access.md) — SSH, RDP, Tailscale, Cockpit
