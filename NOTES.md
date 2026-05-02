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

**Velký upload 100+ souborů ✅ funguje** (po dlouhém debug session).

### Dnes (2026-05-03)

- **`/admin/files` landing oprava** (`a56aa70`): počty filtrují skryté
  soubory (`.DS_Store`, `._*`, atomické `.tmp`); banner porovnává ID
  nálezů originály vs crops, badge s mismatch countem.
- **Map detail — metadata preview** (`a56aa70`): MAP_ID, zoom, GPS,
  popisek, dim z PNG IHDR (bez sharpu), AOI polygon (počet + bbox +
  preview vertices), výpis tEXt/iTXt, badge anonymizovaná/zaniklá.
- **`/admin/audit/blocklist`** (`2fa2a70`) — fail2ban TSV viewer:
  stats / TOP 10 jails+IPs / recent / všechny IP / permaban kandidáti
  (live preview `.conf`). Exporty `?kind=raw|ips|permaban`. Read-only,
  do `/etc/nginx/` se nesahá. Permission hint pro `setfacl`.
- **Audit tabulka horizontal scroll** (`2fa2a70`): `overflow-x-auto` +
  `whitespace-nowrap` na details cell, `AuditSubNav` (Záznamy / Blocklist).
- **Upload epic — 5 commitů, plně vyřešeno** (`1c92e49` → `80e8457` →
  `c7ad4e7` → `2e5d1e9` → `18979de` → `035f136` → `8eacf89`):
  - **#1 maska RSC erroru:** `revalidatePath()` v server action
    rerenderuje listing do response payloadu. Při velkém batchi (50
    files) listing rerender shořel a celá akce vrátila "Server
    Components render" wrapper bez detailů.
    Fix: drop `revalidatePath`, klient volá `router.refresh()`.
  - **#2 client-side encoder:** Server-action RSC encoder v browseru
    silently failoval na ≥50 file batchích — request **vůbec nešel**
    do network. Fix: přepnout finds + crops na **REST POST endpoints**
    `/admin/api/upload/{finds,crops}` přes nativní `fetch()` —
    browser multipart streaming sidesteppuje RSC encoder.
  - **#3 undici formData parser:** `request.formData()` v Next.js
    Node runtime na Safari multipartu padal s "Failed to parse body
    as FormData". Fix: zaparsovat busboyem (`@/lib/admin/multipart`).
  - **#4 Web→Node stream bridge dropuje bytes:**
    `Readable.fromWeb(request.body).pipe(busboy)` ztrácel trailing
    bytes — busboy hlásil "Unexpected end of form" i když
    Content-Length sedělo. Fix: bufferovat body předem
    `busboy.end(await request.arrayBuffer())`.
  - **#5 záhadný 10MB cap upstream:** Body se zkracovalo z 16 MB na
    ~10 MB ještě před Next.js (Content-Length sedělo, reálné bytes
    ne). Nginx config je čistá (200M všude), takže cap je v OVH
    layeru / HTTP/2 transport buffer / něčem podobném.
    Workaround: **size-based batching klient-side**, každý batch
    ≤ `MAX_BATCH_BYTES = 8 MB` (+ stále count cap 50).
    `splitIntoBatches()` v `upload-form.tsx`.
  - **#6 mojibake diakritiky:** busboy default `defParamCharset:
    "latin1"`, takže `NORMÁLNÍ` v filenamu přišlo jako `NORMÃLNÃ` →
    parser hlásil "Unknown STATE token". Fix: `defParamCharset:
    "utf8"` v Busboy konfigu.
  - Bonus: Error boundary `/admin/files/[scope]/error.tsx` ukáže
    digest + `pm2 logs … | grep '<digest>'` hint.

### Commity dnes (od staršího k novějšímu)

- `a56aa70` files landing fixes + map metadata preview
- `2fa2a70` /admin/audit/blocklist + audit horizontal scroll
- `1c92e49` upload errors → structured response
- `80e8457` drop revalidatePath, router.refresh on client + error boundary
- `c7ad4e7` finds + crops upload: server action → REST fetch
- `2e5d1e9` parse multipart with busboy instead of request.formData()
- `18979de` buffer body before busboy (drop Web→Node stream pipe)
- `035f136` size-based batching ≤8 MB (workaround pro 10 MB upstream cap)
- `8eacf89` busboy `defParamCharset: "utf8"` (Czech diacritics in filename)

---

## Další krok (později, ne kritické)

1. **`apt install acl` na VPS** + `setfacl -m u:app:r /var/log/fail2ban-blocklist.tsv`
   → blocklist viewer dostane data z reálného logu místo permission-denied
   hintu. Případně `chmod 644` a edit logrotate `create 644 root root`.
2. **Identifikovat 10 MB upstream cap** — viz pasti níže. Až se najde,
   zvýšit `MAX_BATCH_BYTES` (méně requestů, rychlejší upload).
   Možné kandidáty: OVH proxy/firewall, HTTP/2 INITIAL_WINDOW_SIZE,
   `client_body_buffer_size` interakce.
3. **Cleanup:** unreferenced server actions `uploadFinds`/`uploadCrops`
   v `src/app/admin/files/{finds,crops}/upload-action.ts` můžeme smazat
   — nahradily je REST routy.

---

## Otevřené nápady (nezadané)

- E2E Playwright test pro upload 100+ souborů (regrese guard pro tu
  6-vrstvou cestu, kterou jsme dnes objevili).
- Pre-pass v sync dry-run pro reálné `Location.id` z DB.
- ECharts/Recharts dashboard pro `/admin` přehled.

---

## Historicky (zkráceně)

- **Fáze 1–7 admin track**: passkey/audit, file browser, JSON editor +
  náhled, uploady (originály/crops/maps + reálné fotky darů/lokalit),
  sync trigger s live logem, ID gap detector, sync-needed banner.
- **Sync — rename + auto-prune** (`0b8e214`): admin "set as zaniklá"
  mění locationCode v názvu (mapId zůstává). `phaseMaps` byCode →
  byId → create lookup; `maps.location_renamed` / `maps.location_forked`.
  `phasePrune` auto-mažní orphan location_maps + locations bez `--prune`.
- **Sync-needed banner**: per-scope (finds/maps/meta), shortcut
  `/admin/sync?preset=…`. mtime dirsizes vs `last-sync-success.json`.

### Reverted / nahrazeno

- **Skip filter pro NEEXISTUJE-** (commit `bc00764`): zaniklé lokality
  se mají normálně zobrazovat na `/lokality`. Nahrazeno rename-aware
  lookupem (`0b8e214`).
- **`revalidatePath` v upload actions** (před `80e8457`): masked Server
  Components render error. Nahrazeno client-side `router.refresh()`.
- **Server actions pro upload** (před `c7ad4e7`): RSC encoder choke na
  velkých batchích. Nahrazeno REST `/admin/api/upload/*` přes `fetch()`.

### Známé pasti (drž v hlavě)

- macOS rsync z iCloudu doručuje názvy v NFD; browser posílá NFC. Vždy
  normalizuj obě strany (`.normalize("NFC")`).
- `"use server"` soubory smí exportovat jen `async` funkce. Konstanty
  + typy → `*Types.ts` sourozenec.
- RSC boundary: server komponenta předává klientskému jen `"use
  server"` action, ne libovolnou inline arrow funkci. `confirmTemplate:
  string` s `{n}` placeholderem.
- Iron-session cookie pro admin **musí mít `path=/`**, jinak
  `/api/admin/*` dostává unauth requesty.
- Polling loop musí používat `useRef` pro mutating offset.
- **`revalidatePath()` v server action bundle-uje rerender do RSC
  response.** Když rerender shoří, klient vidí jen masked "Server
  Components render". Pro mutace následované rerenderem listingu
  radši `router.refresh()` na klientu.
- **Server-action RSC encoder choke** na ≥50 file batchích — request
  ani neodešel. Pro file uploady použij **REST POST + fetch()**, ne
  server action. Pod `/admin/api/...` aby dědil nginx 200M cap.
- **`request.formData()` (undici) padá** na velkých Safari multipart
  payloadech "Failed to parse body as FormData". Použij **busboy** přes
  `@/lib/admin/multipart`. **NIKDY** nepoužívej `Readable.fromWeb(body).pipe(busboy)`
  — drop trailing bytes na velkých streamech. Bufferuj přes
  `await request.arrayBuffer()` a pak `busboy.end(buffer)`.
- **busboy default `defParamCharset: "latin1"`** mangluje diakritiku
  v multipart filenamu. Vždy nastav `defParamCharset: "utf8"`.
- **Záhadný ~10 MB body cap** mezi browserem a Next.js (možná OVH
  vrstva nebo HTTP/2 buffer). Workaround: size-based batching ≤8 MB
  per request. Identifikace cap-u zatím nedořešena — viz "Další krok".
- Ubuntu 24.04 nemá `acl` defaultně — `setfacl: command not found`
  → `sudo apt install -y acl` nebo `chmod 644` fallback.
