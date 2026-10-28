#!/usr/bin/env bash
# deploy/update-docker-services.sh — bring self-hosted Docker Compose
# services up to their latest image, safely.
#
#   sudo bash /var/www/ctyrlistkoteka/deploy/update-docker-services.sh <compose-dir> [<compose-dir>…]
#
# Run it when the weekly *Runtime security* check reports a `docker`
# finding. The compose directories are arguments, not baked in — which
# services run where is server knowledge, not repo knowledge.
#
# Per directory: pull → recreate → verify. It stops at the first failure.
#   • every service of the project must be running afterwards;
#   • a server identity (data/id_ed25519.pub, RustDesk) must be unchanged —
#     a new one would force every client to be re-pointed;
#   • no container may keep data in an ANONYMOUS volume: that is data
#     outside its compose directory, outside the off-site backup, and lost
#     the next time the container is recreated after a `down`. GoatCounter
#     sat like that from 2026-04-30 to 2026-10-28 (its volume target didn't
#     match where the image writes).
# Afterwards only DANGLING images (the versions just replaced) are pruned.
#
# Take a backup first (deploy/backup-services.sh).

set -euo pipefail

fail() { echo "FAIL: $*" >&2; exit 1; }

[[ $# -ge 1 ]] || fail "usage: $0 <compose-dir> [<compose-dir>…]"
command -v docker > /dev/null || fail "docker not found"

for dir in "$@"; do
  [[ "$dir" == /* ]] || fail "$dir: give an absolute path"
  [[ -f "$dir/docker-compose.yml" || -f "$dir/compose.yaml" ]] || fail "$dir: no compose file"
  cd "$dir"
  echo "== $dir"

  identity=""
  if [[ -f data/id_ed25519.pub ]]; then
    identity=$(sha256sum data/id_ed25519.pub | cut -d' ' -f1)
  fi

  docker compose pull
  docker compose up -d

  # Give restart loops a moment to show up as "not running".
  sleep 5
  expected=$(docker compose config --services | sort)
  running=$(docker compose ps --status running --services | sort)
  [[ "$expected" == "$running" ]] || fail "$dir: not every service is running (expected: $(echo $expected), running: $(echo $running))"

  if [[ -n "$identity" ]]; then
    now=$(sha256sum data/id_ed25519.pub | cut -d' ' -f1)
    [[ "$now" == "$identity" ]] || fail "$dir: data/id_ed25519.pub CHANGED — clients will reject the server; restore the key from the backup"
  fi

  # Anonymous volume = a 64-hex volume name, created by an image VOLUME the
  # compose file doesn't mount over.
  for cid in $(docker compose ps -q); do
    anon=$(docker inspect "$cid" --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} -> {{.Destination}}{{println}}{{end}}{{end}}' \
      | grep -E '^[0-9a-f]{64} ' || true)
    if [[ -n "$anon" ]]; then
      name=$(docker inspect "$cid" --format '{{.Name}}')
      fail "$dir: container ${name#/} keeps data in an anonymous volume (not backed up, lost on recreate): $anon — mount that path from the compose directory"
    fi
  done

  echo "OK $dir: $(echo $running) running, images: $(docker compose ps --format '{{.Image}}' | sort -u | tr '\n' ' ')"
done

docker image prune -f > /dev/null
echo "OK all done; replaced image versions pruned."
