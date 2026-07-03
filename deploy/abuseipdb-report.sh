#!/usr/bin/env bash
# /usr/local/sbin/abuseipdb-report.sh
#
# Denní batch report nových fail2ban banů na https://www.abuseipdb.com/
# přes jejich bulk-report endpoint. Čte /var/log/fail2ban-blocklist.tsv,
# filtruje řádky novější než last-timestamp z předchozího běhu, mapuje
# jail → AbuseIPDB kategorie a POSTne to.
#
# Files:
#   /etc/abuseipdb-key                          API klíč (chmod 600 root:root)
#   /var/log/fail2ban-blocklist.tsv             Source data (z fail2ban action)
#   /var/lib/abuseipdb-report/last-timestamp    State (poslední reportovaný TS)
#   /var/log/abuseipdb-report.log               Output log
#
# Cron — přes /etc/cron.d/abuseipdb-report (viz deploy/abuseipdb-report.cron)
#
# Mapování jail → AbuseIPDB kategorie (https://www.abuseipdb.com/categories):
#   sshd, sshd-logger  → 18,22  (Brute-Force, SSH)
#   nginx-noscript     → 19,21  (Bad Web Bot, Web App Attack)
#   ostatní            → 15     (Hacking) fallback

set -euo pipefail

LOG="/var/log/fail2ban-blocklist.tsv"
STATE_DIR="/var/lib/abuseipdb-report"
STATE="$STATE_DIR/last-timestamp"
KEY_FILE="/etc/abuseipdb-key"
API_URL="https://api.abuseipdb.com/api/v2/bulk-report"
LOCK="/run/abuseipdb-report.lock"

# Single instance only — paralelní běh by vedl k duplicitním reportům.
exec 9>"$LOCK"
flock -n 9 || { echo "$(date -Iseconds) Already running, skip"; exit 0; }

# Sanity
command -v jq >/dev/null 2>&1 || {
  echo "jq není nainstalované (sudo apt install jq)" >&2
  exit 1
}
[[ -r "$KEY_FILE" ]] || { echo "API key unreadable: $KEY_FILE" >&2; exit 1; }
[[ -f "$LOG" ]] || { echo "$(date -Iseconds) No blocklist log yet: $LOG"; exit 0; }

# Ověř, že API klíč není world-readable — selhává brzy, ne až po POSTu.
KEY_PERMS=$(stat -c "%a" "$KEY_FILE")
case "$KEY_PERMS" in
  600|400) ;;
  *)
    echo "API key má nezabezpečená oprávnění ($KEY_PERMS), čekáno 600/400" >&2
    exit 1
    ;;
esac

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
# The Next.js admin (PM2 user `app`) reads $STATE for the blocklist page.
# The chmod above resets the ACL mask, so re-grant traversal to `app` on
# every run — a one-off `setfacl` would be masked out again at the next cron.
setfacl -m u:app:rx "$STATE_DIR" 2>/dev/null || true

API_KEY=$(cat "$KEY_FILE")
LAST_TS=$(cat "$STATE" 2>/dev/null || echo "")

CSV=$(mktemp)
RESP=$(mktemp)
trap 'rm -f "$CSV" "$RESP"' EXIT

# Filtruj TSV $1 > LAST_TS; přidej CSV header.
# Reserved/dokumentační adresy (RFC 5737, RFC 3849) se nikdy nereportují
# — patří sem mimo jiné 192.0.2.1, kterou jsme používali při smoke testu
# action chainu, a obecně každá test/dokumentační IP, která by se omylem
# dostala do TSV. AbuseIPDB by je nejspíš stejně odmítl jako
# invalidReports, ale lepší je je nevyrobit vůbec.
{
  echo "IP,Categories,ReportDate,Comment"
  awk -F'\t' -v last="$LAST_TS" '
    function csv_escape(s) {
      gsub(/"/, "\"\"", s)
      return "\"" s "\""
    }
    function categories(jail) {
      if (jail == "sshd" || jail == "sshd-logger") return "18,22"
      if (jail == "nginx-noscript") return "19,21"
      return "15"
    }
    function is_reserved(ip) {
      # RFC 5737 — TEST-NET-1/2/3 (192.0.2/24, 198.51.100/24, 203.0.113/24)
      if (ip ~ /^192\.0\.2\./) return 1
      if (ip ~ /^198\.51\.100\./) return 1
      if (ip ~ /^203\.0\.113\./) return 1
      # RFC 3849 — IPv6 dokumentační prefix (2001:db8::/32)
      if (ip ~ /^2001:0?[Dd][Bb]8:/) return 1
      return 0
    }
    $1 > last && !is_reserved($2) {
      cmt = "Banned by fail2ban jail=" $3
      if ($4 != "") cmt = cmt " match=" $4
      print $2 "," csv_escape(categories($3)) "," $1 "," csv_escape(cmt)
    }
  ' "$LOG"
} > "$CSV"

ROWS=$(($(wc -l < "$CSV") - 1))
if [[ "$ROWS" -le 0 ]]; then
  echo "$(date -Iseconds) No new bans (since: ${LAST_TS:-never})"
  exit 0
fi

echo "$(date -Iseconds) Reporting $ROWS bans (since: ${LAST_TS:-never})"

HTTP_CODE=$(curl -sS -o "$RESP" -w "%{http_code}" -X POST "$API_URL" \
  -H "Key: $API_KEY" \
  -H "Accept: application/json" \
  -F "csv=@$CSV;type=text/csv")

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "$(date -Iseconds) AbuseIPDB API error: HTTP $HTTP_CODE" >&2
  cat "$RESP" >&2 || true
  exit 1
fi

SAVED=$(jq -r '.data.savedReports // 0' "$RESP")
INVALID=$(jq -r '.data.invalidReports // [] | length' "$RESP")

# State posuneme na MAX timestamp z LOGU (ne z CSV — log mohl mezitím
# narůst dál, ale do CSV jde jen to, co bylo při filtraci k vidění; další
# řádky sedící na disku mezi awk-em a state-update vezmeme za příště).
NEW_LAST=$(awk -F'\t' '{ print $1 }' "$LOG" | sort | tail -1)
echo "$NEW_LAST" > "$STATE"
setfacl -m u:app:r "$STATE" 2>/dev/null || true

echo "$(date -Iseconds) Saved=$SAVED Invalid=$INVALID NewState=$NEW_LAST"
