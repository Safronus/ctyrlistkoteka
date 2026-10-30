# PROGRESS

Záchytný bod pro navázání v nové session. Historie změn je v `CHANGELOG.md`,
tady jen to, co je rozpracované.

## Opravný balíček nálezů („oprava-nalezu“, od 2026-10-28)

Smlouva formátu: desktopové repo `docs/WEB_aktualizace_nalezu.md` (revize 2).
Oprava je SAMOSTATNÝ typ balíčku — balíčky map a nových nálezů se nemění.

### Hotovo
- ✅ F1 analýza + náhled (20b76b5), F2 zápis vše-nebo-nic (d470529) — nasazené.
- ✅ F3 po potvrzení opravy se sám spustí plný sync (bfb76bd, jen lokálně).
- ✅ F4 sync + /admin/checks hlásí víc fotek téhož nálezu; `reconcileFindLinks`
  bere stejný soubor jako zbytek syncu (3f6d3a7, jen lokálně).

### Rozpracováno
- ✅ Společný test 2026-10-28 OVĚŘEN: `oprava-nalezu-2026-10-28_1342.zip`
  (31420–31422 → mapa 149, 31426/31427/31429 → mapa 32) — banner + překryv
  daru, poznámka skrytá, WebP = sha1 balíčku (jen přejmenování), 2 WebP na
  nález; 31423–31425 a 31428 beze změny. Otevřené: R8 u 31427/31429 —
  odpoví výsledková karta / historie importu.
- ✅ Varování v náhledu BĚŽNÉHO balíčku (jen text) — schváleno, ee93b6f.
- ✅ F5 dokumentace (admin-overview, sync-workflow, CHANGELOG), jen lokálně.

### Zbývá
- ✅ F3–F5 pushnuté po ověřeném testu (2026-10-28), výsledek poslán desktopu.

## Bezpečnost: maska /admin + audit úniků + vlastní 404 (od 2026-10-28)

Pořadí dané majitelem: **bezpečnost první**, pak vzhled.

### Zjištěno
- ❌ Nginx maska `/admin` a `/api/admin` (`@admin_notfound`) vrací cizím IP
  natvrdo 120 B HTML bez CSP, kdežto skutečná 404 appky má ~71 kB, titulek
  webu a CSP hlavičku → útočník pozná, že `/admin` „je jiná“ (únik
  informace, ne přístup). Vlastní 404 by rozdíl jen zvětšila.

### Plán
1. **Jednotná 404 přes appku**
   - ✅ App (5d2909d): middleware `X-Ctyr-Cloak`, catch-all `api/[...rest]`,
     `X-Robots-Tag` jen na skutečném adminu, testy.
   - ✅ `deploy/nginx-cloak-app404.py` (klonuje živé `location /` a
     `/api/`) + `deploy/cloak-check.sh`; ověřeno skutečným nginx v Dockeru.
   - ✅ **VPS 2026-10-28:** skript, `nginx -t`, reload; `cloak-check.sh`
     z VPS 6× ✅; admin z domácí IP OK, z mobilní sítě 404.
   - Drobný úklid na později: `ssl_stapling` v nginx je zbytečný (LE zrušil
     OCSP) — jen varování v `nginx -t`.
2. ✅ **Audit veřejného repa na úniky** hotový 2026-10-28 — zpráva je
   jen LOKÁLNĚ v `tmp/security-audit-2026-10-28.md` (git ji ignoruje;
   nikdy ji necommituj, popisuje slabiny). Čeká rozhodnutí majitele
   o navržených krocích.
3. ✅ **Vlastní 404 „hledej čtyřlístek“** nasazená 2026-10-28 (c5ef41e):
   náhodně Louka / Lupa, kola se zvyšující obtížností, časomíra + rekord
   pro návštěvu, CZ/EN, ověřeno na produkci (CSP bez chyb).
   - ⏳ Návrh **Top 10 žebříčku** (anonymní, server měří čas, HMAC kola,
     nová tabulka + endpoint + rate limit + věta do /soukromi) — čeká na
     rozhodnutí majitele; alternativa = osobní rekord v localStorage
     (vyžaduje výjimku z pravidla v CLAUDE.md).
