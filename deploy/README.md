# Deploy — soubory a pořadí

Tato složka obsahuje **artefakty pro produkci**. Narativní postup je
v [`docs/deployment.md`](../docs/deployment.md) — tam je to vysvětleno
krok za krokem. Tento README je rychlý katalog.

| Soubor | Umístění na VPS | Kdy použít |
| --- | --- | --- |
| `ecosystem.config.cjs` | `/var/www/ctyrlistkoteka/deploy/` (git) | PM2 config. Použije `pm2 start` během první instalace a poté `pm2 reload` po každém deployi. |
| `nginx.conf.template` | `/etc/nginx/sites-available/ctyrlistkoteka` | Kopie při inicializaci. Potom `sudo nginx -t && sudo systemctl reload nginx`. |
| `nginx-snippets/block-exploits.conf` | `/etc/nginx/snippets/block-exploits.conf` | Drop notorické scanner cesty (`/.env`, `/wp-login.php`, …) — instant 444. Includuje se z hlavního configu. |
| `nginx-snippets/security-headers.conf` | `/etc/nginx/snippets/security-headers.conf` | HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy. Pro stats subdoménu (a libovolný HTTPS vhost). |
| `nginx-snippets/security-txt-redirect.conf` | `/etc/nginx/snippets/security-txt-redirect.conf` | Stats vhost: redirect `/security.txt` a `/.well-known/security.txt` na autoritativní kopii na apexu. |
| `nginx-conf.d/ssl-hardening.conf` | `/etc/nginx/conf.d/ssl-hardening.conf` | Globální `SignatureAlgorithms` — vyřadí SHA-224 (phase-out per internet.nl). Auto-include z http kontextu. |
| `fail2ban-nginx-noscript.conf` | `/etc/fail2ban/jail.d/nginx-noscript.conf` | Jail definice pro nginx-noscript filter. Skládá default ban akci s `blocklist` (logger). |
| `fail2ban-nginx-noscript-filter.conf` | `/etc/fail2ban/filter.d/nginx-noscript.conf` | Regex pro detekci scanner traffic v nginx access logu. |
| `fail2ban-sshd.conf` | `/etc/fail2ban/jail.d/sshd.local` | Override default sshd jailu — přidá `blocklist` action k SSH banům, ať i ty padají do TSV. |
| `fail2ban-sshd-logger.conf` | `/etc/fail2ban/jail.d/sshd-logger.local` | Logger-only SSH jail. Zaznamenává **každý** první failed login do TSV bez firewall banu (skutečné banování řeší [sshd] jail). |
| `fail2ban-action-blocklist.conf` | `/etc/fail2ban/action.d/blocklist.conf` | Custom action — appendne každý ban do TSV souboru pro long-term audit. |
| `fail2ban-blocklist-append.sh` | `/usr/local/sbin/` (chmod 755) | Helper, který action volá. |
| `blocklist-tools.sh` | `/usr/local/sbin/` (chmod 755) | Reporting + generování permaban listu nad TSV. |
| `logrotate-fail2ban-blocklist.conf` | `/etc/logrotate.d/fail2ban-blocklist` | Měsíční rotace TSV blocklistu, 12 archivů. |
| `abuseipdb-report.sh` | `/usr/local/sbin/` (chmod 755) | Denní bulk-report nových banů na abuseipdb.com. Čte TSV, mapuje jail→kategorie, POST /api/v2/bulk-report. |
| `abuseipdb-report.cron` | `/etc/cron.d/abuseipdb-report` | Cron entry — denně 5:30 spouští reportovací skript. |
| `logrotate-abuseipdb-report.conf` | `/etc/logrotate.d/abuseipdb-report` | Měsíční rotace logu, 6 archivů. |
| `permaban-whitelist.conf` | `/etc/permaban-whitelist.conf` | Exact-match IP whitelist — IP, které se **nikdy** nesmí dostat do permabanu (nftables ani nginx). Sdílená napříč `blocklist-tools.sh`, `permaban-firewall-add.sh`, `permaban-nginx-add.sh`. |
| `nftables-permaban.nft` | `/etc/nftables.d/permaban.nft` | **(nový)** Definice tabulky `inet permaban` se sety `permaban_v4` / `permaban_v6` + drop chainem (hook input priority -10). Načítá se při bootu přes `nftables.service`. |
| `permaban-firewall-add.sh` | `/usr/local/sbin/` (chmod 755) | **(nový)** Helper volaný fail2ban action chainem — přidá IP do nftables setu (L3 drop) + persist do `/var/lib/permaban/elements.nft`. Náhrada za `permaban-nginx-add.sh`. |
| `permaban-firewall-load.service` | `/etc/systemd/system/` | **(nový)** systemd unit — při bootu načte `/var/lib/permaban/elements.nft` do nftables setů. Po `nftables.service`, před `fail2ban.service`. |
| `fail2ban-action-permaban-firewall.conf` | `/etc/fail2ban/action.d/permaban-firewall.conf` | **(nový)** fail2ban action volající `permaban-firewall-add.sh`. Náhrada za `permaban-nginx`. |
| `migrate-nginx-permaban-to-nftables.sh` | `/usr/local/sbin/` (chmod 755) | **(nový)** Jednorázová migrace — čte `permaban-list.conf` a přesouvá IP do nftables setu. Podporuje `--dry-run`. |
| `fail2ban-jail.local.example` | `/etc/fail2ban/jail.local` (manual merge) | **(nový)** Doporučený jail.local pro pure nftables — `banaction = nftables-multiport` + nové permaban-firewall action chainy. |
| `unattended-upgrades-50ctyrlistkoteka.conf` | `/etc/apt/apt.conf.d/52ctyrlistkoteka-unattended.conf` | **(nový)** Override pro `unattended-upgrades` — security + updates pocket, blacklist postgresql/nodejs, no auto-reboot. |
| `permaban-nginx-add.sh` | `/usr/local/sbin/` (chmod 755) | **(legacy)** Append `deny <ip>;` do nginx snippetu. Ponecháno pro rollback po nftables migraci. |
| `fail2ban-action-permaban-nginx.conf` | `/etc/fail2ban/action.d/permaban-nginx.conf` | **(legacy)** fail2ban action volající permaban-nginx-add. Ponecháno pro rollback. |
| `permaban-refresh.cron` | `/etc/cron.d/permaban-refresh` | Cron entry — denně 4:30 přepoč permaban setu z TSV (self-healing pojistka). Nově volá `firewall-deny`; legacy `nginx-deny` zakomentované. |
| `logrotate-permaban.conf` | `/etc/logrotate.d/permaban` | Měsíční rotace permaban-firewall/permaban-nginx debug logů + cron rebuild logu. |
| `systemd-sync.service` | `/etc/systemd/system/` | Volitelné: noční auto-sync. |
| `systemd-sync.timer` | `/etc/systemd/system/` | Zapnout přes `systemctl enable --now ctyrlistkoteka-sync.timer`. |
| `backup.sh` | (git, spouští se odtud) | Denní `pg_dump` + rotace. Do crontab uživatele `app`. |

