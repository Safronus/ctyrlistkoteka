# Deployment — OVH VPS

**Kontext:** OVH VPS-2 (Ubuntu 24.04 LTS), doména `ctyrlistkoteka.cz` u hukot.net,
bez Cloudflare. Claude Code **nepouští** příkazy na serveru přímo — generuje je
a uživatel je spouští v Termiusu.

---

## 0. Předpoklady

- OVH VPS aktivní, IPv4 a IPv6 přiřazené (viz OVH management konzole).
- Přístup k hukot.net pro správu DNS.
- Termius nakonfigurovaný pro SSH s klíčem (ne heslem).
- Lokální SSH klíč uživatele (`~/.ssh/id_ed25519.pub`).

---

## 1. DNS u hukot.net

V administraci hukot.net pro `ctyrlistkoteka.cz` nastav:

| Typ | Name | Hodnota | TTL |
| --- | --- | --- | --- |
| `A` | `@` | **IPv4 OVH VPS** | 3600 |
| `A` | `www` | **IPv4 OVH VPS** | 3600 |
| `AAAA` | `@` | **IPv6 OVH VPS** | 3600 |
| `AAAA` | `www` | **IPv6 OVH VPS** | 3600 |
| `CAA` | `@` | `0 issue "letsencrypt.org"` | 3600 |

Propagace obvykle do hodiny, max 24 h. Ověř:

```bash
dig ctyrlistkoteka.cz +short
dig AAAA ctyrlistkoteka.cz +short
```

---

## 2. Základní zabezpečení serveru

Prvotní SSH přes root (zanikne po přepnutí). V Termiusu:

```bash
# Aktualizace
apt update && apt upgrade -y
apt install -y ufw fail2ban unattended-upgrades

# Vytvoř aplikační uživatele
adduser app --disabled-password --gecos ""
usermod -aG sudo app

# Přenes SSH klíč
mkdir -p /home/app/.ssh
cp ~/.ssh/authorized_keys /home/app/.ssh/authorized_keys
chown -R app:app /home/app/.ssh
chmod 700 /home/app/.ssh
chmod 600 /home/app/.ssh/authorized_keys

# Zakaž root login a password auth
sed -i 's/^#*PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh

# Firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Automatické security updates
dpkg-reconfigure -plow unattended-upgrades
```

Od teď přihlašuj jako `app`: `ssh app@<ip>`.

---

## 3. Instalace software

Jako `app` (sudo podle potřeby):

```bash
# Node.js přes nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install --lts
nvm use --lts

# pnpm
corepack enable
corepack prepare pnpm@latest --activate

# PM2
npm install -g pm2

# PostgreSQL 16 + PostGIS
sudo apt install -y postgresql-16 postgresql-16-postgis-3 postgresql-contrib

# Nginx + Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# Knihovny pro zpracování obrázků
sudo apt install -y libheif-examples libvips-dev

# Redis (volitelné)
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
```

---

## 4. PostgreSQL setup

```bash
sudo -u postgres psql <<'SQL'
CREATE USER ctyrlist WITH PASSWORD 'ZMEN_ME_SILNE_HESLO';
CREATE DATABASE ctyrlistkoteka OWNER ctyrlist;
\c ctyrlistkoteka
CREATE EXTENSION postgis;
CREATE EXTENSION pg_trgm;   -- pro fulltext v poznámkách
SQL
```

Otestuj:
```bash
psql 'postgresql://ctyrlist:HESLO@localhost:5432/ctyrlistkoteka' -c 'SELECT postgis_version();'
```

### Denní zálohy

```bash
sudo mkdir -p /var/backups/postgres
sudo chown app:app /var/backups/postgres

# crontab pro uživatele app
crontab -e
```

Přidej:
```
0 3 * * * pg_dump ctyrlistkoteka | gzip > /var/backups/postgres/ctyrlistkoteka-$(date +\%F).sql.gz && find /var/backups/postgres -mtime +14 -delete
```

---

## 5. Filesystem rozložení

```bash
sudo mkdir -p /var/www/ctyrlistkoteka
sudo mkdir -p /var/ctyrlistkoteka/{data,generated}
sudo mkdir -p /var/ctyrlistkoteka/data/{finds,maps,meta}
sudo mkdir -p /var/ctyrlistkoteka/generated/{web,thumb,maps}
sudo mkdir -p /var/log/ctyrlistkoteka

sudo chown -R app:app /var/www/ctyrlistkoteka
sudo chown -R app:app /var/ctyrlistkoteka
sudo chown -R app:app /var/log/ctyrlistkoteka
```

---

## 6. Klonování projektu

