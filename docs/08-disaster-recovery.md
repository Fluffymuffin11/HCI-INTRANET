# 08 — Disaster Recovery

This document covers **what to do when something is broken badly enough that
routine maintenance can't fix it.** The procedures here assume you have
backups (see [`06-maintenance.md`](06-maintenance.md) → *Backups*).

## Recovery scenarios

```
   Scenario                              First step
   ----------------------------------    ----------------------------------
   Database corruption                   Restore database from pg_dump
   Files deleted from /uploads/          Restore uploads from backup
   /srv/intranet/ wiped entirely         Full application restore
   Whole VM unbootable                   Roll back from vSphere snapshot
   Hardware failure on vSphere host      Restore VM image to another host
```

## Scenario 1 — Database is corrupted

**Symptom:** Backend keeps crashing with PostgreSQL errors, or a query like
`psql -d intranet_hci -c "\dt"` returns connection or relation errors that
shouldn't be possible.

**Recovery steps:**

```bash
# 1. Stop the backend so it stops writing
$ cd /srv/intranet
$ docker compose stop backend

# 2. Confirm PostgreSQL itself is still running on the host
$ sudo systemctl status postgresql

# 3. Take a snapshot of the bad state for forensics (do not skip)
$ sudo -u postgres pg_dump -Fc intranet_hci > \
    /var/backups/intranet/intranet-BROKEN-$(date +%Y%m%d-%H%M%S).dump

# 4. Find your latest good backup
$ ls -lh /var/backups/intranet/intranet-*.dump

# 5. Drop the corrupted database and restore from backup
$ sudo -u postgres psql -c "DROP DATABASE intranet_hci;"
$ sudo -u postgres psql -c "CREATE DATABASE intranet_hci OWNER intranet_app;"
$ sudo -u postgres pg_restore --no-owner --role=intranet_app \
    -d intranet_hci /var/backups/intranet/intranet-YYYYMMDD-HHMMSS.dump

# 6. Restart and verify
$ docker compose start backend
$ docker compose logs -f backend           # watch for errors
$ curl -sk https://Intranet-HCI.heart.local/api/health
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
$ sudo tar -xzf /var/backups/intranet/intranet-uploads-LATEST.tar.gz \
    -C /srv/intranet/uploads                           # restores in place

# Verify
$ ls /srv/intranet/uploads/ | head
$ docker compose start backend
```

If only **some** files are missing (a user deleted a folder), extract the
backup to a temp directory and copy in only what you need:

```bash
$ mkdir /tmp/restore
$ sudo tar -xzf /var/backups/intranet/intranet-uploads-LATEST.tar.gz -C /tmp/restore
$ ls /tmp/restore/
$ sudo cp /tmp/restore/<file> /srv/intranet/uploads/
$ sudo rm -rf /tmp/restore
```

## Scenario 3 — Whole `/srv/intranet/` is gone

**Symptom:** Application files deleted, project directory empty, or
ransomware-like situation.

**Recovery:**

```bash
# 1. Re-clone source code from the internal git repository
$ sudo mkdir -p /srv/intranet
$ sudo chown <ops-user>:<ops-user> /srv/intranet
$ cd /srv
$ git clone https://<internal-git>/heart-center/intranet.git

# 2. Restore uploads from backup
$ sudo tar -xzf /var/backups/intranet/intranet-uploads-LATEST.tar.gz \
    -C /srv/intranet/uploads

# 3. Re-create the .env file
$ openssl rand -hex 48                                # generate SESSION_SECRET
$ sudo nano /srv/intranet/.env
# Paste these lines, filling in real values:
#   SESSION_SECRET=<hex from openssl>
#   DATABASE_URL=postgresql://intranet_app:<pw>@host.docker.internal:5432/intranet_hci
#   INITIAL_ADMIN_PASSWORD=<set if seeding fresh>

# 4. The database is intact (it lives in /var/lib/pgsql/data and is
#    not affected when /srv/intranet/ is wiped). If it is also gone,
#    follow Scenario 1 first.

# 5. Build the frontend
$ cd /srv/intranet/frontend
$ npm install
$ npm run build

# 6. Bring the containers back up
$ cd /srv/intranet
$ docker compose up -d
$ docker compose logs -f
```

## Scenario 4 — PostgreSQL data directory is corrupted

**Symptom:** `systemctl status postgresql` shows the service failed to start
with errors about WAL files, missing tablespaces, or page checksum failures.

**Recovery:**

