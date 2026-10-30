# Upgrade VPS: Ubuntu 25.10 „questing" → 26.04 LTS „resolute"

> **Stav: OS HOTOVÝ — Ubuntu 26.04.1 LTS běží od 2026-10-28 ~23:55 UTC.**
> Fáze 0–5 ✅ (průběh a nálezy v `PROGRESS.md`). Fáze 6: **DB běží na
> PostgreSQL 18.6 od 2026-10-30** (6a–6b ✅, 6c ověření, zbývá úklid 6d).
> Poučení z průběhu:
> `apt-listchanges` během upgradu ukazuje changelogy v pageru (`q`, pak `Y`);
> u dotazu „Remove obsolete packages?" (u nás 349) odpovědět **N**.
> Claude Code se k VPS nepřipojuje — příkazy spouští majitel v Termiusu,
> výstupy vkládá zpět do session. Každá fáze končí kontrolou; do další se
> jde až po ní.

## Proč

- Ubuntu 25.10 je interim vydání a jeho podpora skončila **2026-07-09** —
  od té doby žádné bezpečnostní aktualizace (týdenní workflow *Runtime
  security* proto svítí červeně, schválně; viz CLAUDE.md §11).
- 26.04 LTS vyšlo **2026-04-23**, standardní podpora **do dubna 2031**.
- Z 25.10 vede na 26.04 přímá cesta (`do-release-upgrade`); oficiální
  poznámky k vydání říkají, že starší vydání musí jít nejdřív přes 24.04
  nebo 25.10 — my už na 25.10 jsme.

## Co se změní (ověřeno 2026-10-28 z Launchpadu a release notes)

| Balíček | 25.10 (teď) | 26.04 | Dopad na nás |
| --- | --- | --- | --- |
| PostgreSQL | **17.10** | **18.6** — `postgresql-17` v archivu **není** | ⚠️ hlavní riziko, viz *Rozhodnutí R-PG* |
| PostGIS | 3.5.3 | 3.6.2 (universe) | po přechodu na PG 18 `postgis_extensions_upgrade()` |
| nginx | 1.28.0 | 1.28.3 | stejná řada, konfigurace beze změny |
| docker.io | 26.1.5 | 27.5.1 | jen pomocné kontejnery (GoatCounter, RustDesk) |
| redis | 8.0.2 | 8.0.5 | jen pokud je na hostu nainstalovaný (volitelný) |
| OpenSSL / OpenSSH | — | 3.5.6 / 10.2 | — |
| kernel / systemd | — | Linux 7.0 / systemd 259 | cgroup v1 zrušené (25.10 už jede na v2 — ověří fáze 0) |
| Node.js, pnpm, PM2 | nvm v `/home/app` | beze změny | systémový upgrade se nvm nedotkne |

Známé problémy z release notes, které se nás můžou týkat:
- **PostgreSQL na Linuxu 7.0**: možná regrese propustnosti a latence;
  systémy s huge pages prý nepostižené. Naše DB je malá — sledovat, ne
  řešit předem.
- **Čekání na síť při bootu**: nenakonfigurované rozhraní může boot
  zdržet o minuty (netplan `optional: true`).
- **sudo-rs**: při psaní hesla teď ukazuje hvězdičky (kosmetika).
- Launchpad bug 2152927 (2026-05, upgrade 25.10 → 26.04): upgrader
  skončil chybou i po odebrání nepodporovaných balíčků. Jeden hlášený
  případ, stav v archivu „New" — logy pro diagnostiku jsou
  v `/var/log/dist-upgrade/` (`main.log`, `apt.log`).

## Rozhodnutí R-PG: **varianta A — PostgreSQL 18 z Ubuntu** (2026-10-28)

Po upgradu OS zůstane PG 17 běžet, ale bez bezpečnostních aktualizací
(26.04 `postgresql-17` nemá). Varianta A, protože podle inventury:
- na serveru **není** repozitář PGDG — varianta B by přidávala cizí repo
  (a další věc k hlídání);
- PG 18.6 + `postgresql-18-postgis-3` (PostGIS 3.6.2) jsou v archivu 26.04
  (ověřeno Launchpad API);
- databáze má `data_checksums = off`, PG 18 je při `initdb` zapíná →
  převod **dump/restore** (výchozí metoda `pg_upgradecluster`), ne
  `pg_upgrade`. Naše DB je malá, dump je rychlý;
