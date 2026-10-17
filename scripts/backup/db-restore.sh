#!/usr/bin/env bash
# Restores a backup made by db-backup.sh into an EMPTY database. It never cleans or drops anything, so pointing it at a
# database that already has the tables fails loudly instead of overwriting them.
#
# Usage:
#   BACKUP_PASSPHRASE='...' scripts/backup/db-restore.sh <backup.dump.gpg> <target-database-url>
#
# The target should be a new, empty Postgres database (a new Supabase project, or a local one). Use the session pooler
# (port 5432) or a direct connection, never the transaction pooler (port 6543).
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: BACKUP_PASSPHRASE='...' $0 <backup.dump.gpg> <target-database-url>" >&2
  exit 2
fi
if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  echo "Missing required setting: BACKUP_PASSPHRASE" >&2
  exit 2
fi
if [ ! -f "$1" ]; then
  echo "Backup file not found: $1" >&2
  exit 2
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "1/2 Decrypting..."
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt --output "$WORK/db.dump" "$1" 3<<<"$BACKUP_PASSPHRASE"

echo "2/2 Restoring into the target database..."
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$2" "$WORK/db.dump"

echo "Restore complete."