```bash
# 1. Stop PostgreSQL
$ sudo systemctl stop postgresql

# 2. Preserve the broken data dir for forensics
$ sudo mv /var/lib/pgsql/data /var/lib/pgsql/data.broken-$(date +%Y%m%d)

# 3. Initialize a fresh data dir
$ sudo /usr/bin/postgresql-setup --initdb

# 4. Restore the configs from your config backup or re-run the steps in
#    04-deployment.md to recreate postgresql.conf, pg_hba.conf, users.
$ sudo systemctl start postgresql

# 5. Recreate database and restore from pg_dump
$ sudo -u postgres psql -c "CREATE DATABASE intranet_hci OWNER intranet_app;"
$ sudo -u postgres pg_restore --no-owner --role=intranet_app \
    -d intranet_hci /var/backups/intranet/intranet-LATEST.dump

# 6. Restart the backend
$ cd /srv/intranet && docker compose restart backend
```

## Scenario 5 — VM won't boot

**Symptom:** VM hangs at boot, kernel panic, root filesystem unmountable.

This is where **vSphere snapshots** save you. If snapshots were taken before
the trouble started:

1. Open the vSphere Client (vCenter)
2. Locate VM `Intranet-HCI` in the inventory
3. Right-click → Snapshots → Manage Snapshots
4. Select the most recent good snapshot → **Revert**
5. The VM reverts to that point in time

⚠️ Reverting to a snapshot discards everything that happened after it,
including database rows and uploaded files. **Combine with a recent
backup restore** (Scenarios 1 and 2) to get back the latest data.

### If no snapshots exist

If the VM disk is intact but the OS won't boot:

1. From vSphere, attach the RHEL boot ISO to the VM
2. Power-cycle the VM and boot to "Rescue installed system"
3. The installer mounts your existing root at `/mnt/sysimage`
4. `chroot /mnt/sysimage`
5. Diagnose: `journalctl -xb` for the last boot, `dnf history` for recent
   package operations, check `/etc/fstab` for mount typos
6. `exit`, detach the ISO, reboot

## Scenario 6 — Total hypervisor loss

**Symptom:** The vSphere host (or the whole cluster) is gone — fire, theft,
storage failure beyond recovery.

This is the worst case. Recovery depends on what you have off-site:

| Off-site asset | Restore path |
|---|---|
| Tar/PGDump backups (recent) on a NAS | Provision a new RHEL VM, run through `04-deployment.md`, restore data (Scenarios 1, 2) |
| vSphere snapshot exported as OVA | Import the OVA into another vSphere cluster |
| Only the pg_dump + uploads tar | Build a fresh RHEL VM, install Docker + PostgreSQL, restore |
| Nothing | Rebuild from scratch using this documentation as the guide |

The lesson: **always have at least the PostgreSQL dumps and uploads tar
stored off the vSphere cluster.** Hospital backup policy should already
cover this; verify with the backup administrator.

## Recovery time objectives (informational)

These are **estimates** for an experienced operator with backups available:

| Scenario | Estimated downtime |
|---|---|
| Database corruption only | 10–20 minutes |
| Uploads only | 10–30 minutes (depends on size) |
| `/srv/intranet/` wiped | 30–60 minutes |
| Postgres data dir corrupted | 20–45 minutes |
| VM unbootable, snapshot available | 5–15 minutes |
| VM unbootable, no snapshot | 1–3 hours |
| Total hypervisor loss, full rebuild | 4–8 hours |

## Testing your recovery procedure

⚠️ **A backup you have never restored is not a backup.** Test once a
quarter:

```bash
# 1. Create a scratch database
$ sudo -u postgres psql -c "CREATE DATABASE intranet_hci_test;"

# 2. Restore your latest pg_dump into it
$ sudo -u postgres pg_restore --no-owner --role=intranet_app \
    -d intranet_hci_test /var/backups/intranet/intranet-LATEST.dump

# 3. Sanity-check row counts
$ sudo -u postgres psql -d intranet_hci_test -c \
    "SELECT 'users', COUNT(*) FROM users
     UNION ALL
     SELECT 'posts', COUNT(*) FROM posts;"

# 4. Drop the test database
$ sudo -u postgres psql -c "DROP DATABASE intranet_hci_test;"

# 5. Spot-check uploads tarball
$ tar -tzf /var/backups/intranet/intranet-uploads-LATEST.tar.gz | head
```

If any step fails, **your backups are not viable** and you need to fix the
backup procedure before something real breaks.

## Building a runbook for your specific environment

Once a year, sit down and write a one-page "if I had to do this from scratch
today" document:

- Where do the backups live? (Path, hostname, credentials)
- Who is the responsible IT-Operations point of contact?
- Where is the vSphere / vCenter login? (URL, credentials in the password manager)
- Where is the Red Hat subscription tied to? (Account, contact email)
- Who is the database administrator on call?
- Who else knows? (Designate a backup operator)

Store this off-site too. Print a copy. The day you need it, you will not
have internet access.
