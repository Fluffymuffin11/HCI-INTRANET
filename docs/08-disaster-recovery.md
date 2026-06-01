# 08 — Disaster Recovery

This document covers **what to do when something is broken badly enough that
routine maintenance can't fix it.** The procedures here describe recovery
for the current SQLite-based homelab deployment; the production migration
callout at the end describes the equivalent Postgres-based procedures.

## Recovery scenarios (current)

```
   Scenario                              First step
   ----------------------------------    ----------------------------------
   SQLite DB corrupted                   Restore intranet.db from backup
   Files deleted from /uploads/          Restore uploads from backup
   /srv/intranet/ wiped entirely         Full application restore
   Whole VM unbootable                   Boot from Proxmox snapshot
   Proxmox host fails                    Restore VM image to new host
```

## Scenario 1 — SQLite database is corrupted

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
$ ls -lh /var/backups/intranet/intranet-*.tar.gz

# 4. Extract just the database snapshot from the backup
$ sudo tar -xzf /var/backups/intranet/intranet-YYYYMMDD-HHMMSS.tar.gz \
    -C /tmp intranet/data/intranet-snapshot.db
$ sudo cp /tmp/intranet/data/intranet-snapshot.db /srv/intranet/data/intranet.db
$ sudo chown <user>:<user> /srv/intranet/data/intranet.db

# 5. Restart and verify
$ docker compose start backend
$ docker compose logs -f backend
$ curl http://localhost:8080/api/health
```

⚠️ Restoring the DB rolls back to the backup time. Posts, signups, and
nominations made after the backup are **lost**. Communicate to users.

## Scenario 2 — Uploads directory missing or wiped

```bash
$ docker compose stop backend                          # avoid mid-write

# Extract uploads from the backup
$ sudo tar -xzf /var/backups/intranet/intranet-LATEST.tar.gz \
    -C / srv/intranet/uploads

# Verify
$ ls /srv/intranet/uploads/ | head
$ docker compose start backend
```

If only some files are missing, extract to a temp dir and copy in only
what you need:

```bash
$ mkdir /tmp/restore
$ sudo tar -xzf /var/backups/intranet/intranet-LATEST.tar.gz -C /tmp/restore
$ sudo cp /tmp/restore/srv/intranet/uploads/<file> /srv/intranet/uploads/
$ sudo rm -rf /tmp/restore
```

## Scenario 3 — Whole `/srv/intranet/` is gone

```bash
# 1. Reinstall the directory layout from backup
$ sudo mkdir -p /srv/intranet
$ sudo tar -xzf /home/<user>/intranet-full-backup.tar.gz -C /srv

# 2. If your backups only include data/ and uploads/, re-pull source
#    code from the internal git repo.

# 3. Make sure .env is present
$ ls -la /srv/intranet/.env
# If missing, generate a NEW session secret (logs everyone out):
$ openssl rand -hex 48 | sudo tee /srv/intranet/.env
$ sudo vi /srv/intranet/.env
# File should contain one line:  SESSION_SECRET=<the-hex-string>

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

This is where **Proxmox snapshots** save you. If snapshots exist:

1. Open the Proxmox web UI
2. Select VM **101** → **Snapshots** tab
3. Pick the most recent good snapshot → **Rollback**
4. The VM reverts

⚠️ Rolling back discards everything after the snapshot, including database
rows and uploaded files. **Combine with a recent backup restore.**

### If no snapshots exist

If the VM disk is intact but the OS won't boot:

1. From Proxmox, **boot a rescue ISO** (RHEL boot media → "Rescue installed system")
2. It mounts your existing root at `/mnt/sysimage`
3. `chroot /mnt/sysimage`
4. Diagnose: `journalctl -xb`, `dnf history`, check `/etc/fstab`
5. `exit`, reboot

## Scenario 5 — Total Proxmox host loss

| Off-site asset | Restore path |
|---|---|
| Tar backups on a NAS | Stand up a new VM, run Scenario 3 |
| Proxmox vzdump of the whole VM | Restore `.vma` to a new Proxmox host |
| Only the SQLite + uploads | Build fresh RHEL VM, install Docker, place files, deploy |
| Nothing | Rebuild from scratch using this documentation as the guide |

