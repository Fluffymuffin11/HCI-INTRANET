# 05 — Remote Access

This document covers **all the ways into the server** — SSH, the desktop via
RDP, the Cockpit web console, and the Tailscale overlay that secures them.

## Access matrix

```
                ┌──────────────────────────────────────────────────────────────┐
                │                  RHEL 10 VM                                  │
                │                                                              │
                │   Port  Method            Purpose                            │
                │   ────  ───────────       ─────────────────────────────────  │
   admin Mac    │   22    SSH (OpenSSH)     Shell, file transfer, scripting    │
   ─────►──────►│  3389   RDP (g-r-d, *)    Full GNOME desktop, headless mode  │
                │  8080   HTTP (nginx)      The intranet itself                │
                │  9090   HTTPS (Cockpit)   Web-based admin console            │
                │                                                              │
                │   *g-r-d = gnome-remote-desktop                              │
                └──────────────────────────────────────────────────────────────┘

   All four ports are reachable on BOTH the LAN address (<LAN_IP>)
   AND the Tailscale address (<TAILSCALE_IP>).
```

## Tailscale (the secure overlay)

Tailscale is a peer-to-peer encrypted mesh VPN. Each authorized device gets a
`100.x.y.z` address that works over the open internet without exposing any
ports publicly.

```
   Internet
       │
       ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Tailscale coordination server  (login.tailscale.com)   │
   │  authenticates devices, never sees traffic              │
   └─────────────────────────────────────────────────────────┘
                          │  authentication only
                          ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Tailnet:  <tailnet-owner-email>                         │
   │                                                         │
   │  ┌──────────────┐    encrypted     ┌────────────────┐   │
   │  │ Admin Mac    │ ◄──────────────► │ RHEL VM        │   │
   │  │ 100.x.y.z    │                  │ <TAILSCALE_IP> │   │
   │  └──────────────┘                  └────────────────┘   │
   │                                                         │
   │  ┌────────────────┐                                     │
   │  │ <proxmox-hostname> │   (Proxmox hypervisor host)         │
   │  │ <PROXMOX_TAILSCALE_IP>│                                     │
   │  └────────────────┘                                     │
   └─────────────────────────────────────────────────────────┘
```

### Why we use it

- **No port-forwarding required** on the practice's router
- **End-to-end encrypted** with WireGuard under the hood
- **Identity-based access** — devices are authorized in the admin console
- **DNS works** — devices can be reached by hostname (e.g., `<vm-hostname>`) if
  Tailscale's MagicDNS is on

### Managing devices

The Tailscale admin console at <https://login.tailscale.com> lets the tailnet
owner (`<tailnet-owner-email>`):

- See online/offline devices
- Approve new devices
- Revoke devices
- Edit ACLs (currently default — all devices can reach all others on the tailnet)

### On the server: check Tailscale status

```bash
$ tailscale status              # list peers + self IP
$ tailscale ip                  # just our IPs
$ sudo systemctl status tailscaled
```

If Tailscale ever fails to come up:
```bash
$ sudo systemctl restart tailscaled
$ sudo tailscale up                # may prompt for login URL
```

## SSH access

From any device on the tailnet, or on the LAN:

```bash
$ ssh bryant@<TAILSCALE_IP>        # via Tailscale (anywhere)
$ ssh bryant@<LAN_IP>         # via LAN (in the office)
```

Password: the `bryant` user's local Linux password.

### Recommended: switch to key-based SSH

Password SSH is enabled, but key-based is more secure. From your Mac:

```bash
$ ssh-keygen -t ed25519                                       # if you don't have one
$ ssh-copy-id bryant@<TAILSCALE_IP>                           # installs your pubkey
$ ssh bryant@<TAILSCALE_IP>                                   # now no password needed
```

Then optionally disable password SSH (one line in `/etc/ssh/sshd_config`):
```
PasswordAuthentication no
```
Followed by `sudo systemctl restart sshd`.

⚠️ Do **not** disable password SSH until you have verified key-based auth works.

## RDP — full GNOME desktop

The server runs **gnome-remote-desktop in headless (system) mode**. Every RDP
connection spawns a *fresh GNOME session* — your settings persist (they live
in `~/.config/`) but the display layout and any open apps do not survive
disconnect.

### Connection details

| Setting | Value |
|---|---|
| Host | `<TAILSCALE_IP>` (or `<LAN_IP>`) |
| Port | `3389` |
| Username | `bryant` |
| Password | the `bryant` Linux password |
| Security | Ignore self-signed certificate warnings |

### Recommended client: Royal TSX (free, native macOS)

We tested several clients during setup. Findings:

