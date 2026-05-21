# 07 — Troubleshooting

This is a **playbook of known problems and their fixes**. When something is
broken, find the matching symptom and follow the steps.

## How to use this document

```
   1. Identify the layer that's broken:
      • Can you SSH in?                            → OS is up
      • Does the website respond at all?           → nginx is up
      • Does /api/health work?                     → backend is up
      • Do API calls return data?                  → database is reachable

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
- [SSH refuses connection](#ssh-refuses-connection)
- [Disk is full](#disk-is-full)
- [Containers keep restarting](#containers-keep-restarting)
- [The database is locked](#the-database-is-locked)
- [I forgot the admin password](#i-forgot-the-admin-password)
- [Tailscale is offline](#tailscale-is-offline)
- [SELinux is blocking something](#selinux-is-blocking-something)
- [GPG check failed during dnf upgrade](#gpg-check-failed-during-dnf-upgrade)

---

## Website is completely down

**Symptom:** Browser cannot reach `http://<LAN_IP>:8080/`. Connection
refused, or times out.

**Triage:**
```bash
$ ssh bryant@<TAILSCALE_IP>         # can you log in?
$ ping <LAN_IP>                # is the VM on the network?
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
2. **Backend in restart loop** — `docker compose logs --tail=200 backend` reveals
   why. Usually `SESSION_SECRET` missing or a syntax error in `server.js`.
3. **nginx misconfig** — `docker compose logs --tail=50 web` shows nginx errors.
   Look for "host not found in upstream" → means backend died.
4. **Firewall blocking port 8080** — `sudo firewall-cmd --list-all` should show
   `ports: 3389/tcp 8080/tcp …`. Re-add if missing:
   ```bash
   $ sudo firewall-cmd --permanent --add-port=8080/tcp
   $ sudo firewall-cmd --reload
   ```
5. **Disk full** — `df -h /`. If above 95%, see [Disk is full](#disk-is-full).

---

## Website loads but shows error / blank page

**Symptom:** Browser reaches the site but shows a blank screen, JavaScript error,
or HTTP 502 / 504 from nginx.

**Triage:**
```bash
$ curl -i http://localhost:8080/api/health     # backend alive?
$ docker compose logs --tail=100 backend
```

**HTTP 502 Bad Gateway:** nginx can reach the backend container but the
backend isn't responding. Restart it:
```bash
$ docker compose restart backend
$ docker compose logs -f backend
```

**HTTP 504 Gateway Timeout:** backend is slow. Check load:
```bash
$ top                                # is something pegged at 100% CPU?
$ docker stats                       # container-level CPU/memory
```

**Blank page in browser:** the React build is stale or broken. Rebuild:
```bash
$ cd /srv/intranet/frontend
$ npm run build
```

---

## API calls return 401 / "Not logged in"

**Symptom:** You can see the site, but most API calls return 401.

**Cause:** Your session cookie expired or the `SESSION_SECRET` changed.

**Fix:** Log out and back in. If that fails for everyone, check that the
backend started with the secret:
```bash
$ docker compose logs backend | grep -i secret
# Should NOT see "FATAL: SESSION_SECRET environment variable is not set"
```

If the backend can't read `.env`:
```bash
$ ls -l /srv/intranet/.env
$ cat /srv/intranet/.env       # confirm a value exists
```

---

## Login keeps failing

**Symptom:** correct username/password but login fails.

**Possible causes:**

1. **Rate limited.** After 20 failed attempts in 15 minutes, the IP is blocked.
   Wait or restart the backend:
   ```bash
   $ docker compose restart backend
   ```

2. **Wrong password (it happens).** Reset it — see [I forgot the admin password](#i-forgot-the-admin-password).

3. **Backend can't write to sessions.db.** Check disk space and permissions:
   ```bash
   $ df -h /srv
   $ ls -la /srv/intranet/data/
   ```

---

## Uploaded files don't appear

**Symptom:** files upload "successfully" but 404 when opened.

**Triage:**
```bash
$ ls -la /srv/intranet/uploads/                    # is the file there?
$ docker compose exec backend ls -la /uploads/     # visible inside container?
$ curl -I http://localhost:8080/files/<filename>   # nginx → backend → static
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

**If credentials are empty in `grdctl status`:**
```bash
$ sudo grdctl --system rdp set-credentials bryant '<password>'
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

**Symptom:** Microsoft's "Windows App" on Mac shows error `0x207` and disconnects
immediately.

**Cause:** Headless gnome-remote-desktop uses **RDP server redirection**, which
Microsoft's Windows App on macOS does not honor.

**Fix:** Use a different client. Royal TSX (free) handles redirection correctly.
See [`05-remote-access.md`](05-remote-access.md) → *Recommended client*.

---

## SSH refuses connection

**Symptom:** `ssh: connect to host … port 22: Connection refused`

**Most likely:** sshd is not running.

From the Proxmox console (or any working remote path):
```bash
$ sudo systemctl status sshd
$ sudo systemctl start sshd
$ sudo systemctl enable sshd
```

**If you only have an SSH problem from outside the LAN:**

- Check Tailscale: `sudo systemctl status tailscaled`
- Check firewall: `sudo firewall-cmd --list-ports` should include `22/tcp` (or
  via `services: ssh`)

---

## Disk is full

**Symptom:** Random operations fail with "No space left on device." `df -h /`
shows above 95% used.

**Quick relief (in order, run as you go):**

```bash
# 1. Old Docker images and build cache
$ docker system prune -a -f

