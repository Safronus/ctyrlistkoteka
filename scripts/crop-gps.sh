#!/usr/bin/env bash
# Přenese GPS + datum z originálů (data/finds/) na odpovídající výřezy (data/crops/).
# Párování přes ČÍSLO NÁLEZU = první segment názvu před prvním '+', takže to sedí
# i když se liší přípona (.jpg/.jpeg) nebo stav/poznámka v názvu.
#
# Bez argumentu = DRY-RUN (jen spočítá, nic nezapíše).
# Ostrý běh:  bash crop-gps.sh run
#
# Dotfiles (.DS_Store apod.) se přeskakují — macOS je rád zaseje přes rsync a
# jinak nafukují počty a plodí neškodné „Unknown file type" warningy exiftoolu.
set -euo pipefail

# --- kde jsou data (z .env appky, s rozumným defaultem) ---
ENV_FILE="${ENV_FILE:-/var/www/ctyrlistkoteka/.env}"
DATA="${DATA_DIR:-}"
if [ -z "$DATA" ] && [ -f "$ENV_FILE" ]; then
  DATA="$(grep '^DATA_DIR=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' || true)"
fi
DATA="${DATA:-/var/ctyrlistkoteka/data}"
FINDS="$DATA/finds"
CROPS="$DATA/crops"
MODE="${1:-dry}"

command -v exiftool >/dev/null 2>&1 || {
  echo "exiftool chybí — nainstaluj:  sudo apt install -y libimage-exiftool-perl"; exit 1; }
[ -d "$FINDS" ] && [ -d "$CROPS" ] || { echo "Nenašel jsem $FINDS nebo $CROPS"; exit 1; }
echo "finds: $FINDS"
echo "crops: $CROPS"

# --- index originálů podle čísla nálezu (dotfiles vynechány) ---
declare -A ORIG
while IFS= read -r -d '' f; do
  b=${f##*/}; fid=${b%%+*}
  ORIG["$fid"]="$f"
done < <(find "$FINDS" -maxdepth 1 -type f ! -name '.*' -print0)

# --- sestav argfile: pro každý crop najdi originál podle čísla ---
ARGS="$(mktemp)"
trap 'rm -f "$ARGS"' EXIT
matched=0; missing=0
while IFS= read -r -d '' c; do
  b=${c##*/}; fid=${b%%+*}
  o="${ORIG[$fid]:-}"
  if [ -z "$o" ]; then missing=$((missing+1)); continue; fi
  matched=$((matched+1))
  printf -- '-tagsFromFile\n%s\n-GPS:all\n-alldates\n%s\n' "$o" "$c" >> "$ARGS"
done < <(find "$CROPS" -maxdepth 1 -type f ! -name '.*' -print0)

echo "výřezů spárováno s originálem: $matched"
echo "výřezů bez originálu (přeskočeno): $missing"

if [ "$MODE" != "run" ]; then
  echo
  echo "DRY-RUN — nic se nezapsalo. Ostrý běh:  bash $0 run"
  exit 0
fi

echo "Zapisuji GPS + datum do výřezů (mtime zachován, WebP se nepřegeneruje)…"
# -charset filename=utf8: názvy s diakritikou nezávisle na locale serveru.
# -P: zachová čas úpravy → sync výřezy nepřeprocesuje.
# -overwrite_original: atomicky (temp→rename), bez _original záloh.
exiftool -charset filename=utf8 -overwrite_original -P -progress -@ "$ARGS"
echo "Hotovo."
