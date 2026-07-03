#!/usr/bin/env bash
# Toolkit nad /var/log/fail2ban-blocklist.tsv — statistiky, export
# unikátních IP, generování nginx `deny` souboru pro permaban.
#
# Použití:
#   blocklist-tools.sh stats              # souhrn (kolik banů celkem, top jail, top IP)
#   blocklist-tools.sh ips                # unikátní IP setříděné podle počtu banů
#   blocklist-tools.sh nginx-deny         # legacy — vygeneruje permaban-list.conf
#                                           (L7 drop v nginx, ponecháno pro rollback
#                                           po nftables migraci).
#   blocklist-tools.sh firewall-deny      # vygeneruje elements.nft z TSV pro
#                                           nftables sety inet permaban permaban_{v4,v6}.
#                                           L3 drop — paket dropnutý před TLS handshake.
#   blocklist-tools.sh recent N           # posledních N banů s časem a důvodem
#
# Oba `*-deny` cíle berou volitelný `--apply` jako 2. argument, jinak
# jen vygenerují soubor a vypíší příkaz k aktivaci.
#
# ENV proměnné (s výchozími hodnotami):
#   WINDOW_DAYS=3650            "kolik dní zpět TSV uvážit" (default ~10 let = forever)
#   PERMABAN_THRESHOLD=1        kolikrát musí být IP zabanovaná, aby se přidala
#   INCLUDE_JAILS="nginx-noscript sshd sshd-logger"
#                               whitespace-separovaný seznam jailů, které se započítávají
#   WHITELIST_FILE=/etc/permaban-whitelist.conf
#                               cesta k whitelist souboru (jeden IP / # komentář per řádek)
#   NGINX_DENY=/etc/nginx/snippets/permaban-list.conf
#                               cílový .conf pro nginx-deny (legacy)
#   ELEMENTS_FILE=/var/lib/permaban/elements.nft
#                               cílový .nft pro firewall-deny (nftables perzistence)
#   BACKUP_DIR=/var/backups/permaban
#                               kam se ukládají snapshoty před každým rebuildem
#   BACKUP_RETENTION_DAYS=30    auto-prune snapshotů starších než N dní
#
# Umístění: /usr/local/sbin/blocklist-tools.sh
# Práva:    sudo chmod 755, vlastník root:root

set -euo pipefail

LOG="/var/log/fail2ban-blocklist.tsv"
NGINX_DENY="${NGINX_DENY:-/etc/nginx/snippets/permaban-list.conf}"
ELEMENTS_FILE="${ELEMENTS_FILE:-/var/lib/permaban/elements.nft}"
WINDOW_DAYS="${WINDOW_DAYS:-3650}"
PERMABAN_THRESHOLD="${PERMABAN_THRESHOLD:-1}"
INCLUDE_JAILS="${INCLUDE_JAILS:-nginx-noscript sshd sshd-logger}"
WHITELIST_FILE="${WHITELIST_FILE:-/etc/permaban-whitelist.conf}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/permaban}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

cmd="${1:-stats}"