```bash
cd /var/www
# Použij deploy klíč nebo personal access token jednorázově:
git clone git@github.com:<user>/ctyrlistkoteka.git
cd ctyrlistkoteka

pnpm install
cp .env.example .env
nano .env    # doplň heslo DB, NEXT_PUBLIC_SITE_URL, cesty

pnpm prisma migrate deploy
pnpm build
```

---

## 7. PM2 — process management

```bash
# V /var/www/ctyrlistkoteka
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup systemd -u app --hp /home/app
# (spustí vytištěný příkaz jako sudo)
```

Otestuj: `curl -I http://127.0.0.1:3000` → měl by vrátit 200.

---

## 8. Nginx

```bash
sudo cp /var/www/ctyrlistkoteka/deploy/nginx.conf.template /etc/nginx/sites-available/ctyrlistkoteka
# Uprav server_name a cesty pokud třeba
sudo ln -s /etc/nginx/sites-available/ctyrlistkoteka /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Otestuj bez SSL: `curl -I http://ctyrlistkoteka.cz`.

---

## 9. SSL přes Let's Encrypt

```bash
sudo certbot --nginx -d ctyrlistkoteka.cz -d www.ctyrlistkoteka.cz
# Souhlas s TOS, zadej email, vyber redirect HTTP → HTTPS
```

Auto-renew (Certbot instaluje systemd timer automaticky). Ověř:
```bash
sudo systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

---

## 10. fail2ban + permaban (nftables) + bezpečnostní aktualizace

Bezpečnost edge vrstvy se skládá z několika cihel:

1. **fail2ban krátkodobé bany** — paterní `nftables-multiport` action banuje
   IP na `bantime` (default 1 h). Po expiraci IP zase prochází.
2. **Permaban přes nftables sety** — opakované útočníky přesouváme do
   trvalého `inet permaban` setu, kde paket dropne kernel **před** TLS
   handshake / HTTP parse (L3 drop, žádný CPU za request).
3. **TSV blocklist** — každý ban se loguje do `/var/log/fail2ban-blocklist.tsv`
   pro audit a denní rebuild permaban setu (pojistka proti race conditionům).
4. **AbuseIPDB reporting** — denní bulk report útočných IP do veřejné DB.
5. **Unattended-upgrades** — automatické security patche pro Ubuntu LTS
   (nginx, openssl, …) bez nutnosti manuální intervence.

### 10.1. Základní fail2ban + jail.local

```bash
sudo apt install fail2ban python3-nftables
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
# Uprav podle deploy/fail2ban-jail.local.example — nastav
# banaction = nftables-multiport, ignoreip = (tvoje IP).
sudo systemctl enable --now fail2ban
```

Nginx-noscript a sshd-logger jaily přidej z `deploy/`:

```bash
sudo cp deploy/fail2ban-nginx-noscript.conf      /etc/fail2ban/jail.d/nginx-noscript.conf
sudo cp deploy/fail2ban-nginx-noscript-filter.conf /etc/fail2ban/filter.d/nginx-noscript.conf
sudo cp deploy/fail2ban-sshd.conf                /etc/fail2ban/jail.d/sshd.local
sudo cp deploy/fail2ban-sshd-logger.conf         /etc/fail2ban/jail.d/sshd-logger.local
sudo cp deploy/fail2ban-action-blocklist.conf    /etc/fail2ban/action.d/blocklist.conf
sudo cp deploy/fail2ban-blocklist-append.sh      /usr/local/sbin/
sudo chmod 755 /usr/local/sbin/fail2ban-blocklist-append.sh
sudo cp deploy/blocklist-tools.sh                /usr/local/sbin/
sudo chmod 755 /usr/local/sbin/blocklist-tools.sh
sudo cp deploy/permaban-whitelist.conf           /etc/permaban-whitelist.conf
# DOPLŇ do whitelistu vlastní IP před prvním banem!
sudo cp deploy/logrotate-fail2ban-blocklist.conf /etc/logrotate.d/fail2ban-blocklist
sudo fail2ban-client reload
```

### 10.2. nftables permaban (L3 drop)

#### Instalace tabulky + sets + chainu

```bash
# Nainstaluj table definici.
sudo mkdir -p /etc/nftables.d
sudo cp deploy/nftables-permaban.nft /etc/nftables.d/permaban.nft
sudo chmod 644 /etc/nftables.d/permaban.nft

# /etc/nftables.conf musí includovat /etc/nftables.d/*.nft.
# Na čerstvém Ubuntu 24.04 to tam není — přidej řádek:
grep -q '/etc/nftables.d' /etc/nftables.conf || \
  echo 'include "/etc/nftables.d/*.nft"' | sudo tee -a /etc/nftables.conf

# Načti + povol službu, ať se ruleset načte při bootu.
sudo nft -f /etc/nftables.conf
sudo systemctl enable --now nftables.service

