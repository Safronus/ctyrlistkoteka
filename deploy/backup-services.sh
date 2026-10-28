#!/usr/bin/env bash
# deploy/backup-services.sh — daily backup of the self-hosted services next to
# the app (GoatCounter analytics, RustDesk server identity), with retention
# and failure detection. Same contract as backup.sh: write to a temp file,
# verify, only then keep it and rotate.
#
# Wire into cron as user `app`, after backup.sh and before offsite-stage.sh (3:10):
#   5 3 * * * /var/www/ctyrlistkoteka/deploy/backup-services.sh >> /var/log/ctyr-backup.log 2>&1
#
# Prereqs (once):
#   sudo mkdir -p /var/ctyrlistkoteka/backups/services
#   sudo chown app:app /var/ctyrlistkoteka/backups/services && sudo chmod 700 /var/ctyrlistkoteka/backups/services
#
# OUT_DIR sits under /var/ctyrlistkoteka on purpose: that tree is what the
# off-site pull (deploy/unas-pull.sh) copies.
#
# GoatCounter is SQLite in WAL mode and keeps writing. A plain file copy of
# db + wal can be torn; Python's sqlite3 online-backup API takes a
# consistent snapshot while the service runs — and works read-only, as a
# different user than the one that owns the files (tested 2026-10-28 with
# a live writer: integrity ok).
#
# The RustDesk key pair is the server's identity: without it every client
# has to be re-pointed. It is a private key — the copy here is 0600, in a
# 0700 directory.

set -euo pipefail

OUT_DIR="${OUT_DIR:-/var/ctyrlistkoteka/backups/services}"
GOATCOUNTER_DB="${GOATCOUNTER_DB:-/var/ctyrlistkoteka/goatcounter/goatcounter-data/db.sqlite3}"
RUSTDESK_DATA="${RUSTDESK_DATA:-/home/app/rustdesk/data}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP=$(date +%F_%H%M)

umask 077
if [[ ! -d "$OUT_DIR" ]]; then
  echo "FAIL: backup dir $OUT_DIR does not exist." >&2
  exit 1
fi

status=0

# --- GoatCounter: consistent SQLite snapshot ---------------------------------
gc_out="${OUT_DIR}/goatcounter-${TIMESTAMP}.sqlite3"
if [[ ! -r "$GOATCOUNTER_DB" ]]; then
  echo "FAIL: GoatCounter DB $GOATCOUNTER_DB missing or unreadable." >&2
  status=2
elif ! python3 - "$GOATCOUNTER_DB" "${gc_out}.partial" <<'PY'
import sqlite3, sys
src_path, dst_path = sys.argv[1], sys.argv[2]
src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
dst = sqlite3.connect(dst_path)
src.backup(dst)
src.close()
ok = dst.execute("pragma integrity_check").fetchone()[0]
dst.close()
if ok != "ok":
    sys.exit(f"integrity_check: {ok}")
PY
then
  echo "FAIL: GoatCounter snapshot failed or did not pass integrity_check." >&2
  rm -f "${gc_out}.partial"
  status=3
else
  gzip -9 "${gc_out}.partial" && mv "${gc_out}.partial.gz" "${gc_out}.gz"
  echo "OK $(date +%FT%T) ${gc_out}.gz ($(stat -c %s "${gc_out}.gz" 2>/dev/null || stat -f %z "${gc_out}.gz") B)"
fi

# --- RustDesk: server key pair ------------------------------------------------
rd_out="${OUT_DIR}/rustdesk-keys-${TIMESTAMP}.tar.gz"
if [[ ! -r "${RUSTDESK_DATA}/id_ed25519" || ! -r "${RUSTDESK_DATA}/id_ed25519.pub" ]]; then
  echo "FAIL: RustDesk key pair in ${RUSTDESK_DATA} missing or unreadable." >&2
  status=4
elif ! tar -czf "${rd_out}.partial" -C "$RUSTDESK_DATA" id_ed25519 id_ed25519.pub \
     || ! tar -tzf "${rd_out}.partial" > /dev/null; then
  echo "FAIL: RustDesk key archive could not be written or read back." >&2
  rm -f "${rd_out}.partial"
  status=5
else
  mv "${rd_out}.partial" "$rd_out"
  echo "OK $(date +%FT%T) ${rd_out}"
fi

# Rotate only after this run produced good copies of BOTH, so a run of
# failures can never erode the history down to nothing.
if [[ "$status" -eq 0 ]]; then
  find "$OUT_DIR" -type f \( -name 'goatcounter-*.sqlite3.gz' -o -name 'rustdesk-keys-*.tar.gz' \) \
    -mtime "+${RETENTION_DAYS}" -delete
fi
exit "$status"
