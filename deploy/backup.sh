#!/usr/bin/env bash
# deploy/backup.sh — daily pg_dump with retention + failure detection.
#
# Wire into cron as user `app`:
#   crontab -e
#   0 3 * * * /var/www/ctyrlistkoteka/deploy/backup.sh >> /var/log/ctyr-backup.log 2>&1
#
# Prereqs:
#   sudo mkdir -p /var/backups/postgres
#   sudo chown app:app /var/backups/postgres
#   sudo touch /var/log/ctyr-backup.log && sudo chown app:app /var/log/ctyr-backup.log
#
# Credentials: `app` has no Postgres role, so this connects over TCP as the
# `ctyrlist` role and reads the password from ~/.pgpass (mode 0600):
#   127.0.0.1:5432:ctyrlistkoteka:ctyrlist:<heslo z .env>
# Peer auth over the unix socket does NOT work here — that is exactly how
# the original one-liner in crontab silently produced 20-byte "backups"
# every night for months (found 2026-07-20).

set -euo pipefail

DB_NAME="${DB_NAME:-ctyrlistkoteka}"
DB_USER="${DB_USER:-ctyrlist}"
DB_HOST="${DB_HOST:-127.0.0.1}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP=$(date +%F_%H%M)
# Custom format (-Fc): compressed already, and restorable selectively /
# in parallel with pg_restore -j. Plain SQL + gzip can only be replayed
# start-to-finish.
OUT_FILE="${BACKUP_DIR}/${DB_NAME}-${TIMESTAMP}.dump"

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "FAIL: backup dir $BACKUP_DIR does not exist." >&2
  exit 1
fi

# Write to a temp file first: a partial dump must never look like a good
# one, and must never be what retention counts as "today's backup".
TMP_FILE="${OUT_FILE}.partial"
trap 'rm -f "$TMP_FILE"' EXIT

if ! pg_dump --format=custom --no-owner --no-privileges \
       -h "$DB_HOST" -U "$DB_USER" "$DB_NAME" > "$TMP_FILE"; then
  echo "FAIL: pg_dump exited non-zero — no backup written." >&2
  exit 2
fi

# Guard against silent failures that still exit 0 (empty DB, truncated
# stream). A real dump of this collection is several MB; 1 MB is a floor
# low enough to never false-positive but high enough to catch a dud.
MIN_BYTES=$((1024 * 1024))
ACTUAL_BYTES=$(stat -c %s "$TMP_FILE" 2>/dev/null || stat -f %z "$TMP_FILE")
if [[ "$ACTUAL_BYTES" -lt "$MIN_BYTES" ]]; then
  echo "FAIL: dump is only ${ACTUAL_BYTES} B (< ${MIN_BYTES}); keeping older backups." >&2
  exit 3
fi

# Verify the archive is actually readable before trusting it. pg_restore -l
# parses the table of contents without touching any database — cheap, and
# it turns "the file exists" into "the file is a valid dump".
if ! pg_restore --list "$TMP_FILE" > /dev/null 2>&1; then
  echo "FAIL: dump did not pass pg_restore --list; keeping older backups." >&2
  exit 4
fi

mv "$TMP_FILE" "$OUT_FILE"
trap - EXIT

# Rotate only after a verified-good dump landed, so a run of failures can
# never erode the history down to nothing.
find "$BACKUP_DIR" -type f -name "${DB_NAME}-*.dump" -mtime "+${RETENTION_DAYS}" -delete

echo "OK $(date +%FT%T) ${OUT_FILE} (${ACTUAL_BYTES} B)"
