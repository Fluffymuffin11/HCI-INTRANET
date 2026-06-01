# 02 — Infrastructure

This document describes the **server, operating system, network, and supporting
services** that host the intranet in the Huntsville Hospital production
environment.

## Host inventory

| Property | Value |
|---|---|
| Operating system | Red Hat Enterprise Linux 10.1 (Coughlan) |
| Kernel | `6.12.x-el10` (current at install) |
| Virtualization | VMware vSphere / ESXi guest |
| vSphere cluster | Huntsville Hospital production cluster |
| VM name | `Intranet-HCI` |
| FQDN | `Intranet-HCI.heart.local` |
| Time zone | `America/Chicago` (host and containers) |
| vCPU | 4 |
| vRAM | 8 GiB |
| vDisk | 80 GiB single LVM volume `/dev/mapper/rhel-root` |
| Subscription | Red Hat Enterprise Linux subscription, registered to hospital account |
| Joined to | Huntsville Hospital corporate DNS; static A record managed by hospital IT |

To check current numbers at any time:
```bash
$ hostnamectl              # OS and machine identity
$ free -h                  # memory
$ df -h /                  # disk
$ uptime                   # how long up, load average
```

## Disk layout

```
   /dev/mapper/rhel-root  <-- single LVM logical volume
       |
       +- mounted at /
              |
              +- /home/<ops-user>/          (admin user's home directory)
              |
              +- /srv/intranet/             (APPLICATION - this project)
              |     +- app/                 (Node backend source + node_modules)
              |     +- frontend/            (React source + built dist/)
              |     +- nginx/               (reverse-proxy config + TLS certs)
              |     +- public/              (admin/ and manager/ static portals)
              |     +- uploads/             (uploaded files - live)
              |     +- prisma/              (schema.prisma, migrations)
              |     +- docs/                (this documentation)
              |
              +- /var/lib/docker/           (Docker images and overlay storage)
              +- /var/lib/pgsql/data/       (PostgreSQL 16 database files)
              +- /var/log/                  (System logs - journald)
              +- /etc/                      (System configuration)
```

PostgreSQL stores its data in `/var/lib/pgsql/data` on the host. The application
code, uploaded files, and the database all live on this single VM but the
database runs as a native systemd service, not inside a Docker container, so
DBAs can connect to it directly from their workstations.

## Network topology

The VM has **two logical network interfaces** in production:

```
   +---------------------------------------------------------+
   |                  RHEL 10 VM                             |
   |                                                         |
   |  lo            127.0.0.1/8        <-- localhost only    |
   |                                                         |
   |  ens192        <vsphere-assigned-ip>/24                 |
   |                Huntsville Hospital corporate VLAN       |
   |                DNS: Intranet-HCI.heart.local            |
   |                                                         |
   |  docker0       172.18.0.1/16      <-- Docker bridge     |
   |                (container-to-container only)            |
   +---------------------------------------------------------+
```

| Interface | Purpose | Reachable from |
|---|---|---|
| `lo` | Loopback | the VM itself |
| `ens192` | Primary NIC on the corporate VLAN | Hospital workstations, IT-Ops jump host, DBA workstations |
| `docker0` | Inter-container traffic | Containers only |

There is **no Tailscale or other overlay network in production.** All access
is over the hospital's internal corporate network only. The system is not
exposed to the public internet.

## Firewall (firewalld)

`firewalld` is active using the default `public` zone, bound to `ens192`.
Open ingress ports in production:

| Port | Protocol | Service | Allowed from |
|---|---|---|---|
| `22/tcp` | TCP | OpenSSH | IT-Ops jump host (source-restricted) |
| `443/tcp` | TCP | nginx (HTTPS) | Entire corporate VLAN |
| `9090/tcp` | TCP | Cockpit web console | IT-Ops jump host (source-restricted) |
| `5432/tcp` | TCP | PostgreSQL | DBA group on corporate VLAN (source-restricted) |
| `icmp` | — | ping / discovery | Corporate VLAN |

Note: port `80/tcp` is **not** open. nginx redirects clients to `:443`
internally via a same-host listener that responds only on the loopback,
not via firewalld passthrough.

To inspect or modify:
```bash
$ sudo firewall-cmd --list-all                        # show current
$ sudo firewall-cmd --permanent --add-port=N/tcp      # open a port persistently
$ sudo firewall-cmd --reload                          # apply changes
```