4. ⏳ **Rozdělení na dvě repa:** P1 hotovo (private repo + `ops/`),
   P2–P5 odloženo majitelem.

### Stále čeká (nezapomenout)
- Ubuntu 25.10 → 26.04: výstup fáze 0 od majitele → doladit plán + R-PG,
  zapnout `--docker` v `runtime-security.yml`, opravit nálezy inventury.

## Upgrade Ubuntu 25.10 → 26.04 (2026-10-28/29)
- Plán + kontrolní seznam nginx / Node / služby / pravidla:
  `docs/ubuntu-upgrade-26.04.md`.
- ✅ Fáze 1: dump `ctyrlistkoteka-2026-10-28_2306.dump` + `etc-pre-26.04.tgz`
  na Macu (hashe sedí), zálohy služeb, snapshot v OVH.
- ✅ Fáze 2: 0 balíčků k aktualizaci. Nalezen a opraven `logrotate.service`
  failed od 2026-05-02 (postrotate mimo `{}` + `endscriptx`, 3659064).
- ✅ Fáze 3: `do-release-upgrade` → **Ubuntu 26.04.1 LTS, jádro 7.0.0-42**.
  Odebráno 12 balíčků (`libvips-dev` + -dev hlavičky; sharp má libvips
  přibalenou — ověřeno `sharp.versions`). „Remove obsolete" (349) = N.
- ✅ Fáze 4: služby active, `--failed` prázdné; PG 17 online, PostGIS 3.5.3
  na GEOS 3.14.1/PROJ 9.7.1, 31 700 nálezů; PM2 démon i worker v24.22.1;
  naše konfigurace beze změny (`tar -d` proti záloze); nginx `*_params`
  přepsal balíček (Host `$host$is_request_port$request_port`) — naše vhosty
  je nepoužívají; časovače, cron, Docker, fail2ban, nftables, runner OK;
  port 1022 zavřený. Testovací deploy 62dccc6 ✅. *Runtime security*:
  `os-release` ✅, jediné ❌ `apt-orphaned` (čekané do fází 5/6).
  cloak-check ❌ byl falešný poplach (náhodná hra 404) — opraveno 62dccc6.
- ✅ Majitel: web, `/admin`, RustDesk z domova OK.
- Rozhodnuto 2026-10-29: Docker → `unattended-upgrades` (automaticky).
- ✅ Fáze 5 (2026-10-29): PG 17 balíčky `apt-mark manual` (jinak by je
  noční autoremove z u-u smazal); Docker 29.9.2 z oficiálního repa +
  v `unattended-upgrades`; kontejnery aktuální; autoremove 296 balíčků
  (gcc, -dev, libvips42, GEOS 3.13 — PostGIS je na 3.14.1, ověřeno `ldd`);
  Node 24.18.0 smazán; `ssl_stapling` pryč z ručně zpřísněného
  `options-ssl-nginx.conf`; týdenní kontrola hlídá `systemd-failed`
  (b2db9a1); dokumentace (callout, CLAUDE.md §11/§12). Starší jádro
  6.17.0-41 ponecháno jako záložní položka GRUBu.
- ✅ certbot `renew --dry-run` 2026-10-29 ráno: všechny 3 certifikáty
  (ctyrlistkoteka.cz+www, qr.casqb.org, stats.ctyrlistkoteka.cz) success.
  Noční 503 byl jen přetížený staging LE.
- ✅ Fáze 6a–6b (2026-10-30): **DB na PostgreSQL 18.6 + PostGIS 3.6.2**,
  `pg_upgradecluster` (dump/restore), výpadek ~10 min, 31 700 nálezů,
  checksums on; cluster 17 zastavený na 5433. Detail v
  `docs/ubuntu-upgrade-26.04.md`. Ruční *Runtime security*: jen
  `apt-orphaned` (balíčky PG 17 — čekané do 6d). Rozhodnutí majitele
  2026-10-29: e-mail z týdenní kontroly nechat chodit, nic nepotlačovat.
