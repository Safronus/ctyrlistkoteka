#!/usr/bin/env bash
# Append-only logger volaný fail2ban `actionban` při každém banu — zapíše
# IP, čas, jail a (pokud dorazí) failregex match do TSV souboru, který
# přežije log rotation a `bantime` expiraci v sqlite DB. Slouží jako
# zdroj pro permanentní blocklist.
#
# Volání: /usr/local/sbin/fail2ban-blocklist-append.sh <ip> <jail> [<matches>]
#
# TSV sloupce:
#   1. ISO timestamp (yyyy-mm-ddThh:mm:ss+zz:zz)
#   2. IP adresa banovaná
#   3. název jail (např. nginx-noscript, sshd)
#   4. první ~80 znaků log line co ban spustila (volitelné)
#
# Umístění souboru: /usr/local/sbin/fail2ban-blocklist-append.sh
# Práva:           sudo chmod 755, vlastník root:root
# Cílový log:      /var/log/fail2ban-blocklist.tsv (vytvořen při prvním banu)

set -euo pipefail

IP="${1:-unknown}"
JAIL="${2:-unknown}"
MATCHES="${3:-}"

# Zkrácení matches řádky, ať TSV nevybobtnává — drž první 80 znaků
# bez tabulátorů/newlines (nahradí mezerou), aby TSV zůstalo validní.
MATCHES_SHORT=$(printf '%s' "$MATCHES" | tr '\t\n' '  ' | cut -c1-80)

OUT="/var/log/fail2ban-blocklist.tsv"
printf '%s\t%s\t%s\t%s\n' "$(date -Iseconds)" "$IP" "$JAIL" "$MATCHES_SHORT" >> "$OUT"