Spárované s:
- `.github/workflows/deploy.yml` — GitHub Actions CI/CD
- `src/app/sitemap.ts`, `src/app/robots.ts` — SEO
- `prisma/migrations/` — aplikují se na VPS přes `pnpm prisma migrate deploy`

## První nasazení — checklist

Následuj [`docs/deployment.md`](../docs/deployment.md) sekce 0–9. Klíčové kroky
po pořadí:

1. **DNS** — nastav A/AAAA u hukot.net (sekce 1)
2. **Server** — `adduser app`, SSH klíče, UFW, fail2ban (sekce 2–3)
3. **Software** — Node (nvm), pnpm, PM2, Postgres 16+PostGIS, Nginx, certbot, libheif (sekce 3)
4. **DB** — create user + db + `CREATE EXTENSION postgis` (sekce 4)
5. **FS layout** — `/var/ctyrlistkoteka/{data,generated}` (sekce 5)
6. **Clone + build** — `git clone`, `pnpm install`, `pnpm build` (sekce 6)
7. **PM2** — `pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup` (sekce 7)
8. **Nginx** — symlink template, `nginx -t && systemctl reload nginx` (sekce 8)
9. **SSL** — `sudo certbot --nginx -d ctyrlistkoteka.cz -d www.ctyrlistkoteka.cz` (sekce 9)
10. **GitHub secrets** — `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, volitelně `DEPLOY_PORT` (sekce 11)
11. **Data** — `rsync` archiv do `/var/ctyrlistkoteka/data/` → `pnpm sync` (sekce 12)
12. **Zálohy** — `crontab -e` → `0 3 * * * /var/www/ctyrlistkoteka/deploy/backup.sh` (sekce 4 + `backup.sh`)
13. **Auto-sync (volitelné)** —
    ```bash
    sudo cp deploy/systemd-sync.service /etc/systemd/system/ctyrlistkoteka-sync.service
    sudo cp deploy/systemd-sync.timer   /etc/systemd/system/ctyrlistkoteka-sync.timer
    sudo systemctl daemon-reload
    sudo systemctl enable --now ctyrlistkoteka-sync.timer
    ```

## GitHub Actions secrets

V Settings → Secrets and variables → Actions přidej:

| Secret | Hodnota |
| --- | --- |
| `DEPLOY_HOST` | IP nebo hostname OVH VPS |
| `DEPLOY_USER` | `app` (nebo dedikovaný `deploy` uživatel) |
| `DEPLOY_SSH_KEY` | privátní SSH klíč (odpovídající veřejnému klíči v `~/.ssh/authorized_keys` pro `app`) |
| `DEPLOY_PORT` | (volitelné) nestandardní SSH port; default 22 |

Generuj nový key pair jen pro deploy, nepoužívej osobní klíč:
```
ssh-keygen -t ed25519 -f deploy_key -C "github-actions-ctyrlistkoteka" -N ""
# deploy_key.pub → na VPS do /home/app/.ssh/authorized_keys
# deploy_key → do DEPLOY_SSH_KEY secret
```

## Security hardening

Dvouvrstvá lehká ochrana: **Nginx dropuje** notorické scanner cesty na úrovni
HTTP, **fail2ban** banuje opakované útočníky na úrovni firewall a do TSV
souboru se vrší dlouhodobý audit log, ze kterého se generuje permaban
list. Bez WAF (ModSecurity / Crowdsec) — pro read-only public web bez
user inputu by to byla palba na vrabce.

### Nasazení (~5 min)

```bash
cd /var/www/ctyrlistkoteka
git pull

