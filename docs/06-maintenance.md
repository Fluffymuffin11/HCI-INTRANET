# 06 — Maintenance Guide

> **This chapter is written for people new to Red Hat Linux.** It explains every
> command. If you are an experienced sysadmin, skim the code blocks; the prose is
> for newcomers. The procedures here describe the **current homelab** system; a
> "Production migration" callout at the end notes which procedures change for
> Huntsville Hospital.

If you remember nothing else: **most problems are solved by restarting the
right service.** Identify which layer is broken (web, backend, RDP, database,
OS), then restart just that piece.

---

## 1. Orientation — what you're looking at

When you log in via SSH, you are dropped into a **shell** (the program that
reads commands and runs them). The default shell here is `bash`. The prompt
looks like:

```
<user>@<host>:~$
   |     |     | +- "I'm waiting for a command"
   |     |     +--- you are in your home folder (~/)
   |     +--------- the machine's hostname
   +--------------- your username
```

The most useful keys at the prompt:

| Key | What it does |
|---|---|
| `Tab` | autocompletes file names and commands |
| `↑ / ↓` | cycles through command history |
| `Ctrl+R` | searches command history |
| `Ctrl+C` | cancels the currently running command |
| `Ctrl+L` | clears the screen |
| `Ctrl+D` | logs out |

### `sudo` — running things as root

Prefix any system-changing command with `sudo`. The first time per session
it asks for your password. Subsequent `sudo` calls in the same shell skip
the prompt for a few minutes.

```bash
$ whoami                    # -> <your user>
$ sudo whoami               # -> root  (after entering password)
```

⚠️ Always read the command before pressing Enter.

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
$ du -sh /srv/intranet/data/             # SQLite database size
$ docker system df                       # Docker's view of disk usage
```

Treat anything above 80% used as urgent.

### How is memory?

```bash
$ free -h
```

Expect 3–4 GiB used. If `available` drops below 500 MiB, something is
leaking. Find the culprit:

```bash
$ top                  # 'q' to quit, 'M' to sort by memory, 'P' by CPU
```

💡 In Cockpit, the **Overview** page shows all of this graphically.

---

## 3. Restarting things (the most common operation)

```
   Restart NGINX only         (5 sec downtime)
       v
   Restart Backend only       (15-30 sec downtime)
       v
   Restart Both               (full intranet downtime, ~30 sec)
       v
   Restart Docker daemon      (~1 minute, restarts ALL containers)
       v
   Reboot the VM              (3-5 minutes total)
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

---

## 4. Reading logs

### Application logs (the containers)

```bash
$ docker compose logs --tail=100 backend       # last 100 lines
$ docker compose logs --tail=100 web           # nginx
$ docker compose logs -f backend               # live tail (Ctrl+C to stop)
$ docker compose logs --since 1h backend       # past hour
```

### System logs (anything outside the containers)

`journald` is the unified log service:

```bash
$ sudo journalctl -xe                    # last entries, formatted
$ sudo journalctl --since "1 hour ago"   # past hour
$ sudo journalctl --since today          # since midnight
$ sudo journalctl -u docker.service      # specific service
$ sudo journalctl -u sshd                # SSH
$ sudo journalctl -u gnome-remote-desktop  # RDP server
$ sudo journalctl -k                     # kernel only
$ sudo journalctl -f                     # live tail
```

In Cockpit, **Logs** in the left nav gives a search-and-filter UI.

---

## 5. Updating the operating system

```bash
$ sudo subscription-manager status        # registered?
$ sudo dnf check-update                   # list available updates
$ sudo dnf upgrade                        # apply (asks y/n)
$ sudo dnf upgrade -y                     # without prompt
```

After installing updates, check if a reboot is needed:

```bash
$ sudo dnf needs-restarting -r            # exits 1 if reboot recommended
```

If needed:
```bash
$ sudo systemctl reboot
```

### Recommended update cadence

| Cadence | Action |
|---|---|
| **Weekly** | `sudo dnf check-update` |
| **Monthly** | `sudo dnf upgrade --security` |
| **Quarterly** | Full `sudo dnf upgrade` + reboot |

⚠️ Never run `dnf upgrade` mid-workday.

---

## 6. Backups (current — SQLite era)

### What needs backing up

| Importance | Path | Why |
|---|---|---|
| 🔴 Critical | `/srv/intranet/data/` | Live SQLite databases |
| 🔴 Critical | `/srv/intranet/uploads/` | Uploaded files |
| 🟡 Important | `/srv/intranet/.env` | `SESSION_SECRET` |
| 🟢 Nice | `/srv/intranet/app/`, `/srv/intranet/frontend/` | Source (also in git) |

### Manual backup recipe

```bash
$ DATE=$(date +%Y%m%d-%H%M%S)

# Safe SQLite snapshot (uses SQLite's online backup API)
$ docker compose exec backend sh -c \
    "apk add --no-cache sqlite >/dev/null 2>&1; \
     sqlite3 /data/intranet.db \".backup '/data/intranet-snapshot.db'\""

$ sudo tar -czf /home/<user>/intranet-backup-$DATE.tar.gz \
      -C /srv intranet/data intranet/uploads intranet/.env

$ sudo rm /srv/intranet/data/intranet-snapshot.db
```

Then copy off the VM:

```bash
# From your Mac:
$ scp <user>@<tailscale-ip>:/home/<user>/intranet-backup-*.tar.gz \
      ~/Backups/
```

### Automated backups (recommended)