| Client | Works? | Notes |
|---|---|---|
| **Royal TSX** (royalapps.com) | ✅ | Recommended. Native, free, handles RDP server redirection |
| **Microsoft "Windows App"** (App Store) | ⚠️ | Cannot handle the redirection used in headless mode |
| **Jump Desktop** | ❌ | NLA/NTLM negotiation incompatibility with gnome-remote-desktop |
| **xfreerdp via Homebrew** | ⚠️ | Functional, but renders through XQuartz — visually rough |
| **virt-viewer + SPICE** | ❌ | Bypassed in favor of this RDP path |

### First-time Royal TSX setup

1. Install Royal TSX from <https://royalapps.com/ts/mac/features> or the Mac App Store
2. On first launch, install the **Remote Desktop (RDP)** plugin when prompted
3. **File → New Document → Add → Remote Desktop**
4. Fill in:
   - Computer Name: `<TAILSCALE_IP>`
   - Username: `bryant`
   - Password: (your password)
5. Under the connection's **Display** tab:
   - Resolution: Custom → **3024 × 1964** (or your monitor's native pixels)
   - Color depth: 32-bit
6. Under **Advanced / Security**:
   - **Ignore certificate warnings**: ON
7. Double-click to connect → accept the certificate warning → land on the desktop

To toggle full-screen: **⌥⌘F** in Royal TSX (Connection Full Screen).

### What "headless mode" means in practice

```
   Royal TSX connects to :3389
       │
       ▼
   gnome-remote-desktop daemon authenticates (TLS + credentials)
       │
       ▼
   Daemon spawns a fresh GDM session for user 'bryant'
       │
       ▼
   Mutter creates a virtual monitor at the resolution Royal TSX requested
       │
       ▼
   You see the desktop. Settings persist (same ~/.config), display layout doesn't.
```

When you disconnect, the GNOME session is torn down. Next connect = new session.

### Switching to screen-sharing mode (advanced, not recommended)

Headless mode is the *intended* mode for this deployment because:
- It survives reboots without anyone logged in locally
- It supports per-client resolution negotiation
- It does not depend on an unlocked gnome-keyring

A "screen sharing" mode also exists (shares the active console session) but
needs an unlocked keyring, which is awkward on a headless VM. Avoid unless
you have a specific reason.

## Cockpit (web console)

Cockpit is the most beginner-friendly way to manage the server. Browse to:

```
   https://<TAILSCALE_IP>:9090/      ← via Tailscale
   https://<LAN_IP>:9090/       ← via LAN
```

It is a **self-signed certificate** — accept the browser warning. Log in with
the `bryant` Linux user.

From Cockpit you can:

```
   ┌───────────────────────────────────────────────────────────────┐
   │  Cockpit (web)                                                │
   │                                                               │
   │  Overview          live CPU/memory/disk/network graphs        │
   │  Logs              browse journald with search and filters    │
   │  Storage           disk partitions, free space, NFS mounts    │
   │  Networking        interfaces, firewall, VPN                  │
   │  Podman / Docker   running containers, restart, view logs     │
   │  Software updates  list and install dnf updates with a UI     │
   │  Services          systemd unit list, start/stop/enable       │
   │  Accounts          list/create users, change passwords        │
   │  Terminal          full shell access in the browser           │
   │  SELinux           policy state                               │
   └───────────────────────────────────────────────────────────────┘
```

💡 **For an operator who is not a Linux expert, Cockpit is the single best
tool to learn.** Most maintenance tasks in [`06-maintenance.md`](06-maintenance.md)
can be done through Cockpit.

## Local console (Proxmox)

If all remote paths fail, you can still get into the VM via the Proxmox web UI:

1. Browse to the Proxmox host: `https://<LAN_HOST>:8006/`
2. Log in to Proxmox
3. Select VM **101 (RedHat)** in the left tree
4. Click **Console** in the top right

⚠️ The console used to be SPICE. We diagnosed it as broken and migrated to
RDP. The **noVNC** console option (in the same dropdown) still works as a
fallback.

## Quick reference: which tool when

| You want to… | Use |
|---|---|
| Run a one-line command | SSH |
| Edit a file in vim/nano | SSH |
| Restart a container | SSH or Cockpit |
| Watch system metrics | Cockpit |
| Read logs with a search box | Cockpit |
| Use a graphical app (Firefox, Files) | RDP |
| Tweak GNOME settings | RDP |
| Update Red Hat packages | Cockpit (easy) or SSH `sudo dnf upgrade` |
| Recover from boot problems | Proxmox noVNC console |

## Where to go next

- [`06-maintenance.md`](06-maintenance.md) — routine maintenance procedures
- [`07-troubleshooting.md`](07-troubleshooting.md) — when something is broken
