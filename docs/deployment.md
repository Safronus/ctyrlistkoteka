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

## 10. fail2ban

```bash
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
# V /etc/fail2ban/jail.local ujisti se, že je [sshd] enabled = true
# Přidej nebo zapni [nginx-limit-req] jail pokud Nginx má limit_req zóny
sudo systemctl enable --now fail2ban
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
