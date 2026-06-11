# 02 — Infrastructure

This document describes the **server, operating system, network, and supporting
services** that host the intranet in the homelab test environment today, and
the changes planned for the Huntsville Hospital production deployment.

## Host inventory (current homelab)

| Property | Value |
|---|---|
| Operating system | Red Hat Enterprise Linux 10.1 (Coughlan) |
| Kernel | `6.12.0-124.8.1.el10_1.x86_64` |
| Virtualization | KVM guest under Proxmox VE |
| Proxmox host name | (homelab) |
| VMID on Proxmox | 101 |
| Hostname | `localhost` (transient) |
| Time zone | `America/Chicago` |
| vCPU | 4 |
| vRAM | 7 GiB |
| vDisk | 28 GiB single LVM volume `/dev/mapper/rhel-root` |
| Subscription | Red Hat Developer subscription, registered |
| Tailscale | Active, joins the `<owner>@` tailnet |

To check current numbers at any time:
```bash
$ hostnamectl              # OS and machine identity
$ free -h                  # memory
$ df -h /                  # disk
$ uptime                   # load and uptime
```

## Disk layout

```
   /dev/mapper/rhel-root  <-- single LVM logical volume
       |
       +- mounted at /
              |
              +- /home/<ops-user>/         (admin user's home directory)
              |     +- .claude/            (Claude Code state)
              |
              +- /srv/intranet/            (APPLICATION - this project)
              |     +- app/                (Express backend source + node_modules)
              |     +- frontend/           (React source + built dist/)
              |     +- nginx/              (reverse-proxy config)
              |     +- public/             (admin/ and manager/ static portals)
              |     +- data/               (SQLite databases - live)
              |     +- uploads/            (uploaded files)
              |     +- docs/               (this documentation)
              |
              +- /var/lib/docker/          (Docker images and overlay storage)
              +- /var/log/                 (System logs - journald)
              +- /etc/                     (System configuration)
```

In the homelab, the SQLite databases live at `/srv/intranet/data/` and are
bind-mounted into the backend container at `/data/`. There is no PostgreSQL
installation yet.

## Network topology (homelab)

The VM has **three logical network presences** in the homelab:

```
   +---------------------------------------------------------+
   |                  RHEL 10 VM                             |
   |                                                         |
   |  lo            127.0.0.1/8        <-- localhost only    |
   |                                                         |
   |  ens18         <lan-ip>/24                              |
   |                Homelab LAN                              |
   |                                                         |
   |  tailscale0    <tailscale-ip>/32                        |
   |                Tailscale overlay                        |
   |                                                         |
   |  docker0       172.18.0.1/16      <-- Docker bridge     |
   |                (container-to-container only)            |
   +---------------------------------------------------------+
```

| Interface | Purpose | Reachable from |
|---|---|---|
| `lo` | Loopback | the VM itself |
| `ens18` | Primary NIC on the homelab LAN | LAN devices |
| `tailscale0` | Encrypted overlay for remote access | Authorized devices on the tailnet |
| `docker0` | Inter-container traffic | Containers only |

## Firewall (firewalld)

`firewalld` is active using the default `public` zone, bound to `ens18`.
Open ingress ports today:

| Port | Protocol | Service | Allowed from |
|---|---|---|---|
| `22/tcp` | TCP | OpenSSH | LAN + Tailscale |
| `8080/tcp` | TCP | nginx (HTTP) | LAN + Tailscale |
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
   systemd --+-- docker.service              <-- runs the intranet containers
            +-- firewalld.service           <-- packet filtering
            +-- gdm.service                 <-- GNOME display manager (for RDP)
            +-- gnome-remote-desktop.service <-- RDP server (headless)
            +-- sshd.service                <-- SSH
            +-- tailscaled.service          <-- Tailscale agent
            +-- cockpit.socket              <-- on-demand Cockpit
            +-- rhsm.service / rhsmcertd    <-- Red Hat subscription
```

To list all running services:
```bash
$ systemctl list-units --type=service --state=running
```

## Listening sockets (current state)

```
   PORT    BIND ADDRESS                  SERVICE
   22      0.0.0.0  +  [::]              sshd
   631     127.0.0.1  +  [::1]           CUPS (local printing only)
   3389    *                              gnome-remote-desktop (RDP)
   8080    0.0.0.0  +  [::]              nginx (HTTP, served by container)
   9090    *                              cockpit
```

To check anytime:
```bash
$ sudo ss -tlnp
```

## Boot-time service order

```
   BIOS  ->  GRUB  ->  kernel  ->  systemd  --+-->  network.target
                                              +-->  firewalld
                                              +-->  tailscaled       (joins tailnet)
                                              +-->  sshd
                                              +-->  docker           (starts containers)
                                              +-->  graphical.target
                                              |       +-->  gdm
                                              +-->  gnome-remote-desktop (RDP ready)
```

## Cockpit (web admin)

Cockpit lets you do most maintenance through a browser:

```
   https://<tailscale-ip>:9090/   ← via Tailscale
   https://<lan-ip>:9090/         ← via LAN
```

Accept the self-signed cert warning, then log in with your local user.
Cockpit is the friendliest path for non-CLI maintenance.

## Updates and subscription

```bash
$ sudo subscription-manager status                    # registered?
$ sudo dnf check-update                               # what's available
$ sudo dnf upgrade                                    # apply (asks y/n)
$ sudo dnf needs-restarting -r                        # reboot needed?
```

### Recommended update cadence (current)

| Cadence | Action |
|---|---|
| **Weekly** | `sudo dnf check-update` |
| **Monthly** | `sudo dnf upgrade --security` |
| **Quarterly** | Full `sudo dnf upgrade` + reboot |

---

## 🔄 Production migration

For the Huntsville Hospital deployment, the infrastructure layer changes
significantly:

| Item | Homelab (today) | Production target |
|---|---|---|
| Hypervisor | Proxmox VE | VMware vSphere / ESXi |
| VM disk size | 28 GiB | 80 GiB (room for PostgreSQL + uploads) |
| vRAM | 7 GiB | 8 GiB |
| Hostname | `localhost` (transient) | `Intranet-HCI` (DNS A record) |
| FQDN | (none) | `Intranet-HCI.heart.local` |
| Network | Tailscale + LAN | Hospital corporate VLAN only |
| Firewall ports | 22, 8080, 3389, 9090 | 22 (jump host), 443, 5432 (DBAs), 9090 |
| TLS | (none) | Hospital internal CA cert |
| Remote GUI | RDP via gnome-remote-desktop | (removed — Cockpit only) |
| Tailscale | Active | Not installed |
| New service | (none) | PostgreSQL 17 systemd service |

The Huntsville Hospital network team will assign the static IP and DNS name.
Hospital PKI will issue the TLS certificate. Hospital security may require
additional source-IP restrictions on ports 22 and 9090.

## Where to go next

- [`03-application.md`](03-application.md) — the intranet code itself
- [`04-deployment.md`](04-deployment.md) — Docker Compose mechanics
- [`05-remote-access.md`](05-remote-access.md) — SSH, RDP, Tailscale, Cockpit