# 1. Nginx exploit-block snippet + global TLS hardening
sudo mkdir -p /etc/nginx/snippets
sudo cp deploy/nginx-snippets/block-exploits.conf /etc/nginx/snippets/
sudo cp deploy/nginx-conf.d/ssl-hardening.conf    /etc/nginx/conf.d/

# 2. Hlavní config — do server bloku přidat:
#    - na vrchol souboru (mimo server bloky):
#      limit_req_zone $binary_remote_addr zone=ctyr_main:10m rate=20r/s;
#    - do server { ... } HTTPS bloku, PŘED location /:
#      include /etc/nginx/snippets/block-exploits.conf;
#    - do location / { ... }:
#      limit_req zone=ctyr_main burst=40 nodelay;
#      limit_req_status 429;
sudo nano /etc/nginx/sites-available/ctyrlistkoteka
sudo nginx -t && sudo systemctl reload nginx

# 3. fail2ban — filter, jail, sshd override, sshd logger, custom action, helper
sudo cp deploy/fail2ban-nginx-noscript-filter.conf /etc/fail2ban/filter.d/nginx-noscript.conf
sudo cp deploy/fail2ban-nginx-noscript.conf        /etc/fail2ban/jail.d/nginx-noscript.conf
sudo cp deploy/fail2ban-sshd.conf                  /etc/fail2ban/jail.d/sshd.local
sudo cp deploy/fail2ban-sshd-logger.conf           /etc/fail2ban/jail.d/sshd-logger.local
sudo cp deploy/fail2ban-action-blocklist.conf      /etc/fail2ban/action.d/blocklist.conf

sudo cp deploy/fail2ban-blocklist-append.sh /usr/local/sbin/
sudo cp deploy/blocklist-tools.sh           /usr/local/sbin/
sudo chmod 755 /usr/local/sbin/{fail2ban-blocklist-append.sh,blocklist-tools.sh}
sudo chown root:root /usr/local/sbin/{fail2ban-blocklist-append.sh,blocklist-tools.sh}

# 4. Logrotate
sudo cp deploy/logrotate-fail2ban-blocklist.conf /etc/logrotate.d/fail2ban-blocklist

