# Čtyřlístkotéka — Claude Code instrukce

Tento dokument je **primárním zdrojem kontextu** pro Claude Code. Přečti si ho celý
před jakýmkoli úkonem. Poté projdi `docs/` pro detaily a **`ops/`** (soukromý
provozní kontext + `ops/PROGRESS.md`, viz §11 „Provozní kontext“).

---

## 1. O projektu

**Čtyřlístkotéka** je veřejná webová prezentace soukromé sbírky čtyřlístků.
Doména: `ctyrlistkoteka.cz` (DNS u hukot.net). Provoz: OVH VPS-2.

### Hlavní funkce (4 stránky)

1. **Domů** — uvítací stránka s úvodem a hlavními ukazateli sbírky
2. **Sbírka** — galerie nálezů s filtry, hledáním a detailem nálezu
3. **Mapa** — OpenStreetMap s polygonálními vrstvami lokalit + PNG overlay mapami
4. **Statistiky** — souhrnné grafy (časová řada, top lokality, typy prostředí, stavy nálezů)

> **Invariant:** sbírka obsahuje výhradně **čtyřlístky**. Žádné pětilístky, šestilístky atd. UI proto nezobrazuje „počet lístků" ani podle něj nefiltruje. Sloupec `finds.leaf_count` je v DB zachován s `DEFAULT 4` čistě jako historický artefakt schématu.

### Cílová skupina a priority

- **Desktop first**, mobil plně funkční (responzivní).
- **Veřejný web** → SEO, OpenGraph, sitemap, rozumná cache.
- **Jediný uživatel** přidává data → žádné admin rozhraní, data přicházejí přes SSH/SCP (Termius).

### Rozsah dat

- Aktuálně ~17 000 nálezů, ~128 lokalit.
- Výhledově až ~100 000 nálezů, lokalit nedefinovaně (rostou).
- Obrázky: HEIC (originály) + PNG/JPEG (mapy a starší fotky).

---

## 2. Architektura (závazná)

```
Klient (prohlížeč)
    │ HTTPS 443
    ▼
Nginx (SSL, reverse proxy, cache statických assetů)
    │ HTTP 127.0.0.1:3000
    ▼
Next.js (App Router, SSR + ISR)
    │
    ├──► PostgreSQL 18 + PostGIS  (127.0.0.1:5432)
    └──► /var/ctyrlistkoteka/generated/  (thumb + web WebP)
```

**Originály HEIC nejsou na serveru.** Uživatel si je archivuje lokálně. Na VPS jsou
jen odvozené WebP varianty (web ~1600 px, thumb ~400 px).

---

## 3. Tech stack (závazný)

| Vrstva | Volba | Poznámka |
| --- | --- | --- |
| Runtime | Node.js LTS | nainstalovat přes `nvm` |
| Framework | Next.js (latest stable, App Router) | TypeScript strict |
| Jazyk | TypeScript | `strict: true` v `tsconfig.json` |
| Styling | Tailwind CSS (v4+) | žádný runtime-CSS-in-JS |
| UI komponenty | shadcn/ui + Radix | selektivně, ne celou sadu |
| Ikony | lucide-react | |
| DB | PostgreSQL + PostGIS 3 | prod: **nativní PG 18** (od 2026-10-30); lokální dev: `postgis/postgis:16-3.4` |
| ORM | Prisma | pro geo sloupce používej raw SQL nebo `Unsupported("geometry")` |
| Mapy | Leaflet + react-leaflet | OSM dlaždice, markercluster, image overlays |
| Grafy | Recharts | pro základní grafy; ECharts jen pokud Recharts nestačí |
| Obrázky | sharp + heic-convert | server-side zpracování |
| Cache agregací | Redis | jen pro statistiky; pokud start bez něj, použij in-memory + ISR |
| Package manager | pnpm | workspaces pokud monorepo |
| Tests | Vitest + Playwright | unit + e2e |
| Linter / Formatter | ESLint + Prettier | shared config |
| Process manager | PM2 | ekosystém soubor `ecosystem.config.cjs` |
| Web server | Nginx | reverse proxy + SSL termination |
| SSL | Let's Encrypt (certbot) | auto-renew přes systemd timer |
| CI/CD | GitHub Actions | deploy přes SSH po merge do `main` |

