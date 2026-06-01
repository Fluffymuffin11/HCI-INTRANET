# 05 — Remote Access

This document covers **all the ways into the production server** from the
hospital's internal corporate network — SSH, the Cockpit web console, and
the direct database access used by DBAs.

## Access matrix

```
                +----------------------------------------------------------+
                |                  RHEL 10 VM                              |
                |                                                          |
                |   Port   Method            Purpose                       |
                |   ----   ----------------  ----------------------------- |
   ops jump --> |   22     SSH (OpenSSH)     Shell, file transfer, scripts |
                |  443     HTTPS (nginx)     The intranet itself           |
                |  9090    HTTPS (Cockpit)   Web-based admin console       |
                |                                                          |
                +----------------------------------------------------------+

   The PostgreSQL database runs on the SAME VM (native, not in a container):
   Intranet-HCI.heart.local : 5432  (see "Direct database access" below)
```

There is **no Tailscale, no VPN client, no internet-facing port** for this
system. All access is over the hospital's internal corporate network only.

## SSH access

From the IT-Ops jump host:

```bash
$ ssh <ops-user>@Intranet-HCI.heart.local
```

Authentication is **key-based only** in production; password SSH is disabled
in `/etc/ssh/sshd_config`:

```
PasswordAuthentication no
PermitRootLogin no
```

To add a new operator's key:

```bash
$ ssh <ops-user>@Intranet-HCI.heart.local
$ sudo mkdir -p /home/<new-user>/.ssh
$ sudo nano /home/<new-user>/.ssh/authorized_keys
   # paste the public key
$ sudo chmod 600 /home/<new-user>/.ssh/authorized_keys
$ sudo chown -R <new-user>:<new-user> /home/<new-user>/.ssh
```

## Cockpit (web console)

The most beginner-friendly way to manage the server:

```
   https://Intranet-HCI.heart.local:9090/
```

Cockpit uses the same TLS certificate as the main site, so browsers show the
normal padlock. Log in with the operator's hospital domain account (must be
a member of `wheel` group on the VM).

From Cockpit:

```
   +---------------------------------------------------------------+
   |  Cockpit (web)                                                |
   |                                                               |
   |  Overview          live CPU / memory / disk / network graphs  |
   |  Logs              browse journald with search and filters    |
   |  Storage           disk partitions, free space, NFS mounts    |
   |  Networking        interfaces, firewall, VPN                  |
   |  Podman / Docker   running containers, restart, view logs     |
   |  Software updates  list and install dnf updates with a UI     |
   |  Services          systemd unit list, start/stop/enable       |
   |  Accounts          list/create users, change passwords        |
   |  Terminal          full shell access in the browser           |
   |  SELinux           policy state                               |
   +---------------------------------------------------------------+
```

For an operator who is not a Linux expert, **Cockpit is the single best
tool to learn.** Most maintenance tasks in [`06-maintenance.md`](06-maintenance.md)
can be performed through Cockpit.

## Direct database access

A key production capability: PostgreSQL runs as a **native systemd service**
on the same VM as the application (not in a Docker container). This lets DBAs
connect directly from their workstations to the same hostname as the website,
on the standard PostgreSQL port. There is no need to shell into any container.

### Database connection details

| Item | Value |
|---|---|
| Hostname | `Intranet-HCI.heart.local` |
| Port | `5432` (default PostgreSQL) |
| Database name | `intranet_hci` |
| Application user | `intranet_app` (used by the Fastify backend) |
| Read-only user | `intranet_ro` (for reporting / dashboards) |
| DBA users | one per DBA, with full privileges, key-based auth where supported |

### Connection from a DBA workstation

Using `psql`:
```bash
$ psql -h Intranet-HCI.heart.local -U <dba-user> -d intranet_hci
```

Using DBeaver, pgAdmin, or another GUI client:

| Field | Value |
|---|---|
| Host | `Intranet-HCI.heart.local` |
| Port | `5432` |
| Database | `intranet_hci` |
| Username | the DBA's account |
| Authentication | as configured (LDAP / password / certificate) |
| SSL mode | `require` (production policy) |

### What DBAs can do

- Run ad-hoc `SELECT` queries against any table
- Build reports against the read-only replica
- Take logical backups with `pg_dump`
- Inspect query plans with `EXPLAIN ANALYZE`
- Tune indexes and statistics
- Restore from a backup (with change-management approval)

### What DBAs should NOT do (without coordination)

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

## Quick reference: which tool when

| You want to... | Use |
|---|---|
| Run a one-line command | SSH |
| Edit a file in vim / nano | SSH |
| Restart a container | SSH or Cockpit |
| Watch system metrics | Cockpit |
| Read logs with a search box | Cockpit |
| Update Red Hat packages | Cockpit (easy) or SSH `sudo dnf upgrade` |
| Query the database | psql / DBeaver / pgAdmin to `Intranet-HCI.heart.local:5432` |
| Recover from boot problems | vSphere Client (vCenter) -> VM -> Web Console |

## Local console (vSphere)

If all remote paths fail, you can still get into the VM via the vSphere Client:

1. Open vCenter at `<vcenter-fqdn>`
2. Log in with your vSphere credentials
3. Locate the VM `Intranet-HCI` in the inventory tree
4. Right-click -> Open Console (or use the embedded HTML5 console)

The console gives you a virtual keyboard/monitor connection to the VM,
useful when networking or SSH is broken.

## Where to go next

- [`06-maintenance.md`](06-maintenance.md) — routine maintenance procedures
- [`07-troubleshooting.md`](07-troubleshooting.md) — when something is broken
