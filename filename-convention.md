# Konvence pojmenování souborů

**Tento dokument je kritický pro import.** Oddělovač mezi poli je `+` (plus).
Uvnitř jednotlivých polí se vyskytují `_` (podtržítka) jako náhrada diakritiky
a mezer v českém textu.

---

## A) Fotografie nálezu

### Schéma

```
{FIND_ID}+{MAP_NUMBER}+{LOCATION_CODE}+{STATE}+{ANON_FLAG}+{NOTE_OR_FLAG}.{ext}
```

Pole jsou oddělena znakem `+`. Uvnitř polí se mohou vyskytovat `_`.

### Reálný příklad

Skutečný název (s diakritikou):
```
16230+00031+RATIBOŘ_POLE001f+NORMÁLNÍ+NE+BezPoznámky.HEIC
```

Na filesystému (po transliteraci diakritiky na `_`):
```
16230_00031_RATIBOR__POLE001f_NORMA_LNI__NE_BezPozna_mky.HEIC
```

**POZOR:** Na filesystému jsou `+` i diakritické znaky nahrazeny `_`. Proto
skutečný soubor na disku nemá `+` oddělovače — vše jsou podtržítka. Parser
musí **rekonstruovat `+` oddělovače** z transliterovaného názvu, viz sekce
„Strategie parsování" níže.

### Dekompozice polí

```
16230+00031+RATIBOŘ_POLE001f+NORMÁLNÍ+NE+BezPoznámky.HEIC
└─┬─┘ └─┬─┘ └──────┬───────┘ └──┬───┘ └┬┘ └────┬────┘ └┬┘
  │     │          │            │      │       │       │
  │     │          │            │      │       │       └── přípona (HEIC/JPEG/PNG)
  │     │          │            │      │       └── poznámka nebo "BezPoznámky"
  │     │          │            │      └── anonymizace: NE=veřejný, ANO=tajný
  │     │          │            └── stav nálezu
  │     │          └── kód lokační mapy (katastr_typ+číslo+sub-část)
  │     └── číslo lokační mapy (5 číslic, zero-padded)
  └── ID nálezu (integer, stabilní primární klíč)
```

### Pole v detailu

#### 1. `FIND_ID` — ID nálezu
- Integer, unikátní, stabilní. Rozsah: 1–99999+.
- Toto je **primární klíč** v tabulce `finds`. Nepoužívat autoincrement.

#### 2. `MAP_NUMBER` — číslo lokační mapy
- 5 číslic, zero-padded: `00001`–`99999`.
- Propojuje nález na konkrétní lokační mapu (viz sekce B, pole MAP_ID).
- Jeden nález → jedna mapa. Více nálezů může sdílet stejnou mapu.

#### 3. `LOCATION_CODE` — identifikátor lokace
- Formát: `{KATASTR}_{TYP}{NNN}{písmeno}`
- Příklady: `RATIBOŘ_POLE001f`, `BRNO_LES003a`, `PRAHA_PARK012b`
- `KATASTR` = katastrální oblast (český název s diakritikou)
- `TYP` = typ prostředí (POLE, LES, MESTO, ZAHRADA, PARK, …)
- `NNN` = třímístné číslo (001–999)
- `písmeno` = sub-část (a–z), volitelné
- Na disku se diakritika v katastrálním názvu transliteruje: `RATIBOŘ` → `RATIBOR_`

#### 4. `STATE` — stav nálezu
Enumerace (v originálním českém znění):

| Hodnota v názvu | DB enum | Popis |
| --- | --- | --- |
| `NORMÁLNÍ` | `NORMAL` | Standardní nález |
| `BEZGPS` | `NO_GPS` | Chybí GPS souřadnice |
| `BEZFOTKY` | `NO_PHOTO` | Evidován, ale bez fotografie |
| `DAROVANÝ` | `DONATED` | Darován třetí osobě |

