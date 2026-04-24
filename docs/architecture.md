# Architektura

## Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      Internet (IPv4 / IPv6)                     │
└─────────────────────────────────────────────────────────────────┘
                              │ HTTPS 443
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  OVH VPS-2  (Ubuntu 24.04 LTS, 6 vCPU, 12 GB RAM, 100 GB SSD)   │
│                                                                 │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  Nginx                                                   │  │
│   │   • SSL termination (Let's Encrypt)                      │  │
│   │   • reverse proxy → 127.0.0.1:3000                       │  │
│   │   • static serve: /var/ctyrlistkoteka/generated/         │  │
│   │   • gzip / brotli, cache-control pro obrázky             │  │
│   └───────────────────────────┬──────────────────────────────┘  │
│                               │                                 │
│   ┌───────────────────────────▼──────────────────────────────┐  │
│   │  Next.js (PM2 cluster mode, 2 instance)                  │  │
│   │   • App Router, SSR + ISR                                │  │
│   │   • Server Actions pro admin akce (žádné zatím)          │  │
│   └───────────┬────────────────────────────────┬─────────────┘  │
│               │                                │                │
│   ┌───────────▼──────────┐         ┌───────────▼─────────────┐  │
│   │  PostgreSQL 16       │         │  Redis (volitelný)      │  │
│   │  + PostGIS 3         │         │  • cache agregací stats │  │
│   │  (127.0.0.1:5432)    │         │  (127.0.0.1:6379)       │  │
│   └──────────────────────┘         └─────────────────────────┘  │
│                                                                 │
│   Filesystem:                                                   │
│     /var/ctyrlistkoteka/                                        │
│     ├── data/           ← uživatel sem nahrává přes SCP         │
│     │   ├── finds/      (HEIC/PNG/JPEG)                         │
│     │   ├── maps/       (PNG lokačních map)                     │
│     │   └── meta/       (LokaceStavyPoznamky.json)              │
│     └── generated/      ← aplikace sem generuje                 │
│         ├── web/        (WebP ~1600 px)                         │
│         └── thumb/      (WebP ~400 px)                          │
└─────────────────────────────────────────────────────────────────┘
```

## Rendering strategie

| Stránka | Strategie | Důvod |
| --- | --- | --- |
| `/` | SSG / ISR (revalidate 1 h) | statická, shrnutí dat |
| `/sbirka` | SSR + klientský filtr | velký dataset, potřeba paginace |
| `/sbirka/[id]` | ISR (revalidate 24 h) | detail se mění zřídka, SEO |
| `/mapa` | CSR po hydrataci (dynamic import Leaflet) | Leaflet nemá SSR |
| `/statistiky` | ISR (revalidate 6 h) + Redis cache | drahé agregace |
| `/api/*` | Dynamic (Node.js) | live dotazy |
| `sitemap.xml` | ISR (revalidate 24 h) | SEO |

## Cache vrstvy (shora dolů)

1. **Browser cache** — `Cache-Control: public, max-age=31536000, immutable` pro `/generated/*` (obrázky mají obsahový hash v názvu).
2. **Nginx cache** — zbytečný pro dynamické HTML (ISR to řeší), ale zapnutý pro `/generated/*` (výrazný výkon u velkých obrázků).
3. **Next.js ISR** — revalidace podle tabulky výše.
4. **Redis** (volitelný) — drahé agregace pro `/statistiky` (top lokality, time series). Bez Redisu → in-memory LRU cache (nepřežije restart, ale s ISR stačí).
5. **PostgreSQL query plan cache** — automatický; pro těžké dotazy zvažme materializované views.

## Škálovatelnost

- **17k → 100k záznamů**: DB indexy pokryjí, paginace cursor-based.
- **Mapa se 100k body**: klientský `leaflet.markercluster` zvládne cca 50k–100k bodů na rozumném HW. Nad 100k → server-side tiles (`/api/finds/tiles/{z}/{x}/{y}`) generované z PostGIS (`ST_ClusterDBSCAN`).
- **Obrázky**: `/generated/` se servíruje přímo Nginxem, ne Next.js. Při 100k nálezech × 1,5 fotky × (200 KB web + 30 KB thumb) ≈ **35 GB** — na 100 GB SSD bezpečně.
- **Originály HEIC**: na VPS se nedrží. Pokud se v budoucnu objeví potřeba archivace online, přidá se abstrakce `ImageStorage` a druhá implementace (OVH Object Storage / S3).

## Zabezpečení

- **UFW** firewall: povoleno jen 22, 80, 443.
- **SSH**: jen klíče, `PermitRootLogin no`, nestandardní port volitelně.
- **fail2ban** pro SSH a Nginx.
- **Rate limiting** v Nginxu pro `/api/*` (60 req/min/IP).
- **CSP hlavičky** v Next.js `next.config.ts` — whitelist `self` + OSM tile servers + Leaflet CDN není potřeba (Leaflet je v bundle).
- **HSTS** zapnutý po úspěšné instalaci SSL.
- **Automatické aktualizace**: `unattended-upgrades` pro security patche.
- **Zálohy DB**: `pg_dump` denně cronem, 14 dní retence, rsync volitelně na externí stroj.

## Logování a monitoring

- Aplikační logy přes PM2 → `/var/log/ctyrlistkoteka/`.
- Nginx access + error logy → rotace logrotatem.
- **Bez externí telemetrie** (uživatel si nepřeje).
- Volitelně v budoucnu: self-hosted Uptime Kuma na stejném VPS (subdoména `status.ctyrlistkoteka.cz`).

## Rozhodovací body (na co si dát pozor)

- **HEIC v prohlížeči nefunguje** (kromě Safari). V DB uchováváme jen cesty k WebP variantám. Sloupec `original_path` odkazuje na offline archiv (info pro případný export v budoucnu, nepoužívá se v UI).
- **Leaflet a SSR**: komponenty s Leafletem **musí** být `"use client"` a načtené přes `next/dynamic` s `{ ssr: false }`.
- **Server Components + Prisma**: Prisma klient se vytváří jako singleton v `src/lib/db.ts`, aby se při HMR nerozjela konexe.