# Ověř, že table + sety + chain existují.
sudo nft list table inet permaban
```

Pokud máš aktivní **ufw**, musíš se rozhodnout: buď ho ponechat (jeho
pravidla žijí v `inet filter` tabulce, takže s naším `inet permaban`
koexistují bez konfliktu), nebo přepnout úplně na nftables — `sudo ufw
disable` a nastavit basic firewall přes nftables. Default tvého OVH VPS
po ZAS-y má pravděpodobně ufw active s povolenými porty 22/80/443.

#### Instalace fail2ban action + add scriptu

```bash
sudo cp deploy/permaban-firewall-add.sh                  /usr/local/sbin/
sudo chmod 755 /usr/local/sbin/permaban-firewall-add.sh
sudo cp deploy/fail2ban-action-permaban-firewall.conf    /etc/fail2ban/action.d/permaban-firewall.conf
sudo cp deploy/permaban-firewall-load.service            /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable permaban-firewall-load.service
```

#### Aktivace permaban-firewall v jailech

V `/etc/fail2ban/jail.local` přidej `permaban-firewall` do `action`
chainu každého reportable jailu — vzor v
`deploy/fail2ban-jail.local.example`. Klíčové řádky:

```ini
[DEFAULT]
banaction = nftables-multiport
banaction_allports = nftables-allports

[sshd]
action = %(action_)s
         blocklist
         permaban-firewall

[nginx-noscript]
action = %(action_)s
         blocklist
         permaban-firewall
```

Reload:

```bash
sudo fail2ban-client reload
sudo fail2ban-client status nginx-noscript   # ověř, že jail žije
```

#### Daily rebuild + cron

```bash
sudo cp deploy/permaban-refresh.cron /etc/cron.d/permaban-refresh
sudo chmod 644 /etc/cron.d/permaban-refresh
sudo cp deploy/logrotate-permaban.conf /etc/logrotate.d/permaban
```

Cron volá `blocklist-tools.sh firewall-deny --apply` denně v 04:30 —
self-healing rebuild ze TSV, idempotentní (žádný `nft -f`, pokud se
obsah nezmění).

### 10.3. Migrace ze starého nginx permabanu

Pokud máš existující `/etc/nginx/snippets/permaban-list.conf` (z předchozí
verze setupu), přesuň IP do nftables:

```bash
sudo cp deploy/migrate-nginx-permaban-to-nftables.sh /usr/local/sbin/
sudo chmod 755 /usr/local/sbin/migrate-nginx-permaban-to-nftables.sh

# Suchý běh — ukáže co by se přidalo, žádný zápis.
sudo migrate-nginx-permaban-to-nftables.sh --dry-run

# Skutečná migrace.
sudo migrate-nginx-permaban-to-nftables.sh --apply

# Ověř stav setů (počet elementů).
sudo nft list set inet permaban permaban_v4 | head -20
sudo nft list set inet permaban permaban_v6 | head -20
```

Po ověření, že nový permaban funguje (test access ze známé zabanované
IP nebo dropované packety v counter), odstraň include `permaban-list.conf`
z nginx config:

```bash
# Najdi include řádky v nginx configu — měly by se nacházet uvnitř
# server bloku ctyrlistkoteka.
sudo grep -n 'permaban-list' /etc/nginx/sites-enabled/ctyrlistkoteka

# Po smazání:
sudo nginx -t && sudo systemctl reload nginx
```

Stará permaban-nginx-* infrastruktura (`permaban-nginx-add.sh`,
`fail2ban-action-permaban-nginx.conf`) zůstává v repu pro snadný rollback,
ale po úspěšné migraci ji můžeš odinstalovat (smazat soubory + odstranit
`permaban-nginx` z action chainu v jail.local).

### 10.4. Unattended-upgrades (security patche)

```bash
sudo apt install unattended-upgrades apt-listchanges
sudo cp deploy/unattended-upgrades-50ctyrlistkoteka.conf \
        /etc/apt/apt.conf.d/52ctyrlistkoteka-unattended.conf
sudo chmod 644 /etc/apt/apt.conf.d/52ctyrlistkoteka-unattended.conf

# Aktivace timeru (na Ubuntu už default).
sudo systemctl enable --now apt-daily.timer apt-daily-upgrade.timer