The lesson: **always have at least the data backups stored off the
hypervisor.**

## Recovery time objectives (informational)

| Scenario | Estimated downtime |
|---|---|
| Database corruption only | 5–10 minutes |
| Uploads only | 10–30 minutes (depends on size) |
| `/srv/intranet/` wiped | 30–60 minutes |
| VM unbootable, snapshot available | 5–15 minutes |
| VM unbootable, no snapshot | 1–3 hours |
| Total hypervisor loss | 4–8 hours |

## Testing your recovery procedure

⚠️ **A backup you have never restored is not a backup.** Test quarterly:

```bash
# 1. Scratch directory
$ mkdir /tmp/restore-test

# 2. Extract latest backup
$ sudo tar -xzf /var/backups/intranet/intranet-LATEST.tar.gz -C /tmp/restore-test

# 3. Check the database is readable
$ sudo sqlite3 /tmp/restore-test/srv/intranet/data/intranet-snapshot.db \
    "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM posts;"

# 4. Spot-check uploads
$ ls /tmp/restore-test/srv/intranet/uploads/ | head
$ file /tmp/restore-test/srv/intranet/uploads/* | head

# 5. Clean up
$ sudo rm -rf /tmp/restore-test
```

If any step fails, your backups are not viable.

---

## 🔄 Production migration

Every scenario above translates to a Postgres equivalent in production:

### Scenario 1 (database) — Postgres version

```bash
$ docker compose stop backend

# Take a forensic dump of the broken state
$ sudo -u postgres pg_dump -Fc intranet_hci > \
    /var/backups/intranet/intranet-BROKEN-$(date +%Y%m%d-%H%M%S).dump

# Drop and recreate
$ sudo -u postgres psql -c "DROP DATABASE intranet_hci;"
$ sudo -u postgres psql -c "CREATE DATABASE intranet_hci OWNER intranet_app;"
$ sudo -u postgres pg_restore --no-owner --role=intranet_app \
    -d intranet_hci /var/backups/intranet/intranet-db-LATEST.dump

$ docker compose start backend
```

### Scenario 4 (boot) — vSphere version

In production, snapshots are taken in the vSphere Client:
1. Right-click VM `Intranet-HCI` → Snapshots → Manage Snapshots
2. Select a snapshot → **Revert**

OVA exports replace `vzdump` for migrating to another hypervisor.

### New scenario in production: Postgres data dir corrupted

If `/var/lib/pgsql/data` is corrupted but the VM otherwise boots:

```bash
$ sudo systemctl stop postgresql
$ sudo mv /var/lib/pgsql/data /var/lib/pgsql/data.broken-$(date +%Y%m%d)
$ sudo /usr/bin/postgresql-setup --initdb
# Re-configure postgresql.conf and pg_hba.conf from configuration backup
$ sudo systemctl start postgresql
$ sudo -u postgres psql -c "CREATE DATABASE intranet_hci OWNER intranet_app;"
$ sudo -u postgres pg_restore --no-owner --role=intranet_app \
    -d intranet_hci /var/backups/intranet/intranet-db-LATEST.dump
$ cd /srv/intranet && docker compose restart backend
```

### Updated recovery time objectives (target)

| Scenario | Estimated downtime |
|---|---|
| Database corruption only | 10–20 minutes |
| Postgres data dir corrupted | 20–45 minutes |
| Uploads only | 10–30 minutes |
| `/srv/intranet/` wiped | 30–60 minutes |
| VM unbootable, snapshot available | 5–15 minutes |
| VM unbootable, no snapshot | 1–3 hours |
| Total vSphere host loss | 4–8 hours |

## Building a runbook for your specific environment

Once a year, write a one-page "if I had to do this from scratch today" doc:

- Where do the backups live? (Path, hostname, credentials)
- Who is the Proxmox / vSphere admin contact?
- Who owns the Tailscale tailnet (homelab) or hospital corp network (production)?
- Where is the Red Hat subscription tied to?
- Who else knows? Designate a backup operator.

Store this off-site. Print a copy. The day you need it, you may not have
internet access.
