# Datový model

## Entity (přehled)

```
locations ◄── location_maps ◄── finds ──► find_images
                                  │
                                  └──► find_state_assignments
```

- Location (lokace) 1:N → LocationMap (lokační mapa)
- LocationMap 1:N → Find (nález) — přes `mapId`
- Find 1:N → FindImage (fotka originálu nebo výřezu)
- Find M:N → FindState (stavy)

---

## Tabulky

### `locations`

Lokality jsou katastrální/typové jednotky. Jedna lokalita = jedna sub-část
(např. `RATIBOŘ_POLE001a` a `RATIBOŘ_POLE001f` jsou dvě samostatné lokality).

| Sloupec | Typ | Poznámka |
| --- | --- | --- |
| `id` | INTEGER PK | odpovídá klíči v `LokaceStavyPoznamky.json` (1, 2, 10…) |
| `code` | VARCHAR(100) UNIQUE | `RATIBOŘ_POLE001f` (s diakritikou) |
| `code_transliterated` | VARCHAR(100) UNIQUE | `RATIBOR__POLE001f` (na disku) |
| `cadastral_area` | VARCHAR(100) | `RATIBOŘ` |
| `location_type` | VARCHAR(50) | `POLE`, `LES`, `MESTO`, `ZAHRADA`, … |
| `number` | SMALLINT | `1` (pořadové číslo) |
| `subpart` | CHAR(1) NULL | `a`, `b`, `f`, … |
| `display_name` | VARCHAR(255) | z popisu mapy, lidsky čitelný |
| `description` | TEXT NULL | volitelný delší popis |
| `center_point` | GEOMETRY(Point, 4326) NULL | centroid (z GPS map) |
| `polygon` | GEOMETRY(Polygon, 4326) NULL | z AOI_POLYGON v metadatech mapy |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Indexy:** `code` (unique), `code_transliterated` (unique), `cadastral_area`,
`location_type`, GIST na `center_point` a `polygon`.

---

### `location_maps`

Každá lokační mapa je PNG soubor (reálně JPEG) s OSM screenshot + volitelným
polygonem.

| Sloupec | Typ | Poznámka |
| --- | --- | --- |
| `id` | INTEGER PK | MAP_ID z názvu souboru (00001–99999, uloženo bez zero-pad) |
| `location_id` | INTEGER FK → locations | |
| `location_code` | VARCHAR(100) | `RATIBOŘ_POLE001a` |
| `description` | VARCHAR(500) | popis z názvu mapy |
| `center_lat` | DOUBLE PRECISION | GPS střed z názvu |
| `center_lng` | DOUBLE PRECISION | GPS střed z názvu |
| `zoom` | SMALLINT | OSM zoom level (0–20) |
| `image_path` | VARCHAR(500) | cesta k souboru mapy |
| `image_bounds` | JSONB | `[[swLat, swLng], [neLat, neLng]]` pro Leaflet |
| `image_width` | INTEGER | rozměry obrázku v px |
| `image_height` | INTEGER | |
| `has_polygon` | BOOLEAN | zda AOI_POLYGON existuje v metadatech |
| `is_anonymized` | BOOLEAN | z metadat souboru |
| `original_filename` | VARCHAR(500) | transliterovaný název na disku |
| `created_at` | TIMESTAMPTZ | |

**Indexy:** `location_id`, `location_code`.

---

### `finds`

| Sloupec | Typ | Poznámka |
| --- | --- | --- |
| `id` | INTEGER PK | **ID z názvu souboru**, NE autoincrement |
| `location_id` | INTEGER FK → locations NULL | z JSON `lokace` |
| `map_id` | INTEGER FK → location_maps NULL | MAP_NUMBER z filename |
| `found_at` | DATE NULL | z EXIF `DateTimeOriginal` |
| `leaf_count` | SMALLINT NOT NULL DEFAULT 4 | Vždy 4 — sbírka obsahuje výhradně čtyřlístky. Sloupec je v DB zachován jako historický artefakt schématu, app vrstva ho neexponuje. |
| `notes` | TEXT NULL | z JSON `poznamky`, **API skrývá pro anonymizované** |
| `is_anonymized` | BOOLEAN DEFAULT FALSE | z JSON `anonymizace` + filename pole 5 |
| `coordinates` | GEOMETRY(Point, 4326) NULL | z EXIF GPS |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Indexy:** `location_id`, `map_id`, `found_at` (DESC), `is_anonymized`,
GIST na `coordinates`. (Index na `leaf_count` v migrační historii zůstává,
ale nemá žádný praktický smysl — všechny řádky sdílejí jednu hodnotu.)

---

### `find_images`