**Nepoužívat:**
- Cloudflare (uživatel si výslovně nepřeje)
- Externí analytiku bez GDPR consent bannery (zatím nic)
- Klientská storage API (`localStorage`, `IndexedDB`) pro aplikační stav mimo preferenci UI
  - ⚠️ **Jediná schválená výjimka (2026-10-28): osobní rekordy hry na stránce 404** (`ctyr-404-bests-v1`, `src/components/not-found/use-personal-bests.ts`). Jen časy kol v prohlížeči návštěvníka, nic se neposílá ani nepáruje; čtení validuje `parseBests`. Nerozšiřuj na další stav.
- SSR-only komponenty tam, kde stačí statický export

---

## 4. Struktura repozitáře

Preferuj **single Next.js aplikaci** (ne monorepo) pro jednoduchost:

```
ctyrlistkoteka/
├── CLAUDE.md                     # tenhle soubor
├── README.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── .env.example
├── .env                          # ignorováno gitem
├── .gitignore
├── docker-compose.yml            # lokální Postgres+PostGIS
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── src/
│   ├── app/                      # ŽÁDNÝ app/layout.tsx — víc kořenových layoutů (gotchas #36)
│   │   ├── [locale]/
│   │   │   ├── layout.tsx        # kořen veřejného webu (lang z URL, next/root-params)
│   │   │   ├── page.tsx          # /  a  /en
│   │   │   ├── sbirka/
│   │   │   │   ├── page.tsx      # /sbirka
│   │   │   │   └── [id]/page.tsx # /sbirka/16230
│   │   │   ├── mapa/page.tsx
│   │   │   └── statistiky/page.tsx
│   │   ├── admin/layout.tsx      # vlastní kořen (cs); stejně d/ a tym/
│   │   ├── api/
│   │   │   ├── finds/route.ts
│   │   │   ├── locations/route.ts
│   │   │   └── stats/route.ts
│   │   ├── sitemap.ts
│   │   └── robots.ts
│   ├── components/
│   │   ├── ui/                   # shadcn/ui primitives
│   │   ├── finds/
│   │   ├── map/
│   │   └── stats/
│   ├── lib/
│   │   ├── db.ts                 # Prisma client singleton
│   │   ├── paths.ts              # cesty ke generovaným obrázkům
│   │   ├── parseFilename.ts      # parser konvence názvů souborů
│   │   ├── parseRanges.ts        # "15-35" → [15, ..., 35]
│   │   ├── anonymize.ts          # logika pro anonymizované nálezy
│   │   └── stats.ts              # agregace statistik
│   └── types/
│
├── scripts/
│   ├── sync.ts                   # filesystem → DB importní skript
│   ├── generate-images.ts        # HEIC → WebP + thumbnaily
│   └── examples/
│       └── LokaceStavyPoznamky.sample.json
│
├── public/
│   └── favicon.svg
│
├── deploy/
│   ├── nginx.conf.template
│   ├── ecosystem.config.cjs
│   └── systemd-sync.service      # volitelný cron pro auto-sync
│
├── docs/
│   ├── architecture.md
│   ├── data-schema.md
│   ├── filename-convention.md
│   ├── sync-workflow.md
│   └── deployment.md
│
└── .github/workflows/
    └── deploy.yml
```

---

## 5. Datový model (vysoké pojetí)

Detail viz `docs/data-schema.md` a `prisma/schema.prisma`.

### Hlavní entity

- **`locations`** — lokality (128+), každá má unikátní kód, volitelný polygon (z EXIF metadat mapy `AOI_POLYGON`), volitelný PNG overlay s bounding boxem.
- **`location_maps`** — lokační mapy (PNG soubory, reálně JPEG). Každá má MAP_ID, GPS střed, zoom, bounding box. Vazba N:1 na lokaci.
- **`finds`** — nálezy (17k+), `id` je **zachované uživatelské ID** (NE autoincrement), cizí klíč na lokalitu a lokační mapu, datum (z EXIF), GPS bod (z EXIF), stavy, poznámka.
- **`find_images`** — 1..N obrázků na nález, dva typy: `ORIGINAL` (celá fotka) a `CROP` (výřez čtyřlístku).
- **`find_states`** — enum `NORMAL | ANONYMIZED | DONATED | LOST | NO_GPS | NO_PHOTO | LOCATION_MISSING | NOT_PICKED`.

