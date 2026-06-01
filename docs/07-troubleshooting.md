# 07 — Troubleshooting

This is a **playbook of known problems and their fixes** for the current
homelab deployment. When something is broken, find the matching symptom and
follow the steps. Issues marked **(target)** apply to the production
PostgreSQL migration, not the current SQLite system.

## How to use this document

```
   1. Identify the layer that's broken:
      • Can you SSH in?                            -> OS is up
      • Does the website respond at all?           -> nginx is up
      • Does /api/health work?                     -> backend is up
      • Do API calls return data?                  -> database is reachable

   2. Look for matching symptom below

   3. Follow the playbook
```

## Symptom index

- [Website is completely down](#website-is-completely-down)
- [Website loads but shows error / blank page](#website-loads-but-shows-error--blank-page)
- [API calls return 401 / "Not logged in"](#api-calls-return-401--not-logged-in)
- [Login keeps failing](#login-keeps-failing)
- [Uploaded files don't appear](#uploaded-files-dont-appear)
- [RDP connection hangs at "connecting"](#rdp-connection-hangs-at-connecting)
- [RDP error 0x207 (Windows App)](#rdp-error-0x207-windows-app)
- [Tailscale is offline](#tailscale-is-offline)
- [SSH refuses connection](#ssh-refuses-connection)
- [Disk is full](#disk-is-full)
- [Containers keep restarting](#containers-keep-restarting)
- [The SQLite database is locked](#the-sqlite-database-is-locked)
- [I forgot the admin password](#i-forgot-the-admin-password)
- [SELinux is blocking something](#selinux-is-blocking-something)
- [GPG check failed during dnf upgrade](#gpg-check-failed-during-dnf-upgrade)

---

## Website is completely down

**Symptom:** Browser cannot reach `http://<vm-ip>:8080/`. Connection
refused, or times out.

**Triage:**
```bash
$ ssh <user>@<tailscale-ip>         # can you log in?
$ ping <lan-ip>                     # is the VM on the network?
```

If you cannot ping or SSH, the VM is down or off the network. Check Proxmox.

If you can SSH, continue:

```bash
$ cd /srv/intranet
$ docker compose ps                 # are containers Up?
$ sudo ss -tlnp | grep 8080         # is port 8080 listening?
$ curl -I http://localhost:8080/    # local probe
```

**Common causes and fixes:**

1. **Containers stopped** — `docker compose up -d`
2. **Backend in restart loop** — `docker compose logs --tail=200 backend`
   reveals why. Usually `SESSION_SECRET` missing or a syntax error in
   `server.js`.
3. **nginx misconfig** — `docker compose logs --tail=50 web` shows nginx
   errors. "Host not found in upstream" means backend died.
4. **Firewall blocking port 8080**:
   ```bash
   $ sudo firewall-cmd --permanent --add-port=8080/tcp
   $ sudo firewall-cmd --reload
   ```
5. **Disk full** — `df -h /`. See [Disk is full](#disk-is-full).

---

## Website loads but shows error / blank page

**Triage:**
```bash
$ curl -i http://localhost:8080/api/health     # backend alive?
$ docker compose logs --tail=100 backend
```

**HTTP 502 Bad Gateway:** nginx can reach the backend but the backend isn't
responding. Restart it:
```bash
$ docker compose restart backend
$ docker compose logs -f backend
```

**HTTP 504 Gateway Timeout:** backend is slow. Check load:
```bash
$ top                                # is something at 100% CPU?
$ docker stats                       # container-level CPU/memory
```

**Blank page:** the React build is stale. Rebuild:
```bash
$ cd /srv/intranet/frontend
$ npm run build
```

---

## API calls return 401 / "Not logged in"

**Cause:** Session cookie expired or `SESSION_SECRET` changed.

**Fix:** Log out and back in. If that fails for everyone, check the backend
started with the secret:
```bash
$ docker compose logs backend | grep -i secret
# Should NOT see "FATAL: SESSION_SECRET environment variable is not set"
```

---

## Login keeps failing

**Possible causes:**

1. **Rate limited.** 20 failed attempts in 15 minutes blocks the IP.
   Restart the backend to clear:
   ```bash
   $ docker compose restart backend
   ```

2. **Wrong password.** Reset — see [I forgot the admin password](#i-forgot-the-admin-password).

3. **Backend can't write to sessions.db.** Check disk and permissions:
   ```bash
   $ df -h /srv
   $ ls -la /srv/intranet/data/
   ```

---

## Uploaded files don't appear

**Triage:**
```bash
$ ls -la /srv/intranet/uploads/                    # is the file there?
$ docker compose exec backend ls -la /uploads/     # visible in container?
$ curl -I http://localhost:8080/files/<filename>
```

**Common cause:** the `/uploads` mount got disconnected after a Docker change.
Recreate containers:
```bash
$ cd /srv/intranet
$ docker compose down
$ docker compose up -d
```

---

## RDP connection hangs at "connecting"

**Symptom:** Royal TSX (or other client) shows "Connecting..." indefinitely.

**Triage:**
```bash
$ ss -tlnp | grep 3389                            # is it listening?
$ sudo systemctl status gnome-remote-desktop      # is the service up?
$ sudo journalctl -u gnome-remote-desktop -n 50   # recent logs
```

**Common fix:**
```bash
$ sudo systemctl restart gnome-remote-desktop
```

**If credentials are empty in `grdctl --system status`:**
```bash
$ sudo grdctl --system rdp set-credentials <user> '<password>'
$ sudo systemctl restart gnome-remote-desktop
```

**If the TLS cert/key are gone:**
```bash
$ sudo openssl req -new -x509 -days 3650 -nodes \
    -out /etc/gnome-remote-desktop/rdp-tls.crt \
    -keyout /etc/gnome-remote-desktop/rdp-tls.key \
    -subj "/CN=rhel-vm"
$ sudo grdctl --system rdp set-tls-cert /etc/gnome-remote-desktop/rdp-tls.crt
$ sudo grdctl --system rdp set-tls-key /etc/gnome-remote-desktop/rdp-tls.key
$ sudo systemctl restart gnome-remote-desktop
```

---

## RDP error 0x207 (Windows App)

**Symptom:** Microsoft's "Windows App" on Mac shows error `0x207` and
disconnects immediately.

**Cause:** Headless gnome-remote-desktop uses **RDP server redirection**,
which Microsoft's Windows App on macOS does not honor.

**Fix:** Use a different client. Royal TSX (free) handles redirection
correctly. See [`05-remote-access.md`](05-remote-access.md) →
*Recommended client*.

---

## Tailscale is offline

**Symptom:** The VM doesn't appear in the Tailscale admin console, or
`tailscale status` shows nothing.

**Fix:**
```bash
$ sudo systemctl restart tailscaled
$ sudo tailscale status                    # current state
$ sudo tailscale up                        # re-authenticate
                                           # will print a login URL
```

If `tailscale up` fails with "logged out":
```bash
$ sudo tailscale up --auth-key=tskey-xxxxx
```
(generate the auth key in the Tailscale admin console)

---

## SSH refuses connection

**Symptom:** `ssh: connect to host … port 22: Connection refused`

**Most likely:** sshd is not running. From the Proxmox console:
```bash
$ sudo systemctl status sshd
$ sudo systemctl start sshd
$ sudo systemctl enable sshd
```

**If the problem is Tailscale-only:**
- Check Tailscale: `sudo systemctl status tailscaled`
- Check firewall: `sudo firewall-cmd --list-ports` should include `22/tcp`
  via `services: ssh`

---

## Disk is full

**Symptom:** Random operations fail with "No space left on device."
`df -h /` shows above 95% used.

**Quick relief (in order):**

```bash
# 1. Old Docker images and build cache
$ docker system prune -a -f

# 2. journald logs over 14 days
$ sudo journalctl --vacuum-time=14d

# 3. DNF cache
$ sudo dnf clean all

# 4. Anything in /tmp
$ sudo du -sh /tmp/*
$ sudo rm -rf /tmp/<stale-thing>
```

Find the biggest directories anywhere:
```bash
$ sudo du -h --max-depth=2 / 2>/dev/null | sort -rh | head -30
```

---

## Containers keep restarting

**Symptom:** `docker compose ps` shows `Restarting` repeatedly.

**Triage:**
```bash
$ docker compose logs --tail=200 <service>
```

Look for the first error after each restart:

- **Backend:** `SESSION_SECRET` missing or `intranet.db` corrupted
- **Backend:** a recent code change has a syntax error
- **nginx:** `host not found in upstream "backend"` -> backend isn't running
- **nginx:** typo in `nginx/default.conf` -> test with
  `docker compose exec web nginx -t`

---

## The SQLite database is locked

**Symptom:** Backend logs show `SQLITE_BUSY: database is locked`.

**Cause:** Something else has the database open (often a manual `sqlite3`
session left in a forgotten terminal).

**Fix:**
```bash
$ docker compose exec backend sh
/app # ps -ef | grep sqlite
# kill any stray sqlite3 processes
/app # exit
$ docker compose restart backend
```

If the lock persists, the SQLite **WAL journal** may be corrupted. Restore
from the most recent backup (see [`08-disaster-recovery.md`](08-disaster-recovery.md)).

**(target)** In the PostgreSQL production deployment this symptom changes
to "P1001 / P2024 / pool exhaustion" errors. Diagnose with
`sudo systemctl status postgresql` and `pg_stat_activity` queries.

---

## I forgot the admin password

**The Linux admin password** (the local user account):

1. From the Proxmox noVNC console, reboot the VM
2. At the GRUB menu, press `e` to edit the boot entry
3. Find the line starting with `linux …`, add `rd.break enforcing=0`
4. Ctrl-X to boot
5. At the `switch_root:/#` prompt:
   ```
   mount -o remount,rw /sysroot
   chroot /sysroot
   passwd
   exit
   exit
   ```

**The application admin password** (the `admin` user in the website):
See [`06-maintenance.md`](06-maintenance.md) →
*Changing the intranet admin password*.

---

## SELinux is blocking something

**Symptom:** A service "should work" but doesn't, and `journalctl` mentions
"AVC denied".

**Check:**
```bash
$ getenforce                                 # current mode
$ sudo ausearch -m AVC --start recent        # recent denials
```

**Quick test:** temporarily set permissive to confirm SELinux is the cause:
```bash
$ sudo setenforce 0                          # permissive — NOT persistent
# test the failing operation
$ sudo setenforce 1                          # back to enforcing
```

The **proper** fix is labeling files correctly or generating a custom
policy with `audit2allow`.

---

## GPG check failed during dnf upgrade

**Cause:** A repository pushed a package signed by a key the system doesn't
trust yet.

**Fix options:**

1. Refresh keys:
   ```bash
   $ sudo dnf clean all
   $ sudo subscription-manager refresh
   $ sudo dnf upgrade
   ```

2. If a third-party repo is the culprit (e.g., EPEL):
   ```bash
   $ sudo dnf upgrade --disablerepo=epel
   ```

3. Install the new key:
   ```bash
   $ sudo rpm --import https://path/to/the/repo/KEY
   ```

---

## When all else fails

```bash
$ docker compose down && docker compose up -d
$ sudo systemctl reboot
$ sudo journalctl -xe --since "10 minutes ago"
```

If the system still won't come up, restore from backup
([`08-disaster-recovery.md`](08-disaster-recovery.md)).

---

## 🔄 Production migration

In production these specific symptoms change or disappear:

| Today's symptom | Production equivalent |
|---|---|
| RDP connection hangs | (removed — RDP not installed) |
| RDP error 0x207 | (removed) |
| Tailscale is offline | (removed — Tailscale not installed) |
| SQLite database locked | Replaced by: PostgreSQL pool exhaustion / P1001 / P2024 |
| `firewall-cmd --add-port=8080/tcp` | `firewall-cmd --add-port=443/tcp` (already open) |
| Login at `http://<ip>:8080` | Login at `https://Intranet-HCI.heart.local` |
| Restore SQLite by copying `.db` file | Restore via `pg_restore --no-owner -d intranet_hci` |

A separate playbook for PostgreSQL-specific issues (connection pool, WAL
size, autovacuum) will be added to v2.0 of this document once production
has been running long enough to surface real incidents.