if [[ ! -f "$LOG" ]]; then
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
    cutoff=$(date -Iseconds -d "$WINDOW_DAYS days ago")
    TMP=$(mktemp)
    trap 'rm -f "$TMP"' EXIT

    # Whitelist do regex. Whitelist soubor může chybět — pak nikdo není
    # whitelisted (kromě reserved/private rozsahů níž). Komentáře a
    # prázdné řádky ignorujeme, '.' v IP escapujeme pro awk regex.
    WL_REGEX=""
    if [[ -f "$WHITELIST_FILE" ]]; then
      WL_REGEX=$(awk '
        /^[[:space:]]*#/ { next }
        /^[[:space:]]*$/ { next }
        { gsub(/^[[:space:]]+|[[:space:]]+$/, ""); gsub(/\./, "\\."); print "^" $0 "$" }
      ' "$WHITELIST_FILE" | paste -sd'|' -)
    fi

    # Jails do whitespace-bound regex pro awk porovnání.
    JAIL_REGEX=$(echo "$INCLUDE_JAILS" | awk '{
      for (i = 1; i <= NF; i++) printf "%s%s", (i>1 ? "|" : ""), "^"$i"$";
    }')

    {
      echo "# Auto-generated permaban list"
      echo "# Source: $LOG"
      echo "# Generated: $(date -Iseconds)"
      echo "# Window: last ${WINDOW_DAYS} days"
      echo "# Threshold: IPs banned >= ${PERMABAN_THRESHOLD}×"
      echo "# Jails: ${INCLUDE_JAILS}"
      echo "# Whitelist: ${WHITELIST_FILE} ($([[ -f "$WHITELIST_FILE" ]] && grep -cv '^[[:space:]]*\(#\|$\)' "$WHITELIST_FILE" || echo 0) entries)"
      echo "#"
      awk -F'\t' \
        -v cutoff="$cutoff" \
        -v thr="$PERMABAN_THRESHOLD" \
        -v jail_regex="$JAIL_REGEX" \
        -v wl_regex="$WL_REGEX" '
        function is_reserved(ip) {
          # RFC 5737 doc, RFC 3849 IPv6 doc, RFC 1918 private, loopback,
          # link-local. Tyhle se nikdy nedostanou do nginx deny — i kdyby
          # se omylem dostaly do TSV (test, špatně nakonfigurovaný proxy
          # header), nikdy nereprezentují skutečného útočníka.
          if (ip ~ /^10\./) return 1
          if (ip ~ /^127\./) return 1
          if (ip ~ /^169\.254\./) return 1
          if (ip ~ /^172\.(1[6-9]|2[0-9]|3[01])\./) return 1
          if (ip ~ /^192\.168\./) return 1
          if (ip ~ /^192\.0\.2\./) return 1
          if (ip ~ /^198\.51\.100\./) return 1
          if (ip ~ /^203\.0\.113\./) return 1
          if (ip ~ /^::1$/) return 1
          if (ip ~ /^[Ff][Ee]80:/) return 1
          if (ip ~ /^2001:0?[Dd][Bb]8:/) return 1
          return 0
        }
        $1 >= cutoff && $3 ~ jail_regex {
          ip = $2
          if (is_reserved(ip)) next
          if (wl_regex != "" && ip ~ wl_regex) next
          count[ip]++
        }
        END {
          for (ip in count) if (count[ip] >= thr) print "deny " ip ";"
        }
      ' "$LOG" | sort
    } > "$TMP"

    n=$(grep -c '^deny ' "$TMP" || true)

    # Idempotence — pokud se obsah po hlavičce nezmění, neděláme nic.
    # `cmp -s` vrací nenulu při rozdílu, takže testem srovnáme s
    # předchozím .conf. Hlavičku ignorujeme přes `tail -n +N` (počet
    # statických komentářových řádků = 8 výše).
    if [[ -f "$NGINX_DENY" ]] && \
       diff -q <(tail -n +9 "$NGINX_DENY") <(tail -n +9 "$TMP") > /dev/null 2>&1; then
      echo "Permaban list beze změny ($n IP). Reload nginx se neprovádí."
      exit 0
    fi

    # Snapshot předchozího stavu (atomicky před přepsáním).
    if [[ -f "$NGINX_DENY" ]]; then
      mkdir -p "$BACKUP_DIR"
      chmod 750 "$BACKUP_DIR"
      ts=$(date -Iseconds | tr ':' '-')
      cp -p "$NGINX_DENY" "$BACKUP_DIR/permaban-list.${ts}.conf"
      # Auto-prune starých snapshotů. -mtime +N = starší než N dní.
      find "$BACKUP_DIR" -maxdepth 1 -type f -name 'permaban-list.*.conf' \
        -mtime +"$BACKUP_RETENTION_DAYS" -delete 2>/dev/null || true
    fi

    install -m 0644 "$TMP" "$NGINX_DENY"
    echo "Vygenerováno $n IP do $NGINX_DENY"

    # Apply mode — pokud nás volá cron / fail2ban-action, chceme rovnou
    # nginx -t && reload. Argument --apply (volitelný) tohle zapne.
    if [[ "${2:-}" = "--apply" ]]; then
      if nginx -t 2>/dev/null; then
        systemctl reload nginx
        echo "nginx reload OK."
      else
        echo "nginx -t selhal — reload přeskočen, mrkni na config." >&2
        exit 1
      fi
    else
      echo "Pro aktivaci proveď:"
      echo "    sudo nginx -t && sudo systemctl reload nginx"
    fi
    ;;

  firewall-deny)
    # Rebuild nftables elements.nft z TSV. Output formát:
    #   flush set inet permaban permaban_v4
    #   flush set inet permaban permaban_v6
    #   add element inet permaban permaban_v4 { 1.2.3.4 }
    #   add element inet permaban permaban_v6 { 2001:db8::1 }
    #
    # Jeden `nft -f` na celý soubor = atomická kernel transakce
    # (flush + add v jednom kroku, žádné okno, kdy by set byl prázdný).
    #
    # Idempotence: pokud se obsah po hlavičce nezmění oproti aktuálnímu
    # ELEMENTS_FILE, `nft -f` se neprovede.

    cutoff=$(date -Iseconds -d "$WINDOW_DAYS days ago")
    TMP=$(mktemp)
    trap 'rm -f "$TMP"' EXIT

    WL_REGEX=""
    if [[ -f "$WHITELIST_FILE" ]]; then
      WL_REGEX=$(awk '
        /^[[:space:]]*#/ { next }
        /^[[:space:]]*$/ { next }
        { gsub(/^[[:space:]]+|[[:space:]]+$/, ""); gsub(/\./, "\\."); print "^" $0 "$" }
      ' "$WHITELIST_FILE" | paste -sd'|' -)
    fi

    JAIL_REGEX=$(echo "$INCLUDE_JAILS" | awk '{
      for (i = 1; i <= NF; i++) printf "%s%s", (i>1 ? "|" : ""), "^"$i"$";
    }')

    {
      echo "# Auto-generated permaban elements pro nftables"
      echo "# Source: $LOG"
      echo "# Generated: $(date -Iseconds)"
      echo "# Window: last ${WINDOW_DAYS} days"
      echo "# Threshold: IPs banned >= ${PERMABAN_THRESHOLD}×"
      echo "# Jails: ${INCLUDE_JAILS}"
      echo "# Whitelist: ${WHITELIST_FILE} ($([[ -f "$WHITELIST_FILE" ]] && grep -cv '^[[:space:]]*\(#\|$\)' "$WHITELIST_FILE" || echo 0) entries)"
      echo "#"
      echo "flush set inet permaban permaban_v4"
      echo "flush set inet permaban permaban_v6"
      awk -F'\t' \
        -v cutoff="$cutoff" \
        -v thr="$PERMABAN_THRESHOLD" \
        -v jail_regex="$JAIL_REGEX" \
        -v wl_regex="$WL_REGEX" '
        function is_reserved(ip) {
          if (ip ~ /^10\./) return 1
          if (ip ~ /^127\./) return 1
          if (ip ~ /^169\.254\./) return 1
          if (ip ~ /^172\.(1[6-9]|2[0-9]|3[01])\./) return 1
          if (ip ~ /^192\.168\./) return 1
          if (ip ~ /^192\.0\.2\./) return 1
          if (ip ~ /^198\.51\.100\./) return 1
          if (ip ~ /^203\.0\.113\./) return 1
          if (ip ~ /^::1$/) return 1
          if (ip ~ /^[Ff][Ee]80:/) return 1
          if (ip ~ /^2001:0?[Dd][Bb]8:/) return 1
          return 0
        }
        $1 >= cutoff && $3 ~ jail_regex {
          ip = $2
          if (is_reserved(ip)) next
          if (wl_regex != "" && ip ~ wl_regex) next
          count[ip]++
        }
        END {
          for (ip in count) {
            if (count[ip] >= thr) {
              if (ip ~ /:/) {
                print "add element inet permaban permaban_v6 { " ip " }"
              } else {
                print "add element inet permaban permaban_v4 { " ip " }"
              }
            }
          }
        }
      ' "$LOG" | sort
    } > "$TMP"

    n=$(grep -c '^add element' "$TMP" || true)

    # Idempotence — porovnání bez hlavičky. Statických komentářových
    # řádků nahoře je 9 (řádky 1–9), data začíná řádkem 10 (flush statementy).
    if [[ -f "$ELEMENTS_FILE" ]] && \
       diff -q <(tail -n +10 "$ELEMENTS_FILE") <(tail -n +10 "$TMP") > /dev/null 2>&1; then
      echo "Permaban elements beze změny ($n IP). nft -f se neprovádí."
      exit 0
    fi

    # Snapshot předchozího stavu.
    if [[ -f "$ELEMENTS_FILE" ]]; then
      mkdir -p "$BACKUP_DIR"
      chmod 750 "$BACKUP_DIR"
      ts=$(date -Iseconds | tr ':' '-')
      cp -p "$ELEMENTS_FILE" "$BACKUP_DIR/elements.${ts}.nft"
      find "$BACKUP_DIR" -maxdepth 1 -type f -name 'elements.*.nft' \
        -mtime +"$BACKUP_RETENTION_DAYS" -delete 2>/dev/null || true
    fi

    mkdir -p "$(dirname "$ELEMENTS_FILE")"
    install -m 0644 "$TMP" "$ELEMENTS_FILE"
    echo "Vygenerováno $n IP do $ELEMENTS_FILE"

    if [[ "${2:-}" = "--apply" ]]; then
      if nft -f "$ELEMENTS_FILE" 2>&1; then
        echo "nft reload OK ($n IP v setech)."
      else
        echo "nft -f selhal — sety mohou být v částečném stavu." >&2
        echo "Ověř stav: sudo nft list set inet permaban permaban_v4" >&2
        exit 1
      fi
    else
      echo "Pro aktivaci proveď:"
      echo "    sudo nft -f $ELEMENTS_FILE"
    fi
    ;;

  *)
    echo "Použití: $0 {stats|ips|recent [N]|nginx-deny [--apply]|firewall-deny [--apply]}"
    echo "  ENV proměnné pro *-deny:"
    echo "    WINDOW_DAYS=$WINDOW_DAYS"
    echo "    PERMABAN_THRESHOLD=$PERMABAN_THRESHOLD"
    echo "    INCLUDE_JAILS=\"$INCLUDE_JAILS\""
    echo "    WHITELIST_FILE=$WHITELIST_FILE"
    echo "    NGINX_DENY=$NGINX_DENY            (legacy)"
    echo "    ELEMENTS_FILE=$ELEMENTS_FILE     (nftables)"
    echo "    BACKUP_DIR=$BACKUP_DIR"
    echo "    BACKUP_RETENTION_DAYS=$BACKUP_RETENTION_DAYS"
    exit 1
    ;;
esac
