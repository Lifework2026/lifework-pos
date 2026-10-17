#!/usr/bin/env bash
# Nightly database backup: pg_dump -> check the dump -> encrypt (AES-256) -> upload to S3-compatible storage -> verify.
#
# Run by .github/workflows/db-backup.yml. Everything it needs comes from environment variables (GitHub secrets):
#   BACKUP_DATABASE_URL     Supabase SESSION POOLER connection string, port 5432 (works over IPv4 from GitHub runners)
#   BACKUP_PASSPHRASE       at least 16 characters; encrypts the dump. Without it the backup cannot be opened.
#   BACKUP_S3_BUCKET        bucket name
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   a key that can only write to that bucket
#   AWS_REGION              e.g. ap-southeast-1 (use "auto" for Cloudflare R2)
#   BACKUP_S3_ENDPOINT      optional, only for non-AWS storage such as Cloudflare R2 or Backblaze B2
#   BACKUP_S3_PREFIX        optional folder in the bucket (default: lifework-pos/daily)
#
# The dump holds the "public" schema only: every table the POS owns. Supabase's own schemas (auth, storage, ...) are
# managed by Supabase and not used by this app. Product photos live in Storage and are NOT in this dump.
# Nothing here prints a secret, and nothing here deletes anything.
set -euo pipefail

require() {
  if [ -z "${!1:-}" ]; then
    echo "Missing required setting: $1" >&2
    exit 2
  fi
}

for name in BACKUP_DATABASE_URL BACKUP_PASSPHRASE BACKUP_S3_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION; do
  require "$name"
done
if [ "${#BACKUP_PASSPHRASE}" -lt 16 ]; then
  echo "BACKUP_PASSPHRASE must be at least 16 characters." >&2
  exit 2
fi

# The Supabase server runs PostgreSQL 17, and pg_dump refuses to dump a newer server. Fail early with a clear message
# instead of letting an older client that is first on PATH abort halfway.
MIN_PG_MAJOR="${BACKUP_MIN_PG_MAJOR:-17}"
PG_DUMP_VERSION="$(pg_dump --version)"
PG_DUMP_MAJOR="$(printf '%s' "$PG_DUMP_VERSION" | grep -oE '[(]PostgreSQL[)] [0-9]+' | grep -oE '[0-9]+$' || true)"
if [ -z "$PG_DUMP_MAJOR" ] || [ "$PG_DUMP_MAJOR" -lt "$MIN_PG_MAJOR" ]; then
  echo "pg_dump must be version $MIN_PG_MAJOR or newer, but the one on PATH is: $PG_DUMP_VERSION ($(command -v pg_dump))" >&2
  exit 5
fi

# libpq rejects Prisma-only options such as ?pgbouncer=true, so remove them if someone pasted DATABASE_URL.
clean_url() {
  local url="$1" param
  for param in pgbouncer connection_limit pool_timeout schema; do
    url="$(printf '%s' "$url" | sed -E "s/([?&])${param}=[^&]*&?/\\1/")"
  done
  printf '%s' "$url" | sed -E 's/[?&]$//'
}
DATABASE_URL_CLEAN="$(clean_url "$BACKUP_DATABASE_URL")"

PREFIX="${BACKUP_S3_PREFIX:-lifework-pos/daily}"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
NAME="lifework-pos-${STAMP}.dump.gpg"
KEY="${PREFIX}/${NAME}"

ENDPOINT=()
if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
  ENDPOINT=(--endpoint-url "$BACKUP_S3_ENDPOINT")
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DUMP="${WORK}/db.dump"
ENCRYPTED="${WORK}/${NAME}"

echo "1/4 Dumping the database (schema public)..."
pg_dump --format=custom --schema=public --no-owner --no-privileges --file "$DUMP" --dbname "$DATABASE_URL_CLEAN"

echo "2/4 Checking the dump can be read and is not empty..."
TABLES="$(pg_restore --list "$DUMP" | grep -c 'TABLE DATA' || true)"
if [ "$TABLES" -lt 1 ]; then
  echo "The dump contains no table data. Not uploading it." >&2
  exit 3
fi
echo "    $TABLES tables with data, $(wc -c < "$DUMP" | tr -d ' ') bytes before encryption."

echo "3/4 Encrypting (AES-256, passphrase from BACKUP_PASSPHRASE)..."
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --symmetric --cipher-algo AES256 --output "$ENCRYPTED" "$DUMP" 3<<<"$BACKUP_PASSPHRASE"
rm -f "$DUMP"
SIZE="$(wc -c < "$ENCRYPTED" | tr -d ' ')"

echo "4/4 Uploading to s3://${BACKUP_S3_BUCKET}/${KEY} ..."
aws s3 cp "$ENCRYPTED" "s3://${BACKUP_S3_BUCKET}/${KEY}" --only-show-errors ${ENDPOINT[@]+"${ENDPOINT[@]}"}
REMOTE_SIZE="$(aws s3api head-object --bucket "$BACKUP_S3_BUCKET" --key "$KEY" --query ContentLength --output text ${ENDPOINT[@]+"${ENDPOINT[@]}"})"
if [ "$REMOTE_SIZE" != "$SIZE" ]; then
  echo "Upload check failed: sent $SIZE bytes, storage reports $REMOTE_SIZE." >&2
  exit 4
fi

echo "Backup complete: ${KEY} (${SIZE} bytes)."