# 5. Apply
sudo fail2ban-client reload
sudo fail2ban-client status nginx-noscript
sudo fail2ban-client status sshd
sudo fail2ban-client status sshd-logger     # nový logger-only jail
sudo fail2ban-client get sshd actions       # má ukazovat: nftables, blocklist
sudo fail2ban-client get sshd-logger actions # má ukazovat: blocklist (žádný firewall)
```

Smoke test (z **jiné** IP, ne z home/mobile, kterou máš whitelistovanou):
```bash
curl -is https://ctyrlistkoteka.cz/.env       | head -1   # Recv failure / 444
curl -is https://ctyrlistkoteka.cz/wp-login.php | head -1   # totéž
curl -is https://ctyrlistkoteka.cz/             | head -1   # 200 OK
```

### Operativa — co kde najdeš

| Co potřebuješ | Příkaz |
| --- | --- |
| Souhrn banů (top IP, top jails) | `sudo blocklist-tools.sh stats` |
| Posledních 20 banů s důvodem | `sudo blocklist-tools.sh recent 20` |
| Všechny IP setříděné podle počtu banů | `sudo blocklist-tools.sh ips` |
| Aktuálně banovaní (do bantime) | `sudo fail2ban-client status nginx-noscript` |
| Manuální unban | `sudo fail2ban-client unban <ip>` |
| Append-only audit log | `sudo less /var/log/fail2ban-blocklist.tsv` |

### Permaban list — hybridní mode (real-time + denní rebuild)

Default chování `blocklist-tools.sh nginx-deny`: **každá** zabanovaná
IP z reportable jailů (`nginx-noscript`, `sshd`, `sshd-logger`) se
promotuje do `nginx deny` listu — bez prahu, bez okna. Whitelist
(typicky tvoje vlastní IP) je v `/etc/permaban-whitelist.conf`,
private/reserved rozsahy (RFC 1918 / 5737 / 3849) jsou filtrované
vždy. Snapshot předchozího stavu padá do `/var/backups/permaban/`
před každým přepsáním (auto-prune po 30 dnech).

Ve dvojici s tím běží fail2ban action `permaban-nginx`, která stejnou
logiku aplikuje **v okamžiku banu** — append do deny listu + debounced
reload nginx (60s okno, ať pod útokem reload chain neflapuje). Cron
rebuild slouží jako self-healing pojistka pro race condition / restart
fail2ban v půli akce / manuální editace souboru.

```bash
# 1. Whitelist — POVINNÝ KROK před prvním rebuildem, jinak by se sem
#    mohla dostat tvoje vlastní IP a zablokovat ti přístup.
sudo cp deploy/permaban-whitelist.conf /etc/permaban-whitelist.conf
sudo chmod 644 /etc/permaban-whitelist.conf
sudo chown root:root /etc/permaban-whitelist.conf
# Pak ještě edituj — IP v repu odpovídají homelab + admin allow listu
# z nginx.conf.template, ale pokud máš víc / jiné, dolaď v Termiusu.

# 2. blocklist-tools.sh (přepis se starou verzí v repu — nový skript
#    má nové defaulty + whitelist + snapshot).
sudo cp deploy/blocklist-tools.sh /usr/local/sbin/
sudo chmod 755 /usr/local/sbin/blocklist-tools.sh
sudo chown root:root /usr/local/sbin/blocklist-tools.sh

# 3. Real-time helper (volaný fail2ban actionem) + jeho action def
sudo cp deploy/permaban-nginx-add.sh                /usr/local/sbin/
sudo chmod 755 /usr/local/sbin/permaban-nginx-add.sh
sudo chown root:root /usr/local/sbin/permaban-nginx-add.sh

sudo cp deploy/fail2ban-action-permaban-nginx.conf  /etc/fail2ban/action.d/permaban-nginx.conf

# 4. Wire action do existujících jailů — přidej řádek `permaban-nginx`
#    do `action = ...` sekce kazdého z těchto jailů:
#       /etc/fail2ban/jail.d/nginx-noscript.conf
#       /etc/fail2ban/jail.d/sshd.local
#       /etc/fail2ban/jail.d/sshd-logger.local
#    Řádek dej VEDLE existujícího `blocklist`, ne místo něj. Příklad:
#       action = %(action_)s
#                blocklist
#                permaban-nginx
sudo nano /etc/fail2ban/jail.d/nginx-noscript.conf
sudo nano /etc/fail2ban/jail.d/sshd.local
sudo nano /etc/fail2ban/jail.d/sshd-logger.local

