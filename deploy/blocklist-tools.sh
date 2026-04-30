#!/usr/bin/env bash
# Toolkit nad /var/log/fail2ban-blocklist.tsv — statistiky, export
# unikátních IP, generování nginx `deny` souboru pro permaban.
#
# Použití:
#   blocklist-tools.sh stats          # souhrn (kolik banů celkem, top jail, top IP)
#   blocklist-tools.sh ips            # unikátní IP setříděné podle počtu banů
#   blocklist-tools.sh nginx-deny     # nginx-deny soubor pro permaban (zdrojem
#                                       jsou IP banované 3+× za poslední 30 dní)
#   blocklist-tools.sh recent N       # posledních N banů s časem a důvodem
#
# Umístění: /usr/local/sbin/blocklist-tools.sh
# Práva:    sudo chmod 755, vlastník root:root

set -euo pipefail

LOG="/var/log/fail2ban-blocklist.tsv"
NGINX_DENY="/etc/nginx/snippets/permaban-list.conf"
WINDOW_DAYS="${WINDOW_DAYS:-30}"
PERMABAN_THRESHOLD="${PERMABAN_THRESHOLD:-3}"

cmd="${1:-stats}"

if [ ! -f "$LOG" ]; then
  echo "Blocklist log neexistuje: $LOG"
  echo "(fail2ban ještě nikoho nebanoval, nebo blocklist action není aktivní)"
  exit 0
fi

case "$cmd" in
  stats)
    total=$(wc -l < "$LOG")
    unique=$(awk -F'\t' '{print $2}' "$LOG" | sort -u | wc -l)
    echo "Celkem banů:        $total"
    echo "Unikátních IP:      $unique"
    echo
    echo "TOP 10 jail:"
    awk -F'\t' '{print $3}' "$LOG" | sort | uniq -c | sort -rn | head -10
    echo
    echo "TOP 10 IP (nejvíc banů):"
    awk -F'\t' '{print $2}' "$LOG" | sort | uniq -c | sort -rn | head -10
    ;;

  ips)
    awk -F'\t' '{print $2}' "$LOG" | sort | uniq -c | sort -rn
    ;;

  recent)
    n="${2:-20}"
    tail -n "$n" "$LOG" | column -t -s $'\t' -N čas,IP,jail,důvod
    ;;

  nginx-deny)
    # IP banované >= PERMABAN_THRESHOLD × za posledních WINDOW_DAYS dní.
    # Filtrujeme JEN jail=nginx-noscript — `nginx deny` direktiva
    # blokuje HTTP requesty, takže IP odchycené z SSH (sshd / sshd-logger)
    # by tam dělaly jen šum. SSH útoky řeší sshd jail nezávisle (firewall ban).
    cutoff=$(date -Iseconds -d "$WINDOW_DAYS days ago")
    {
      echo "# Auto-generated permaban list"
      echo "# Source: $LOG (filter: jail=nginx-noscript)"
      echo "# Generated: $(date -Iseconds)"
      echo "# Threshold: IPs banned >= ${PERMABAN_THRESHOLD}× in last ${WINDOW_DAYS} days"
      echo "#"
      awk -F'\t' -v cutoff="$cutoff" -v thr="$PERMABAN_THRESHOLD" '
        $1 >= cutoff && $3 == "nginx-noscript" { count[$2]++ }
        END {
          for (ip in count) if (count[ip] >= thr) print "deny " ip ";"
        }
      ' "$LOG" | sort
    } > "$NGINX_DENY.tmp"
    mv "$NGINX_DENY.tmp" "$NGINX_DENY"
    n=$(grep -c '^deny ' "$NGINX_DENY" || true)
    echo "Vygenerováno $n IP do $NGINX_DENY"
    echo "Pro aktivaci přidej do server bloku:"
    echo "    include $NGINX_DENY;"
    echo "a pak: sudo nginx -t && sudo systemctl reload nginx"
    ;;

  *)
    echo "Použití: $0 {stats|ips|recent [N]|nginx-deny}"
    echo "  ENV proměnné pro nginx-deny:"
    echo "    WINDOW_DAYS=$WINDOW_DAYS  PERMABAN_THRESHOLD=$PERMABAN_THRESHOLD"
    exit 1
    ;;
esac