# 2. journald logs over 14 days
$ sudo journalctl --vacuum-time=14d

# 3. DNF cache
$ sudo dnf clean all

# 4. Anything weird in /tmp
$ sudo du -sh /tmp/*
$ sudo rm -rf /tmp/<stale-thing>

# 5. The 48 MB backup tarball at /srv/intranet/intranet-backup.tar.gz
$ ls -lh /srv/intranet/intranet-backup.tar.gz
# Move it to your home or delete:
$ mv /srv/intranet/intranet-backup.tar.gz /home/bryant/
```

If you cannot find what filled the disk, this command lists the biggest
directories anywhere:

```bash
$ sudo du -h --max-depth=2 / 2>/dev/null | sort -rh | head -30
```

**If `/srv/intranet/uploads/` is the problem:** users have uploaded too much.
Decide what to prune (an admin can delete posts/resources through the website).
Do not delete files from `/srv/intranet/uploads/` directly — the database
references them by filename.

---

## Containers keep restarting

**Symptom:** `docker compose ps` shows `Restarting` or repeatedly cycling
between `Up` and `Restarting`.

**Triage:**
```bash
$ docker compose logs --tail=200 <service>
```

Look for the very first error after each restart. Most likely:

- **Backend:** `SESSION_SECRET` missing or `intranet.db` corrupted
- **Backend:** a recent code change has a syntax error
- **nginx:** `host not found in upstream "backend"` → backend isn't running
- **nginx:** typo in `/srv/intranet/nginx/default.conf` → test with
  `docker compose exec web nginx -t`

---

## The database is locked

**Symptom:** Backend logs show `SQLITE_BUSY: database is locked`.

**Cause:** Something else has the database open (often a manual `sqlite3`
session left open in a forgotten terminal).

**Fix:**
```bash
$ docker compose exec backend sh
/app # ps -ef | grep sqlite
# kill any stray sqlite3 processes
/app # exit
$ docker compose restart backend
```

If the lock persists across restart, the SQLite **WAL journal** may be
corrupted. Restore from the most recent backup (see
[`08-disaster-recovery.md`](08-disaster-recovery.md)).

---

## I forgot the admin password

**The Linux admin password** (the `bryant` account):

1. From the Proxmox noVNC console (you'll need physical or hypervisor access),
   reboot the VM
2. At the GRUB menu, press `e` to edit the boot entry
3. Find the line starting with `linux …`, add `rd.break enforcing=0` to the end
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
See [`06-maintenance.md`](06-maintenance.md) → *Changing the intranet admin password*.

---

## Tailscale is offline

**Symptom:** The VM doesn't appear in the Tailscale admin console, or
`tailscale status` shows nothing.

**Fix:**
```bash
$ sudo systemctl restart tailscaled
$ sudo tailscale status                    # shows current state
$ sudo tailscale up                        # re-authenticates if needed
                                           # will print a login URL — open it
                                           # in a browser, log in as the
                                           # tailnet owner
```

If `tailscale up` fails with "logged out":
```bash
$ sudo tailscale up --auth-key=tskey-xxxxx
```
(generate the auth key in the Tailscale admin console → Settings → Keys)

---

## SELinux is blocking something

**Symptom:** A service "should work" but doesn't, and `journalctl` mentions
"AVC denied" or `setroubleshoot`.

**Check:**
```bash
$ getenforce                                 # current mode (Enforcing/Permissive)
$ sudo ausearch -m AVC --start recent        # recent denials
```

**Quick test:** temporarily set to permissive to confirm it's SELinux:
```bash
$ sudo setenforce 0                          # permissive — NOT persistent
# test the failing operation
$ sudo setenforce 1                          # back to enforcing
```

If SELinux is the culprit, the **proper** fix is to label files correctly or
generate a custom policy with `audit2allow`. The lazy fix (don't use long-term)
is to set permissive mode in `/etc/selinux/config`.

⚠️ Disabling SELinux reduces your security posture. Treat it as a diagnostic
step, not a fix.

---

## GPG check failed during dnf upgrade

**Symptom:** `dnf upgrade` shows messages like:

```
GPG Keys are configured as: file:///etc/pki/rpm-gpg/RPM-GPG-KEY-redhat-release
The downloaded packages were saved in cache until the next successful transaction.
Error: GPG check FAILED
```

**Cause:** A repository pushed a package signed by a key the system doesn't
trust yet (often happens after enabling EPEL or third-party repos with newer
keys).

**Fix options:**

1. Refresh the keys:
   ```bash
   $ sudo dnf clean all
   $ sudo subscription-manager refresh
   $ sudo dnf upgrade
   ```

2. If a specific third-party repo (EPEL, etc.) is the culprit, disable it for
   the upgrade:
   ```bash
   $ sudo dnf upgrade --disablerepo=epel
   ```

3. As a last resort, install the new key:
   ```bash
   $ sudo rpm --import https://path/to/the/repo/KEY
   ```

---

## When all else fails

Step back and run the **golden three**:

```bash
$ cd /srv/intranet && docker compose down && docker compose up -d
$ sudo systemctl reboot
$ sudo journalctl -xe --since "10 minutes ago"
```

If the system still won't come up, restore from backup
([`08-disaster-recovery.md`](08-disaster-recovery.md)).