### Zdroj pravdy

Oddělovač v názvech souborů je `+`; skutečné názvy na disku `+` i diakritiku zachovávají (parser = `split('+')`).

1. **Název souboru fotky** → ID nálezu, **číslo mapy (= přiřazení k lokalitě)**, kód lokality, anonymizace (pole 5), příznak poznámky. STATE v názvu je jen čitelný otisk, do DB nejde.
2. **EXIF metadata fotky** → GPS souřadnice, datum nálezu.
3. **Název souboru lokační mapy** → kód lokality, popis, GPS středu, zoom, MAP_ID.
4. **EXIF metadata mapy** → AOI_POLYGON (volitelné), anonymizace, marker středobodu.
5. **`LokaceStavyPoznamky.json`** → autoritativní **stavy** a **poznámky**; anonymizaci umí jen zapnout (výsledek = NEBO s polem 5 a anonymizovanou mapou). Sekce `lokace` přiřazení find→lokalita **neurčuje** (slouží jen kontrolám v adminu).

Detailní pravidla a priority zdrojů viz `docs/filename-convention.md`.

---

## 6. Anonymizace a ochrana soukromí

Nálezy kde **filename pole 5 = `ANO`** nebo jsou v seznamu `anonymizace.ANONYMIZOVANE`
ve zdrojovém JSONu **nesmí** na veřejném webu:

- zobrazit poznámku
- zobrazit přesné GPS (zaokrouhli na ~500 m nebo skryj úplně)
- objevit se v `<meta>` tagách nebo OpenGraph
- zobrazit v detailu jména lidí zmíněná v poznámkách

Implementuj centrální funkci `anonymize(find)` v `src/lib/anonymize.ts`, která toto
rozhodování zapouzdří. **Nikde jinde v kódu se nesmí číst `find.notes` přímo** —
vždy přes tuto funkci.

---

## 7. Konvence kódu

- **Jazyk v kódu**: anglicky (identifikátory, komentáře, commit zprávy).
- **Jazyk v UI**: česky (texty, popisky, aria-labels).
- **Komponenty**: Server Components default; `"use client"` jen když nutné.
- **Data fetching**: přes Prisma v Server Components, ne v API route pokud to nezjednodušuje věc.
- **API routes**: jen pro to, co klient opravdu volá za runtime (mapa – tile filtry, hledání).
- **Error handling**: chyby nikdy neignorovat; logovat se strukturou `{ level, event, ...context }`.
- **No magic numbers**: konstanty do `src/lib/constants.ts` (velikosti miniatur, cluster radius atd.).

### Git workflow

- Hlavní větev: `main` — **push do `main` = deploy** (self-hosted runner na VPS).
  Commituje a pushuje se přímo do `main`, bez PR (rozhodnutí majitele).
- Ruleset na GitHubu (od 2026-10-30) na `main` **blokuje force push a smazání
  větve**; povinné PR ani kontroly schválně nemá, aby nerozbil push = deploy.
- Feature větve (`feat/xxx`, `fix/xxx`, `chore/xxx`, `docs/xxx`) jen volitelně
  u větších věcí.