- ✅ 6c (2026-10-30): `pg_dump` 18.6, ruční `backup.sh` proti 18 OK
  (4 461 517 B), `start.conf` 17 = manual, `postgresql@18-main` active /
  `@17-main` inactive, deploy `ab487b7` (34 migrací, nic k aplikaci),
  `pnpm sync --dry-run` čistý (31 700 nálezů, 0 parse failures,
  reconcile.clean). ⏳ zbývá: `/admin/checks` (majitel) a noční záloha +
  UNAS stažení 2026-10-31.
- ⏳ 6d naplánováno: připomínka 2026-11-06 8:00 (scheduled task
  `pg17-uklid-pripominka-2026-11-06`).
- ⏳ 6d (po několika dnech, se souhlasem): `pg_dropcluster 17 main` +
  odebrat balíčky PG 17 → `apt-orphaned` zezelená.
- ⚠️ K ověření: PostGIS je v *universe* — zjistit, jak na 26.04 chodí
  jeho bezpečnostní záplaty (bez Ubuntu Pro).
- ✅ UNAS ranní běh 2026-10-29: 06:10:01 → 06:11:24 (83 s), snapshot
  2026-10-29 OK, 30 ponecháno. Ruční běh včera (3 min 12 s) byl výjimka.
- **Další krok:** `/admin/checks` od majitele; 2026-10-31 ráno UNAS `tail -n 2 pull.log`; 2026-11-06 krok 6d.

## Seznam oprav (nahlášeno majitelem)
1. ✅ **404 – Lupa na mobilu** (2026-10-28): na dotyku lupa pluje nad
   prstem (poloměr + 36 px), tažení nic nevybírá, klepnutí vybere ťuknuté
   místo; myš a šipky beze změny. Ověřeno simulovaným dotykem v prohlížeči.
2. ✅ **/sbirka na mobilu – dlaždice** (2026-10-28): spodní banner při
   najetí myší ZŮSTÁVÁ jen na desktopu (rozhodnutí majitele: na mobilu jen
   datum, nic nepřidávat). Skutečný problém byl jinde — v horní liště se
   pěticiferné číslo ořezávalo na „#31…“. Pod `md` (768 px) teď palec
   s hlasy sedí jako bílý čip v pravém horním rohu fotky a 🍀 před číslem
   odpadá; tablet a desktop beze změny. Ověřeno měřením na 390 / 640 /
   768 px (rezerva i pro šesticiferná ID). Ověřeno majitelem na iPhonu;
   doladěno: 🍀 zpět, číslo přesně na středu (vlajka vpravo ve slotu
   šířky špendlíku), palec 4 px od rohu na 50% průhledném čipu bez blur.
3. ✅ **404 – kola nad 8 vs. tabulka rychlosti** (nahlášeno a opraveno
   2026-10-29). Kola od 8 dál mají v tabulce společný řádek „8+“ (rekord =
   nejlepší z nich, jak se už ukládal; „Dnes“ = nejlepší dnešní + počet),
   hlášky „v kole 8+“. Nově rozbalovací „Jak hrát?“ nad loukou (cíl,
   ovládání myš/prst/klávesnice podle hry, návnady s pupenem, kola
   a obtížnost, „8+“, časomíra, rekordy jen v prohlížeči), CZ/EN.
   Ověřeno: 11 kol v prohlížeči, mobil, EN; testy `hunt.test.ts`.

## Nápady (zatím jen poznámka, neimplementovat bez zadání)
- **/statistiky – odhad vývoje** (majitel 2026-10-29): předpověď, kdy padne
  čtyřlístek č. 100 000 a další milníky — z dosavadního tempa nálezů
  (např. trend posledních měsíců / sezónnost). Před návrhem probrat
  s majitelem: které milníky, z jakého období počítat, jak ukázat nejistotu.
