# 06 — Maintenance Guide

> **This chapter is written for people new to Red Hat Linux.** It explains every
> command and what each piece does. If you are an experienced sysadmin, skim the
> code blocks; the prose is for newcomers.

If you remember nothing else: **most problems are solved by restarting the right
service.** Identify which layer is broken (web, backend, database, OS), then restart
just that piece.

---

## 1. Orientation — what you're looking at

When you log in via SSH, you are dropped into a **shell** (the program that
reads commands and runs them). The default shell here is `bash`. The prompt
looks like:

```
bryant@localhost:~$
   │      │       │ │
   │      │       │ └─ "I'm waiting for a command"
   │      │       └─── you are in your home folder (~/)
   │      └─────────── the machine's hostname
   └────────────────── your username
```

The most useful keys at the prompt:

| Key | What it does |
|---|---|
| `Tab` | autocompletes file names and commands |
| `↑ / ↓` | cycles through command history |
| `Ctrl+R` | searches command history (start typing, ↑ to scroll) |
| `Ctrl+C` | cancels the currently running command |
| `Ctrl+L` | clears the screen (same as typing `clear`) |
| `Ctrl+D` | logs out (same as `exit`) |

### `sudo` — running things as root

You are logged in as `bryant`. For commands that change the system (installing
software, restarting services, editing system files), prefix the command with
`sudo`. The first time per session it asks for your password. Once you've
entered it, subsequent `sudo` calls in the same shell skip the prompt for a
few minutes.

```bash
$ whoami                    # → bryant
$ sudo whoami               # → root  (after entering password)
```

⚠️ `sudo` is a loaded gun — it runs commands with full system privileges.
Always read the command before pressing Enter.

---

## 2. Daily / weekly checks

### Is the website up?

```bash
$ curl -sI http://localhost:8080/        # should print "HTTP/1.1 200 OK"
$ curl -s http://localhost:8080/api/health
{"ok":true}
```

If either fails, jump to [`07-troubleshooting.md`](07-troubleshooting.md) →
*Website is down*.

### Are the containers running?

```bash
$ cd /srv/intranet
$ docker compose ps
```

You should see both `intranet_nginx` and `intranet_backend` with status `Up`.
Anything other than `Up` is a problem.

### How is disk space?

```bash
$ df -h /                                # root filesystem free space
$ du -sh /srv/intranet/uploads/          # how much uploads have grown
$ docker system df                       # Docker's view of disk usage
```

Treat **anything above 80% used** as urgent. Above 90% the OS misbehaves in
subtle ways (the Docker daemon can refuse to start new containers, journald
truncates logs, the website may fail to serve uploads).

### How is memory?

```bash
$ free -h
```

You expect about 3–4 GiB used. If `available` drops below 500 MiB, something
is leaking or a workload spiked. The `top` or `htop` commands let you see
which process is to blame:

```bash
$ top                  # press 'q' to quit, 'M' to sort by memory, 'P' by CPU
```

💡 In Cockpit, the **Overview** page shows all of this graphically — no
commands needed.

---

## 3. Restarting things (the most common operation)

The intranet has several restart layers, from least to most disruptive:

```
   Restart NGINX only         (5 sec downtime)
       ↓
   Restart Backend only       (15–30 sec downtime)
       ↓
   Restart Both               (full intranet downtime, ~30 sec)
       ↓
   Restart Docker daemon      (~1 minute, restarts ALL containers)
       ↓
   Reboot the VM              (3–5 minutes total)
```

Run all of these from `/srv/intranet/`:

```bash
$ cd /srv/intranet
$ docker compose restart web              # just nginx
$ docker compose restart backend          # just the Node app
$ docker compose restart                  # both
$ sudo systemctl restart docker           # whole Docker daemon (RARE)
$ sudo systemctl reboot                   # full VM reboot
```

⚠️ **Reboot only when you need to** — the website is offline for 3–5 minutes,
and any running maintenance tasks die.

---

## 4. Reading logs

Logs are the first thing to look at when something is wrong.

### Application logs (the containers)

```bash
$ cd /srv/intranet
$ docker compose logs --tail=100 backend       # last 100 lines, backend
$ docker compose logs --tail=100 web           # nginx
$ docker compose logs -f backend               # live tail (Ctrl+C to stop)
$ docker compose logs --since 1h backend       # past hour
```

What "good" backend logs look like:
```
intranet_backend  | Server listening on :3000
intranet_backend  | [email stub] subject → recipient
```

What "bad" looks like:
```
intranet_backend  | Error: P1001 Can't reach database server at host.docker.internal:5432
intranet_backend  | UnhandledPromiseRejection ...
```

### System logs (anything outside the containers)

The system uses `journald` — a unified log service. Useful commands:

```bash
$ sudo journalctl -xe                    # last entries, formatted
$ sudo journalctl --since "1 hour ago"   # past hour
$ sudo journalctl --since today          # since midnight
$ sudo journalctl -u docker.service      # logs for a specific service
$ sudo journalctl -u sshd                # SSH logs
$ sudo journalctl -k                     # kernel messages only
$ sudo journalctl -f                     # live tail of everything
```

