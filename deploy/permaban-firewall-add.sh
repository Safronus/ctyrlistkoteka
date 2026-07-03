#!/usr/bin/env bash
# Helper volaný fail2ban akcí permaban-firewall pri každém banu z
# reportable jailu (nginx-noscript, sshd, sshd-logger). Náhrada za
# permaban-nginx-add.sh — přidává IP přímo do nftables setu, takže
# je blokovaná na L3 (paket dropnutý před TLS handshake / HTTP parse).
#
# Chování:
#   1. Whitelist + private/reserved guard — nikdy nepřidáme vlastní IP
#      ani RFC 1918 / 5737 rozsahy.
#   2. Detekce IPv4 vs IPv6 přes přítomnost ":" — vybírá příslušný set
#      (permaban_v4 / permaban_v6).
#   3. flock + dedup v /var/lib/permaban/elements.nft — víc paralelních
#      banů by jinak mohlo produkovat duplikáty nebo částečně zapsanou
#      řádku.
#   4. Atomic `nft add element` — kernel set se aktualizuje okamžitě;
#      žádný debounced reload jako u nginx (nftables změny jsou in-kernel,
#      žádný reload nepotřebují).
#
# Umístění: /usr/local/sbin/permaban-firewall-add.sh
# Práva:    sudo chmod 755, vlastník root:root
#
# fail2ban actionu předává <ip> jako $1.

set -euo pipefail

IP="${1:?usage: $0 <ip>}"
ELEMENTS_FILE="${ELEMENTS_FILE:-/var/lib/permaban/elements.nft}"
WHITELIST_FILE="${WHITELIST_FILE:-/etc/permaban-whitelist.conf}"
LOCK="/run/permaban-firewall.lock"
LOG_FILE="${PERMABAN_LOG:-/var/log/permaban-firewall.log}"

log_line() {
  echo "$(date -Iseconds) $*" >> "$LOG_FILE" 2>/dev/null || true
}

# Sanity check IP — fail2ban by sem neměl pustit nic mimo IPv4/IPv6,
# ale ověřujeme defensivně, ať si neotevřeme injection cestu do `nft`.
if ! [[ "$IP" =~ ^[0-9a-fA-F:.]+$ ]]; then
  log_line "Reject invalid IP shape: $IP"
  exit 0
fi

# Whitelist (exact match per řádek). grep -F = fixed string, -x = whole
# line. Komentáře a prázdné řádky předem odfiltrované.
if [[ -f "$WHITELIST_FILE" ]]; then
  if grep -v '^[[:space:]]*#' "$WHITELIST_FILE" \
     | grep -v '^[[:space:]]*$' \
     | grep -Fxq -- "$IP"; then
    log_line "Whitelist skip: $IP"
    exit 0
  fi
fi

# Reserved/private skip — defense in depth. Stejná logika jako v
# blocklist-tools.sh awk filteru.
case "$IP" in
  10.*|127.*|169.254.*) log_line "Reserved skip: $IP"; exit 0 ;;
  192.0.2.*|198.51.100.*|203.0.113.*) log_line "Reserved skip: $IP"; exit 0 ;;
  192.168.*) log_line "Reserved skip: $IP"; exit 0 ;;
  172.1[6-9].*|172.2[0-9].*|172.3[01].*) log_line "Reserved skip: $IP"; exit 0 ;;
  ::1) log_line "Reserved skip: $IP"; exit 0 ;;
  *) ;;  # public IP → fall through to the ban below
esac
case "${IP,,}" in
  fe80:*) log_line "Reserved skip: $IP"; exit 0 ;;
  2001:0db8:*|2001:db8:*) log_line "Reserved skip: $IP"; exit 0 ;;
  *) ;;  # public IP → fall through to the ban below
esac

# Detekce family. Dvojtečka kdekoli = IPv6, jinak IPv4.
if [[ "$IP" == *:* ]]; then
  SET_NAME="permaban_v6"
else
  SET_NAME="permaban_v4"
fi

# Pojistka, že adresářová struktura existuje. systemd unit by ji měl
# vytvořit při bootu, ale při prvním banu před prvním bootem to není
# zaručené.
mkdir -p "$(dirname "$ELEMENTS_FILE")"

exec 9>"$LOCK"
flock 9

# Inicializace souboru. Bez hlavičky (jen `add element` řádky), aby
# šel rovnou `nft -f` načíst bez parsování komentářů. Komentář na
# první řádek jen jako anchor pro grep test "is file ours".
if [[ ! -f "$ELEMENTS_FILE" ]]; then
  cat > "$ELEMENTS_FILE" <<EOF
# Auto-managed permaban elements pro nftables.
# Real-time append: /usr/local/sbin/permaban-firewall-add.sh (z fail2ban action)
# Periodický rebuild: /usr/local/sbin/blocklist-tools.sh firewall-deny --apply (denní cron)
# Whitelist: $WHITELIST_FILE
# Soubor obsahuje 'add element' statementy, načítané při bootu přes
# permaban-firewall-load.service. Manuální editace přežijí jen do
# dalšího rebuildu (cron přepisuje soubor s diff testem).
EOF
  chmod 644 "$ELEMENTS_FILE"
fi

# Dedup — escape teček pro IPv4, pro IPv6 stačí literal porovnání.
ESC_IP="${IP//./\\.}"
if grep -qE "^add element inet permaban ${SET_NAME} \\{ ${ESC_IP} \\}\$" "$ELEMENTS_FILE"; then
  log_line "Already present: $IP ($SET_NAME)"
  exit 0
fi

# Apply na running kernel set — nft je atomic, případný error vrátí
# nenulový exit code a poznáme to.
if ! nft add element inet permaban "$SET_NAME" "{ $IP }" 2>>"$LOG_FILE"; then
  log_line "ERROR: nft add element failed for $IP ($SET_NAME)"
  exit 1
fi

# Persist do souboru pro boot replay. Append-only — rebuild dělá
# blocklist-tools.sh firewall-deny.
echo "add element inet permaban $SET_NAME { $IP }" >> "$ELEMENTS_FILE"
log_line "Added: $IP ($SET_NAME)"