Na disku transliterováno: `NORMA_LNI_` (NORMÁLNÍ), `DAROVAN_` (DAROVANÝ) atd.

#### 5. `ANON_FLAG` — příznak anonymizace
- `NE` = veřejná lokace, GPS se zobrazují
- `ANO` = tajná lokace, GPS se nezobrazují na veřejném webu

**Důležité:** Toto je **per-nález** rozhodnutí. Jeden nález na lokalitě může být
anonymní, jiný na stejné lokalitě veřejný. JSON `anonymizace.ANONYMIZOVANE` je
autoritativní zdroj, filename pole 5 je doplňkové.

#### 6. `NOTE_OR_FLAG` — poznámka
- `BezPoznámky` = nález nemá poznámku
- Cokoli jiného = volný text poznámky (může obsahovat mezery, diakritiku)
- Na disku transliterováno (`BezPozna_mky`)
- Poznámky jsou také v `LokaceStavyPoznamky.json` (`poznamky` sekce) — **JSON je
  autoritativní zdroj textu**, filename jen signalizuje přítomnost/nepřítomnost.

### Typy obrázků nálezů

Každý nález může mít **dva druhy** obrázků:

1. **Originál** — celá fotografie z telefonu/fotoaparátu.
2. **Výřez (crop)** — oříznutý záběr přímo na čtyřlístek.

**Konvence rozlišení originálu vs. výřezu:** Claude Code se při prvním importu
zeptá uživatele, jak jsou odlišeny (odlišná složka? suffix v názvu? jinak?).
V datovém modelu: `find_images.image_type` = `ORIGINAL` | `CROP`.

### GPS a datum

- **GPS souřadnice**: z **EXIF metadat** fotky (`GPSLatitude`, `GPSLongitude`).
  Nejsou v názvu souboru.
- **Datum nálezu**: z **EXIF** (`DateTimeOriginal` nebo `CreateDate`).
  Není v názvu souboru.
- Pokud EXIF chybí (stav `BEZGPS`), `coordinates` v DB je NULL.

---

## B) Lokační mapa

### Schéma

```
{LOCATION_CODE}+{DESCRIPTION}+GPS{lat}S+{lon}V+Z{zoom}+{MAP_ID}.png
```

Oddělovač je `+`. Popis může obsahovat mezery, pomlčky, závorky, diakritiku.

### Reálný příklad

Skutečný název:
```
RATIBOŘ_POLE001a+Pole nad penzionem HORA - hlavní ultimátní naleziště (levá hrana)+GPS49.36668S+17.88867V+Z16+00026.png
```

Na filesystému (transliterováno):
```
RATIBOR__POLE001a_Pole_nad_penzionem_HORA_-_hlavni__ultima_tni__nalezis_te___leva__hrana__GPS49_36668S_17_88867V_Z16_00026.png
```

### Dekompozice polí

```
RATIBOŘ_POLE001a + Pole nad penzionem HORA... + GPS49.36668S + 17.88867V + Z16 + 00026 .png
└──────┬────────┘  └───────────┬────────────┘   └─────┬─────┘  └───┬───┘  └┬┘  └─┬──┘
       │                      │                       │            │       │     │
       │                      │                       │            │       │     └── MAP_ID (5 číslic)
       │                      │                       │            │       └── zoom level (OSM)
       │                      │                       │            └── longitude (V = východ/east)
       │                      │                       └── latitude (S = sever/north)
       │                      └── lidsky čitelný popis lokace
       └── kód lokace (shodný s polem 3 ve fotkách nálezů)
```

### Pole v detailu

#### 1. `LOCATION_CODE`
Shodný identifikátor jako u fotek nálezů. Propojovací klíč.

#### 2. `DESCRIPTION`
Volný text, lidsky čitelný popis. Uloží se do `locations.display_name`.

#### 3–4. GPS souřadnice
- `GPS{lat}S` → latitude, kladná (S = Sever/North)
- `{lon}V` → longitude, kladná (V = Východ/East)
- Desetinná tečka v originále. Na disku nahrazena `_`: `49_36668` → `49.36668`.
- **Toto je střed mapy** (centroid lokace).

