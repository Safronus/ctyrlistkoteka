# Pracovní poznámky

Žurnál session-level kontextu — co je rozpracované, co se právě dořešilo,
co je další krok. Drž pod ~200 řádků; starší věci stručně shrnuj nahoru.
Detailní architektura → `docs/`, dlouhodobé instrukce → `CLAUDE.md`.

---

## Stav (2026-05-03)

Admin track má hotové fáze 1–7 (passkey + audit, file browser, JSON editor
+ náhled, upload originálů + crops + map, reálné fotky, sync trigger, ID
gap detector, sync-needed banner, **fail2ban blocklist viewer**). Pickup
point pro Claude Code = `docs/admin-overview.md`.

### Dnes (2026-05-03)

- **`/admin/files` landing oprava** (`a56aa70`): počty filtrují skryté
  soubory (`.DS_Store`, `._*`, atomické `.tmp`); banner nahoře porovnává
  ID nálezů v originálech vs crops (symetrický rozdíl, ne raw názvy) a
  ukazuje preview chybějících ID. Karty originálů + crops mají badge
  s mismatch countem.
- **Map detail — metadata preview** (`a56aa70`): nový panel na
  `/admin/files/maps/<name>` s MAP_ID, zoom, GPS středem, popiskem,
  rozměrem v px (z PNG IHDR — bez sharpu, jen 64KB head read), AOI
  polygon (počet bodů + GPS bbox + náhled prvních 4 vertices), výpis
  všech tEXt/iTXt chunků, badge `anonymizovaná`/`zaniklá`.
- **`/admin/audit/blocklist`** (`2fa2a70`) — fail2ban TSV viewer:
  stats / TOP 10 jails / TOP 10 IP / recent / všechny IP s počty +
  first/last seen + jails / permaban kandidáti (formulář
  threshold/window/jail, živý preview `.conf`). Exporty:
  `/api/admin/blocklist/export?kind=raw|ips|permaban` (TSV/CSV/JSON/conf).
  **Webapp jen čte, do `/etc/nginx/` nikdy nesahá.** Permission hint
  pro `setfacl` (chybělo `acl` package — viz pasti).
- **Audit tabulka horizontální scroll** (`2fa2a70`): wrapper z
  `overflow-hidden` na `overflow-x-auto`, details cell `whitespace-nowrap`,
  + `AuditSubNav` (Záznamy / Blocklist) na obou audit stránkách.
- **Upload — masked Server Components error** (`1c92e49`, `80e8457`):
  Při uploadu 50 souborů se zobrazila generická produkční hláška
  "An error occurred in the Server Components render" místo reálné
  příčiny. **Root cause:** `revalidatePath()` uvnitř server action
  přibalí rerenderovaný strom listingu do RSC response — jakmile
  rerender shoří (větší batch → `analyzeIdRange`/`listScope` na
  17k+ filech?), celá action response je shozena pod maskou.
  - **Fix v `80e8457`**: action vrací jen `{ results }`, klient volá
    `router.refresh()` po prvním ok řádku. Action response je teď
    triviální, listing rerender už nemůže shodit upload.
  - **Error boundary**: `/admin/files/[scope]/error.tsx` ukáže digest
    + `pm2 logs … | grep '<digest>'` hint.
  - **Bonus** (`1c92e49`): structured `error` field v `UploadResponse`,
    top-level try/catch v actions, console.error s plným stackem.

### Commity dnes (od staršího k novějšímu)

- `a56aa70` files landing fixes + map metadata preview
- `2fa2a70` /admin/audit/blocklist + audit horizontal scroll
- `1c92e49` upload errors → structured response (diagnostic, nestačil)
- `80e8457` drop revalidatePath, router.refresh on client (skutečný fix)

---

## Další krok (čeká na uživatele)

1. **Deploy `80e8457`** přes GitHub Action.
2. **Upload 121 souborů** (originály i crops) — měl by projít všechny
   3 batche (50/50/21).
