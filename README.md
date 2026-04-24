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

## Dokumentace

- [`CLAUDE.md`](CLAUDE.md) — závazné pokyny pro práci na projektu
- [`docs/architecture.md`](docs/architecture.md) — architektura
- [`docs/data-schema.md`](docs/data-schema.md) — datový model
- [`docs/filename-convention.md`](docs/filename-convention.md) — konvence názvů souborů (**důležité**)
- [`docs/sync-workflow.md`](docs/sync-workflow.md) — import dat
- [`docs/deployment.md`](docs/deployment.md) — deployment na OVH

## Přispívání

Tohle je soukromý projekt jednoho autora, ale struktura kódu má být čistá a testovaná
i pro případ, že se časem otevře. Commit zprávy používají
[Conventional Commits](https://www.conventionalcommits.org/).

## Licence

Kód: MIT (volitelné — doplnit).
Obrazová data a obsah sbírky: © autor, všechna práva vyhrazena.