#### 5. `Z{zoom}`
OSM zoom level (celé číslo 0–20). Typicky 14–18.

#### 6. `MAP_ID`
5 číslic, zero-padded: `00001`–`99999`. Unikátní ID mapy.
Propojení: `find_filename.MAP_NUMBER` == `map_filename.MAP_ID`.

### Metadata v souboru mapy

Kromě názvu souboru obsahuje **samotný soubor** (v EXIF/XMP metadatech):

| Metadata klíč | Popis | Povinnost |
| --- | --- | --- |
| `AOI_POLYGON` | Polygon oblasti zájmu (souřadnice bodů) | Volitelné — ne všechny mapy ho mají |
| Anonymizace | Příznak, zda je mapa anonymizovaná | Ano |
| Marker středobodu | Střed lokace | Ano |

**Formát polygonu a metadat:** Claude Code při implementaci parseru přečte
vzorkové soubory exiftoolem (`exiftool -j mapka.png`) a zdokumentuje skutečný
formát. Polygon se uloží jako PostGIS `geometry(Polygon, 4326)`.

### Skutečný formát souboru

**Pozor:** Přestože přípona je `.png`, soubory jsou ve skutečnosti **JPEG**
(magic bytes `FF D8 FF`). Parser musí detekovat formát podle magic bytes, ne
podle přípony. sharp to zvládne automaticky.

### Výpočet bounding boxu pro Leaflet overlay

Z GPS středu + zoom + rozměrů obrázku v pixelech:

1. Načti rozměry obrázku (sharp: `metadata()`).
2. Rozlišení na daném zoomu:
   `resolution = 156543.03 * cos(lat × π / 180) / 2^zoom` (metry/pixel)
3. Šířka/výška mapy v metrech:
   `width_m = width_px × resolution`, `height_m = height_px × resolution`
4. GPS je **střed obrázku** → bounding box = střed ± polovina.
5. Převod na stupně:
   `Δlat ≈ height_m / 111320`
   `Δlng ≈ width_m / (111320 × cos(lat × π / 180))`
6. Výstup: `bounds = [[lat - Δlat/2, lng - Δlng/2], [lat + Δlat/2, lng + Δlng/2]]`

Uloží se do `locations.map_image_bounds` jako JSONB.

---

## C) Strategie parsování (transliterovaných názvů z disku)

### Problém

Na disku jsou originální `+` a diakritické znaky nahrazeny `_`. Proto název:
```
16230_00031_RATIBOR__POLE001f_NORMA_LNI__NE_BezPozna_mky.HEIC
```
nelze jednoduše splitnout na `_`.

### Řešení: pozicový parser

**Pro fotky nálezů:**

```
1. Odstraň příponu.
2. Z levé strany: najdi řetězec číslic → FIND_ID.
3. Přeskoč "_", najdi další řetězec 5 číslic → MAP_NUMBER.
4. Přeskoč "_". Najdi LOCATION_CODE vzor: {UPPER+}_{UPPER}{3digit}{lower?}
   (regex: [A-Z_]+[A-Z]+\d{3}[a-z]?)
5. Přeskoč "_". Matchuj STATE na známé transliterované varianty:
   NORMA_LNI_ | DAROVAN_ | BEZGPS | BEZFOTKY
6. Přeskoč "_". ANON_FLAG: NE | ANO.
7. Přeskoč "_". Zbytek = NOTE (nebo BezPozna_mky → has_note = false).
```

**Pro lokační mapy:**

```
1. Odstraň příponu.
2. Najdi GPS vzor: GPS\d+_\d+S → tím se oddělí {CODE+DESCRIPTION} od {GPS...}.
3. Z levé strany: LOCATION_CODE (stejný vzor jako výše).
4. Mezi CODE a GPS: DESCRIPTION (transliterovaný).
5. Za GPS: longitude (\d+_\d+V), Z(\d+), MAP_ID (\d{5}).
```