3. **Pokud listing pak shoří**: error.tsx ukáže digest. V Termiusu:
   ```bash
   pm2 logs ctyrlistkoteka --err --lines 500 | grep '<digest>'
   ```
   → najdeme reálnou root-cause render-time chyby.
4. **Blocklist ACL** (po `apt install acl`):
   ```bash
   sudo apt install -y acl
   sudo setfacl -m u:app:r /var/log/fail2ban-blocklist.tsv
   # + logrotate snippet postrotate hook (viz UI hint v /admin/audit/blocklist)
   ```
   Alternativně `sudo chmod 644 /var/log/fail2ban-blocklist.tsv` + edit
   logrotate `create 644 root root`.

---

## Otevřené nápady (nezadané)

- Pre-pass v dry-run, který načte skutečná `Location.id` z DB místo
  mapId stand-inu, aby `prune.dryrun_auto` count nebyl přibližný při
  více mapách na jednu lokaci.
- E2E Playwright test pro rename flow (set as zaniklá → sync → ověř DB).
- E2E Playwright test pro upload 100+ souborů (proti regresi
  Server-Components-render maskovací cesty).
- Lower `MAX_FILES_PER_REQUEST` z 50 na ~25, pokud i po `80e8457`
  větší batche selhávají z paměťových důvodů.
- ECharts/Recharts dashboard pro `/admin` přehled (kolik nálezů
  přibylo za týden, kdy poslední úspěšný sync, počet anomálií v JSONu).

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
- **Fáze 5 — JSON náhled**: stats banner, find lookup, anomaly detection.
- **Fáze 6 — reálné fotky**: `<id><slot>_DAR[_ANON].<ext>` (darované),
  `<mapa>_reálné foto<descriptor>.<ext>` (lokality).
- **Fáze 7 — sync trigger**: spawn `tsx scripts/sync.ts` jako podproces,
  state JSON v `data/.admin/state/sync.json` (sdíleno mezi PM2 workery),
  log v `data/.admin/logs/`, polling 750 ms. Dry-run + ostrý s confirm.
- **Sync — rename + auto-prune** (2026-05-02, `0b8e214`): admin's
  "set as zaniklá" mění locationCode v názvu, MAP_ID zůstává.
  `phaseMaps` dělá byCode → byId → create lookup; rename loguje
  `maps.location_renamed`, fork loguje `maps.location_forked`.
  `phasePrune` automaticky maže orphan location_maps + locations
  na každém syncu (bez `--prune`); finds + generated/ za `--prune`.
- **Sync-needed banner**: porovnává mtime dirsizes s
  `last-sync-success.json`. Per-scope. Shortcut `/admin/sync?preset=…`.
- **Cross-PC bootstrap**: README sekce "Pokračování na jiném počítači",
  `docs/admin-overview.md` jako pickup point.

### Reverted / nahrazeno

- **Skip filter pro NEEXISTUJE-** v `phaseMaps` (commit `bc00764`,
  2026-05-02): zaniklé lokality se mají normálně zobrazovat na
  `/lokality`, schema explicitně podporuje `NEEXISTUJE-` v `Location.code`.
  Nahrazeno rename-aware lookupem v `0b8e214`.
- **`revalidatePath` v upload actions** (před `80e8457`): masked
  Server Components render error při velkých batchích. Nahrazeno
  client-side `router.refresh()`.

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
- **`revalidatePath()` v server action bundle-uje rerender do RSC
  response.** Pokud ten rerender shoří, klient vidí jen masked
  "Server Components render" wrapper bez detailů. Pro mutace co
  následuje rerender velkého listingu radši `router.refresh()` na
  klientu po návratu action.
- Ubuntu 24.04 nemá `acl` package defaultně — `setfacl: command not
  found` znamená `sudo apt install -y acl` nebo `chmod 644` fallback
  s logrotate `create 644 …` directivou.
