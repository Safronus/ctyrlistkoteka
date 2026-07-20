#!/usr/bin/env bash
# deploy/unas-pull.sh — runs ON THE UNAS, pulls the collection from the VPS.
#
# Install (as root on the UNAS):
#   mkdir -p /persistent/ctyrlistkoteka
#   cp unas-pull.sh /persistent/ctyrlistkoteka/
#   chmod +x /persistent/ctyrlistkoteka/unas-pull.sh
#   printf '30 4 * * * root /persistent/ctyrlistkoteka/unas-pull.sh >> /persistent/ctyrlistkoteka/pull.log 2>&1\n' \
#     > /etc/cron.d/ctyrlistkoteka-backup
#
# ⚠️ UniFi OS keeps / on an overlayfs, so /etc/cron.d is WIPED BY FIRMWARE
# UPDATES. The script itself lives in /persistent (which survives), but the
# cron entry does not — after every UNAS firmware update, re-create
# /etc/cron.d/ctyrlistkoteka-backup. The freshness check on the VPS exists
# precisely because this will eventually be forgotten.
#
# Direction is PULL on purpose: the VPS has no route to the NAS and no
# credentials for it, so compromising the server cannot reach the backups.

set -euo pipefail

VPS_HOST="${VPS_HOST:-ctyrlistkoteka.cz}"
VPS_USER="${VPS_USER:-app}"
SSH_KEY="${SSH_KEY:-/persistent/ctyrlistkoteka/id_backup}"
# Separate key, separate forced command — see the ping block at the bottom.
PING_KEY="${PING_KEY:-/persistent/ctyrlistkoteka/id_backup_ping}"

SHARE="/volume/02c60934-d1ce-4b09-b529-42a495c6b90c/.srv/.unifi-drive/CtyrlistkotekaBackups/.data"
SNAP_DIR="${SNAP_DIR:-${SHARE}/snapshots}"
LATEST_LINK="${SNAP_DIR}/latest"
KEEP_SNAPSHOTS="${KEEP_SNAPSHOTS:-30}"
TODAY="${SNAP_DIR}/$(date +%F)"

# A good full pull is ~27 GB; a good incremental still leaves a complete
# tree. Refuse to publish a snapshot that came out implausibly small —
# same guard philosophy as backup.sh, for the same reason.
MIN_TOTAL_BYTES="${MIN_TOTAL_BYTES:-$((20 * 1024 * 1024 * 1024))}"

log() { echo "$(date -Is) $*"; }

if [[ ! -d "$SHARE" ]]; then
  log "FAIL: share path $SHARE not found (renamed in UniFi Drive?)"
  exit 1
fi
if [[ ! -r "$SSH_KEY" ]]; then
  log "FAIL: ssh key $SSH_KEY missing"
  exit 1
fi

mkdir -p "$SNAP_DIR"

# Reuse yesterday's snapshot as a hardlink source: unchanged files cost no
# extra space, so 30 daily snapshots of a 27 GB tree stay near 27 GB rather
# than 810 GB. Only genuinely new/changed files consume storage.
link_dest=()
if [[ -d "$LATEST_LINK" ]]; then
  link_dest=(--link-dest="$(readlink -f "$LATEST_LINK")")
fi

# Build into .partial so an interrupted run never becomes `latest` and
# never becomes the link-dest for tomorrow.
staging="${TODAY}.partial"
rm -rf "$staging"
mkdir -p "$staging"

log "pull start → $staging"

# The remote path is '.' because the VPS key is pinned to a forced rrsync
# command rooted at /var/ctyrlistkoteka — the client cannot ask for
# anything outside it.
if ! rsync -a --delete --numeric-ids --partial \
      -e "ssh -i ${SSH_KEY} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
      "${link_dest[@]}" \
      "${VPS_USER}@${VPS_HOST}:." "${staging}/"; then
  log "FAIL: rsync exited non-zero; keeping previous snapshots"
  exit 2
fi

actual_bytes="$(du -sb "$staging" | cut -f1)"
if [[ "$actual_bytes" -lt "$MIN_TOTAL_BYTES" ]]; then
  log "FAIL: snapshot is only ${actual_bytes} B (< ${MIN_TOTAL_BYTES}); discarding"
  rm -rf "$staging"
  exit 3
fi

if [[ ! -s "${staging}/.offsite/MANIFEST.txt" ]]; then
  log "FAIL: MANIFEST.txt missing — offsite-stage.sh did not run on the VPS; discarding"
  rm -rf "$staging"
  exit 4
fi

rm -rf "$TODAY"
mv "$staging" "$TODAY"
ln -sfn "$TODAY" "$LATEST_LINK"

# Prune only after a good snapshot landed, so a run of failures can never
# erode history. -mindepth/-maxdepth 1 keeps this pinned to the dated dirs.
find "$SNAP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime "+${KEEP_SNAPSHOTS}" \
  -exec rm -rf {} + 2>/dev/null || true

# Tell the VPS we made it. Its own cron checks the age of this marker and
# shouts if we stop showing up — the safety net for the wiped-cron problem
# described at the top of this file.
#
# This needs a SECOND key: the pull key is pinned to a read-only rrsync
# forced command and so cannot write anything. The ping key's forced
# command is literally just the touch, so it grants nothing else either.
# Failure here must not fail the backup — the data is already safe.
if [[ -r "$PING_KEY" ]]; then
  ssh -i "$PING_KEY" -o IdentitiesOnly=yes -o BatchMode=yes \
      -o StrictHostKeyChecking=accept-new \
      "${VPS_USER}@${VPS_HOST}" true \
    || log "WARN: could not ping the VPS freshness marker"
else
  log "WARN: ping key $PING_KEY missing — VPS cannot tell this ran"
fi

log "OK snapshot $(basename "$TODAY") (${actual_bytes} B), $(find "$SNAP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' | wc -l) kept"
