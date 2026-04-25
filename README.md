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
