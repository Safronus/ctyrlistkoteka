#!/usr/bin/env bash
# Jednorázová migrace existujícího nginx permaban listu na nftables sety.
#
# Co dělá:
#   1. Čte /etc/nginx/snippets/permaban-list.conf (existující seznam
#      `deny <ip>;` řádků).
#   2. Pro každou IP detekuje IPv4/IPv6 a přidá do příslušného setu
#      (permaban_v4 / permaban_v6).
#   3. Apply na běžící kernel + persist do /var/lib/permaban/elements.nft.
#   4. Suchý běh (`--dry-run`) ukáže, co by se přidalo, bez zápisu.
#
# Idempotence: skript přeskakuje IP, které už v setu jsou (přes
# nft list set). Lze spustit opakovaně bez efektu.
#
# Whitelist + reserved skip se NEZNOVU-aplikují — pokud byla IP v nginx
# permabanu, předpokládáme že už byla validovaná dříve. Pokud chceš
# čistou re-validaci, spusť blocklist-tools.sh firewall-deny --apply
# (rebuild z TSV s fresh whitelist passem).
#
# Umístění: /usr/local/sbin/migrate-nginx-permaban-to-nftables.sh
# Práva:    sudo chmod 755, vlastník root:root
#
# Volání:
#   sudo migrate-nginx-permaban-to-nftables.sh --dry-run
#   sudo migrate-nginx-permaban-to-nftables.sh --apply

set -euo pipefail

NGINX_DENY="${NGINX_DENY:-/etc/nginx/snippets/permaban-list.conf}"
ELEMENTS_FILE="${ELEMENTS_FILE:-/var/lib/permaban/elements.nft}"
MODE="${1:-}"

if [[ "$MODE" != "--dry-run" ]] && [[ "$MODE" != "--apply" ]]; then
  echo "Použití: $0 {--dry-run|--apply}"
  echo "  --dry-run: ukáže co by se přidalo, žádný zápis"
  echo "  --apply:   skutečně přidá do nftables + persist do souboru"
  exit 1
fi

if [[ ! -f "$NGINX_DENY" ]]; then
  echo "$NGINX_DENY neexistuje — nic k migraci."
  exit 0
fi

# Existující elementy v kernel setech — pro dedup.
EXISTING_V4=$(nft list set inet permaban permaban_v4 2>/dev/null \
              | awk '/elements = \{/,/\}/' \
              | tr -d '{},\n' | tr -s ' ' '\n' | grep -E '^[0-9.]+$' || true)
EXISTING_V6=$(nft list set inet permaban permaban_v6 2>/dev/null \
              | awk '/elements = \{/,/\}/' \
              | tr -d '{},\n' | tr -s ' ' '\n' | grep -E ':' || true)

# Souhrn pro report.
new_v4=()
new_v6=()
skipped=0
malformed=0

while IFS= read -r line; do
  # Match `deny <ip>;` (volitelný whitespace). Komentáře a prázdné
  # řádky odfiltrované.
  if [[ "$line" =~ ^[[:space:]]*deny[[:space:]]+([0-9a-fA-F:.]+)[[:space:]]*\;[[:space:]]*$ ]]; then
    ip="${BASH_REMATCH[1]}"
  else
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    malformed=$((malformed + 1))
    continue
  fi

  if [[ "$ip" == *:* ]]; then
    # IPv6
    if echo "$EXISTING_V6" | grep -Fxq -- "$ip"; then
      skipped=$((skipped + 1))
      continue
    fi
    new_v6+=("$ip")
  else
    # IPv4
    if echo "$EXISTING_V4" | grep -Fxq -- "$ip"; then
      skipped=$((skipped + 1))
      continue
    fi
    new_v4+=("$ip")
  fi
done < "$NGINX_DENY"

echo "=== Migrace plan ==="
echo "Zdroj: $NGINX_DENY"
echo "Cíl:   nftables sety inet permaban permaban_{v4,v6}"
echo "       persist v $ELEMENTS_FILE"
echo
echo "Nové IPv4 k přidání: ${#new_v4[@]}"
echo "Nové IPv6 k přidání: ${#new_v6[@]}"
echo "Už v setu (skip):    $skipped"
echo "Neparsovatelné:      $malformed"

if [[ "$MODE" = "--dry-run" ]]; then
  echo
  echo "(dry-run — žádný zápis)"
  if [[ ${#new_v4[@]} -gt 0 ]]; then
    echo "Sample IPv4 (prvních 10):"
    printf '  %s\n' "${new_v4[@]:0:10}"
  fi
  if [[ ${#new_v6[@]} -gt 0 ]]; then
    echo "Sample IPv6 (prvních 10):"
    printf '  %s\n' "${new_v6[@]:0:10}"
  fi
  exit 0
fi

# --apply: skutečné přidání.
mkdir -p "$(dirname "$ELEMENTS_FILE")"
touch "$ELEMENTS_FILE"

# Inicializovat hlavičku, pokud chybí.
if ! grep -q '^# Auto-managed permaban elements' "$ELEMENTS_FILE"; then
  cat > "$ELEMENTS_FILE.new" <<EOF
# Auto-managed permaban elements pro nftables.
# Real-time append: /usr/local/sbin/permaban-firewall-add.sh
# Periodický rebuild: /usr/local/sbin/blocklist-tools.sh firewall-deny --apply
# První population: migrate-nginx-permaban-to-nftables.sh $(date -Iseconds)
EOF
  cat "$ELEMENTS_FILE" >> "$ELEMENTS_FILE.new"
  mv "$ELEMENTS_FILE.new" "$ELEMENTS_FILE"
fi

added_v4=0
added_v6=0

for ip in "${new_v4[@]}"; do
  if nft add element inet permaban permaban_v4 "{ $ip }" 2>/dev/null; then
    echo "add element inet permaban permaban_v4 { $ip }" >> "$ELEMENTS_FILE"
    added_v4=$((added_v4 + 1))
  else
    echo "WARN: nft add element selhal pro $ip (v4)" >&2
  fi
done

for ip in "${new_v6[@]}"; do
  if nft add element inet permaban permaban_v6 "{ $ip }" 2>/dev/null; then
    echo "add element inet permaban permaban_v6 { $ip }" >> "$ELEMENTS_FILE"
    added_v6=$((added_v6 + 1))
  else
    echo "WARN: nft add element selhal pro $ip (v6)" >&2
  fi
done

echo
echo "=== Migrace hotová ==="
echo "Přidáno IPv4: $added_v4"
echo "Přidáno IPv6: $added_v6"
echo
echo "Stav setů:"
nft list set inet permaban permaban_v4 2>/dev/null | grep -E 'elements|^[[:space:]]*$' | head -3
nft list set inet permaban permaban_v6 2>/dev/null | grep -E 'elements|^[[:space:]]*$' | head -3
echo
echo "Po ověření že migrace funguje (test access z jedné z přesunutých IP)"
echo "můžeš odstranit nginx permaban include z nginx.conf:"
echo "    sudo sed -i '/permaban-list.conf/d' /etc/nginx/sites-enabled/ctyrlistkoteka"
echo "    sudo nginx -t && sudo systemctl reload nginx"