- Prisma PG 18 oficiálně podporuje.

Migrace DB je **samostatné okno** (fáze 6) až po ověřeném OS — nemíchat.

## Fáze 0 — inventura (jen čtení) ✅ hotovo 2026-10-28

Výsledek a z něj plynoucí opravy jsou v private ops repu (`inventory/`).
Pro plán důležité: cgroup v2 (blokátor „cgroup v1“ se nás netýká),
`Prompt=normal`, žádná cizí apt repa (Docker repo už chybí — docker-ce je
osiřelý, viz fáze 5), ~31 GB volného místa. Příkazy pro případné
zopakování:

```bash
lsb_release -ds; uname -r; stat -fc %T /sys/fs/cgroup
grep -v '^#' /etc/update-manager/release-upgrades
ls -1 /etc/apt/sources.list.d/
grep -rhE '^(Types|URIs|Suites|deb )' /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null
apt-cache policy postgresql-17 postgresql-17-postgis-3 nginx docker.io docker-ce redis-server 2>/dev/null | grep -E '^[a-z]|Installed'
pg_lsclusters
sudo -u postgres psql -d ctyrlistkoteka -Atc "select extname, extversion from pg_extension order by 1"
sudo -u postgres psql -Atc "show data_checksums"
systemctl is-enabled pm2-app nginx postgresql docker redis-server fail2ban nftables unattended-upgrades 2>&1
systemctl list-units --type=service --no-pager | grep -i -E 'actions\.runner|goatcounter'
sudo docker ps --format '{{.Names}}  {{.Image}}'
sudo docker images --format '{{.Repository}}:{{.Tag}}  {{.CreatedSince}}'
for d in /home/*/actions-runner* /opt/actions-runner*; do [ -x "$d/bin/Runner.Listener" ] && echo "$d $("$d/bin/Runner.Listener" --version)"; done
apt-get -s dist-upgrade | grep '^Inst' | grep -v ' Ubuntu:' | head -20
id app; sudo -u app docker ps -q >/dev/null 2>&1 && echo "app: docker OK" || echo "app: docker NE"
df -h / /var; free -h
apt list --upgradable 2>/dev/null | wc -l
```

## Fáze 1 — příprava a zálohy

1. **Okno údržby**: během fáze 2–4 nic nepushovat do `main` (push = deploy
   přes self-hosted runner na tomtéž stroji).
2. **Snapshot VPS v OVH Control Panelu** (placená volba — ověř cenu a že
   je dostupná pro VPS-2). Je to jediný rychlý návrat celého stroje.
3. **Dump DB mimo server**: `pg_dump -Fc` do `/var/backups/postgres/`
   (postup v `deployment.md` §4) a `scp` na Mac. Ověřit
   `pg_restore --list` nad staženým souborem.
4. **Záloha `/etc`** (`sudo tar czf /var/backups/etc-pre-26.04.tgz /etc`)
   a stáhnout na Mac — kvůli porovnání konfigurací, které upgrader
   nabídne přepsat.
5. `data/` má originál na Macu (rsync), `generated/` jde přegenerovat
   syncem — zálohovat netřeba, jen ověřit, že rsync z Macu je aktuální.
6. **Zálohy služeb:** ručně `deploy/backup-services.sh` (GoatCounter +
   klíče RustDesku) a ověřit, že poslední noční off-site stažení proběhlo
   (`offsite-freshness.sh` v logu `/var/log/ctyr-backup.log`).

## Fáze 2 — dorovnat 25.10

```bash
sudo apt update && sudo apt full-upgrade
sudo reboot
```
Po rebootu: web, `/admin`, `pm2 ls`, `systemctl --failed`. Musí být čisto,
jinak upgrade nezačínat.

## Fáze 3 — `do-release-upgrade`

- Spustit v `tmux`/`screen` (odpojení Termiusu nesmí upgrade zabít).
- Upgrader nabídne záložní sshd na portu **1022** — přes nftables bude
  zavřený; nechat zavřený, pokud hlavní SSH funguje (jinak ho dočasně
  povolit a pak zase zavřít).
- Cizí apt repa vypíná (záloha s příponou `.distUpgrade`). U nás žádné
  nejsou — Docker repo zmizelo už při upgradu 25.04 → 25.10 (právě takhle)
  a vrátí se ve fázi 5. Docker přitom poběží dál (osiřelý balíček).
