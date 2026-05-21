# 08 — Disaster Recovery

This document covers **what to do when something is broken badly enough that
routine maintenance can't fix it.** The procedures here assume you have
backups (see [`06-maintenance.md`](06-maintenance.md) → *Backups*).

## Recovery scenarios

```
   Scenario                              First step
   ────────────────────────────────────  ────────────────────────────────
   Data corruption (DB unreadable)       Restore database from backup
   Files deleted from /uploads/          Restore uploads from backup
   /srv/intranet/ wiped entirely         Full application restore
   Whole VM unbootable                   Boot from Proxmox snapshot
   Hardware failure on hypervisor        Restore VM image to new host
```

## Scenario 1 — Database is corrupted

**Symptom:** Backend keeps crashing with SQLite errors, or
`sqlite3 intranet.db ".tables"` returns "file is not a database."

**Recovery steps:**

```bash
# 1. Stop the backend so it stops writing
$ cd /srv/intranet
$ docker compose stop backend

# 2. Move the bad database aside (don't delete — useful for forensics)
$ sudo mv data/intranet.db data/intranet.db.broken-$(date +%Y%m%d)

# 3. Find your latest good backup
$ ls -lh /var/backups/intranet/                    # if using the automated script
# or
$ ls -lh /home/bryant/intranet-backup-*.tar.gz     # manual backups

# 4. Extract just the database
$ sudo tar -xzf /var/backups/intranet/intranet-YYYYMMDD-HHMMSS.tar.gz \
    -C /tmp intranet/data/intranet-snapshot.db
$ sudo cp /tmp/intranet/data/intranet-snapshot.db /srv/intranet/data/intranet.db
$ sudo chown bryant:bryant /srv/intranet/data/intranet.db

# 5. Restart and verify
$ docker compose start backend
$ docker compose logs -f backend           # watch for errors
$ curl http://localhost:8080/api/health    # confirm it's responding
```

⚠️ Restoring the DB rolls back to the backup time. Any posts, signups, or
nominations made after the backup are **lost**. Communicate to users.

## Scenario 2 — Uploads directory missing or wiped

**Symptom:** Images show as broken; `/srv/intranet/uploads/` is empty or
missing files.

**Recovery:**

```bash
$ docker compose stop backend                          # avoid mid-write

# Extract uploads from the backup
$ sudo tar -xzf /var/backups/intranet/intranet-LATEST.tar.gz \
    -C / srv/intranet/uploads                          # restores in place

# Verify
$ ls /srv/intranet/uploads/ | head
$ docker compose start backend
```

If only **some** files are missing (e.g., a user deleted a folder), extract
the backup to a temp directory and copy in only what you need:

```bash
$ mkdir /tmp/restore
$ sudo tar -xzf /var/backups/intranet/intranet-LATEST.tar.gz -C /tmp/restore
$ ls /tmp/restore/srv/intranet/uploads/
$ sudo cp /tmp/restore/srv/intranet/uploads/<file> /srv/intranet/uploads/
$ sudo rm -rf /tmp/restore
```

## Scenario 3 — Whole `/srv/intranet/` is gone

**Symptom:** Application files deleted, project directory empty, or
ransomware-like situation.

**Recovery:**

```bash
# 1. Reinstall the directory layout from backup
$ sudo mkdir -p /srv/intranet
$ sudo tar -xzf /home/bryant/intranet-full-backup.tar.gz -C /srv

# 2. If your backups only include data/ and uploads/, re-pull the source code
#    from git (if a repo exists), or re-run the original deployment scripts.

# 3. Make sure .env is present
$ ls -la /srv/intranet/.env
# If missing, generate a NEW session secret (this will log everyone out):
$ openssl rand -hex 48 | sudo tee /srv/intranet/.env
# Edit to add the SESSION_SECRET= prefix:
$ sudo vi /srv/intranet/.env
# File should contain a single line:  SESSION_SECRET=<the-hex-string>

# 4. Rebuild the frontend if dist/ is empty
$ cd /srv/intranet/frontend
$ npm install
$ npm run build

# 5. Bring it back up
$ cd /srv/intranet
$ docker compose up -d
$ docker compose logs -f
```

## Scenario 4 — VM won't boot

**Symptom:** VM hangs at boot, kernel panic, root filesystem unmountable.

This is where **Proxmox snapshots** save you. If snapshots were taken before
the trouble started:

1. Open the Proxmox web UI: `https://<LAN_HOST>:8006/`
2. Select VM **101 (RedHat)** → **Snapshots** tab
3. Pick the most recent good snapshot → **Rollback**
4. The VM reverts to that point in time

⚠️ Rolling back to a snapshot discards everything that happened after it,
including database changes and uploaded files. **Combine with a recent backup
restore** to get back the latest data.

### If no snapshots exist

If the VM disk is intact but the OS won't boot:

1. From Proxmox, **boot a rescue ISO** (RHEL boot media → "Rescue installed system")
2. It mounts your existing root at `/mnt/sysimage`
3. `chroot /mnt/sysimage`
4. Diagnose: `journalctl -xb` for the last boot, `dnf history` for recent
   package operations, check `/etc/fstab` for mount typos
5. `exit`, reboot

## Scenario 5 — Total hypervisor loss

**Symptom:** The Proxmox host itself is gone — fire, theft, drive failure.

This is the worst case. Recovery depends on what you have off-site:

| Off-site asset | Restore path |
|---|---|
| Tar backups (recent) on a NAS | Stand up a new VM, run Scenario 3 |
| Proxmox `vzdump` of the whole VM | Restore the .vma file to a new Proxmox host |
| Only the SQLite + uploads | Build a fresh RHEL VM, install Docker, place files, deploy |
| Nothing | Rebuild from scratch using this documentation as the guide |

The lesson: **always have at least the data backups stored off the hypervisor.**

## Recovery time objectives (informational)

These are **estimates** for an experienced operator with backups available:

| Scenario | Estimated downtime |
|---|---|
| Database corruption only | 5–10 minutes |
| Uploads only | 10–30 minutes (depends on size) |
| `/srv/intranet/` wiped | 30–60 minutes |
| VM unbootable, snapshot available | 5–15 minutes |
| VM unbootable, no snapshot | 1–3 hours |
| Total hypervisor loss, full rebuild | 4–8 hours |

## Testing your recovery procedure

⚠️ **A backup you have never restored is not a backup.** Test once a quarter:

```bash
# 1. Stand up a scratch directory
$ mkdir /tmp/restore-test

# 2. Extract your latest backup into it
$ sudo tar -xzf /var/backups/intranet/intranet-LATEST.tar.gz -C /tmp/restore-test

# 3. Check that the database is readable
$ sudo sqlite3 /tmp/restore-test/srv/intranet/data/intranet-snapshot.db \
    "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM posts;"

# 4. Spot-check uploads
$ ls /tmp/restore-test/srv/intranet/uploads/ | head
$ file /tmp/restore-test/srv/intranet/uploads/* | head      # confirm not corrupted

# 5. Clean up
$ sudo rm -rf /tmp/restore-test
```

If any step fails, **your backups are not viable** and you need to fix the
backup procedure before something real breaks.

## Building a runbook for your specific environment

Once a year, sit down and write a one-page "if I had to do this from scratch
today" document:

- Where do the backups live? (Path, hostname, credentials)
- Who is the Tailscale tailnet owner? (Email, recovery options)
- Where is the Proxmox login? (URL, credentials in your password manager)
- Where is the Red Hat subscription tied to? (Account, contact email)
- Who else knows? (Designate a backup operator)

Store this off-site too. Print a copy. The day you need it, you will not have
internet access.
