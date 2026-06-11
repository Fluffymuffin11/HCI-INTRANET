#!/bin/bash
#
# 1-bootstrap.sh — Run this FIRST on the fresh office RHEL 10 box.
# Installs every repo + package the intranet dev box depends on.
# Mirrors the original homelab host (RHEL 10.2, PostgreSQL 17, Docker, Tailscale).
#
# Usage:  sudo ./1-bootstrap.sh
#
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo ./1-bootstrap.sh" >&2
  exit 1
fi

echo "==> [1/6] Registering the system (RHEL Developer subscription)"
# If not already registered, uncomment and run once:
#   subscription-manager register
# A free Red Hat Developer account works for a single dev box.
subscription-manager status >/dev/null 2>&1 || \
  echo "    !! System not registered. Run 'subscription-manager register' before continuing."

echo "==> [2/6] Base system update"
dnf upgrade -y

echo "==> [3/6] Adding third-party repositories"

# --- EPEL (Tailscale deps, misc tooling) ---
dnf install -y https://dl.fedoraproject.org/pub/epel/epel-release-latest-10.noarch.rpm || true

# --- Docker CE ---
dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo

# --- PostgreSQL Global Development Group (PGDG) ---
dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-10-x86_64/pgdg-redhat-repo-latest.noarch.rpm
# Disable the built-in postgresql module so the PGDG packages win:
dnf -qy module disable postgresql || true

# --- Tailscale ---
dnf config-manager --add-repo https://pkgs.tailscale.com/stable/rhel/10/tailscale.repo

echo "==> [4/6] Installing packages"
dnf install -y \
  postgresql17-server postgresql17-contrib \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
  tailscale \
  git

echo "==> [5/6] Enabling services"
systemctl enable --now docker
systemctl enable --now tailscaled

echo "==> [6/6] Done with bootstrap."
echo
echo "Next steps:"
echo "  1. Connect to Tailscale:   sudo tailscale up"
echo "  2. Run:                    sudo ./2-setup-postgres.sh"
echo "  3. Pull data from old box, then run 3-import.sh"
