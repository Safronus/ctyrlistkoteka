#!/usr/bin/env bash
# Helper volaný fail2ban akcí permaban-nginx pri každém banu z reportable
# jailu (nginx-noscript, sshd, sshd-logger). Chování:
#
#   1. Whitelist + private/reserved guard — nikdy nepřidáme vlastní IP
#      ani RFC 1918 / 5737 rozsahy do nginx deny listu.
#   2. Append `deny <ip>;` do permaban-list.conf přes flock + dedup
#      (víc než jeden běh paralelně by jinak mohl produkovat duplikáty
#      nebo částečně zapsanou řádku).
#   3. Debounced reload nginx přes systemd transient unit. Multiple
#      bany v okně RELOAD_DEBOUNCE_SEC se sloučí do jednoho reloadu —
#      pod útokem (stovky banů/minutu) by jinak nginx zaplevelily.
#
# Umístění: /usr/local/sbin/permaban-nginx-add.sh
# Práva:    sudo chmod 755, vlastník root:root
#
# fail2ban actionu předává <ip> jako $1.

set -euo pipefail

IP="${1:?usage: $0 <ip>}"
NGINX_DENY="${NGINX_DENY:-/etc/nginx/snippets/permaban-list.conf}"
WHITELIST_FILE="${WHITELIST_FILE:-/etc/permaban-whitelist.conf}"
LOCK="/run/permaban-nginx.lock"
RELOAD_DEBOUNCE_SEC="${RELOAD_DEBOUNCE_SEC:-60}"
LOG_FILE="${PERMABAN_LOG:-/var/log/permaban-nginx.log}"

log_line() {
  echo "$(date -Iseconds) $*" >> "$LOG_FILE" 2>/dev/null || true
}

# Sanity check IP — fail2ban by sem neměl pustit nic mimo IPv4/IPv6,
# ale ověřujeme defensivně, ať si neotevřeme injection cestu.
if ! [[ "$IP" =~ ^[0-9a-fA-F:.]+$ ]]; then
  log_line "Reject invalid IP shape: $IP"
  exit 0
fi

# Whitelist (exact match per řádek). grep -F = fixed string, -x =
# whole line, -E vyloučíme komentáře předem.
if [[ -f "$WHITELIST_FILE" ]]; then
  if grep -v '^[[:space:]]*#' "$WHITELIST_FILE" \
     | grep -v '^[[:space:]]*$' \
     | grep -Fxq -- "$IP"; then
    log_line "Whitelist skip: $IP"
    exit 0
  fi
fi

# Reserved/private skip — defense in depth. Tatáž logika jako v
# blocklist-tools.sh awk filteru, jen v bash glob patternu.
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

exec 9>"$LOCK"
flock 9

# Hlavička při prvním vytvoření, ať operator vidí, že soubor řídí
# automation a manuální editace přežije max do dalšího cron rebuildu
# (viz blocklist-tools.sh, který soubor přepisuje s diff testem).
if [[ ! -f "$NGINX_DENY" ]]; then
  cat > "$NGINX_DENY" <<EOF
# Auto-managed permaban list.
# Real-time append: /usr/local/sbin/permaban-nginx-add.sh (z fail2ban action)
# Periodický rebuild: /usr/local/sbin/blocklist-tools.sh nginx-deny --apply (denní cron)
# Whitelist: $WHITELIST_FILE
# Manual edits prežijí jen do dalšího rebuildu — pro trvalou výjimku
# přidej IP do whitelistu.
EOF
  chmod 644 "$NGINX_DENY"
fi

# Dedup — escape teček ať '.' v regex matchne literálně.
ESC_IP="${IP//./\\.}"
if grep -qE "^deny ${ESC_IP};\$" "$NGINX_DENY"; then
  log_line "Already present: $IP"
  exit 0
fi

echo "deny $IP;" >> "$NGINX_DENY"
log_line "Added: $IP"

# Debounced reload — pokud už timer běží, necháme ho dokmitnout.
# `is-active` na transient timer vrací 0 jen pokud existuje a běží.
if ! systemctl is-active --quiet permaban-reload-pending.timer; then
  systemctl reset-failed permaban-reload-pending.timer 2>/dev/null || true
  systemctl reset-failed permaban-reload-pending.service 2>/dev/null || true
  systemd-run --quiet \
    --on-active="${RELOAD_DEBOUNCE_SEC}s" \
    --unit=permaban-reload-pending \
    --collect \
    bash -c 'nginx -t && systemctl reload nginx' \
    || log_line "systemd-run schedule failed — fallback to direct reload"
fi