sudo fail2ban-client reload
sudo fail2ban-client get nginx-noscript actions  # má obsahovat: permaban-nginx
sudo fail2ban-client get sshd actions
sudo fail2ban-client get sshd-logger actions

# 5. Backfill — prvotní vygenerování permaban listu z celého TSV
#    (POVINNĚ až po kroku 1, jinak se neaplikuje whitelist).
sudo blocklist-tools.sh nginx-deny --apply
# Výstup: "Vygenerováno N IP do /etc/nginx/snippets/permaban-list.conf"
# + "nginx reload OK."

# 6. Aktivuj include v nginx (jednorázově):
#    /etc/nginx/sites-available/ctyrlistkoteka — do server bloku
#    PŘED location / přidej:
#       include /etc/nginx/snippets/permaban-list.conf;
sudo nano /etc/nginx/sites-available/ctyrlistkoteka
sudo nginx -t && sudo systemctl reload nginx

# 7. Daily cron (rebuild + apply v 04:30 každý den)
sudo cp deploy/permaban-refresh.cron       /etc/cron.d/permaban-refresh
sudo chmod 644 /etc/cron.d/permaban-refresh

# 8. Logrotate pro nové permaban-* logy
sudo cp deploy/logrotate-permaban.conf     /etc/logrotate.d/permaban
sudo chmod 644 /etc/logrotate.d/permaban
```

Ověření že real-time chain funguje (z **jiné** IP, ne whitelistované):
```bash
# Vyvolej nginx-noscript ban — TŘI requesty na známou exploit cestu
curl -is https://ctyrlistkoteka.cz/.env > /dev/null
curl -is https://ctyrlistkoteka.cz/wp-login.php > /dev/null
curl -is https://ctyrlistkoteka.cz/.git/config > /dev/null
# Po max 2 min:
sudo tail -f /var/log/permaban-nginx.log     # má ukázat "Added: <ip>"
sudo grep "<ip>" /etc/nginx/snippets/permaban-list.conf
```

Manuální odebrání IP z permabanu:
```bash
sudo sed -i "/^deny 1\\.2\\.3\\.4;/d" /etc/nginx/snippets/permaban-list.conf
sudo nginx -t && sudo systemctl reload nginx
# Pozor: pokud zůstane v TSV ban historie, příští cron rebuild ji zase
# přidá — pro trvalou výjimku přidej IP do /etc/permaban-whitelist.conf.
```

Tweaky default chování (pokud někdy potřebuješ jinou strategii):
```bash
# Vrátit threshold-based ("3+ banů za 30 dní z nginx-noscript")
sudo PERMABAN_THRESHOLD=3 WINDOW_DAYS=30 INCLUDE_JAILS=nginx-noscript \
  blocklist-tools.sh nginx-deny --apply
```

### AbuseIPDB reporting (volitelné)

Denní automatický report nových banů na [abuseipdb.com](https://www.abuseipdb.com/).
Útočníci se tak přidávají do veřejné databáze a vrací se to do reputace
celého internetu — plus tvoje vlastní confidence score roste s objemem
ověřených reportů.

**Před nasazením:** vytvoř si na abuseipdb.com účet (free tier dává 1000
reportů/den, premium 5000), v *Settings → API* vygeneruj klíč se scope
`Reporter`.

```bash
# 1. Ulož API klíč (chmod 600 — pouze root čte)
echo 'TVŮJ_API_KLÍČ' | sudo tee /etc/abuseipdb-key > /dev/null
sudo chmod 600 /etc/abuseipdb-key
sudo chown root:root /etc/abuseipdb-key

# 2. Skript + cron + logrotate
sudo cp deploy/abuseipdb-report.sh /usr/local/sbin/
sudo chmod 755 /usr/local/sbin/abuseipdb-report.sh
sudo chown root:root /usr/local/sbin/abuseipdb-report.sh