- **CZ/EN podle jazyka prohlížeče** (majitel 2026-10-29). Dnes vědomě
  VYPNUTO (`src/i18n/routing.ts`: `localeDetection: false`,
  `localeCookie: false`) — automatika přesměrovávala podle cookie /
  `Accept-Language` a klik na „CZ“ vracel na EN; cookie bez HttpOnly hlásily
  skenery. Šetrnější varianty k probrání: (a) jednorázová lišta „This site
  is also in English → switch“ podle `navigator.language`, bez přesměrování
  a bez cookie (zavření jen pro návštěvu); (b) přesměrování jen při vstupu
  na `/` z cizího webu podle `Accept-Language`, bez cookie — pozor na SEO
  a na to, aby šlo vždy vrátit na CZ.
- **Vylepšení her 404 — seznam k výběru** (majitel 2026-10-29, nic
  nerozhodnuto):
  1. Ověřit/opravit časomíru ve skryté záložce (pauza přes
     `visibilitychange`, ať se nepočítá čas mimo stránku).
  2. Nápověda po několika chybách (např. po 5 pokusech zúžit oblast nebo
     krátce zvýraznit čtvrtinu louky) — bez vlivu na rekord, nebo s
     poznámkou „s nápovědou“.
  3. Volba hry: tlačítko „Zkusit Louku / Lupu“ (dnes náhodně per request).
  4. Souhrn návštěvy: celkový čas, průměr na kolo, nejlepší kolo
     (`summarizeTimes` to už počítá), série kol bez chyby.
  5. Denní výzva: stejná louka pro všechny podle data (seed z data, žádný
     server) + vlastní rekord dne.
  6. Sdílení výsledku jako text do schránky („Kolo 11, 7,0 s 🍀“), bez dat.
  7. Mobil: krátká vibrace při nálezu (`navigator.vibrate`, respektovat
     `prefers-reduced-motion`).
  8. Přístupnost: vyšší kontrast / odlišení odstínů pro barvoslepé.
  9. Tlačítko „Smazat moje rekordy“ (jediný localStorage klíč).
  10. Oslava milníků (10., 25., 50. nalezený čtyřlístek v návštěvě).
  11. Dřívější návrh **anonymního Top 10** (server měří čas, HMAC kola,
      rate limit, věta do /soukromi) — stále čeká na rozhodnutí.

## Pravidelné hlídání a aktualizace služeb (2026-10-28)
- ✅ Týdenní kontrola: + osiřelé balíčky, + rozšíření DB (`--db`), + Docker
  images (`--docker`). Ruční běh na VPS je zachytil všechny (OS EOL,
  osiřelý Docker, zastaralý RustDesk).
- ✅ RustDesk aktualizován (klíč beze změny), PostGIS rozšíření 3.5.3,
  vývojové kontejnery z VPS pryč, dev compose jen na loopback.
- ✅ GoatCounter: data přesunuta do zálohovaného stromu, historie ověřena.
- ✅ `deploy/backup-services.sh` (cron 3:05) + `deploy/update-docker-services.sh`.
- ⏳ Za pár dní: smazat staré Docker volume (stará kopie GoatCounteru + dvě
  prázdné z dubna) — podrobnosti v private `ops/inventory/`.
- ⏳ Upgrade Ubuntu 26.04 (vrátí i Docker repozitář; PostgreSQL varianta A
  = 18 z Ubuntu, dump/restore) + odebrat `ssl_stapling` z nginx.

## /admin/qr — průhledné PNG pod středovým obrázkem (2026-10-28)
- ✅ Opraveno a nasazeno (1898e2a): strip maže všechny výplně `data-qr-bg`
  (pozadí + podklad pod obrázkem/logem). Platí ve všech záložkách i v PDF
  Darování. Ověřeno majitelem stažením QR nálezu (2026-10-28).