Save as `/usr/local/bin/intranet-backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR=/var/backups/intranet
DATE=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

# Online SQLite snapshot
docker compose -f /srv/intranet/docker-compose.yml exec -T backend sh -c \
  "sqlite3 /data/intranet.db \".backup '/data/intranet-snapshot.db'\""

tar -czf "$BACKUP_DIR/intranet-$DATE.tar.gz" \
    -C /srv intranet/data/intranet-snapshot.db intranet/uploads intranet/.env

rm /srv/intranet/data/intranet-snapshot.db

# Keep only the last 14 backups
ls -1t "$BACKUP_DIR"/intranet-*.tar.gz | tail -n +15 | xargs -r rm --
```

Schedule via cron:

```bash
$ sudo crontab -e
# Add:
0 2 * * * /usr/local/bin/intranet-backup.sh >> /var/log/intranet-backup.log 2>&1
```

⚠️ **Still copy them off the VM.** Sync to a NAS or cloud bucket weekly.

---

## 7. Disk space management

```bash
$ df -h /
$ sudo du -sh /var/* 2>/dev/null | sort -h         # biggest /var/ subdirs
$ docker system df                                 # Docker footprint
$ sudo journalctl --disk-usage                     # log size
```

Cleanup commands:

```bash
$ docker system prune -a                           # ⚠️ removes unused images
$ docker container prune                           # stopped containers
$ sudo journalctl --vacuum-time=14d                # trim journald
$ sudo dnf clean all                               # dnf cache
```

---

## 8. Managing users

```bash
$ sudo useradd -m -G wheel,docker alice            # creates home, gives sudo+docker
$ sudo passwd alice
$ sudo passwd -e alice                             # force password change on login
$ sudo userdel -r alice                            # -r removes home
```

⚠️ **Application users** (admin accounts inside the intranet) are different
— managed through the website's admin panel at `/admin/`, not via Linux.

---

## 9. Changing the intranet admin password (current — SQLite)

```bash
# 1. Generate a new bcrypt hash inside the backend container
$ docker compose exec backend node -e \
  "console.log(require('bcryptjs').hashSync('NewPass123!', 10))"
# Copy the resulting $2a$10$... string

# 2. Update the user row in SQLite
$ docker compose exec backend sh -c \
    "sqlite3 /data/intranet.db \
       \"UPDATE users SET password_hash='<paste-hash-here>' WHERE username='admin';\""
```

---

## 10. Routine maintenance schedule

```
   DAILY    (5 min, automated)
   +- Backup script at 02:00
   +- (Optional) cron health-check on /api/health

   WEEKLY   (10 min, manual)
   +- docker compose ps                  -> containers all Up
   +- df -h /                            -> disk under 80%
   +- sudo journalctl -p err --since=7d  -> any errors?
   +- Tailscale admin console            -> expected devices online

   MONTHLY  (30 min, manual, maintenance window)
   +- sudo dnf upgrade --security
   +- Review backup integrity (extract one, spot-check)

   QUARTERLY (1 hour, maintenance window)
   +- Full sudo dnf upgrade + reboot
   +- Restart all containers from cold
   +- Verify backups by TEST RESTORE
   +- Review user list, deactivate inactive accounts
```

## 11. When in doubt

Three commands that have saved many sessions:

```bash
$ docker compose restart       # nudge the app
$ sudo systemctl reboot                            # nudge the OS
$ sudo journalctl -xe                              # what just broke?
```

If those don't help, see [`07-troubleshooting.md`](07-troubleshooting.md).

---

## 🔄 Production migration

When the system moves to Huntsville Hospital, several maintenance procedures
change. The flowchart of "restart layers" stays the same; what changes is
**how the database is backed up and inspected**, and that the **RDP layer
is removed**.

### Backups change from SQLite to PostgreSQL

| Today | Target |
|---|---|
| `sqlite3 .backup` against a file in `data/` | `sudo -u postgres pg_dump -Fc intranet_hci` |
| Tar bundles the `.db` file | Tar bundles the `.dump` file |
| Restore: copy the file back | Restore: `pg_restore` into a fresh database |

Sample target backup script:

```bash
#!/usr/bin/env bash
set -euo pipefail
DATE=$(date +%Y%m%d-%H%M%S)
sudo -u postgres pg_dump -Fc intranet_hci > /var/backups/intranet/intranet-db-$DATE.dump
tar -czf /var/backups/intranet/intranet-uploads-$DATE.tar.gz -C /srv intranet/uploads
```

### Admin password reset (target) uses psql instead of sqlite3

```bash
$ docker compose exec backend node -e \
  "console.log(require('bcryptjs').hashSync('NewPass123!', 10))"
$ sudo -u postgres psql intranet_hci -c \
    "UPDATE \"User\" SET password_hash='<paste-hash-here>' WHERE username='admin';"
```

### Update cadence becomes change-management driven

The hospital change-management process replaces the casual "monthly /
quarterly" cadence. Each update window is documented in advance with a
roll-back plan and a maintenance-window announcement.

### Removed in production

- `gnome-remote-desktop` and GDM are uninstalled in production. RDP is
  no longer a maintenance path.
- Tailscale is uninstalled. Remote access is over the corporate network
  only.

### Added in production

- **TLS certificate renewal** every 12 months. Coordinate with hospital
  PKI 30 days before expiry. Cert files at `/etc/nginx/tls/`.
- **PostgreSQL vacuum / analyze** weekly (cron):
  `sudo -u postgres vacuumdb --all --analyze`
- **DBA-driven schema migrations** via Prisma, applied automatically
  on backend restart (`prisma migrate deploy`).