sudo cp deploy/abuseipdb-report.cron /etc/cron.d/abuseipdb-report
sudo cp deploy/logrotate-abuseipdb-report.conf /etc/logrotate.d/abuseipdb-report

# 3. jq dependency
sudo apt install -y jq

# 4. Smoke test (manuálně, ne čekat na cron)
sudo /usr/local/sbin/abuseipdb-report.sh
# Očekávaný výstup:
#   2026-XX-XXTHH:MM:SS+02:00 Reporting N bans (since: never)
#   2026-XX-XXTHH:MM:SS+02:00 Saved=N Invalid=0 NewState=...

# 5. Verifikace logu na další dny
sudo tail -f /var/log/abuseipdb-report.log
```

**Mapování jail → AbuseIPDB kategorie:**

| Jail | Kategorie | Význam |
| --- | --- | --- |
| `sshd`, `sshd-logger` | `18, 22` | Brute-Force, SSH |
| `nginx-noscript` | `19, 21` | Bad Web Bot, Web App Attack |
| ostatní (fallback) | `15` | Hacking |

**State a re-run:** skript si pamatuje poslední úspěšně reportovaný ISO
timestamp v `/var/lib/abuseipdb-report/last-timestamp`. Když ho smažeš,
příští run reportuje vše od začátku (AbuseIPDB ale stejně vyhazuje
záznamy starší než 30 dní jako `invalidReports`, takže to tě ban-history
neporušuje).

**AbuseIPDB rate limit:** 1000 reportů/den (free) by stačilo na ~700 IP
se 30% rezervou. Pokud bys měl víc traffic, zvaž premium nebo úpravu
cron periody na 12h s parciálními dávkami.

### Whitelist vlastní IP

V GoatCounter má separátní seznam (Settings → Ignore IPs). Pro **fail2ban**
přidej do `/etc/fail2ban/jail.local` (nebo do nginx-noscript jail bloku):
```ini
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 <TVOJE_STATICKA_IP> <TVUJ_ROZSAH>/24
```
A reload: `sudo fail2ban-client reload`. Tvoje home/mobile IP pak fail2ban
nikdy nezbanuje, ani kdybys náhodou trefil 6× exploit URL.

## stats.ctyrlistkoteka.cz — TLS + security headers

GoatCounter běží v Dockeru za nginx reverse proxy. Subdoména si
zaslouží stejnou hygienu jako apex.

### TLS

Pokud cert pro `stats.ctyrlistkoteka.cz` ještě nemáš, vyrob ho přes
certbot — provede automatickou instalaci do nginx vhostu a renew přes
systemd timer:

```bash
# Verifikuj, že cert existuje
sudo ls /etc/letsencrypt/live/stats.ctyrlistkoteka.cz/

# Pokud ne — vystavit (subdoména musí mít A/AAAA záznam u hukot.net)
sudo certbot --nginx -d stats.ctyrlistkoteka.cz
```

Certbot ve výchozím nastavení napíše do vhostu `include
/etc/letsencrypt/options-ssl-nginx.conf`, který obsahuje rozumný TLS
profil (TLS 1.2/1.3, Mozilla intermediate ciphers, session tickets
off). Žádné další TLS tweakování není potřeba — ověř to:

```bash
# Lokálně z VPS
curl -vI https://stats.ctyrlistkoteka.cz/ 2>&1 | grep -E 'HTTP|TLS|SSL'

# Externě (zvenku, např. z laptopu)
nmap --script ssl-enum-ciphers -p 443 stats.ctyrlistkoteka.cz
# nebo SSL Labs:
# https://www.ssllabs.com/ssltest/analyze.html?d=stats.ctyrlistkoteka.cz
# Cíl: A nebo A+
```

### Security headers

Aplikace snippetu na stats vhost:

```bash
# 1. Zkopíruj snippet
sudo cp deploy/nginx-snippets/security-headers.conf /etc/nginx/snippets/

# 2. Edituj stats vhost — najdi server { listen 443 ssl; ... } blok
#    pro stats.ctyrlistkoteka.cz a PŘED location / { ... } přidej:
#       include /etc/nginx/snippets/security-headers.conf;
sudo nano /etc/nginx/sites-available/stats   # nebo jiný název

