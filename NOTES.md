# Pracovní poznámky

Žurnál session-level kontextu — co je rozpracované, co se právě dořešilo,
co je další krok. Drž pod ~200 řádků; starší věci stručně shrnuj nahoru.
Detailní architektura → `docs/`, dlouhodobé instrukce → `CLAUDE.md`.

---

## Stav (2026-05-02)

Admin track má hotové fáze 1–7 (passkey + audit, file browser, JSON editor
+ náhled s tabami/statistikami/lookup, upload originálů + crops + lokačních
map, reálné fotky darů + lokalit, sync trigger s live logem, ID gap detector,
sync-needed banner). Pickup point pro Claude Code = `docs/admin-overview.md`.

### Dnes (2026-05-02)

- **Map detail — popisek + zaniklé**: editor segmentu[1] názvu mapy funguje
  i pro zaniklé (`NEEXISTUJE-`) i anonymizované mapy; tlačítko "Obnovit"
  strhne `NEEXISTUJE-` prefix. Replace souboru má server-side defenzivu
  proti name-mismatch (vyžaduje `nameOverride=1`).
- **Sync — rename + auto-prune** (nejnovější commit `0b8e214`): admin's
  "set as zaniklá" mění locationCode v názvu, MAP_ID zůstává. Předchozí
  upsert-by-code padal na PK kolizi. `phaseMaps` teď dělá byCode → byId
  → create lookup; rename loguje `maps.location_renamed`, fork (starý
  code ještě používán jinou mapou) loguje `maps.location_forked` a vyrobí
  čerstvé Location.id. `phasePrune` automaticky maže orphan
  location_maps + locations na každém syncu (bez `--prune`); finds +
  generated/ WebPy zůstávají za `--prune`.
- **Default 500/page** pro `/admin/files/maps` (`SCOPE_DEFAULT_PAGE_SIZE`
  v `[scope]/page.tsx`).

### Commity dnes (od staršího k novějšímu)

- `bc00764` skip NEEXISTUJE- maps (zrušeno níže) + 500/page default
- `0b8e214` rename-aware phaseMaps + auto-prune orphan maps/locations
  (nahrazuje skip přístupem "delete-old + create-new = update in place")

---

## Další krok

1. **Počkej na deploy** GitHub Action z `0b8e214`.
2. V `/admin/sync` spusť **dry-run**. Hledej v logu:
   - `prune.dryrun_auto` — kolik maps/locations by se smazalo
   - `maps.location_renamed` / `maps.location_forked` — kolik renamů detekováno
3. Pokud čísla dávají smysl (rename → 0 orphanů typicky, jen log řádek;
   skutečně smazaná mapa → 1 orphan), spusť **ostrý sync**.
4. Ověř na `/lokality`, že přejmenovaná lokalita (BRNO_ZVONAŘKA-ÚAN001 nebo
   ZLÍN_JSVAHY-NSTR001) je teď pod `NEEXISTUJE-…` kódem.

---

## Otevřené nápady (nezadané)

- Pre-pass v dry-run, který načte skutečná `Location.id` z DB místo
  mapId stand-inu, aby `prune.dryrun_auto` count nebyl přibližný při
  více mapách na jednu lokaci.
- E2E Playwright test pro rename flow (set as zaniklá → sync → ověř DB).
- ECharts/Recharts dashboard pro `/admin` přehled (kolik nálezů přibylo
  za týden, kdy poslední úspěšný sync, počet anomálií v JSONu).

---

## Historicky (zkráceně)

- **Fáze 1 — auth foundation**: passkey/WebAuthn, iron-session
  (cookie path = `/`), audit log, IP cloak `/admin` 404 pro neautent.
- **Fáze 2 — file browser**: read-only listing + audit log viewer.
- **Fáze 3 — JSON editor**: 4 taby (lokace / poznámky / stavy /
  anonymizace), `formatJsonCompactArrays` pro single-line pole primitiv.
- **Fáze 4 — uploady**: originály (finds), crops (crops), lokační mapy
  (s zachováním PNG tEXt + EXIF). Atomický zápis (tmp → fsync → rename),
  destruktivní operace přes `data/.trash/<ts>/` (auto-prune 30 dní).
- **Fáze 5 — JSON náhled**: stats banner, find lookup, anomaly detection
  (darované bez poznámky, find bez lokace). Hlavní karta vede na náhled,
  ne na editor.
- **Fáze 6 — reálné fotky**: `<id><slot>_DAR[_ANON].<ext>` (darované),
  `<mapa>_reálné foto<descriptor>.<ext>` (lokality). Cíl
  `generated/find-photos/`, `generated/location-photos/`.
- **Fáze 7 — sync trigger**: spawn `tsx scripts/sync.ts` jako podproces,
  state JSON v `data/.admin/state/sync.json` (sdíleno mezi PM2 workery),
  log soubor v `data/.admin/logs/`, polling 750 ms. Dry-run + ostrý
  s confirm stripem, preset z `?preset=finds|maps|meta`.
- **Sync-needed banner**: porovnává mtime adresářů s
  `last-sync-success.json`. Per-scope (finds / maps / meta). Shortcut
  na `/admin/sync?preset=…`.
- **Cross-PC bootstrap**: README sekce "Pokračování na jiném počítači",
  `docs/admin-overview.md` jako pickup point pro nový Claude session.

### Reverted / nahrazeno

- **Skip filter pro NEEXISTUJE-** v `phaseMaps` (commit `bc00764`):
  uživatel opravil — zaniklé lokality se mají normálně zobrazovat na
  `/lokality`, schema explicitně podporuje `NEEXISTUJE-` v `Location.code`.
  Místo skipu teď rename-aware lookup + auto-prune (`0b8e214`).

### Známé pasti (drž v hlavě)

- macOS rsync z iCloudu doručuje názvy v NFD; browser posílá NFC. Vždy
  normalizuj obě strany (`.normalize("NFC")`) než porovnáváš.
- `"use server"` soubory smí exportovat jen `async` funkce. Konstanty
  + typy patří do `*Types.ts` sourozeneckého souboru.
- RSC boundary: server komponenta může předat klientské komponentě jen
  `"use server"` action, ne libovolnou inline arrow funkci. Místo
  `confirmText: (n) => string` použij `confirmTemplate: string` s `{n}`
  placeholderem.
- Iron-session cookie pro admin musí mít `path=/`, jinak `/api/admin/*`
  dostává unauth requesty.
- Polling loop musí používat `useRef` pro mutating state (offset),
  jinak useEffect zachytí starou hodnotu a re-fetchuje stejné bytes.