| Sloupec | Typ | Poznámka |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `find_id` | INTEGER FK → finds | ON DELETE CASCADE |
| `image_type` | VARCHAR(10) | `ORIGINAL` nebo `CROP` (výřez čtyřlístku) |
| `original_filename` | VARCHAR(500) | pro referenci |
| `original_sha1` | CHAR(40) | pro detekci změn při sync |
| `web_path` | VARCHAR(500) | `/generated/web/{sha}.webp` |
| `thumb_path` | VARCHAR(500) | `/generated/thumb/{sha}.webp` |
| `width` | INTEGER | rozměry WebP web varianty |
| `height` | INTEGER | |
| `is_primary` | BOOLEAN DEFAULT FALSE | první fotka nálezu |
| `sort_order` | SMALLINT DEFAULT 0 | řazení v galerii |
| `created_at` | TIMESTAMPTZ | |

**Indexy:** `find_id`, `(find_id, image_type)`, `is_primary`.

---

### `find_state_assignments` (M:N)

| Sloupec | Typ |
| --- | --- |
| `find_id` | INTEGER FK → finds ON DELETE CASCADE |
| `state` | TEXT (enum) |
| PK `(find_id, state)` | |

Enum hodnoty:

```
NORMAL            -- výchozí
ANONYMIZED        -- skryté detaily
DONATED           -- darováno
LOST              -- ztracený
NO_GPS            -- chybí GPS
NO_PHOTO          -- bez fotografie
GIGANT            -- extrémně velký čtyřlístek
-- zastaralé (od 2026-07), enum ponechán kvůli parsování, sync je maže:
LOCATION_MISSING  -- (zrušeno) „Bez lokality" — špatná kopie NO_GPS
LOCATION_GONE     -- (zrušeno) zaniklou lokalitu značí prefix NEEXISTUJE-
NOT_PICKED        -- (zrušeno) „Neutržený"
```

---

## Validace a invarianty

- `find.leaf_count` = 4 (sbírka je výhradně čtyřlístková, viz výše).
- Pokud `find.is_anonymized = true`, API **musí** skrýt `notes` a vrátit `coordinates`
  zaokrouhlené na 3 desetinná místa (~111 m) nebo NULL.
- Pokud stav `NO_GPS`, `coordinates` je NULL.
- Pokud stav `NO_PHOTO`, nemá řádky v `find_images`.
- Nález bez lokality má `location_id` i `map_id` NULL (dřív značeno stavem
  `LOCATION_MISSING`, ten byl zrušen).
- `location.code` je unikátní a nemění se.
- `finds.id` je stabilní — nikdy ho přečíslovat.
- `location_maps.id` odpovídá MAP_ID z názvu mapy a MAP_NUMBER z fotek nálezů.

---

## Prisma specifika

Geo sloupce (`geometry`) Prisma nativně nezná. Použij `Unsupported("geometry(Point, 4326)")`
a raw SQL:

```ts
// čtení s GeoJSON
const rows = await prisma.$queryRaw<Array<{ id: number; gj: string }>>`
  SELECT id, ST_AsGeoJSON(coordinates) AS gj
  FROM finds WHERE location_id = ${locationId}
`;
```

---

## Příklady dotazů

**Seznam nálezů pro lokalitu, paginovaně:**
```ts
const finds = await prisma.find.findMany({
  where: { locationId },
  orderBy: { foundAt: 'desc' },
  take: 24,
  cursor: cursor ? { id: cursor } : undefined,
  include: { images: { where: { isPrimary: true } } },
});
```

**Bodové značky pro mapu (omezeně podle bounds):**
```ts
const markers = await prisma.$queryRaw<Array<{ id: number; lat: number; lng: number }>>`
  SELECT id,
         ST_Y(coordinates) AS lat,
         ST_X(coordinates) AS lng
  FROM finds
  WHERE coordinates IS NOT NULL
    AND is_anonymized = false
    AND coordinates && ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)
  LIMIT 5000
`;
```

**Statistika top lokality:**
```sql
SELECT l.id, l.display_name, COUNT(f.id)::int AS find_count
FROM locations l
LEFT JOIN finds f ON f.location_id = l.id
GROUP BY l.id, l.display_name
ORDER BY find_count DESC
LIMIT 20;
```

---

## Materializované views (volitelné, až při potřebě)

```sql
CREATE MATERIALIZED VIEW stats_finds_per_month AS
SELECT date_trunc('month', found_at)::date AS month, COUNT(*)::int AS count
FROM finds
WHERE found_at IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- refresh v cronu 1×/hodinu
REFRESH MATERIALIZED VIEW CONCURRENTLY stats_finds_per_month;
```