# 3. Apply
sudo nginx -t && sudo systemctl reload nginx
```

Verifikace, že hlavičky odcházejí:

```bash
curl -sI https://stats.ctyrlistkoteka.cz/ | grep -iE 'strict-transport|content-type-options|frame-options|referrer|permissions'
```

Měl bys vidět všech 5 hlaviček. Externí kontrola je
[securityheaders.com](https://securityheaders.com/?q=stats.ctyrlistkoteka.cz)
— cíl A nebo A+ (CSP chybí záměrně, GoatCounter dashboard má vlastní
inline JS; přidávat ho by znamenalo whitelist managment bez velkého
přínosu — útočník by stejně potřeboval kompromitovat samotnou GC instanci).

#### Duplicitní hlavičky z GoatCounter upstreamu

Pokud securityheaders.com hlásí *"There was a duplicate
Strict-Transport-Security header"* (a totéž pro `X-Content-Type-Options`),
je to proto, že GoatCounter sám posílá vlastní default security
hlavičky a nginx k nim přidává naše ze snippetu. Browsery to
tolerují (nejrestriktivnější hodnota vyhrává), ale je čistší
upstream verzi v nginx schovat a nechat naši jako jediný zdroj pravdy.

V `location /` bloku stats vhostu (`/etc/nginx/sites-available/<stats>`)
přidej před `proxy_pass`:

```nginx
location / {
    proxy_hide_header Strict-Transport-Security;
    proxy_hide_header X-Content-Type-Options;

    proxy_pass http://127.0.0.1:8090;   # nebo port, na kterém GC běží
    # ... ostatní proxy_set_header direktivy
}
```

`proxy_hide_header` zabrání tomu, aby konkrétní hlavička z upstream
odpovědi prošla ke klientovi; naše `add_header` v server bloku ji
nahradí. Apply:

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -sI https://stats.ctyrlistkoteka.cz/ | grep -ciE '^strict-transport-security'
# Má vrátit 1 (ne 2)
```

#### security.txt (RFC 9116)

internet.nl flagne `security.txt` ze stats subdomény, protože GoatCounter
ho posílá v legacy lokaci (`/security.txt`) a malformed (chybí `Expires`,
`Contact` není URI). Opravujeme to dvojitě:

1. **Apex vhost** servíruje autoritativní validní kopii v `public/.well-known/security.txt`
   (Next.js to pickne z `public/` — žádná nginx změna není potřeba).

2. **Stats vhost** přesměrovává na apex. RFC 9116 sekce 4 cross-domain
   redirect explicitně povoluje:

```bash
sudo cp deploy/nginx-snippets/security-txt-redirect.conf /etc/nginx/snippets/

# V /etc/nginx/sites-available/stats.ctyrlistkoteka.cz, do server { listen 443 ... } bloku
# (mimo location / blok) přidej:
#       include /etc/nginx/snippets/security-txt-redirect.conf;
sudo nano /etc/nginx/sites-available/stats.ctyrlistkoteka.cz

sudo nginx -t && sudo systemctl reload nginx

# Verifikace — oba bývalé URL přesměrují na apex/.well-known
curl -sI https://stats.ctyrlistkoteka.cz/security.txt           | head -2
curl -sI https://stats.ctyrlistkoteka.cz/.well-known/security.txt | head -2
# Obě má vrátit: HTTP/2 301, location: https://ctyrlistkoteka.cz/.well-known/security.txt

curl -s https://ctyrlistkoteka.cz/.well-known/security.txt
# Má vypsat čtyři řádky: Contact, Expires, Preferred-Languages, Canonical
```

> **Renewal:** `Expires` je nastavený na **2027-04-29**. RFC doporučuje
> < 1 rok, takže po cca 11 měsících (březen 2027) je třeba bumpovat
> datum v `public/.well-known/security.txt`. Cron-style připomínka
> přes `/schedule` agent zajistí, že to neuteče.

## Rollback

Deploy je fast-forward, ne rebase. Rollback:

```bash
# Na VPS
cd /var/www/ctyrlistkoteka
git log --oneline -5              # najdi předchozí commit
git reset --hard <commit>
pnpm install --frozen-lockfile
pnpm build
pm2 reload ctyrlistkoteka
```

Pro DB migrace — Prisma `migrate deploy` je forward-only. Pokud je potřeba
rollback schema, obnov z `pg_dump` zálohy v `/var/backups/postgres/`.
