# Sync workflow — filesystem → databáze

## Princip

Filesystem `/var/ctyrlistkoteka/data/` je **jediným zdrojem pravdy** pro obsah.
Databáze je odvozená a kdykoli regenerovatelná. Uživatel přidává data pouze
přes SCP/rsync do datového adresáře a pak spustí sync skript přes SSH.

```
┌────────────────┐       SCP/rsync       ┌─────────────────────────────┐
│ Lokální archiv │ ────────────────────► │ /var/ctyrlistkoteka/data/   │
│ (originály)    │                       │                             │
└────────────────┘                       └──────────┬──────────────────┘
                                                    │ pnpm sync
                                                    ▼
                                         ┌──────────────────────────────┐
                                         │ PostgreSQL + /generated/     │
                                         │ (derived, rebuildable)       │
                                         └──────────────────────────────┘
```

## Adresářová struktura datového zdroje

```
/var/ctyrlistkoteka/data/
├── finds/
│   ├── 16230_00031_RATIBOR__POLE001f_NORMA_LNI__NE_BezPozna_mky.HEIC
│   ├── 16230_00031_RATIBOR__POLE001f_NORMA_LNI__NE_BezPozna_mky.HEIC
│   └── ...                         # flat, tisíce souborů (originály)
│
├── crops/                           # výřezy čtyřlístků (volitelně oddělená složka)
│   └── ...                         # Claude Code se zeptá uživatele na konvenci
│
├── maps/
│   ├── RATIBOR__POLE001a_Pole_nad_penzionem_..._GPS49_36668S_17_88867V_Z16_00026.png
│   └── ...                         # flat, jedna mapa na sub-lokalitu
│
└── meta/
    └── LokaceStavyPoznamky.json    # jeden soubor, průběžně upravovaný
```

**Velikost:** 17k × ~2 MB HEIC ≈ 34 GB. 100 GB VPS bezpečně pojme. Při růstu
k 100k nálezů se ale originály blíží hranici — pak uživatel rozhodne o přesunu
na Object Storage / Additional Disk.

## Derived adresář

```
/var/ctyrlistkoteka/generated/
├── web/
│   └── {sha1}.webp                 # ~1600 px, kvalita 85
├── thumb/
│   └── {sha1}.webp                 # ~400 px, kvalita 80
└── maps/
    └── {sha1}.webp                 # PNG mapa převedená na WebP pro web
```

Obrázky se pojmenovávají podle SHA-1 originálu → deterministické, deduplikované,
ideální pro browser cache (`Cache-Control: immutable`).

## Sync algoritmus

```
1. Načti LokaceStavyPoznamky.json a zvaliduj schéma (Zod).
2. Pro každý soubor v data/maps/:
   a. Parsuj název → { locationCode, description, lat, lng, zoom, mapId }.
   b. Čti EXIF/XMP metadata (AOI_POLYGON, anonymizace, marker).
   c. Načti rozměry obrázku (sharp metadata).
   d. Vypočti bounding box z GPS středu + zoom + rozměry.
   e. UPSERT location_maps (klíč = mapId).
   f. UPSERT locations (klíč = locationCode → hledej location.id v JSON lokace).
   g. Pokud AOI_POLYGON: raw SQL INSERT polygon do locations.polygon.
3. Pro každý soubor v data/finds/:
   a. Parsuj název → { findId, mapNumber, locationCode, state, isAnon, hasNote }.
   b. Mapuj locationCode → location_id přes locations.code.
   c. Mapuj mapNumber → map_id přes location_maps.id.
   d. Spočti SHA-1 souboru.
   e. Pokud neexistuje /generated/web/{sha}.webp:
      - HEIC: heic-convert → buffer → sharp → WebP web + thumb.
      - JPEG/PNG: sharp → WebP web + thumb.
   f. Čti EXIF metadata fotky: GPS, DateTimeOriginal.
   g. Urči image_type: ORIGINAL nebo CROP (viz konvence rozlišení).
   h. UPSERT find (id = findId) — datum z EXIF, GPS z EXIF.
   i. UPSERT find_image s web_path + thumb_path + image_type.
4. Načti "poznamky" z JSONu a UPDATE finds.notes.
5. Pro každý stav v "stavy" rozbal ranges → UPSERT find_state_assignments.
6. Pro "anonymizace.ANONYMIZOVANE" rozbal ranges → UPDATE finds.is_anonymized = true
   + UPSERT stav ANONYMIZED.
7. Vypiš statistiky: přidáno N, aktualizováno M, přeskočeno K, chyby L.
```

