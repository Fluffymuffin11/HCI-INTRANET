# 01 — System Overview

## What this system is

The **Heart Center Intranet** is an internal-only web platform for The Heart Center
medical practice (`<company-domain>`). It provides employees with:

- Company announcements and news posts (with admin moderation)
- Employee directory and search
- HR resources, policies, IT support requests
- Shared schedules, sign-up sheets, and event coordination
- Recognition programs (Employee Spotlight nominations)
- Centralized links to web apps used by the practice

It is deployed as a single self-contained stack on **one Red Hat Enterprise
Linux 10 virtual machine** running on the practice's Proxmox hypervisor.

## High-level architecture

```
                                  ┌───────────────────────────────────────────┐
                                  │  RHEL 10 VM  (Proxmox guest, KVM)         │
                                  │  hostname: localhost  ·  4 vCPU · 7 GiB   │
                                  │                                           │
   ┌────────────────────┐         │   ┌────────────────────────────────────┐  │
   │  Employee laptop   │         │   │  firewalld (public zone)           │  │
   │  / phone on LAN    │ ───────►│   │  open: 22/tcp 8080/tcp 3389/tcp    │  │
   └────────────────────┘  :8080  │   │         9090/tcp (cockpit)         │  │
                                  │   └─────────────────┬──────────────────┘  │
                                  │                     │                     │
   ┌────────────────────┐ Tailscale│                    ▼                     │
   │  Admin via Mac     │ <TAIL │   ┌────────────────────────────────────┐  │
   │  (Royal TSX RDP)   │ SCALE_IP> │   │  Docker bridge network             │  │
   └────────────────────┘ ───────►│   │                                    │  │
                          :3389,22│   │   ┌─────────────┐  ┌────────────┐  │  │
                                  │   │   │ intranet_   │  │ intranet_  │  │  │
   ┌────────────────────┐         │   │   │  nginx      │─►│  backend   │  │  │
   │  System maint via  │  :9090  │   │   │ nginx:alpine│  │ node:alpine│  │  │
   │  Cockpit (https)   │ ───────►│   │   │  :80 ⇆ host │  │  :3000     │  │  │
   └────────────────────┘         │   │   │   :8080     │  │            │  │  │
                                  │   │   └─────────────┘  └─────┬──────┘  │  │
                                  │   │                          │         │  │
                                  │   └──────────────────────────┼─────────┘  │
                                  │                              │            │
                                  │   ┌──────────────────────────▼─────────┐  │
                                  │   │  Host bind mounts                  │  │
                                  │   │   /srv/intranet/data/   (SQLite)   │  │
                                  │   │   /srv/intranet/uploads/  (files)  │  │
                                  │   │   /srv/intranet/frontend/dist/  R/O│  │
                                  │   │   /srv/intranet/public/admin/   R/O│  │
                                  │   │   /srv/intranet/nginx/default.conf │  │
                                  │   └────────────────────────────────────┘  │
                                  │                                           │
                                  └───────────────────────────────────────────┘
```

## Service layers

The system can be thought of as **five concentric layers**:

```
   ┌──────────────────────────────────────────────────────────────┐
   │                  ❺  USER EXPERIENCE                          │
   │  React 19 SPA  ·  Admin HTML portal  ·  Manager HTML portal  │
   ├──────────────────────────────────────────────────────────────┤
   │                  ❹  APPLICATION                              │
   │  Express.js single-file backend, 1,244 LOC, server.js        │
   │  REST API, session auth, 4 role tiers, audit logging         │
   ├──────────────────────────────────────────────────────────────┤
   │                  ❸  DATA                                     │
   │  SQLite (intranet.db) · Session store (sessions.db)          │
   │  Uploaded files on filesystem (/uploads)                     │
   ├──────────────────────────────────────────────────────────────┤
   │                  ❷  PLATFORM                                 │
   │  nginx reverse proxy · Docker Compose · bind-mount volumes   │
   ├──────────────────────────────────────────────────────────────┤
   │                  ❶  INFRASTRUCTURE                           │
   │  RHEL 10 · KVM/Proxmox · Tailscale · firewalld · GDM/RDP     │
   └──────────────────────────────────────────────────────────────┘
```

When reading the rest of the documentation, mentally place every detail into one
of these layers. Most maintenance work targets layers ❶ (the OS) and ❷ (Docker).

## Audiences served

| Audience | How they reach the system | Where they land |
|---|---|---|
| Employees (any device, on LAN) | Browser to `http://<LAN_IP>:8080/` | React SPA (employee view) |
| Managers | Browser to `http://<LAN_IP>:8080/manager/` | Static manager portal |
| Admins / Super-admins | Browser to `http://<LAN_IP>:8080/admin/` | Static admin portal |
| Technical operators | Tailscale SSH or RDP to `<TAILSCALE_IP>` | Linux shell or GNOME desktop |
| System maintenance | HTTPS to `https://<LAN_IP>:9090/` | Cockpit web console |

## Data-flow at a glance

A typical "employee views the home page" request:

```
   Browser                  nginx                 Express backend            SQLite
     │                       │                          │                      │
     │  GET /                │                          │                      │
     │──────────────────────►│                          │                      │
     │                       │ serves dist/index.html   │                      │
     │◄──────────────────────│                          │                      │
     │                       │                          │                      │
     │  GET /api/posts       │                          │                      │
     │──────────────────────►│  proxy_pass strips /api  │                      │
     │                       │  ──── GET /posts ───────►│                      │
     │                       │                          │  SELECT … WHERE      │
     │                       │                          │  status='approved'   │
     │                       │                          │─────────────────────►│
     │                       │                          │◄─────────────────────│
     │                       │  ◄──── 200 JSON ─────────│                      │
     │◄──────────────────────│                          │                      │
```

## Where this lives in real space

```
   Proxmox host: <proxmox-hostname>  (Tailscale: <PROXMOX_TAILSCALE_IP>)
                 │
                 └─ VM "RedHat" (VMID 101)
                       │
                       ├─ vCPU: 4
                       ├─ vRAM: 7 GiB
                       ├─ vDisk: 28 GiB (rhel-root LVM volume)
                       └─ vNIC: ens18 → bridged on LAN (<LAN_SUBNET>)
                                       Tailscale overlay on tailscale0
```

Continue to [`02-infrastructure.md`](02-infrastructure.md) for the server-side
details, or jump to [`06-maintenance.md`](06-maintenance.md) if you just need to
keep the lights on.
