# Upgrade VPS: Ubuntu 25.10 „questing" → 26.04 LTS „resolute"

> **Stav: NÁVRH k odsouhlasení (2026-10-28).** Nic z toho ještě neběželo.
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

## Rozhodnutí R-PG (otevřené — rozhodne majitel po fázi 0)

Po upgradu OS zůstane PG 17 nainstalovaný a běžící, ale **z archivu
Ubuntu už bez bezpečnostních aktualizací**. Dvě cesty:

- **A — přejít na PG 18 z Ubuntu** (`pg_upgradecluster`). Žádné cizí
  repo, aktualizace přes Ubuntu `-security` (už je chytá vzor
  `postgresql-` v unattended-upgrades). Cena: major migrace DB.
  Prisma PG 18 oficiálně podporuje.
- **B — nechat PG 17 z repozitáře PGDG** (`apt.postgresql.org`, má
  `resolute-pgdg` s `postgresql-17` i `postgresql-17-postgis-3`). Bez
  migrace dat; PG 17 má upstream podporu do listopadu 2029. Cena: další
  apt repo (do unattended-upgrades se musí přidat jeho origin, jinak se
  nepatchuje — přesně ta mezera, kterou kontrola runtime zatím nevidí).

Doporučení: **A, ale jako samostatný krok až po ověřeném OS** — upgrade
OS a migraci DB nemíchat; když se něco pokazí, je jasné, co. Pokud fáze 0
ukáže, že PGDG už na hostu je, mění to výchozí bod a probereme znovu.

## Fáze 0 — inventura (jen čtení, nic nemění)

Výstup celé fáze vlož do session; podle něj se doladí zbytek plánu.

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
- Cizí apt repa vypne (záloha s příponou `.distUpgrade`) — po upgradu se
  znovu zapnou ručně (fáze 5).
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
WebAuthn), jeden testovací deploy (prázdný commit z Macu) a ručně spuštěný
workflow *Runtime security* — musí být **zelený** (Ubuntu podporováno).
Runner: `systemctl status` jeho služby, v GitHubu stav „Idle".

## Fáze 5 — dočištění

- Znovu zapnout cizí repa (`.distUpgrade`), u každého ověřit suite
  `resolute`.
- `apt autoremove` — **jen po přečtení seznamu** (nesmí zmizet
  PG 17, dokud běží).
- Aktualizovat dokumentaci: CLAUDE.md §12, callout v `deployment.md`,
  `PROGRESS.md`, CHANGELOG.
- Smazat Node 24.18.0 postupem „Mazání staré verze Node".

## Fáze 6 — PostgreSQL (podle R-PG; samostatné okno)

Varianta A (náčrt, doladí se po fázi 0):
1. Čerstvý `pg_dump -Fc` na Mac.
2. `sudo apt install postgresql-18 postgresql-18-postgis-3`.
3. `sudo pg_dropcluster 18 main --stop` — jen prázdný cluster, který
   balíček sám založil (oznámit předem; data v něm nejsou).
4. `sudo pg_upgradecluster 17 main` — výchozí metoda **dump/restore**,
   ne `-m upgrade`: PG 18 při `initdb` zapíná datové checksums, a
   `pg_upgrade` vyžaduje shodu se starým clusterem (fáze 0 ukáže
   `data_checksums`). Při naší velikosti DB je dump rychlý. Nový cluster
   převezme port 5432, starý zůstane zastavený vedle.
5. `SELECT postgis_extensions_upgrade();` v DB `ctyrlistkoteka`,
   `pm2 reload`, ověřit web + `pnpm sync --dry-run` + `/admin/checks`.
6. Až po několika dnech provozu: `pg_dropcluster 17 main` a odebrat
   balíčky PG 17 (destruktivní — oznámit a odsouhlasit předem).

Návrat: starý cluster 17 běží dál až do kroku 6 — `pg_ctlcluster`
přepnutí zpět; v nejhorším snapshot z fáze 1.

## Zdroje

- [Ubuntu 26.04 LTS release notes](https://documentation.ubuntu.com/release-notes/26.04/)
- [Changes since 25.10](https://documentation.ubuntu.com/release-notes/26.04/changes-since-previous-interim/)
- Launchpad API, `getPublishedSources` pro `questing` a `resolute`
  (verze v tabulce, dotaz 2026-10-28)
- [PGDG `resolute-pgdg`](https://apt.postgresql.org/pub/repos/apt/dists/)
- [Prisma — supported databases](https://www.prisma.io/docs/orm/reference/supported-databases)
- [Launchpad bug 2152927](https://lists.snapcraft.io/archives/foundations-bugs/2026-May/548839.html)
