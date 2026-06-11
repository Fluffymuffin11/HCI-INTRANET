# Migrating the Intranet Dev Box → Office Computer

This kit rebuilds the intranet dev environment on a fresh **bare-metal RHEL 10**
machine, byte-for-byte at the application layer, and pulls the live data across
**Tailscale**.

The full system is small (≈11 GB OS, ~50 MB database), so this is fast.

## What gets recreated

| Layer        | Original box                          | New box (this kit)            |
|--------------|---------------------------------------|-------------------------------|
| OS           | RHEL 10.2                             | RHEL 10.2 (you install)       |
| Database     | PostgreSQL 17 (PGDG, on host)         | `1-bootstrap.sh` + `2-setup`  |
| Container rt | Docker CE 29 + Compose v5            | `1-bootstrap.sh`              |
| VPN          | Tailscale 1.98                        | `1-bootstrap.sh`              |
| App stack    | Fastify + React + nginx (Compose)     | `git clone` + `docker compose up` |
| Data         | `intranet_hci` DB + 3 roles           | `export.sh` → `3-import.sh`   |

---

## Step-by-step

### On the OFFICE box (fresh RHEL 10 install)

1. **Install RHEL 10.2** from the ISO. Register with your free Red Hat
   Developer subscription (`subscription-manager register`).

2. **Copy this `migrate/` folder over** (it ships in the repo, so the easiest
   path is to clone the repo once Tailscale is up — see step 4).

3. **Run the bootstrap** — installs all repos, Postgres 17, Docker, Tailscale:
   ```bash
   sudo ./1-bootstrap.sh
   ```

4. **Join Tailscale:**
   ```bash
   sudo tailscale up
   ```
   Now the new box can see the old one by its Tailscale name.

5. **Clone the app repo:**
   ```bash
   sudo git clone https://github.com/Fluffymuffin11/HCI-INTRANET.git /srv/intranet
   ```

6. **Prepare PostgreSQL:**
   ```bash
   cd /srv/intranet/migrate
   sudo ./2-setup-postgres.sh
   ```

### On the OLD box (current homelab)

7. **Export the data bundle:**
   ```bash
   cd /srv/intranet/migrate
   sudo ./export.sh
   tar czf intranet-data.tgz dump/
   ```

8. **Send it over Tailscale** (replace `<new-box>` with its Tailscale name):
   ```bash
   tailscale file cp intranet-data.tgz <new-box>:
   ```

### Back on the OFFICE box

9. **Receive + unpack the bundle:**
   ```bash
   cd /srv/intranet/migrate
   sudo tailscale file get .
   tar xzf intranet-data.tgz
   ```

10. **Import the database:**
    ```bash
    sudo ./3-import.sh
    ```

11. **Bring the stack up:**
    ```bash
    cd /srv/intranet
    # .env is git-ignored — copy it from the old box (it holds SESSION_SECRET +
    # DATABASE_URL). Carry it over Tailscale the same way as the data bundle.
    docker compose up -d
    ```

12. **Verify:** browse to `http://<new-box-ip>:8080` and log in.

---

## Don't forget `.env`

`.env` is **git-ignored** and is NOT in the repo — it holds `SESSION_SECRET`,
`DATABASE_URL`, and `INITIAL_ADMIN_PASSWORD`. Copy it from the old box manually:

```bash
# on old box
tailscale file cp /srv/intranet/.env <new-box>:
# on new box
sudo tailscale file get /srv/intranet/
```

If you'd rather start clean, generate a fresh `SESSION_SECRET`
(`openssl rand -hex 48`) — existing logins will be invalidated, which is fine
for a dev box.

---

## Notes

- **DB passwords:** the roles dump carries the existing (placeholder) passwords.
  This is a good moment to rotate `intranet_app` away from `CHANGEME_app` —
  do it after import with `ALTER USER intranet_app WITH PASSWORD '...'` and
  update `.env` to match.
- **Optional desktop / RDP:** `2-setup-postgres.sh` opens port 3389, but GNOME
  Remote Desktop must be enabled separately (`grdctl --system rdp enable`) if
  you want to RDP into the office box.
- **This kit doubles as disaster recovery.** If the box ever dies, these five
  scripts rebuild it from the GitHub repo + a Postgres dump. Keep a recent
  `dump/` somewhere off-box.