- Commit zprávy: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`).
- Před `git push`: **vždy** `pnpm lint && pnpm typecheck && pnpm test`.

---

## 8. Fáze projektu (doporučené pořadí)

Claude Code postupuje po fázích. **Po každé fázi se zastav a ukaž výstup uživateli.**

1. **Fáze 1 — Scaffolding**: Inicializace Next.js, Tailwind, Prisma, Docker Compose, základní layout a stránky se zástupným obsahem. Výstup: lokálně běžící stránka na `localhost:3000`.
2. **Fáze 2 — Databáze**: Prisma schema dle `docs/data-schema.md`, první migrace, seed s několika falešnými nálezy. Výstup: dotaz `SELECT * FROM finds LIMIT 5` vrátí řádky.
3. **Fáze 3 — Parsery a import**: `parseFilename`, `parseRanges`, `sync.ts` skript + `generate-images.ts`. Otestovat na vzorcích v `scripts/examples/`. Výstup: funkční `pnpm sync --dry-run`.
4. **Fáze 4 — Stránka Sbírka**: list + detail s obrázky. Virtualizovaná mřížka, filtry, hledání. Výstup: funkční prohlížení 17k záznamů.
5. **Fáze 5 — Stránka Mapa**: Leaflet, polygony, markercluster, PNG overlays. Výstup: interaktivní mapa.
6. **Fáze 6 — Statistiky**: Recharts dashboardy, ISR cache. Výstup: `/statistiky` s grafy.
7. **Fáze 7 — Deployment**: Nginx, PM2, systemd, SSL, GitHub Actions. Detail v `docs/deployment.md`. **Claude Code NEPŘIPOJUJE k produkčnímu VPS** — generuje skripty a návody, uživatel je spouští v Termiusu.
8. **Fáze 8 — Import reálných dat**: uživatel nahraje data na VPS, spustí `pnpm sync`.

---

## 9. Co NEDĚLAT

- ❌ **Neměň ID nálezů** — user má existující číslování, Next.js `finds.id` musí odpovídat číslu v názvu souboru.
- ⚠️ **`/var/ctyrlistkoteka/data/` je ve všech runtime cestách read-only KROMĚ admin rozhraní (`/admin/*`).** Mimo admin směr přidává sbírku výhradně rsync z Macu. Admin endpointy smí zapisovat, ale jen za následujících podmínek: (a) atomicky (tmp file → fsync → rename); (b) přes path-helper, který odmítne jakoukoli cestu mimo `data/finds/`, `data/maps/` a `generated/find-photos/`; (c) destruktivní operace (delete/replace) nejprve kopírují cíl do `data/.trash/<timestamp>/` — vždy přes `prepareTrashDir()` z `src/lib/admin/trash.ts`, nikdy ručním `path.join`, protože právě na tom helperu visí **auto-prune po 30 dnech** (do 2026-08-10 to tady bylo napsané, ale nikde naimplementované, a koš narostl na 197 MB). Veřejné stránky `/`, `/sbirka`, `/mapa`, `/statistiky`, `/lokality` zůstávají striktně read-only.
- ❌ **Nepřipojuj se k produkčnímu serveru automaticky** — všechny produkční akce proběhnou přes SSH z uživatelova Termiusu nebo GitHub Actions.
- ❌ **Neposílej data třetím stranám** — žádná externí analytika, fonty selfhost přes `next/font`, žádné CDN obrázků.
  - ⚠️ **Schválená výjimka (2026-08-08): Google Sheets, jen čtení.** Sada „darování ve světě“ může mít odkaz na Google Sheets, ze kterého admin **stahuje** `export?format=xlsx` (ručně na tlačítko). Ven jde jen ID dokumentu, nikdy se **nezapisuje zpět**. Vědomé rozhodnutí majitele (2026-08-08): tabulka obsahuje souřadnice úkrytů a odkaz je sdílený — riziko nese on. Kód v `src/lib/admin/dropSheet.ts`. Odkaz je **ve výchozím stavu admin-only data** a sám od sebe se na veřejnou routu nedostane. **Jediná výjimka (2026-08-12):** majitel ho může přepínačem *Ukázat odkaz na tabulku i na mapě pro tým* (`drop_campaigns.sheet_share_crew`, výchozí `false`) pustit na heslem chráněnou `/tym/<token>`. Je to samostatné zakliknutí schválně — v tabulce jsou úkryty **všech** oblastí a obvykle i právo je měnit, tedy víc, než ukazuje jedna mapa pro tým. Nikam jinam odkaz nepatří a nikdy ho nezobrazuj bez toho přepínače.
  - ⚠️ **Jediná schválená výjimka (2026-08-07): Nominatim.** Tlačítko „Najít hranici“ v `/admin/qr/darovani/<id>` se ptá `nominatim.openstreetmap.org` na obrys města. Podmínky, za kterých to platí: **jen z adminu**, **jen na ruční stisk**, ven jde **výhradně název místa** (nikdy nález, token ani souřadnice úkrytu), výsledek se **uloží do `drop_areas.boundary`** a víc se už nikam nevolá. Kód je izolovaný v `src/lib/admin/dropNominatim.ts`. Nerozšiřuj to na další volání ani na veřejné routy.
- ❌ **Neloguj poznámky ani GPS do systémových logů** — mohou být citlivé.
- ❌ **Nezobraz detaily anonymizovaných nálezů** — viz kapitola 6.
- ❌ **Neexportuj databázi přes veřejné API** — endpointy musí mít rozumné limity (paginace, rate limit).

---

## 10. Environment proměnné

Viz `.env.example`. Na produkci uživatel vytvoří `.env` ručně přes Termius.

```env
DATABASE_URL=postgresql://ctyrlist:HESLO@localhost:5432/ctyrlistkoteka
NEXT_PUBLIC_SITE_URL=https://ctyrlistkoteka.cz
DATA_DIR=/var/ctyrlistkoteka/data
GENERATED_DIR=/var/ctyrlistkoteka/generated
REDIS_URL=redis://localhost:6379   # volitelné
LOG_LEVEL=info
NODE_ENV=production
```

---

## 11. Klíčové odkazy na podrobnosti

- [docs/architecture.md](docs/architecture.md) — podrobný architektonický nákres + rozhodovací strom pro jednotlivé stránky
- [docs/data-schema.md](docs/data-schema.md) — entity, sloupce, vztahy, příklady
- [docs/filename-convention.md](docs/filename-convention.md) — **kritické** — jak parsovat názvy souborů
- [docs/sync-workflow.md](docs/sync-workflow.md) — jak funguje import filesystem → DB
- [docs/deployment.md](docs/deployment.md) — krok za krokem OVH + Nginx + SSL + PM2
- [docs/admin-overview.md](docs/admin-overview.md) — admin rozhraní (`/admin/*`), kompletní přehled
- [docs/gotchas.md](docs/gotchas.md) — **lessons learned** — NFC normalizace, `"use server"` exporty, admin cookie path
- [docs/collaboration.md](docs/collaboration.md) — pracovní pravidla, commit policy, design-call etiketa

### Provozní kontext (soukromý)

Stav serveru, provozní návody (deployment, upgrady), bezpečnostní kontrola
runtime, známé mezery, infrastrukturní gotchas a **záchytné body práce
(`PROGRESS.md`)** jsou v soukromém repu `Safronus/ctyrlistkoteka-ops`,
naklonovaném do `ops/` (v `.gitignore`):

- `ops/CLAUDE-ops.md` — provozní instrukce (runtime security, server, prostředí)
- `ops/PROGRESS.md` — záchytné body (jediná platná kopie)
- `ops/docs/` — deployment, upgrade Ubuntu, `gotchas-infra.md`
- `ops/CHANGELOG-ops.md` — provozní a bezpečnostní změny

**Když `ops/` chybí, nic si nedomýšlej — zeptej se.** Klonuj přes
`gh repo clone Safronus/ctyrlistkoteka-ops ops` (HTTPS). Nic z `ops/`
nikdy necommituj do veřejného repa; změny serveru / bezpečnosti / stavu
práce se commitují a pushují do ops, kód sem — často obojí.

---

## 12. Informace o uživateli a prostředí

- Lokalita: Zlín, ČR (CE časová zóna `Europe/Prague`).
- Doména: `ctyrlistkoteka.cz` u **hukot.net**.
- Produkční server: VPS (detail v `ops/CLAUDE-ops.md`).
- Uživatel používá **Termius** pro SSH. Claude Code generuje příkazy, uživatel je spouští sám.
- IP adresy, hostname, verze, stav záplat a přihlašovací údaje **nikdy do veřejného repa** (ani do commit zpráv).
- GitHub repo: **veřejné** ([github.com/Safronus/ctyrlistkoteka](https://github.com/Safronus/ctyrlistkoteka)) — celý kód je otevřený. Citlivé věci (DB heslo, `VOTE_FINGERPRINT_SALT`, `FIND_PHOTO_UNLOCK_CODE`, admin credentials) zůstávají v `.env` na VPS, do gitu nejdou — `.gitignore` je drží mimo. Při každém commitu zkontroluj, že žádné tajemství ani provozní detail neutíká.
