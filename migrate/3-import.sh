#!/bin/bash
#
# 3-import.sh — Run on the NEW box after 2-setup-postgres.sh, once the ./dump/
# bundle from the old box is present. Loads roles first, then the database.
#
# Usage:  sudo ./3-import.sh
#
set -euo pipefail

DUMP="$(dirname "$0")/dump"

if [[ ! -f "$DUMP/roles.sql" || ! -f "$DUMP/intranet_hci.sql" ]]; then
  echo "Missing dump files. Expected:" >&2
  echo "  $DUMP/roles.sql" >&2
  echo "  $DUMP/intranet_hci.sql" >&2
  exit 1
fi

echo "==> Restoring roles"
sudo -u postgres psql -f "$DUMP/roles.sql"

echo "==> Restoring intranet_hci database"
sudo -u postgres psql -f "$DUMP/intranet_hci.sql"

echo "==> Verifying"
sudo -u postgres psql -d intranet_hci -c "\dt" | head -20
sudo -u postgres psql -d intranet_hci -c "SELECT count(*) AS users FROM users;"

echo
echo "Database restored. Final step: bring up the app stack."
echo "  cd /srv/intranet && docker compose up -d"
