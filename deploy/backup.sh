#!/usr/bin/env bash
# deploy/backup.sh — daily pg_dump with 14-day retention.
#
# Wire into cron as user `app`:
#   crontab -e
#   0 3 * * * /var/www/ctyrlistkoteka/deploy/backup.sh
#
# Prereq: /var/backups/postgres exists and is owned by `app`.
#   sudo mkdir -p /var/backups/postgres
#   sudo chown app:app /var/backups/postgres

set -euo pipefail

DB_NAME="${DB_NAME:-ctyrlistkoteka}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP=$(date +%F_%H%M)
OUT_FILE="${BACKUP_DIR}/${DB_NAME}-${TIMESTAMP}.sql.gz"

if [ ! -d "$BACKUP_DIR" ]; then
  echo "Backup dir $BACKUP_DIR does not exist; aborting." >&2
  exit 1
fi

# pg_dump over the local socket; the `app` user has peer auth on prod.
pg_dump --format=plain --no-owner "$DB_NAME" | gzip -9 > "$OUT_FILE"

# Verify the dump is non-trivial (guards against silent failures where gzip
# writes a few bytes of header on empty input).
MIN_BYTES=1024
ACTUAL_BYTES=$(stat -c %s "$OUT_FILE" 2>/dev/null || stat -f %z "$OUT_FILE")
if [ "$ACTUAL_BYTES" -lt "$MIN_BYTES" ]; then
  echo "Backup $OUT_FILE is suspiciously small ($ACTUAL_BYTES B); not pruning." >&2
  exit 2
fi

# Rotate: delete dumps older than RETENTION_DAYS.
find "$BACKUP_DIR" -type f -name "${DB_NAME}-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

echo "OK ${OUT_FILE} (${ACTUAL_BYTES} B)"