## Idempotentnost a detekce změn

- **UPSERT** všude (`ON CONFLICT DO UPDATE`).
- Hash souboru v `find_images.original_sha1` — pokud se nezměnil, přeskočit regeneraci obrázků. Pozor: přeskočí se **celé** zpracování nálezu, včetně upsertu metadat.
- **Re-link nálezů** (`reconcileFindLinks`, běží na konci fáze finds): `location_id`/`map_id` nálezu se odvozuje z názvu souboru + přítomných lokačních map. Když ale foto přeskočí předchozí bod (nezměněné), jeho upsert se nespustí — a nález přidaný, když jeho mapa **chyběla** (→ `location_id = null`), by po pozdějším nahrání mapy zůstal bez lokace navždy. Tento levný průchod to dorovná: znovu přiřadí `location_id`/`map_id` všem nálezům, jejichž mapa je na disku. **Konzervativní** — jen doplní/opraví, nikdy nevynuluje nález, jehož mapa v daném běhu chybí (aby mapless/částečný sync nesmazal lokace). Loguje `relinked`. Běží jen v ostrém běhu (v `--dry-run` je `mapToLocation` jen náhrada `mapId→mapId`, takže by počet nedával smysl).
- `LokaceStavyPoznamky.json` se parsuje vždy celý (je malý, zlomek sekundy).
- Smazané soubory: pokud skript projde celým datasetem a `finds.id` X v DB není
  pokrytý žádným souborem, **neničí** ho — jen zaloguje varování. Smazání je
  manuální akce (`pnpm sync --prune` s explicitním flagem).

## CLI rozhraní

```bash
pnpm sync                    # standardní import
pnpm sync --dry-run          # vypiš co by se dělo, nic nezapisuj
pnpm sync --only=maps        # jen lokační mapy a lokality
pnpm sync --only=finds       # jen nálezy (originály + výřezy)
pnpm sync --only=meta        # jen JSON metadata (stavy, poznámky)
pnpm sync --find=16230       # jen jeden nález (debug)
pnpm sync --force-regen      # přegeneruj WebP i pokud existují
pnpm sync --prune            # smaž DB záznamy bez odpovídajícího souboru
```

## Logování

Každý běh `pnpm sync` vygeneruje:

- `logs/sync-{timestamp}.log` — hlavní log (readable)
- `logs/sync-failures-{timestamp}.jsonl` — řádky pro soubory, které selhaly v parsování

Obsah failures logu:

```jsonl
{"file":"finds/weird_name.HEIC","reason":"parse_error","details":"no FIND_ID prefix"}
{"file":"finds/999_1_UNKNOWN_CODE_X.HEIC","reason":"unknown_location","details":"UNKNOWN_CODE not in locations table"}
```

Uživatel si failures projde ručně a buď opraví názvy souborů, nebo přidá
výjimky do parseru.

## IndexNow ping (SEO)

Na konci **ostrého** (ne `--dry-run`) syncu s fázemi finds skript sám
pingne IndexNow (`src/lib/indexnow.ts`) s URL nálezů, které tento běh
**nově vložil** (`createdAt >= start`) a nejsou anonymizované → Bing /
Seznam.cz / Yandex je začnou crawlovat v hodinách místo čekání na
sitemap. Je to **best-effort**: selhání jen zaloguje `indexnow.failed`,
nikdy nerozbije sync; na localhostu / v dry-runu je to no-op. Klíč je
veřejný v kódu, ověřuje se přes route `/indexnow-key`. Google IndexNow
nepoužívá (řeší sitemap + Search Console).

