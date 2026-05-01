# Čtyřlístkotéka

Veřejná webová prezentace sbírky čtyřlístků. Nálezy, mapy, statistiky.

🌐 **[ctyrlistkoteka.cz](https://ctyrlistkoteka.cz)**

---

## Tech stack

- **Next.js** (App Router) + TypeScript + Tailwind CSS
- **PostgreSQL 16** + **PostGIS** přes Prisma
- **Leaflet** + **react-leaflet** (OpenStreetMap)
- **Recharts** (statistiky)
- **sharp** + **heic-convert** (zpracování obrázků)
- Hostováno na **OVH VPS** za **Nginx** + **Let's Encrypt**, proces managuje **PM2**

## Rychlý start — lokální vývoj

Potřebuješ: **Node.js LTS**, **pnpm**, **Docker**.

```bash
# Klonovat repo
git clone git@github.com:<user>/ctyrlistkoteka.git
cd ctyrlistkoteka

# Instalace závislostí
pnpm install

# Vytvořit .env z .env.example
cp .env.example .env
# (vyplnit hodnoty)

# Spustit Postgres+PostGIS v Dockeru
docker compose up -d

# Aplikovat migrace a seed
pnpm prisma migrate dev
pnpm db:seed

# Dev server
pnpm dev
```

Otevři [http://localhost:3000](http://localhost:3000).

## Příkazy

| Příkaz | Popis |
| --- | --- |
| `pnpm dev` | Dev server s HMR |
| `pnpm build` | Produkční build |
| `pnpm start` | Spustí produkční build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript check |
| `pnpm test` | Vitest unit testy |
| `pnpm test:e2e` | Playwright E2E |
| `pnpm sync` | Import `DATA_DIR` → DB |
| `pnpm sync --dry-run` | Sync bez zápisu do DB |
| `pnpm generate-images` | HEIC/JPEG → WebP varianty |
| `pnpm db:studio` | Prisma Studio |

## Sync na produkci po rsyncu

Po nahrání nových dat do `/var/ctyrlistkoteka/data/{finds,crops,maps,meta}` na VPS
se podle situace volí jiný příkaz.

### 1. Jen přibyly nové soubory (žádné mazání lokálně)

```sh
cd /var/www/ctyrlistkoteka
pnpm sync
pm2 restart ctyrlistkoteka
```

`sync` bez `--prune` jen přidá/aktualizuje. Existující WebP varianty (klíčované
sha1) se nepřepisují, takže běh je rychlý — počítá se hlavně sha1 nových souborů.

### 2. Lokálně se něco smazalo/přejmenovalo (nebo měl rsync `--delete`)

```sh
cd /var/www/ctyrlistkoteka
pnpm sync --prune --dry-run     # nejdřív koukni, co se chystá smazat
pnpm sync --prune                # když dry-run vypadá dobře, pusť ostře
pm2 restart ctyrlistkoteka
```

`--prune` smaže DB orphany (`finds`, `locations`, `location_maps`) i WebP soubory
v `generated/`, na které už nic v DB neukazuje. Bez `--prune` zůstanou v DB staré
řádky a stránky budou ukazovat fantómy.

### 3. Změnil se jen `LokaceStavyPoznamky.json`

```sh
cd /var/www/ctyrlistkoteka
pnpm sync --only=meta
pm2 restart ctyrlistkoteka
```

Nesahá na soubory ani neregeneruje obrázky — jen přepíše poznámky/stavy/anonymizaci v DB.

### Proč `pm2 restart`

Next.js drží SSR/ISR cache stránek. Bez restartu jsou na webu vidět stará čísla
i přes čerstvou DB. Restart je rychlý (~2 s).

### Užitečné flagy

| Flag | Použití |
| --- | --- |
| `--dry-run` | Žádné DB zápisy ani mazání. Vypíše plán + parse failures. |
| `--force-regen` | Přegeneruje WebP i když existují (po změně `WEB_SIZE`/`THUMB_QUALITY` apod.). |
| `--find=<id>` | Jen jeden konkrétní nález — pro debug. |
| `--only=maps\|finds\|meta` | Spustí jen vybranou fázi. |

### Logy

Každý běh píše do `logs/sync-<ISO>.log` (strukturovaný JSON) a
`logs/sync-failures-<ISO>.jsonl` (parse chyby).

```sh
tail -f logs/sync-*.log | jq .
ls logs/sync-failures-*.jsonl    # 0 souborů = žádné parse chyby
```

### TL;DR jako rutina

V drtivé většině případů (ať už se mazalo lokálně nebo ne) stačí spouštět:

```sh
cd /var/www/ctyrlistkoteka && pnpm sync --prune && pm2 restart ctyrlistkoteka
```

`--prune` na čistém stavu nemá co mazat, takže nic nepokazí, a chrání před
zapomenutým úklidem.

### Reálné fotky lokalit (mimo `pnpm sync`)

Detail lokality (`/lokality/<id>`) má v sekci **„Mapa lokality"** v pravém
horním rohu hlavičky tlačítko **„Reálná fotka"**. Ukáže se jen tehdy, když
má daná location-map ručně nahranou reálnou fotografii s vyznačeným AOI.

Konvence:

- **Cesta:** `${GENERATED_DIR}/location-photos/`  
  (na produkci typicky `/var/ctyrlistkoteka/generated/location-photos/`).
  Složku stačí jednou vytvořit (`mkdir -p`); Nginx ji obslouží přes
  existující alias `/generated/`.
- **Název souboru:** stejný jako `originalFilename` u dané mapy (s
  diakritikou + plus signy, tak jak ji autor pojmenoval lokálně), bez
  původní přípony, plus suffix `_reálné foto*.png`.
  Příklad: pro mapu `REYKJAVÍK_MIKLABRAUT001+Island - po cestě…+00057.HEIC`
  je očekávaná fotka `REYKJAVÍK_MIKLABRAUT001+Island - po cestě…+00057_reálné foto ve střední velikosti.png`.
- **Formát:** PNG / JPG / JPEG / WebP, doporučená max šířka **1600 px**.
- **Privacy:** anonymizované mapy se neresolvují i kdyby fotka existovala —
  tlačítko se neukáže.

Není potřeba spouštět `pnpm sync`. Po nahrání nové fotky ale **musíš
udělat `pm2 restart ctyrlistkoteka`** — detail stránky má `revalidate
= 86400` (24 h), takže Next.js servíruje cached HTML a SSR se
nespouští, dokud se cache nezneplatní. Restart proces ISR cache
zahodí, další request stránku rerenderuje, helper přečte složku a
tlačítko se objeví. Bez restartu by se fotka ukázala až po 24 h
přirozené revalidace.

#### Synchronizace fotek z lokálu

Fotky bydlí na Macu v iCloudu, na VPS jdou nahrát rsyncem. Zachovej
trailing slash u source — zkopírují se OBSAHY složky, ne sama složka:

```sh
# Anonymizovaná verze (pro public dokumentaci)
rsync -avz --progress --exclude='.DS_Store' \
  '/Users/<user>/Library/Mobile Documents/com~apple~CloudDocs/Čtyřlístky/Generování PDF/Mapky lokací/Roztříděné/Reálné fotky/Připravené na web/' \
  <user>@<host>:/var/ctyrlistkoteka/generated/location-photos/
```

Při prvním rsyncu vytvoř cílový adresář (jednou stačí):

```sh
ssh <user>@<host> 'mkdir -p /var/ctyrlistkoteka/generated/location-photos/'
```

Volitelně ověř, co se nahrálo:

```sh
ssh <user>@<host> 'ls -la /var/ctyrlistkoteka/generated/location-photos/ | head -20'
```

> **iCloud on-demand:** soubory ve `Mobile Documents/com~apple~CloudDocs`
> mají Mac tendenci stahovat až při prvním otevření. Pokud rsync vrátí
> *Resource temporarily unavailable* pro nějaký soubor, otevři Finder na
> té cestě, počkej až se modré ikonky šipky překlopí do vyplněných, a
> rsync znovu spusť. Případně preventivně:
> `brctl download '/Users/<user>/Library/Mobile Documents/com~apple~CloudDocs/Čtyřlístky/Generování PDF/Mapky lokací/Roztříděné/Reálné fotky/Připravené na web/'`

> **Bez `--delete`:** rsync defaultně NEMAŽE soubory na VPS, které byly
> lokálně přejmenované/smazané. Pokud potřebuješ zrcadlo, přidej
> `--delete` — ale pozor, smaže i to, co ti tam náhodou skončilo přes
> jiný kanál. Pro řízený úklid raději `ssh ... 'rm /var/ctyrlistkoteka/generated/location-photos/<konkrétní>.png'`.

### Automatický sync 2× denně

Je k dispozici systemd timer (šablona `deploy/systemd-sync.timer` +
`deploy/systemd-sync.service`), který spustí `pnpm sync` v 06:00 a 18:00
místního času a po něm udělá `pm2 reload ctyrlistkoteka`. `--prune` se
automaticky **nespouští** — orphany v DB i `generated/` zůstávají, dokud
`pnpm sync --prune` ručně nepustíš (chrání to před chybným úklidem, kdyby
běh načasování spadl doprostřed rozpracovaného rsyncu).

Sync sám rychle přeskakuje soubory, které se od poslední importované
verze nezměnily (porovnává `mtime` proti `find_images.created_at`),
takže pravidelný běh nad nezměněnou sbírkou trvá sekundy, ne minuty.

Instalace na VPS (jednou):

```sh
sudo cp deploy/systemd-sync.service /etc/systemd/system/ctyrlistkoteka-sync.service
sudo cp deploy/systemd-sync.timer  /etc/systemd/system/ctyrlistkoteka-sync.timer
sudo systemctl daemon-reload
sudo systemctl enable --now ctyrlistkoteka-sync.timer
systemctl list-timers | grep ctyrlistkoteka     # ověř plán
```

Stav posledního běhu: `journalctl -u ctyrlistkoteka-sync.service -n 200`.

## Bezpečnost — fail2ban + blocklist-tools

Veřejný read-only web bez user-input nepotřebuje WAF, ale **scanner traffic**
(`/.env`, `/wp-login.php`, brute-force SSH) má smysl odřezávat. Stack je
dvouvrstvý:

1. **Nginx** dropuje notorické scanner cesty na úrovni HTTP (snippet
   `block-exploits.conf`) — instant 444, žádný backend overhead.
2. **fail2ban** banuje opakované útočníky na úrovni firewall a každý
   ban kopíruje do `/var/log/fail2ban-blocklist.tsv` (append-only audit
   log). Z TSV se generuje **permaban list** pro nginx `deny` (IP, které
   se v TSV objevily ≥ 3× za 30 dní) — ten už není pod `bantime`
   expirací a jede dokud ji ručně nesundáš.

Plný setup (instalace, konfigurace, ssh hardening, AbuseIPDB integrace)
popisuje [`deploy/README.md`](deploy/README.md) — sekce *Security
hardening*. Tady níže je jen **denní operativa**.

### Co kde najdeš

| Co | Příkaz |
| --- | --- |
| Aktuálně banované IP v jailu | `sudo fail2ban-client status nginx-noscript` (nebo `sshd`, `sshd-logger`) |
| Souhrn banů (top IP, top jails) | `sudo blocklist-tools.sh stats` |
| Posledních N banů s důvodem | `sudo blocklist-tools.sh recent 20` |
| Všechny IP setříděné podle počtu banů | `sudo blocklist-tools.sh ips` |
| Manuální unban | `sudo fail2ban-client unban <ip>` |
| Append-only audit log | `sudo less /var/log/fail2ban-blocklist.tsv` |

### Generování permaban listu

`blocklist-tools.sh nginx-deny` projde `/var/log/fail2ban-blocklist.tsv`,
najde IP které **z `nginx-noscript` jailu** překročily práh (default
3× za 30 dní), a zapíše je do
`/etc/nginx/snippets/permaban-list.conf` jako `deny <ip>;`. SSH bany se
do nginx-deny **záměrně nepromítají** (HTTP `deny` na SSH nemá vliv,
sshd jail to řeší nezávisle).

```sh
# Jednorázově
sudo blocklist-tools.sh nginx-deny
sudo nginx -t && sudo systemctl reload nginx

# Přísnější varianta (2× za 14 dní)
sudo PERMABAN_THRESHOLD=2 WINDOW_DAYS=14 blocklist-tools.sh nginx-deny

# Auto-regenerace přes cron (denně 04:00)
sudo crontab -e
# 0 4 * * * /usr/local/sbin/blocklist-tools.sh nginx-deny && /usr/sbin/nginx -t && /bin/systemctl reload nginx
```

Nginx config musí permaban list jednorázově zaincludovat — v
`/etc/nginx/sites-available/ctyrlistkoteka` v `server { ... }` bloku:

```nginx
include /etc/nginx/snippets/permaban-list.conf;
```

### AbuseIPDB reporting

Cron `/etc/cron.d/abuseipdb-report` běží denně 5:30, čte nové bany
z TSV a posílá je na [abuseipdb.com](https://www.abuseipdb.com/) bulk
endpoint. Útočníci se přidávají do veřejné databáze, tvoje confidence
score s objemem reportů roste.

| Co | Kde |
| --- | --- |
| Manuální spuštění (smoke test) | `sudo /usr/local/sbin/abuseipdb-report.sh` |
| Log | `sudo tail -f /var/log/abuseipdb-report.log` |
| API key (chmod 600) | `/etc/abuseipdb-key` |
| Stav (poslední timestamp) | `cat /var/lib/abuseipdb-report/last-timestamp` |

Mapování jail → AbuseIPDB kategorie:

| Jail | Kategorie | Význam |
| --- | --- | --- |
| `sshd`, `sshd-logger` | 18, 22 | Brute-Force, SSH |
| `nginx-noscript` | 19, 21 | Bad Web Bot, Web App Attack |
| ostatní | 15 | Hacking |

Skript si pamatuje poslední úspěšně reportovaný timestamp; když smažeš
`/var/lib/abuseipdb-report/last-timestamp`, příští run reportuje vše
(starší než 30 dní AbuseIPDB stejně vyhodí jako `invalidReports`).

### Whitelist vlastní IP

Aby tě fail2ban náhodou nezbanoval (např. když ladíš a omylem trefíš
6× exploit URL), přidej home/mobile IP do `[DEFAULT]` v
`/etc/fail2ban/jail.local`:

```ini
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 <vlastní IPv4> <vlastní IPv6/64>
```

Pak `sudo fail2ban-client reload`. Whitelist je separátní pro
GoatCounter (Settings → Ignore IPs ve stats subdoméně).

## Matematika /statistiky

Některé sekce stránky `/statistiky` (a kartička „Nejlepší den" na hlavní
stránce) počítají „čistý čas sbírání" a kalendářní tempo. Tady je jak to
je definované, ať se to dá kdykoliv zpětně ověřit z čísel ve světě.

### Sezení (session)

Pro skupinu nálezů ve **stejné lokalitě**, seřazenou podle `found_at`, se
otevírá nové sezení, kdykoliv mezi dvěma po sobě jdoucími nálezy uplyne
**> 15 minut**. Sezení tedy reprezentuje jeden běh sbírání na místě;
pauza delší než 15 min = nezávislá návštěva, kterou počítáme samostatně.

Algoritmicky (Pseudocode):

```
sessions := 0
totalSpread := 0
for each location L:
  ts := all foundAt timestamps for finds in L, sorted ascending
  if ts is empty: continue
  start := ts[0]
  prev  := ts[0]
  for i from 1 to len(ts) - 1:
    if ts[i] - prev > 15 min:
      totalSpread += prev - start
      sessions += 1
      start := ts[i]
    prev := ts[i]
  totalSpread += prev - start
  sessions += 1
```

Single-find sezení přispívá do `totalSpread` 0 (z jednoho timestampu nejde
změřit délku), ale stále se počítá do `sessions` a dostane baseline níže.

### Baseline na sezení

Každému sezení se připočítává **2 minuty před prvním nálezem** —
chvíle na příchod, rozhlédnutí, zaostření. Bez toho by single-find
sezení mělo nulovou délku, což realitu nezachycuje. Konstanta žije v
`SESSION_BASELINE_MS` v `src/lib/queries/home.ts` a duplicitně v
`src/lib/queries/stats.ts` (stejná hodnota; commit, který by ji měnil,
musí přepsat obě místa).

### Čistý čas sbírání

```
estimatedMinutes = round( (totalSpread + sessions × 2 min) / 60 sec )
```

Na hlavní stránce v dlaždici „Nejlepší den" se to počítá jen pro nálezy
toho jednoho dne (`date_trunc('day', found_at) = peakDay`). Na
`/statistiky` v sekci „Doba sbírání a tempo" se to počítá nad **všemi
nálezy s vyplněným `found_at` a `location_id`** — sezení mohou volně
přesahovat přes půlnoc, protože matematika groupuje primárně podle
lokality, ne podle dne.

Nálezy bez `location_id` (vzácně, typicky parse error) jsou z výpočtu
**vyřazeny** — bez lokality nelze určit, jestli dva nálezy patří do
stejného sezení.

### Tempo sbírání (kalendářní)

Anchor je `firstFoundAt` = `MIN(found_at)` napříč všemi nálezy.
Uplynulý čas: `now - firstFoundAt` v sekundách.

Konverze na jednotky:

| Jednotka | Sekund |
| --- | --- |
| hodina | 3 600 |
| den | 86 400 |
| týden | 7 × 86 400 = 604 800 |
| měsíc | 30,44 × 86 400 ≈ 2 629 800 (Julian průměr, 365,25 / 12) |
| rok | 365,25 × 86 400 ≈ 31 557 600 (Julian rok, kompenzuje přestupné) |

Tempo:

```
perUnit = totalFindsWithDate / (elapsedSeconds / unitSeconds)
```

Číselně: pro ~17 000 nálezů za ~12 let to dává cca **1 400 / rok**, **120 /
měsíc**, **27 / týden**, **4 / den**, **0,2 / hod** — minutový pohled by
v kalendáři byl nesmyslně malý, takže se nezobrazuje.

## Dokumentace

- [`CLAUDE.md`](CLAUDE.md) — závazné pokyny pro práci na projektu
- [`docs/architecture.md`](docs/architecture.md) — architektura
- [`docs/data-schema.md`](docs/data-schema.md) — datový model
- [`docs/filename-convention.md`](docs/filename-convention.md) — konvence názvů souborů (**důležité**)
- [`docs/sync-workflow.md`](docs/sync-workflow.md) — import dat
- [`docs/deployment.md`](docs/deployment.md) — deployment na OVH
- [`deploy/README.md`](deploy/README.md) — katalog produkčních artefaktů + plný security setup

## Přispívání

Tohle je soukromý projekt jednoho autora, ale struktura kódu má být čistá a testovaná
i pro případ, že se časem otevře. Commit zprávy používají
[Conventional Commits](https://www.conventionalcommits.org/).

## Licence

Kód: MIT (volitelné — doplnit).
Obrazová data a obsah sbírky: © autor, všechna práva vyhrazena.
