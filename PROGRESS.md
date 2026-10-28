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
   768 px (rezerva i pro šesticiferná ID). ⏳ Majitel ověří na iPhonu.

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
  Darování. ⏳ Majitel ověří stažením QR nálezu v adminu.

## Off-site zálohy na UNAS — „prázdná složka“ (2026-10-28)
- ✅ Diagnóza: zálohy **fungují**. 30 snapshotů (2026-09-29 → 2026-10-28)
  po ~48 GB, `pull.log` denně `OK`, `.last-pull` čerstvý. Prázdný je jen
  share v UniFi Drive — snapshoty leží záměrně mimo Drive (gotcha #32).
  Majitel: v Drive je vidět nemusí, stačí SSH.
- ✅ Docs/skripty: cron je ve skutečnosti `10 6`, ne `30 4` — sladěno.
- ✅ Týdenní kontrola hlídá i `.offsite/.last-pull` (zastavený pull → e-mail).
- ⏳ Vlastník snapshotů: `--chown=0:0` v `unas-pull.sh` (dřív uid 1000 =
  systémový účet UniFi `uisys-…`). Na UNASu čeká: nový skript +
  jednorázový `chown -R root:root` stávajících snapshotů + ověření, že
  další běh hardlinkuje (trvá ~1 min, ne celé stahování).

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