## TLS / certificates

The site is served over HTTPS using a certificate issued by the hospital's
internal Certificate Authority. Trust is pre-installed on hospital
workstations, so end users see a normal padlock with no warnings.

| Item | Path / value |
|---|---|
| Certificate | `/etc/nginx/tls/intranet-hci.crt` |
| Private key | `/etc/nginx/tls/intranet-hci.key` (mode 0600, owner root) |
| Issued by | Huntsville Hospital Internal CA |
| Renewal | Annual; coordinate with hospital PKI team 30 days before expiry |
| Renewal procedure | See [`06-maintenance.md`](06-maintenance.md) -> *Certificate rotation* |

## Services running on the host

```
   systemd --+-- postgresql.service         <-- PostgreSQL 16 database
            +-- docker.service              <-- runs the intranet containers
            +-- firewalld.service           <-- packet filtering
            +-- sshd.service                <-- SSH access (jump host only)
            +-- cockpit.socket              <-- on-demand Cockpit (port 9090)
            +-- chronyd.service             <-- NTP sync to hospital NTP
            +-- rsyslog.service             <-- ships logs to hospital SIEM
            +-- rhsm.service / rhsmcertd    <-- Red Hat subscription
```

To list all running services:
```bash
$ systemctl list-units --type=service --state=running
```

## Listening sockets (production state)

```
   PORT    BIND ADDRESS         SERVICE
   22      0.0.0.0  +  [::]     sshd (firewall-restricted to jump host)
   443     0.0.0.0  +  [::]     nginx (HTTPS, served by container)
   5432    0.0.0.0  +  [::]     postgresql (firewall-restricted to DBA group)
   9090    *                    cockpit (firewall-restricted)
```

To check anytime:
```bash
$ sudo ss -tlnp
```

## Boot-time service order

When the VM powers on, this is roughly the sequence:

```
   BIOS  ->  GRUB  ->  kernel  ->  systemd  --+-->  network.target
                                              +-->  firewalld
                                              +-->  chronyd
                                              +-->  sshd
                                              +-->  rsyslog
                                              +-->  postgresql  (database ready
                                              |                  before docker)
                                              +-->  docker  (starts containers
                                              |              via Compose unit-style
                                              |              restart policy)
                                              +-->  cockpit.socket
```

Containers auto-start because they have `restart: unless-stopped` in
`docker-compose.yml`, and the Docker daemon starts at boot.

## Cockpit (web admin)

Cockpit is a Red Hat web console that lets you do most maintenance through a
browser instead of SSH. Access it at:

```
   https://Intranet-HCI.heart.local:9090/
```

Cockpit uses the same TLS certificate as the main site. Log in with a
hospital-domain-joined account that is a member of the `wheel` (sudo)
group on the VM. From Cockpit you can:

- Watch CPU / memory / disk / network graphs
- Read system logs (journald with search and filter)
- Update software packages with a UI
- Restart services
- Open a terminal in the browser

Cockpit is the **easiest path** for someone unfamiliar with the command line.

## Updates and subscription

The VM is registered with Red Hat. To check status and apply updates:
```bash
$ sudo subscription-manager status                    # confirm registration
$ sudo dnf check-update                               # list available updates
$ sudo dnf upgrade                                    # apply (asks y/n)
$ sudo dnf upgrade -y                                 # apply without prompt
```

After installing updates, **check if a reboot is needed**:
```bash
$ sudo dnf needs-restarting -r                        # exit 1 means reboot recommended
```

If a reboot is needed (kernel, glibc, systemd updates), schedule it through
the hospital change-management process. The Cockpit "Software Updates" page
provides a friendlier UI for the same operations and flags reboot requirements.

### Recommended update cadence

| Cadence | Action |
|---|---|
| **Weekly** | `sudo dnf check-update` - read the list, decide what to apply |
| **Monthly** | `sudo dnf upgrade --security` - security-only updates |
| **Quarterly** | Full `sudo dnf upgrade` + reboot, during a maintenance window approved through change management |

Never run `dnf upgrade` mid-workday. Some packages restart services mid-update;
the intranet may briefly stop responding.

## Where to go next

- [`03-application.md`](03-application.md) - the intranet code itself
- [`04-deployment.md`](04-deployment.md) - Docker Compose and the external database
- [`05-remote-access.md`](05-remote-access.md) - SSH, Cockpit, DBA workstation access