💡 In Cockpit, **Logs** in the left navigation gives a search-and-filter UI
for exactly this.

---

## 5. Updating the operating system

Red Hat publishes security and feature updates regularly. We are *registered*
with the Red Hat subscription system, so `dnf` (the package manager) can pull
them.

```bash
$ sudo subscription-manager status        # confirm we are registered
$ sudo dnf check-update                   # list available updates (no changes)
$ sudo dnf upgrade                        # apply updates (asks "y/n")
$ sudo dnf upgrade -y                     # same, but no prompt
```

After installing updates, **check if a reboot is needed**:

```bash
$ sudo dnf needs-restarting -r            # exits 1 if reboot recommended
```

If a reboot is needed (kernel, glibc, systemd updates), schedule it:

```bash
$ sudo systemctl reboot
```

### Recommended update cadence

| Cadence | Action |
|---|---|
| **Weekly** | `sudo dnf check-update` — read the list, decide what to apply |
| **Monthly** | `sudo dnf upgrade --security` — security-only updates |
| **Quarterly** | Full `sudo dnf upgrade` + reboot, during a maintenance window |

⚠️ **Never run `dnf upgrade` mid-workday.** Some packages restart services
mid-update; the intranet may briefly stop responding.

### Cockpit alternative

Cockpit's **Software Updates** page lets you click-through updates with a
human-readable changelog, and it warns you when a reboot is required.

---

## 6. Backups

### What needs backing up

Four things, in priority order:

| Importance | Path | Why |
|---|---|---|
| 🔴 Critical | PostgreSQL `intranet_hci` database | Source of truth for all relational data |
| 🔴 Critical | `/srv/intranet/uploads/` | All uploaded photos/files |
| 🟡 Important | `/srv/intranet/.env` | `SESSION_SECRET` and `DATABASE_URL` |
| 🟡 Important | `/var/lib/pgsql/data/postgresql.conf` and `pg_hba.conf` | DB configs needed to rebuild |
| 🟢 Nice | `/srv/intranet/app/`, `/srv/intranet/frontend/` | Source code (also in git) |

### Manual backup recipe

```bash
$ DATE=$(date +%Y%m%d-%H%M%S)

# 1. Dump the PostgreSQL database (safe to run live; uses MVCC snapshot)
$ sudo -u postgres pg_dump -Fc intranet_hci \
    > /home/<ops-user>/intranet-db-$DATE.dump

# 2. Tar the uploads
$ sudo tar -czf /home/<ops-user>/intranet-uploads-$DATE.tar.gz \
    -C /srv intranet/uploads

# 3. Copy the .env (small, but contains secrets)
$ sudo cp /srv/intranet/.env /home/<ops-user>/intranet-env-$DATE.backup
```

Then **copy the backups off the VM** (this is the part people forget):

```bash
# From an operator workstation:
$ scp <ops-user>@Intranet-HCI.heart.local:/home/<ops-user>/intranet-*-$DATE.* \
      ~/Backups/intranet/
```

### Why pg_dump is safe to run live

`pg_dump` uses PostgreSQL's MVCC snapshot mechanism: it takes a consistent
point-in-time view of all tables, and the backend can continue reading and
writing concurrently. No need to stop the application for the dump.

## Hot vs cold backup

⚠️ The PostgreSQL database is being **actively written** by the backend. A `tar`
of the `intranet_hci` database could capture it mid-write and produce a slightly inconsistent
file. For a truly clean backup:

```bash
$ sudo -u postgres pg_dump -Fc intranet_hci > /var/backups/intranet/intranet-db-$(date +%Y%m%d-%H%M%S).dump
$ sudo tar -czf /home/bryant/intranet-backup-$DATE.tar.gz \
      -C /srv intranet/data/intranet-backup.db intranet/uploads intranet/.env
$ sudo rm /srv/intranet/data/intranet-backup.db
```

`.backup` is PostgreSQL's online backup API — safe to run while the app is live.

### Automated backups (recommended)

Save the following as `/usr/local/bin/intranet-backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR=/var/backups/intranet
DATE=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

# PostgreSQL logical dump (compressed custom format)
sudo -u postgres pg_dump -Fc intranet_hci \
    > "$BACKUP_DIR/intranet-db-$DATE.dump"

# Uploads
tar -czf "$BACKUP_DIR/intranet-uploads-$DATE.tar.gz" \
    -C /srv intranet/uploads

# Symlink "LATEST" for convenience
ln -sf "$BACKUP_DIR/intranet-db-$DATE.dump"          "$BACKUP_DIR/intranet-db-LATEST.dump"
ln -sf "$BACKUP_DIR/intranet-uploads-$DATE.tar.gz"   "$BACKUP_DIR/intranet-uploads-LATEST.tar.gz"

# Keep only the last 14 backups of each type
ls -1t "$BACKUP_DIR"/intranet-db-*.dump      | tail -n +15 | xargs -r rm --
ls -1t "$BACKUP_DIR"/intranet-uploads-*.tar.gz | tail -n +15 | xargs -r rm --
```

