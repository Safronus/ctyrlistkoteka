#!/usr/bin/env bash
# deploy/offsite-freshness.sh — dead-man's switch for the off-site backup.
#
# Runs on the VPS from cron:
#   40 6 * * * /var/www/ctyrlistkoteka/deploy/offsite-freshness.sh >> /var/log/ctyr-backup.log 2>&1
#
# Why this exists: the pull job runs on the UNAS, whose /etc/cron.d sits on
# an overlayfs that UniFi firmware updates reset. So the pull WILL stop one
# day, silently, and the NAS is the last place that would notice. This runs
# on the VPS — whose cron we control — and turns "backups quietly stopped"
# into a loud line within MAX_AGE_DAYS instead of a discovery during a
# restore.
#
# The marker is touched by the UNAS through an SSH key whose forced command
# does nothing but that touch.

set -euo pipefail

MARKER="${MARKER:-/var/ctyrlistkoteka/.offsite/.last-pull}"
MAX_AGE_DAYS="${MAX_AGE_DAYS:-3}"

if [[ ! -e "$MARKER" ]]; then
  echo "FAIL $(date +%FT%T) off-site backup has NEVER run (no $MARKER)." >&2
  exit 1
fi

age_seconds=$(( $(date +%s) - $(stat -c %Y "$MARKER") ))
age_days=$(( age_seconds / 86400 ))

if (( age_days > MAX_AGE_DAYS )); then
  cat >&2 <<EOF
FAIL $(date +%FT%T) off-site backup is STALE: last pull ${age_days} days ago.
  The UNAS has stopped pulling. Most likely cause: a UniFi firmware update
  wiped /etc/cron.d/ctyrlistkoteka-backup (the script in /persistent
  survives, the cron entry does not). Re-create it:

    printf '30 4 * * * root /persistent/ctyrlistkoteka/unas-pull.sh >> /persistent/ctyrlistkoteka/pull.log 2>&1\\n' \\
      > /etc/cron.d/ctyrlistkoteka-backup

  Then run the script once by hand and confirm this stops firing.
EOF
  exit 2
fi

echo "OK $(date +%FT%T) off-site backup fresh (last pull ${age_days}d ago)"
