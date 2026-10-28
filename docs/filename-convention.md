# Konvence pojmenování souborů

**Tento dokument je kritický pro import.** Oddělovač mezi poli je `+` (plus).
Skutečné názvy souborů na disku `+` **i diakritiku zachovávají** — parser je
proto prosté `split('+')` (`src/lib/parseFilename.ts`). Podtržítko `_` se
vyskytuje jen uvnitř polí (např. v kódu lokace `RATIBOŘ_POLE001f`).

> **Oprava 2026-10-28:** starší verze tohoto dokumentu tvrdila, že se na disku
> `+` i diakritika přepisují na `_` a parser musí oddělovače „rekonstruovat".
> To neplatí; plně transliterovaný název (`16230_00031_RATIBOR__…`)
> současný parser **odmítne** (potřebuje aspoň 5 segmentů
> oddělených `+`). Z transliterace přežilo jen pár starých tokenů uvnitř
> jinak `+`-ového názvu (viz pole 4 a 6).

---

## A) Fotografie nálezu

### Schéma

```
{FIND_ID}+{MAP_NUMBER}+{LOCATION_CODE}+{STATE}+{ANON_FLAG}+{NOTE_OR_FLAG}.{ext}
```

Pole jsou oddělena znakem `+`. Uvnitř polí se mohou vyskytovat `_`.

### Reálný příklad

Takhle soubor na disku skutečně vypadá (s `+` i diakritikou):
```
16230+00031+RATIBOŘ_POLE001f+NORMÁLNÍ+NE+BezPoznámky.HEIC
```

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
- Diakritika v katastrálním názvu zůstává (`RATIBOŘ`); segment se bere jako
  neprůhledný řetězec a rozkládá ho až `splitLocationCode` v `locationCode.ts`.

#### 4. `STATE` — stav nálezu
Enumerace (v originálním českém znění):

| Hodnota v názvu | DB enum | Popis |
| --- | --- | --- |
| `NORMÁLNÍ` | `NORMAL` | Standardní nález |
| `BEZGPS` | `NO_GPS` | Chybí GPS souřadnice |
| `BEZFOTKY` | `NO_PHOTO` | Evidován, ale bez fotografie |
| `DAROVANÝ` | `DONATED` | Darován třetí osobě |
| `ZTRACENÝ` | `LOST` | Ztracen |
| `NEUTRŽEN` | `NOT_PICKED` | Neutržen |
| `BEZLOKACE` | `LOCATION_MISSING` | Bez lokality |
| `LOKACE-NEEXISTUJE` | `LOCATION_GONE` | Lokalita zanikla |

Každý token jde **číst** i bez diakritiky (`DAROVANY`, `ZTRACENY`, `NORMALNI`,
…) — JSON `stavy` je ASCII-only, tak aby se ty dva zápisy nerozcházely.

**Zapisuje se ale jen jedna podoba, a to ta, kterou používá sbírka:**
`DAROVANY`, `ZTRACENY`, `NEUTRZEN` bez diakritiky, `NORMÁLNÍ` s ní. Ať už je
důvod jakýkoli (pojmenovávací nástroj část tokenů transliteruje a část ne),
přejmenování v adminu se toho musí držet — jinak by v archivu vznikla dvě
psaní téhož stavu a `grep DAROVANY` by přestal nacházet všechno. Kanonická
podoba je `STATE_FILENAME_TOKEN` v `src/lib/stateMapping.ts` a hlídá ji test.

Z dob transliterace přežívají jako **čtecí fallback** jen tokeny
`NORMA_LNI_`, `DAROVANY_` a `DAROVAN_` (uvnitř jinak `+`-ového názvu) — čtení
je bere, zápis ne (`src/lib/stateMapping.ts`).

##### Víc stavů najednou (od 2026-08-14)

Segment může nést **libovolný počet stavů oddělených čárkou**:

```
16230+00031+RATIBOŘ_POLE001f+DAROVANÝ,ZTRACENÝ,BEZGPS+ANO+BezPoznámky.HEIC
```

Pravidla, která parser **vynucuje** (porušení = soubor se neimportuje a skončí
v `sync-failures.jsonl`, ať je to vidět):

- **`NORMÁLNÍ` nelze kombinovat.** Znamená „není co hlásit“, takže spolu s
  reálným stavem je to spor, ne zkratka.
- **Prázdný kus je chyba** — `DAROVANÝ,`, `,DAROVANÝ`, `A,,B` i samotná `,`.
- **Neznámý token je chyba** i uvnitř jinak platného seznamu.
- **Duplicita chybou není**, jen se sloučí (`DAROVANÝ,DAROVANY` → jeden stav).
- **Na pořadí nezáleží** — všechno se porovnává jako množina. Parser pořadí
  z názvu zachová, aby přejmenování nešustilo bez důvodu.
- Mezery kolem čárky se tolerují.

**Proč čárka a ne `|`:** `|` zakazuje exFAT i NTFS, což je obvyklý formát
externího disku sdíleného s Windows — záloha archivu by název odmítla nebo
zmršila. Čárka je legální na APFS, ext4, exFAT i NTFS a v bashi a zsh je
inertní, takže ruční `mv` nepotřebuje uvozovky. Čárka v **poznámce** nevadí:
poznámka je segment 6 a parsuje se zvlášť.

**Do DB se STATE segment stále nepromítá** — stavy nálezů plní výhradně
`LokaceStavyPoznamky.json` (viz níž). Název je jejich čitelný otisk a admin
Kontroly konzistence hlídají, že se ty dva zdroje nerozešly.