# Suchý běh — co by se updatovalo příště.
sudo unattended-upgrades --dry-run -d 2>&1 | tail -30
```

Co se auto-updatuje:

- `${distro_id}:${distro_codename}-security` — všechny security patche
  (nginx, openssl, kernel, …)
- `${distro_id}:${distro_codename}-updates` — Ubuntu backporty (kde Canonical
  bere upstream patche a vrací je do 1.24)

Co se **NE**auto-updatuje (blacklist v configu):

- `postgresql-16`, `postgis` — major upgrade by mohl porušit DB
- `nodejs` — máme přes nvm, ne přes apt

Reboots se auto-neprovádí (`Unattended-Upgrade::Automatic-Reboot "false";`)
— kernel update tě upozorní přes `/var/run/reboot-required` a v MOTD,
ale reboot plánuje vlastník ručně (kvůli PM2 + Postgres state).

### 10.5. Verifikace celkového setupu

```bash
# 1. nftables ruleset je naloaded
sudo nft list ruleset | grep -A 20 'table inet permaban'

# 2. permaban-firewall-load service je enabled
systemctl is-enabled permaban-firewall-load.service

# 3. fail2ban jaily žijí + používají nftables action
sudo fail2ban-client status
sudo fail2ban-client get nginx-noscript actions
# Měl bys vidět: nftables-multiport blocklist permaban-firewall

# 4. Unattended-upgrades je aktivní
systemctl list-timers | grep apt-daily

# 5. Permaban counter (kolik dropů od bootu)
sudo nft list chain inet permaban input
# Hledej "counter packets X bytes Y" — vidíš provoz na drop pravidlech.

# 6. Stats z TSV
sudo /usr/local/sbin/blocklist-tools.sh stats
```

---

## 11. CI/CD — GitHub Actions

Claude Code vytvoří `.github/workflows/deploy.yml`, který po merge do `main`:
1. Spustí lint + typecheck + test
2. SSH na VPS
3. `cd /var/www/ctyrlistkoteka && git pull && pnpm install --frozen-lockfile && pnpm prisma migrate deploy && pnpm build && pm2 reload ctyrlistkoteka`

V nastavení repa na GitHubu přidej secrets:
- `DEPLOY_SSH_KEY` — privátní SSH klíč nového user `deploy` (viz níže)
- `DEPLOY_HOST` — IP / hostname VPS
- `DEPLOY_USER` — `app` nebo `deploy`

### Dedikovaný deploy uživatel (doporučené)

Místo `app` účtu vytvoř omezený účet s povolením jen na `/var/www/ctyrlistkoteka`:

```bash
sudo adduser deploy --disabled-password
sudo usermod -aG app deploy    # ať má přístup ke složce
# Restriktivní sudoers: jen pm2 reload
```

Pro v1 ale stačí `app` účet.

---

## 12. První nasazení dat

Viz `docs/sync-workflow.md`.

```bash
# Z lokálu
rsync -av --progress ./ctyrlistkoteka-archive/ app@ctyrlistkoteka.cz:/var/ctyrlistkoteka/data/

# Na VPS
cd /var/www/ctyrlistkoteka
pnpm sync --dry-run   # ověř parsing
pnpm sync             # ostrý import (několik hodin)
pm2 reload ctyrlistkoteka
```

---

## 13. Troubleshooting

| Symptom | Kontrola |
| --- | --- |
| 502 Bad Gateway | `pm2 status`, `pm2 logs ctyrlistkoteka` |
| 504 Gateway Timeout | Dlouhý SQL dotaz nebo Next.js build fail |
| Certbot renewal fail | `sudo certbot renew --dry-run`, port 80 blokovaný? |
| DB connection refused | `sudo systemctl status postgresql` + `pg_hba.conf` |
| Obrázky se nezobrazují | Oprávnění na `/var/ctyrlistkoteka/generated/`, Nginx `alias` |
| `pnpm sync` selže na HEIC | `which heif-convert`, `apt install libheif-examples` |

### Užitečné příkazy

```bash
pm2 logs ctyrlistkoteka --lines 100
sudo journalctl -u nginx -n 50
sudo tail -f /var/log/nginx/ctyrlistkoteka.error.log
sudo tail -f /var/log/postgresql/postgresql-16-main.log
df -h                              # místo na disku
du -sh /var/ctyrlistkoteka/*       # velikost dat
```

---

## 14. Kapacita a růst

| Metrika | Dnes (~17k nálezů) | Cíl (100k nálezů) | Limit VPS-2 |
| --- | --- | --- | --- |
| Velikost originálů | ~34 GB (offline, není na VPS) | 200 GB | — |
| Velikost `/generated/` | ~6 GB | ~35 GB | 100 GB SSD |
| RAM pro Postgres | 2 GB | 3 GB | 12 GB |
| RAM pro Node | 500 MB | 1 GB | 12 GB |
| CPU při idle | <5 % | <10 % | 6 vCPU |
| CPU při sync | 400 % (4 paralelní HEIC) | 400 % | 6 vCPU |

VPS-2 pohodlně stačí i na 100k nálezů. Při dalším růstu zvažuj upgrade na
VPS-3 nebo migraci DB na dedikovaný Postgres.