- U dotazů na konfigurační soubory (`nginx.conf`, `sshd_config`,
  `fail2ban`, `50unattended-upgrades`, `postgresql.conf`…) **ponechat
  naši verzi** a rozdíl si uložit; porovná se se zálohou `/etc`.
- Na konci reboot.

## Fáze 4 — ověření po upgradu

```bash
lsb_release -ds; uname -r
systemctl --failed
systemctl is-active nginx postgresql fail2ban nftables pm2-app docker
sudo nginx -t
sudo certbot renew --dry-run
source /home/app/.nvm/nvm.sh && pm2 ls && node -v
pg_lsclusters
```
Plus z venku: web, `/sbirka`, `/mapa`, `/statistiky`, `/admin` (cloak +
WebAuthn, `bash deploy/cloak-check.sh` z VPS = 6× ✅), `stats.` (GoatCounter),
RustDesk klient, jeden testovací deploy (prázdný commit z Macu) a ručně
spuštěný workflow *Runtime security* — po fázi 5 musí být **zelený**
(do fáze 6 se ještě může ozvat `apt-orphaned` kvůli balíčkům PG 17).
Runner: `systemctl status` jeho služby, v GitHubu stav „Idle".

### Kontrolní seznam: nginx, Node a ostatní služby (projít celý ve fázi 4)

Upgrade OS mění pod appkou knihovny, unity i výchozí konfigurace. „Web
odpovídá 200" nestačí — tohle všechno musí sedět:

**nginx**
- Upgrader nabídne přepsat konfigurace → **ponechat naše**. Pak porovnat
  s předupgradovou zálohou: `/etc/nginx/sites-available/ctyrlistkoteka`,
  drop-in `conf.d/ctyrlistkoteka-gzip.conf`, `snippets/admin-allowlist.conf`
  a `snippets/permaban-list.conf` musí zůstat beze změny
  (`sudo diff -r` proti rozbalenému `etc-pre-26.04.tgz`).
- `sudo nginx -t`; maska `/admin` → `bash deploy/cloak-check.sh` = 6× ✅
  (oba `@admin_*_cloak` bloky jsou klon živého `location /` — viz
  `deploy/nginx-cloak-app404.py`).
- Komprese (`curl -sI -H 'Accept-Encoding: gzip' …` → `content-encoding`),
  bezpečnostní hlavičky, `stats.` a `qr.casqb.org` vhosty.