#### 5. `ANON_FLAG` — příznak anonymizace
- `NE` = veřejná lokace, GPS se zobrazují
- `ANO` = tajná lokace, GPS se nezobrazují na veřejném webu

**Důležité:** Toto je **per-nález** rozhodnutí. Jeden nález na lokalitě může být
anonymní, jiný na stejné lokalitě veřejný.

**Jak se `finds.is_anonymized` skutečně počítá** (`scripts/sync.ts`, fáze finds
a meta): výsledek je **NEBO** ze tří zdrojů — pole 5 = `ANO`, ID v JSON
`anonymizace.ANONYMIZOVANE`, nebo nález leží na anonymizované lokační mapě.
Pole 5 se zapíše (ANO i NE) při každém zpracování souboru; meta fáze z JSON
umí příznak jen **zapnout**, nikdy vypnout. **Odanonymizování** proto potřebuje
obojí: odebrat ID z `ANONYMIZOVANE` **a** přejmenovat soubor na `NE` (tím se
znovu zpracuje). Samotné odebrání z JSON smaže jen stav `ANONYMIZED`, příznak
zůstane `true`.

#### 6. `NOTE_OR_FLAG` — poznámka
- `BezPoznámky` = nález nemá poznámku
- Cokoli jiného = volný text poznámky (může obsahovat mezery, diakritiku)
- Starý transliterovaný tvar `BezPozna_mky` parser ještě přijme jako „bez poznámky"
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

Skutečný název (takhle i na disku):
```
RATIBOŘ_POLE001a+Pole nad penzionem HORA - hlavní ultimátní naleziště (levá hrana)+GPS49.36668S+17.88867V+Z16+00026.png
```

> Od 2026-07-26 se mapy (v2) spravují přes `data/maps/manifest.json`
> a `/admin/import`; ten je pro jejich metadata autoritativní. Schéma názvu
> níže platí pro název PNG souboru.

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
- `GPS{lat}S` → latitude, kladná (S = Sever/North; `J` = jih, záporná)
- `{lon}V` → longitude, kladná (V = Východ/East; `Z` = západ, záporná — Dublin, Reykjavík)
- Desetinná **tečka** (`49.36668`); parser podtržítko místo tečky nepřijme.
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

## C) Parsování

Názvy na disku mají `+` i diakritiku, takže parser (`src/lib/parseFilename.ts`)
je `split('+')` a validace jednotlivých segmentů:

- **Fotka nálezu** (`parseFindFilename`): aspoň 5 segmentů
  `FIND_ID + MAP_NUMBER + LOCATION_CODE + STATE + ANON_FLAG [+ NOTE…]`;
  poznámka může `+` sama obsahovat (zbytek segmentů se spojí). Název se
  normalizuje na NFC (macOS ukládá diakritiku jako NFD).
- **Lokační mapa** (`parseMapFilename`): `CODE + DESCRIPTION + GPS{lat}S|J +
  {lon}V + Z{zoom} + MAP_ID`.
- Transliterované zbytky se berou jen jako čtecí fallback uvnitř `+`-ového
  názvu (`NORMA_LNI_`, `DAROVANY_`, `DAROVAN_`, `BezPozna_mky`). Plně
  transliterovaný název (bez `+`) se **nenaparsuje**.

### Robustnost

- Selhání parseru se logují do `sync-failures.jsonl`, soubor se neimportuje.
- Před prvním ostrým importem: `pnpm sync --dry-run` → uživatel zkontroluje failures.
- Parser nesmí tiše ignorovat chyby — lepší je explicitně selhat.

---

## D) `LokaceStavyPoznamky.json`

Autoritativní zdroj pro **stavy** a **poznámky**; k **anonymizaci** přispívá
(viz pole 5 výše). Sekce `lokace` **neurčuje**, ke které lokalitě nález
v DB patří — to dělá číslo mapy v názvu souboru (viz E). `lokace` dnes
slouží jen kontrolám konzistence v adminu (`src/lib/admin/checks.ts`).

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
| `DAROVANY` | `DONATED` | Darováno |
| `GIGANT` | `GIGANT` | Extrémně velký čtyřlístek |
| `ZTRACENY` | `LOST` | Ztracen |
| `ANONYMIZOVANE` | `ANONYMIZED` | Ze sekce `anonymizace` |

> **Zastaralé stavy (od 2026-07):** klíče `BEZLOKACE` (`LOCATION_MISSING`),
> `LOKACE-NEEXISTUJE` (`LOCATION_GONE`) a `NEUTRZEN` (`NOT_PICKED`) se už
> **nemapují** — stavy byly zrušeny. „Bez lokality" byla špatná kopie „Bez
> GPS"; zaniklou lokalitu značí prefix kódu `NEEXISTUJE-` + vlastní poznámka.
> Filename tokeny i enum hodnoty zůstávají kvůli parsování historických dat,
> ale sync (`DEPRECATED_STATES`) existující přiřazení při dalším běhu smaže.

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
| Přiřazení find→lokace | **Název souboru** (pole 2 = číslo mapy → mapa → lokace); JSON `lokace` se nepoužívá, jen kontroly |
| Stav | **JSON** `stavy` (STATE v názvu je jen čitelný otisk, do DB nejde) |
| Anonymizace | **NEBO**: filename pole 5 = ANO / JSON `anonymizace` / anonymizovaná mapa (JSON umí jen zapnout, viz pole 5) |
| Poznámka (text) | **JSON** `poznamky` |
| GPS | **EXIF** metadata fotky |
| Datum nálezu | **EXIF** metadata fotky |
