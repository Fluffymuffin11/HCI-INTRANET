#!/bin/bash
#
# export.sh — Run this on the ORIGINAL (current) box to produce the data bundle
# that gets carried to the new dev box. Writes everything into ./dump/.
#
#   - roles.sql   : the intranet_app / intranet_ro / dba_group roles + passwords
#   - intranet_hci.sql : full database dump (schema + data)
#
# Usage:  sudo ./export.sh
#
set -euo pipefail

OUT="$(dirname "$0")/dump"
mkdir -p "$OUT"

echo "==> Dumping roles (passwords included)"
# --roles-only captures CREATE ROLE statements with their hashed passwords.
sudo -u postgres pg_dumpall --roles-only \
  | grep -vE '^(CREATE|ALTER) ROLE postgres' \
  > "$OUT/roles.sql"

echo "==> Dumping the intranet_hci database (schema + data)"
sudo -u postgres pg_dump --create --clean --if-exists intranet_hci \
  > "$OUT/intranet_hci.sql"

echo "==> Sizes:"
du -h "$OUT"/*.sql

echo
echo "Bundle ready in: $OUT"
echo "Carry it to the new box over Tailscale, e.g.:"
echo "  tar czf intranet-data.tgz dump/"
echo "  tailscale file cp intranet-data.tgz <new-box-name>:"