## Revalidace cache po syncu

Statistiky (`/statistiky` a statové panely na `/`) se počítají přes
`unstable_cache` s tagem `"stats"` a `revalidate` **6 h**; stránky `/` a
`/statistiky` navíc cachují ISR render. `/sbirka`, `/mapa` a `/lokality`
jsou `force-dynamic` (čtou z DB při každém requestu), takže se po syncu
aktualizují samy — ale **statistiky ne**, dokud nevyprší jejich okno.

`pnpm sync` běží **mimo** Next runtime, takže `revalidateTag`/`revalidatePath`
nemůže volat přímo. Na konci ostrého (ne `--dry-run`) syncu proto pingne
`POST http://127.0.0.1:$PORT/api/admin/revalidate` (`src/lib/revalidatePing.ts`)
s bearer tokenem `REVALIDATE_TOKEN`. Endpoint (uvnitř serveru) zavolá
`revalidatePublicSurfaces()` = `revalidateTag("stats")` + `revalidatePath(…)`,
takže se čísla obnoví **hned**. Bez `REVALIDATE_TOKEN` se ping přeskočí a
endpoint vrací fail-closed 503 — statistiky se pak dorovnají až po TTL.

Vlastnosti:

- **Best-effort** — selhání jen zaloguje `revalidate.ping` (`warn`), nikdy
  nerozbije sync; bez tokenu je to no-op (`skipped: "no-token"`).
- **Cluster-safe** — `revalidateTag`/`revalidatePath` zapisují do sdíleného
  on-disk `.next/cache`, takže oba PM2 workery invalidaci vidí.
- Stejnou revalidaci dělá i **admin-UI** cesta syncu (`syncRunner.ts`)
  přímo v procesu — sdílený helper `src/lib/revalidate.ts`.
- Token je tajný (repo je veřejné). Endpoint žije pod `/api/admin`, takže
  ho pro externí volající navíc kryje Nginx cloak; lokální ping jde na Next
  napřímo a cloak obchází. Token vygeneruj `openssl rand -hex 32` a vlož do
  `.env` (stejná hodnota pro web i pro `pnpm sync`).

## Automatický sync (volitelné)

`deploy/systemd-sync.service` + `systemd-sync.timer` spouští sync každou noc
ve 3:00. Lze zapnout/vypnout:

```bash
sudo systemctl enable --now ctyrlistkoteka-sync.timer
sudo systemctl disable --now ctyrlistkoteka-sync.timer
```

Pro první naimplementaci to **nezapínej** — uživatel si sync spouští ručně po
nahrání nových dat.

## Výkon

- 17 000 souborů × HEIC konverze ≈ **1 s/soubor** na VPS-2 → ~5 hodin první
  import.
- Paralelizace: `p-limit(4)` → ~1,5 h. (Ponech 2 CPU pro DB a systém.)
- Následné syncy budou rychlé (SHA-1 hit → skip).
- Po prvním importu doporučit uživateli `pg_dump` zálohu.

## Postup při prvním spuštění

1. Uživatel nahraje data přes rsync:
   ```bash
   rsync -av --progress ./local-archive/ user@vps:/var/ctyrlistkoteka/data/
   ```
2. SSH na VPS přes Termius.
3. `cd /var/www/ctyrlistkoteka && pnpm sync --dry-run` — ověř parsing.
4. Prohlédni `logs/sync-failures-*.jsonl`. Pokud jsou kritické, zastav a dolaď
   parser.
5. `pnpm sync` — ostrý import (5 hodin).
6. `pnpm db:studio` pro kontrolu.
7. `pg_dump ctyrlistkoteka > backups/initial-$(date +%F).sql`.