Then schedule it nightly via cron:

```bash
$ sudo crontab -e
# Add this line:
0 2 * * * /usr/local/bin/intranet-backup.sh >> /var/log/intranet-backup.log 2>&1
```

This runs at 2:00 a.m. every night and keeps two weeks of snapshots.

⚠️ **Still copy them off the VM.** Backups stored only on the VM do not
help if the VM is the thing that fails. Sync nightly to a hospital-managed
backup share or cloud bucket.

---

## 7. Disk space management

If the disk fills up, the system breaks in confusing ways. Routine cleanup:

### What's eating the disk?

```bash
$ df -h /                                          # overall free space
$ sudo du -sh /var/* 2>/dev/null | sort -h         # biggest /var/ subdirs
$ sudo du -sh /home/* 2>/dev/null | sort -h
$ docker system df                                 # Docker's footprint
$ sudo journalctl --disk-usage                     # log size
```

### Common cleanup commands

```bash
# Old Docker images and build cache
$ docker system prune -a                           # ⚠️ removes UNUSED images
$ docker container prune                           # removes stopped containers

# Trim journald logs to last 14 days
$ sudo journalctl --vacuum-time=14d

# Trim journald to a size cap
$ sudo journalctl --vacuum-size=500M

# DNF cache
$ sudo dnf clean all
```

⚠️ The `intranet-backup.tar.gz` file in `/srv/intranet/` is 48 MB and dates
from May 15. Decide whether to keep it or move it to `/home/bryant/`.

---

## 8. Managing users

Adding a Linux user (e.g., for another technical operator):

```bash
$ sudo useradd -m -G wheel,docker alice            # creates home dir, gives sudo and docker access
$ sudo passwd alice                                # sets a password
$ sudo passwd -e alice                             # forces password change on first login
```

`wheel` is Red Hat's "may use sudo" group. `docker` lets the user run
`docker` commands without sudo.

Removing a user:

```bash
$ sudo userdel -r alice                            # -r removes their home directory
```

⚠️ **Application users (admin accounts inside the intranet website) are
different** — those live in the `users` table of the `intranet_hci` database and are managed
through the website's admin panel at `/admin/`, not via Linux.

---

## 9. Changing the intranet admin password

If you forgot the admin password for the website (not the Linux account —
the website admin user inside the application):

```bash
# 1. Generate a new bcrypt hash inside the backend container
$ docker compose exec backend node -e \
    "console.log(require('bcryptjs').hashSync('NewPass123!', 10))"
# Copy the resulting $2a$10$... string

# 2. Update the user row in PostgreSQL
$ sudo -u postgres psql intranet_hci -c \
    "UPDATE \"User\" SET password_hash = '<paste-hash-here>' WHERE username = 'admin';"
```

Or, if you prefer GUI tools (DBeaver, pgAdmin), update the same row through
your DBA workstation — connect to `Intranet-HCI.heart.local:5432` as a
DBA-privileged user, navigate to the `User` table, edit the `password_hash`
column.

Log in with the new password.

## 10. SSL/TLS — should we do this?

Currently the intranet is served over **plain HTTP** on port 8080. On a
trusted LAN this is the historical norm, but it has weaknesses:

- Passwords cross the network in cleartext
- Browsers warn about "Not Secure"
- Session cookies cannot be marked `Secure: true`

Adding TLS is a recommended hardening step. Two paths:

1. **Self-signed certificate** for nginx — simple, browsers will warn
2. **Reverse-proxy through Caddy or Traefik** with a Let's Encrypt cert via
   DNS-01 (works for LAN-only services)

This is out of scope for routine maintenance but worth knowing about.

---

## 11. Routine maintenance schedule

A reasonable rhythm for this system:

```
   DAILY    (5 min, automated)
   ├─ Backup script runs at 02:00
   └─ (Optional) cron health-check pinging /api/health

   WEEKLY   (10 min, manual)
   ├─ docker compose ps                  → containers all Up
   ├─ df -h /                            → disk under 80%
   ├─ sudo journalctl -p err --since=7d  → any errors?
   └─ Check the corporate network admin console      → all expected devices online

   MONTHLY  (30 min, manual, maintenance window)
   ├─ sudo dnf upgrade --security        → security updates
   ├─ Review backup integrity (extract one and check files)
   └─ Rotate logs if growing fast

   QUARTERLY (1 hour, manual, maintenance window)
   ├─ Full sudo dnf upgrade + reboot
   ├─ Restart all containers from cold
   ├─ Verify backups by performing a TEST RESTORE
   └─ Review user list, deactivate inactive accounts
```

## 12. When in doubt

Three commands that have saved many sessions:

```bash
$ cd /srv/intranet && docker compose restart       # nudge the app
$ sudo systemctl reboot                            # nudge the OS
$ sudo journalctl -xe                              # what just broke?
```

If those don't help, see [`07-troubleshooting.md`](07-troubleshooting.md).