## Off-site zálohy na UNAS — „prázdná složka“ (2026-10-28)
- ✅ Diagnóza: zálohy **fungují**. 30 snapshotů (2026-09-29 → 2026-10-28)
  po ~48 GB, `pull.log` denně `OK`, `.last-pull` čerstvý. Prázdný je jen
  share v UniFi Drive — snapshoty leží záměrně mimo Drive (gotcha #32).
  Majitel: v Drive je vidět nemusí, stačí SSH.
- ✅ Docs/skripty: cron je ve skutečnosti `10 6`, ne `30 4` — sladěno.
- ✅ Týdenní kontrola hlídá i `.offsite/.last-pull` (zastavený pull → e-mail).
- ✅ Vlastník snapshotů: `--chown=0:0` v `unas-pull.sh` (dřív uid 1000 =
  systémový účet UniFi `uisys-…`). Na UNASu nainstalováno (sha256 sedí
  s commitem 8e22538), `chown -R root:root` hotový, ruční běh OK:
  30 snapshotů, soubor z `data/` má 30 hardlinků a vlastníka `root`.
- ⏳ Ruční běh trval 3 min 12 s (obvykle ~1 min, hlavně `sys`); hypotéza:
  mazal existující dnešní snapshot. Zkontrolovat ranní řádek v `pull.log`
  (2026-10-29 06:10) — má být zase ~1 min.

## i18n `next/root-params` (2026-10-28)
- ✅ Migrace hotová lokálně (1eb48ed) + oprava 404 u `/api/admin/revalidate`
  (64bd0aa); ověřeno proti baseline (build + matice 22 adres + prohlížeč).
- ✅ Nasazeno (51aa044), smoke test produkce OK: `lang` cs/en, admin
  `noindex`, sitemap 31 404 URL (ISR), neznámá URL 404, revalidate zvenku 404.
- Podnět mimo rozsah: web nemá vlastní českou 404 (ukazuje výchozí
  černou anglickou) — UX rozhodnutí pro majitele.

## Bezpečnost runtime (od 2026-10-28)

### Hotovo
- ✅ Mac: Node 24.15.0 → 24.22.1 (nvm default), pnpm 10.33.2 přes corepack.
- ✅ `scripts/check-runtime-security.ts` + testy, varování v `deploy.yml`,
  týdenní `runtime-security.yml`, CI `node-version: 24` + `check-latest`,
  `packageManager: pnpm@10.33.2`, docs (`docs/deployment.md`: „Upgrade
  Node.js", „Hlídání bezpečnosti runtime").

### Rozpracováno
- ✅ VPS: Node 24.18.0 → 24.22.1 (CVE-2026-111497) hotový 2026-10-28 —
  unit `pm2-app`, démon i worker ověřeny přes `/proc/<pid>/exe`.
- ✅ Týdenní triáž (`~/.claude/scheduled-tasks/ctyrlistkoteka-dependabot-triage`)
  kontroluje runtime vždy, i bez PR.

### Zbývá
- ❌ Ubuntu 25.10 je od 2026-07-09 EOL → plán upgradu na 26.04 LTS (záloha
  DB, `do-release-upgrade`, PostgreSQL/PostGIS, nginx, PM2, runner, návrat).
  Do té doby týdenní *Runtime security* svítí červeně — schválně.
- Po ověření upgradu: smazat Node 24.18.0 na VPS postupem „Mazání staré
  verze Node".
- ✅ Upgrady z repozitářů mimo Ubuntu (PGDG, Docker CE) — hlídá týdenní
  kontrola (lokálně, nepushnuto).
- ✅ Docker images: `--docker` hotový a ověřený lokálně; ⏳ zapnout v
  `runtime-security.yml` po fázi 0 (`app: docker OK`?).
- Verze runneru: vědomě nehlídat (rozhodnutí 2026-10-28).
- ✅ Úklid worktree/větví po triáži (2026-10-28).
- Dependabot #197 selhal na `postcss@^8.5.32` mladším než jeho karence
  (gotchas #35) — ověřit, že další běh projde.

### Klíčová rozhodnutí
- Deploy na nález jen varuje (nikdy neshodí produkci), týdenní běh selže,
  aby přišel e-mail.
- Zůstáváme na řadě 24; přechod na 26 je samostatná migrace.
- Ven jde jen GET na `nodejs.org/dist/index.json`.

### Další krok
Plán upgradu Ubuntu 25.10 → 26.04 LTS je NÁVRH v `docs/ubuntu-upgrade-26.04.md`
(2026-10-28): čeká na fázi 0 (inventura na VPS, jen čtení) a rozhodnutí R-PG
(PG 18 z Ubuntu vs. PG 17 z PGDG) — 26.04 už `postgresql-17` nemá.