### Alternativa: uživatel dodá originální názvy

Pokud existuje mapování `{transliterovaný} → {originální s +}`, parser je
triviální: `split('+')`. Claude Code se zeptá uživatele, zda toto mapování
existuje (generátor, databáze originálních názvů, jiný zdroj).

### Robustnost

- Selhání parseru se logují do `sync-failures.jsonl`, soubor se neimportuje.
- Před prvním ostrým importem: `pnpm sync --dry-run` → uživatel zkontroluje failures.
- Parser nesmí tiše ignorovat chyby — lepší je explicitně selhat.

---

## D) `LokaceStavyPoznamky.json`

Autoritativní zdroj pro přiřazení, stavy, poznámky, anonymizaci.

### Struktura

```jsonc
{
  "anonymizace": {
    "ANONYMIZOVANE": ["6-7", "43-44", "15052-15058"]
  },
  "lokace": {
    "1": ["15-35", "57-62"],
    "10": ["13608", "14310-14313"],
    "26": ["13790-13967", "14131-14304", ...]
  },
  "poznamky": {
    "14608": "DAR - Brášule a jeho rodinka",
    "156": "Nalezeno v Irsku v Dublinu"
  },
  "stavy": {
    "BEZFOTKY":           ["734", "15055"],
    "BEZGPS":             ["165", "15886"],
    "BEZLOKACE":          [""],
    "DAROVANY":           ["13602-13603", "14608", ...],
    "LOKACE-NEEXISTUJE":  ["36", "112-130"],
    "NEUTRZEN":           [],
    "ZTRACENY":           ["378", "14561"]
  }
}
```

### Mapování stavů JSON → DB

| JSON klíč | DB enum | Popis |
| --- | --- | --- |
| `BEZFOTKY` | `NO_PHOTO` | Bez fotografie |
| `BEZGPS` | `NO_GPS` | Bez GPS |
| `BEZLOKACE` | `LOCATION_MISSING` | Nepřiřazeno k lokalitě |
| `DAROVANY` | `DONATED` | Darováno |
| `LOKACE-NEEXISTUJE` | `LOCATION_MISSING` | Sjednoceno s BEZLOKACE |
| `NEUTRZEN` | `NOT_PICKED` | Nechán na místě |
| `ZTRACENY` | `LOST` | Ztracen |
| `ANONYMIZOVANE` | `ANONYMIZED` | Ze sekce `anonymizace` |

### Rozsahy ID

`"15-35"` = `[15, 16, …, 35]` (inkluzivní). `"14608"` = `[14608]`.

```ts
export function parseRanges(specs: string[]): number[] {
  const out = new Set<number>();
  for (const spec of specs) {
    const s = spec.trim();
    if (!s) continue;
    const m = /^(\d+)-(\d+)$/.exec(s);
    if (m) {
      const [a, b] = [+m[1], +m[2]];
      for (let i = a; i <= b; i++) out.add(i);
    } else if (/^\d+$/.test(s)) {
      out.add(+s);
    } else {
      throw new Error(`Invalid range spec: "${s}"`);
    }
  }
  return [...out].sort((a, b) => a - b);
}
```

---

## E) Priorita zdrojů dat

Při konfliktu:

| Datový bod | Autoritativní zdroj |
| --- | --- |
| ID nálezu | Název souboru (pole 1) |
| Číslo mapy | Název souboru (pole 2) |
| Kód lokace | Název souboru (pole 3) |
| Přiřazení find→lokace | **JSON** `lokace` |
| Stav | **JSON** `stavy` (přesnější než filename) |
| Anonymizace | **JSON** `anonymizace` + doplňkově filename pole 5 |
| Poznámka (text) | **JSON** `poznamky` |
| GPS | **EXIF** metadata fotky |
| Datum nálezu | **EXIF** metadata fotky |
