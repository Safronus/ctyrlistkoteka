#!/usr/bin/env bash
# deploy/offsite-stage.sh — collect the small, non-photo assets into one
# directory so the off-site pull only has to walk a single subtree.
#
# Runs on the VPS from cron, right after backup.sh:
#   10 3 * * * /var/www/ctyrlistkoteka/deploy/offsite-stage.sh >> /var/log/ctyr-backup.log 2>&1
#
# Why a staging dir at all: the pulling side (UNAS) is restricted to ONE
# rsync root by the forced command on its SSH key. Putting the DB dump and
# the secrets under /var/ctyrlistkoteka means data/, generated/ and these
# extras are all reachable through that single restricted root, without
# widening the key's access to the whole filesystem.
#
# NOTE: .offsite/ lives BESIDE data/, never inside it — data/ is read-only
# to everything except the admin UI (CLAUDE.md §9).

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ctyrlistkoteka}"
ROOT_DIR="${ROOT_DIR:-/var/ctyrlistkoteka}"
STAGE_DIR="${STAGE_DIR:-${ROOT_DIR}/.offsite}"
DB_BACKUP_DIR="${DB_BACKUP_DIR:-/var/backups/postgres}"
KEEP_DUMPS="${KEEP_DUMPS:-3}"

mkdir -p "$STAGE_DIR"
chmod 700 "$STAGE_DIR"

# --- 1. Newest verified DB dump ------------------------------------------
# Hardlinked, not copied: same inode, so this costs no extra disk and can
# never be a half-written duplicate of the file backup.sh just validated.
newest_dump="$(find "$DB_BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' -printf '%T@ %p\n' \
  | sort -rn | head -1 | cut -d' ' -f2-)"

if [[ -z "$newest_dump" ]]; then
  echo "FAIL: no .dump found in $DB_BACKUP_DIR — did backup.sh run?" >&2
  exit 1
fi

ln -f "$newest_dump" "${STAGE_DIR}/$(basename "$newest_dump")"

# Keep only the last few dumps here; the full retention lives in
# DB_BACKUP_DIR. The off-site side keeps its own dated snapshots anyway.
# shellcheck disable=SC2012
ls -1t "${STAGE_DIR}"/*.dump 2>/dev/null | tail -n "+$((KEEP_DUMPS + 1))" | xargs -r rm -f

# --- 2. Secrets, encrypted ------------------------------------------------
# .env holds the DB password, admin credentials, VOTE_FINGERPRINT_SALT and
# FIND_PHOTO_UNLOCK_CODE. It is the one thing here that exists nowhere else,
# and the one thing that must not sit in clear text on a NAS share.
#
# Passphrase comes from /root/.offsite-passphrase (mode 0600, NOT in git,
# NOT in the backup). Store a copy in your password manager — without it
# this file is unrecoverable.
PASS_FILE="${PASS_FILE:-/etc/ctyrlistkoteka/offsite.pass}"

if [[ -r "$PASS_FILE" && -r "${APP_DIR}/.env" ]]; then
  # -pbkdf2 + high iteration count: the passphrase is human-chosen, so the
  # KDF is what stands between a stolen file and the secrets.
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
    -in "${APP_DIR}/.env" \
    -out "${STAGE_DIR}/env.enc.tmp" \
    -pass "file:${PASS_FILE}"
  mv "${STAGE_DIR}/env.enc.tmp" "${STAGE_DIR}/env.enc"
  chmod 600 "${STAGE_DIR}/env.enc"
else
  echo "WARN: skipping .env encryption (missing $PASS_FILE or ${APP_DIR}/.env)" >&2
fi

# --- 3. Host config worth keeping ----------------------------------------
# Small, and reconstructing it from memory after a rebuild is miserable.
{
  echo "# crontab -l for $(whoami) @ $(date -Is)"
  crontab -l 2>/dev/null || echo "(none)"
} > "${STAGE_DIR}/crontab.txt"

# Nginx config: readable by app on this host; ignore failure if not.
tar -czf "${STAGE_DIR}/nginx-conf.tar.gz" -C /etc nginx 2>/dev/null \
  || echo "WARN: could not archive /etc/nginx (permissions?)" >&2

# --- 4. Manifest ----------------------------------------------------------
# Gives the pulling side something cheap to sanity-check, and gives future
# you a record of what a given snapshot actually contains.
{
  echo "staged_at=$(date -Is)"
  echo "host=$(hostname)"
  echo "app_commit=$(cd "$APP_DIR" && git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "db_dump=$(basename "$newest_dump")"
  echo "db_dump_bytes=$(stat -c %s "$newest_dump")"
  echo "data_bytes=$(du -sb "${ROOT_DIR}/data" 2>/dev/null | cut -f1)"
  echo "generated_bytes=$(du -sb "${ROOT_DIR}/generated" 2>/dev/null | cut -f1)"
} > "${STAGE_DIR}/MANIFEST.txt"

echo "OK $(date +%FT%T) staged $(basename "$newest_dump") + secrets into ${STAGE_DIR}"
