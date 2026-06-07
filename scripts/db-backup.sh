#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set."
  exit 1
fi

mkdir -p backups
timestamp="$(date -u +%Y%m%d-%H%M%S)"
outfile="backups/pepsi-pos-backup-${timestamp}.sql.gz"

echo "Creating backup: ${outfile}"
pg_dump --no-owner --no-privileges --format=plain "${DATABASE_URL}" | gzip > "${outfile}"
echo "Backup complete."