- certbot: `systemctl is-enabled certbot.timer` + `certbot renew --dry-run`.
- Ve fázi 5 odebrat `ssl_stapling` (OCSP u Let's Encrypt skončil).

**Node / PM2 / appka**
- nvm v `/home/app` upgrade nezmění — ale ověřit, že běží správná binárka:
  `readlink /proc/<pid>/exe` u démona PM2 i workerů (gotchas #34), ne
  `pm2 ls`. `systemctl is-enabled pm2-app` musí být `enabled`.
- Nativní moduly proti nové glibc: v `/var/www/ctyrlistkoteka`
  `node -e "require('sharp'); require('@prisma/client')"` bez chyby.
  Ostrý test = jeden deploy (build + migrace + reload) a `pnpm sync --dry-run`.
- Self-hosted runner: služba `actions.runner.*` aktivní, v GitHubu „Idle".

**Ostatní služby a časovače**
- `fail2ban`, `nftables` (permaban set načtený), `unattended-upgrades`
  (Allowed-Origins jedou přes `${distro_codename}` → přepnou se samy; v
  `/etc/apt/apt.conf.d/52ctyrlistkoteka-unattended.conf` ověřit, že zůstal náš soubor).
- Cron uživatele `app` (`crontab -l`: backup 3:00, služby 3:05, staging
  3:10, freshness 6:40, úklidy koše) a systemd timery (`systemctl
  list-timers`: sync Google Sheets, certbot).
- Docker: GoatCounter + RustDesk běží (`update-docker-services.sh` až po
  návratu Docker repa ve fázi 5).
- Ruční běh workflow *Runtime security*: `os-release` musí zezelenat.

**Pravidla projektu (CLAUDE.md §11) — ve stejném úkolu**
- `docs/deployment.md` → callout „Skutečný stav produkce" (OS 26.04,
  verze nginx/Docker/PG), CLAUDE.md §12 (už ne 25.10 EOL), `CHANGELOG.md`,
  `PROGRESS.md`, komentář v `deploy/unattended-upgrades-50ctyrlistkoteka.conf`.
- Rozšířit/upravit kontrolu, pokud nová verze něco změní
  (`scripts/check-runtime-security.ts`).
- Paměť `project_node2shell_runtime_security` uzavřít, až bude týdenní
  kontrola zelená a Node 24.18.0 smazaný.

## Fáze 5 — dočištění

- **Docker repozitář zpět** (oficiální postup docs.docker.com; 25.10 už
  Docker nepodporuje, 26.04 ano):
  ```bash
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
  Types: deb
  URIs: https://download.docker.com/linux/ubuntu
  Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
  Components: stable
  Architectures: $(dpkg --print-architecture)
  Signed-By: /etc/apt/keyrings/docker.asc
  EOF
  sudo apt update && sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  ```
  Upgrade Dockeru restartuje kontejnery → hned po něm
  `sudo bash deploy/update-docker-services.sh /home/app/rustdesk /var/ctyrlistkoteka/goatcounter`.
  **Rozhodnuto (majitel, 2026-10-29): origin Dockeru ZAŘADIT do
  `unattended-upgrades`** — záplaty automaticky, za cenu občasného
  nočního restartu GoatCounteru a RustDesku. Po zavedení ověřit, že
  kontejnery po restartu Dockeru samy naběhnou (`restart:` v compose)
  a že `apt-foreign` v týdenní kontrole pak Docker nehlásí.
- `nginx`: odebrat `ssl_stapling` (Let's Encrypt OCSP zrušil — jen
  varování v `nginx -t`), `nginx -t`, reload.
- `apt autoremove` — **jen po přečtení seznamu** (nesmí zmizet
  PG 17, dokud běží).
- Aktualizovat dokumentaci: CLAUDE.md §12, callout v `deployment.md`,
  `PROGRESS.md`, CHANGELOG.
- Smazat Node 24.18.0 postupem „Mazání staré verze Node".

## Fáze 6 — PostgreSQL 17 → 18 (podle R-PG; samostatné okno)

Plán doladěný 2026-10-29 (předpoklady: OS hotový, certbot a UNAS ověřené
ráno 2026-10-29). Každá podfáze končí kontrolou výstupů, do další se jde
až po ní.

### 6a — předkontrola (jen čtení, kdykoliv)

Kolace (glibc se s OS změnil — dump/restore indexy stejně přestaví),
md5 hesla (PG 18 je označuje za zastaralá), ručně měněná nastavení
a `pg_hba` (`pg_upgradecluster` je přenese), velikost DB, kandidáti balíčků,
co dalšího sahá do DB (cron, časovače).

```bash
pg_lsclusters
sudo -u postgres psql -d ctyrlistkoteka -Atc "select extname, extversion from pg_extension order by 1"
sudo -u postgres psql -Atc "select datname, datcollversion, pg_database_collation_actual_version(oid) from pg_database where datallowconn"
sudo -u postgres psql -Atc "select rolname from pg_authid where rolpassword like 'md5%'"
sudo -u postgres psql -Atc "select pg_size_pretty(pg_database_size('ctyrlistkoteka'))"
sudo -u postgres psql -Atc "select name, setting from pg_settings where source = 'configuration file' order by 1"
sudo grep -vE '^[[:space:]]*(#|$)' /etc/postgresql/17/main/pg_hba.conf
ls -la /etc/postgresql/17/main/conf.d/
grep -E '^[[:space:]]*create_main_cluster' /etc/postgresql-common/createcluster.conf
apt-cache policy postgresql-18 postgresql-18-postgis-3 | grep -E '^[a-z]|Candidate'
df -h /var/lib/postgresql
crontab -l | grep -v '^#'
systemctl list-timers --no-pager | grep -E 'sync|backup|drop'
```

### 6b — okno údržby (výpadek webu několik minut) ✅ 2026-10-30

**Průběh (2026-10-30, ~16:30–16:42 UTC, výpadek webu ~10 min):**
- 6a: kolace prázdné (locale `C.UTF-8` → nezávislé na glibc), žádná md5
  hesla, DB 55 MB, výchozí konfigurace, `pg_hba` = scram.
- `apt install postgresql-18 postgresql-18-postgis-3`: 15 balíčků, nic
  neodebráno. **Prázdný cluster 18 se NEzaložil** (na rozdíl od
  předpokladu) — krok `pg_dropcluster 18 main` odpadl; ověřeno
  `pg_lsclusters` a `ls /etc/postgresql/` (jen `17`).
- Zastaveny časovače `drop-sheet-sync` + `ctyrlistkoteka-sync`, PM2
  `ctyrlistkoteka`; žádní klienti v `pg_stat_activity`.
- Dump `ctyrlistkoteka-2026-10-30_1634.dump` (4 466 097 B) přes
  `backup.sh`, na Macu v `~/backups/ctyrlistkoteka/pre-26.04/`, sha256 sedí.
- `sudo pg_upgradecluster 17 main` → `Success`; initdb s checksums,
  `C.UTF-8`, role i konfigurace přeneseny, vacuumdb/analyze proběhl sám.
  Výsledek: `18 main 5432 online`, `17 main 5433 down` („Disabling
  automatic startup of old cluster“).
- Ověřeno: `PostgreSQL 18.6`, `pg_trgm 1.6`, `postgis 3.6.2` (bez
  „need upgrade“ — `postgis_extensions_upgrade()` nebyl potřeba), GEOS
  3.14.1, PROJ 9.7.1, `finds` = 31 700, `data_checksums = on`, přihlášení
  `ctyrlist` přes TCP (`.pgpass`) OK.
- PM2 + časovače zpět, `/sbirka` 200, log bez chyb DB. Ruční *Runtime
  security*: vše `[ok]` vč. `db-extensions`, jediný nález `apt-orphaned`
  (balíčky PG 17 — čekané do 6d).

Původní plán:

Nic nepushovat do `main`. Zastavit zápisy (časovače `drop-sheet-sync`
a `ctyrlistkoteka-sync`, PM2 proces `ctyrlistkoteka`), čerstvý dump přes
`deploy/backup.sh` + stáhnout na Mac a ověřit hash, `apt install
postgresql-18 postgresql-18-postgis-3`, smazat jen prázdný cluster 18,
který si balíček sám založí (oznámit předem — data v něm nejsou),
`pg_upgradecluster 17 main` (dump/restore — viz R-PG: checksums), ověřit
`pg_lsclusters` (18 na 5432 online, 17 zastavený vedle), verze rozšíření,
počet nálezů, pak PM2 a časovače zpět. Přesné příkazy se doplní po 6a.

### 6c — ověření

Web + `/admin/checks`, `pnpm sync --dry-run`, ruční `deploy/backup.sh`
(pg_dump 18 proti clusteru 18, `pg_restore --list`), ruční běh *Runtime
security* (`--db`: rozšíření sedí s balíčky), další noční off-site stažení
na UNAS.

### 6d — úklid (až po několika dnech provozu, se souhlasem)

`pg_dropcluster 17 main` a odebrat balíčky PG 17 (destruktivní — oznámit
a odsouhlasit předem). Pak `apt-orphaned` v týdenní kontrole zezelená.

### 6e — dokumentace

Callout v `deployment.md`, CLAUDE.md §2/§3/§11/§12 (PG 17 → 18),
CHANGELOG, PROGRESS, paměť.

Návrat: cluster 17 zůstává až do 6d — přepnutí zpět přes porty
a `pg_ctlcluster` (zápisy po přepnutí by se ztratily); v nejhorším dump
z 6b nebo snapshot VPS.

## Zdroje

- [Ubuntu 26.04 LTS release notes](https://documentation.ubuntu.com/release-notes/26.04/)
- [Changes since 25.10](https://documentation.ubuntu.com/release-notes/26.04/changes-since-previous-interim/)
- Launchpad API, `getPublishedSources` pro `questing` a `resolute`
  (verze v tabulce, dotaz 2026-10-28)
- [PGDG `resolute-pgdg`](https://apt.postgresql.org/pub/repos/apt/dists/)
- [Prisma — supported databases](https://www.prisma.io/docs/orm/reference/supported-databases)
- [Launchpad bug 2152927](https://lists.snapcraft.io/archives/foundations-bugs/2026-May/548839.html)
