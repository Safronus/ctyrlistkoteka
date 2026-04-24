# Čtyřlístkotéka — Claude Code instrukce

Tento dokument je **primárním zdrojem kontextu** pro Claude Code. Přečti si ho celý
před jakýmkoli úkonem. Poté projdi `docs/` pro detaily.

---

## 1. O projektu

**Čtyřlístkotéka** je veřejná webová prezentace soukromé sbírky čtyřlístků.
Doména: `ctyrlistkoteka.cz` (DNS u hukot.net). Provoz: OVH VPS-2.

### Hlavní funkce (4 stránky)

1. **Domů** — uvítací stránka s úvodem a hlavními ukazateli sbírky
2. **Sbírka** — galerie nálezů s filtry, hledáním a detailem nálezu
3. **Mapa** — OpenStreetMap s polygonálními vrstvami lokalit + PNG overlay mapami
4. **Statistiky** — souhrnné grafy (časová řada, top lokality, rozložení počtu lístků atd.)

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
    ├──► PostgreSQL 16 + PostGIS  (127.0.0.1:5432)
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
| DB | PostgreSQL 16 + PostGIS 3 | `postgis/postgis:16-3.4` pro lokální dev |
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
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx              # /
│   │   ├── sbirka/
│   │   │   ├── page.tsx          # /sbirka
│   │   │   └── [id]/page.tsx     # /sbirka/16230
│   │   ├── mapa/page.tsx
│   │   ├── statistiky/page.tsx
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

Oddělovač v názvech souborů je `+`, ale na disku se `+` i diakritika transliterují na `_`.

1. **Název souboru fotky** → ID nálezu, číslo mapy, kód lokality, stav, anonymizace, příznak poznámky.
2. **EXIF metadata fotky** → GPS souřadnice, datum nálezu.
3. **Název souboru lokační mapy** → kód lokality, popis, GPS středu, zoom, MAP_ID.
4. **EXIF metadata mapy** → AOI_POLYGON (volitelné), anonymizace, marker středobodu.
5. **`LokaceStavyPoznamky.json`** → autoritativní mapování lokalita→nálezy, stavy, poznámky, anonymizace.

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

- Hlavní větev: `main` (chráněná, automatický deploy).
- Práce ve feature větvích: `feat/xxx`, `fix/xxx`, `chore/xxx`, `docs/xxx`.
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
- ❌ **Nezapisuj do `/var/ctyrlistkoteka/data/`** — to je uživatelský adresář, read-only pro aplikaci. Piš jen do `/var/ctyrlistkoteka/generated/`.
- ❌ **Nepřipojuj se k produkčnímu serveru automaticky** — všechny produkční akce proběhnou přes SSH z uživatelova Termiusu nebo GitHub Actions.
- ❌ **Neposílej data třetím stranám** — žádná externí analytika, fonty selfhost přes `next/font`, žádné CDN obrázků.
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

---

## 12. Informace o uživateli a prostředí

- Lokalita: Zlín, ČR (CE časová zóna `Europe/Prague`).
- Doména: `ctyrlistkoteka.cz` u **hukot.net**.
- Produkční server: **OVH VPS-2** (6 vCPU, 12 GB RAM, 100 GB SSD), Gravelines (GRA), Ubuntu 24.04 LTS.
- IP adresy, hostname a přihlašovací údaje jsou v `docs/deployment.md` a `.env` — **nedávej je do commitnutých souborů** mimo `.env.example`.
- Uživatel používá **Termius** pro SSH. Claude Code generuje příkazy, uživatel je spouští sám.
- GitHub repo: **privátní**, vytvořit přes `gh repo create`.
