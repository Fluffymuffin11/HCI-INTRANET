#!/bin/bash
#
# 2-setup-postgres.sh — Initialize PostgreSQL 17 on the new box to match the
# original host: same listen config, same pg_hba rule for the Docker network.
# Roles and the database itself come from the dump in step 3 — this only
# prepares the cluster and networking.
#
# Usage:  sudo ./2-setup-postgres.sh
#
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo ./2-setup-postgres.sh" >&2
  exit 1
fi

PGDATA=/var/lib/pgsql/17/data

echo "==> Initializing the PostgreSQL 17 cluster"
if [[ ! -f "$PGDATA/PG_VERSION" ]]; then
  /usr/pgsql-17/bin/postgresql-17-setup initdb
else
  echo "    Cluster already initialized, skipping initdb."
fi

echo "==> Configuring listen_addresses"
# Listen on all interfaces so the Docker bridge can reach Postgres via host-gateway.
sed -i "s/^#\?listen_addresses.*/listen_addresses = '*'/" "$PGDATA/postgresql.conf"

echo "==> Adding pg_hba rule for the Docker compose network (172.18.0.0/16)"
HBA="$PGDATA/pg_hba.conf"
RULE="host    intranet_hci   intranet_app   172.18.0.0/16   scram-sha-256"
if ! grep -qF "intranet_app   172.18.0.0/16" "$HBA"; then
  echo "$RULE" >> "$HBA"
  echo "    Rule added."
else
  echo "    Rule already present."
fi

echo "==> Enabling + starting postgresql-17"
systemctl enable --now postgresql-17

echo "==> Opening firewall for the intranet app + tools"
firewall-cmd --add-port=8080/tcp --permanent   # nginx (intranet)
firewall-cmd --add-port=5555/tcp --permanent   # Prisma Studio
firewall-cmd --add-port=3389/tcp --permanent   # RDP (if you want a desktop)
firewall-cmd --add-service=cockpit --permanent # Cockpit 9090
firewall-cmd --reload

echo
echo "PostgreSQL is up. Now load the data:  sudo ./3-import.sh"
