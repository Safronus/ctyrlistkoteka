# Admin track — přehled

Tento dokument je živá záloha kontextu admin rozhraní (`/admin/*`).
Slouží jako pickup point pro Claude Code (i pro tebe) při pokračování
v jiném prostředí. Aktualizuje se při větších změnách.

> Pravidla práce + commit policy v hlavním [CLAUDE.md](../CLAUDE.md).
> Datový model + filename konvence v [docs/data-schema.md](data-schema.md)
> a [docs/filename-convention.md](filename-convention.md).

---

## 1. Hotové fáze

| Fáze | Co je hotové | Klíčové soubory |
| --- | --- | --- |
| **1** Auth | WebAuthn passkey, iron-session (1 h sliding TTL), audit log | `src/lib/admin/{session,credentials,audit}.ts` |
| **2** Browser | Read-only listing pod `data/` + `generated/`, file detail s preview/download | `src/app/admin/files/{page,[scope]/page,[scope]/[name]/page}.tsx` |
| **3** Finds + crops | Drag-drop upload (1000 ve frontě, batch 50), single + bulk delete, EXIF zachován, .trash backup | `src/app/admin/files/{finds,crops}/{upload,delete}-action.ts` |
| **4** Maps | Upload (PNG nebo JPEG bytes), single + bulk delete, detekce duplikátů, replace s name-mismatch confirm, mark-as-nonexistent + restore, popisek editor | `src/app/admin/files/maps/*` |
| **5** JSON editor | LokaceStavyPoznamky.json — 4 sekce v tabech, Zod validace per sekce, atomic write, .trash snapshot | `src/app/admin/json/lokace-stavy-poznamky/*` + `src/lib/admin/jsonSchema.ts` |
| **5b** Hierarchie lokalit | LokaceHierarchie.json — strukturovaný editor (rodič / dítě, max. hloubka 2), Zod validace, referenční kontrola proti DB, atomic write, .trash snapshot | `src/app/admin/json/lokace-hierarchie/*` + `lokaceHierarchieSchema` v `src/lib/admin/jsonSchema.ts` |
| **5c** Textové lístečky | clover-texts.json + .en.json — CRUD rotujících faktů na homepage. List + filter + modal s CZ/EN side-by-side editorem. Zod validace (10 kategorií, 3 source types, 2 vibes, unique id). Atomic write obou souborů + .trash snapshot v lockstepu. Runtime fs.readFile loader v `cloverTexts.ts` se obnovuje per-mtime, takže homepage ihned ukazuje nový obsah. | `src/app/admin/clover-texts/*` + `cloverTextsFileSchema`, `cloverTranslationsFileSchema` v `src/lib/admin/jsonSchema.ts` |
| **6** Reálné fotky | Donation photos (`<id><slot>_DAR[_ANON].<ext>`) + location photos (`<mapa>_reálné foto…`) — drag-drop upload, single + bulk delete, cache invalidation hook | `src/app/admin/files/{donation,location}-photos/*` |
| **7** Sync trigger | `tsx scripts/sync.ts` jako podproces, file-based stav, live log polling, dry-run + ostrý sync s confirm, `--only` filter | `src/app/admin/sync/*` + `src/lib/admin/syncRunner.ts` |

Sync card na home je aktivní; karta JSON vede na náhled (ne rovnou
do editoru). Náhled JSONu má statistiky + find lookup (lokace/stavy/
poznámka per find ID) a anomálie (DAROVANÝ bez poznámky, ve stavu
bez lokace).

## 2. Architektura admin vrstvy

```
Klient (browser)
   │ HTTPS, WebAuthn
   ▼
Nginx (cloak: 404 mimo allowlist, body limit 200 MB pro uploads)
   │
   ▼
Next.js App Router @ PM2 cluster (2 workers)
   │
   ├── Server Actions (FormData, "use server")
   ├── API routes (file streaming, sync stream/start)
   └── File-based state pro cluster-shared věci:
       ├── data/.admin/sync-status.json   ← sync runner watchdog
       ├── data/.admin/logs/*.log         ← per-run sync log
       └── data/.trash/<ts>/<scope>/      ← snapshot na delete/replace
```

### Klíčové bezpečnostní invariants
- Cookie path `=/` (zachycuje i `/api/admin/*`).
- Path traversal: každá cesta jde přes `safeJoin(rootKey, …)`.
- Filename input: `safeBaseName` odmítne `..`, prázdné, dotfiles, NUL, lomítka.
- NFC normalizace všude — rsync z macOS doručuje NFD, browser často NFC.
  Cesta přes `resolveDiskPath` to schová.
- "use server" soubory exportují **jen async funkce**; konstanty/typy
  do `*Types.ts` souborů (memory `feedback_use_server_only_async.md`).
- Funkce nepředávat jako prop přes RSC hranici — jen async actions.
  Místo callbacku posílej template string s `{n}` placeholderem.

### File-based stav místo in-memory
PM2 cluster = 2 workers. Cokoli per-request, co potřebuje sdílet
state mezi workery, jde přes disk:
- `syncRunner.ts` → status JSON + log soubor + watchdog (`kill -0 <pid>`)
- duplicate detection v listingu → readdir + NFC porovnání

## 3. Data flow přehledně

| Akce | Validace (server) | Persist | Audit |
| --- | --- | --- | --- |
| Upload finds/crops/maps | safeBaseName + parseFilename + magic bytes + duplicate check | `atomicWrite` | `file.upload` |
| Delete (single + bulk) | `resolveDiskPath` | `fs.rename` → `.trash/<ts>/<scope>/` | `file.delete` |
| Replace (maps detail) | NFC name-compare s confirm flag, magic bytes | `copyFile` → trash, `atomicWrite` | `file.replace` |
| Rename (mark/restore zaniklé, popisek) | parseMapFilename + segmentace `+` | `fs.rename` | `file.rename` |
| JSON save | Zod `lokaceStavyPoznamkySchema.safeParse` | `copyFile` → trash, `atomicWrite` | `json.update` |
| Sync start | concurrent-run check on disk | spawn child + write status JSON | `sync.start` |

## 4. Veřejný web vs admin — invariants

- `/`, `/sbirka`, `/mapa`, `/statistiky`, `/lokality` zůstávají
  read-only. Žádný kód v admin track nepíše do `prisma` — DB se
  mění jen přes `pnpm sync`.
- Anonymizované nálezy: `find.notes` se nesmí číst přímo, vždy přes
  `anonymize(find)` v `src/lib/anonymize.ts`. Admin to taky respektuje
  (stačí Audit log neukládat poznámky verbatim — ten je v `secure/`).

## 5. Známé gotchas

- **Cookie path** — pokud někdy refaktoruješ session helper, drž
  `path: "/"`. Path scoped na `/admin` rozhodí `/api/admin/file`.
  (memory `feedback_admin_cookie_path.md`)
- **NFC vs NFD** — viz výše. Pokud lookup po readdir nic nevrací,
  začni `n.normalize("NFC")` na obou stranách.
- **Server actions s exported konstantou** — build padá s generickou
  „Application error" runtime, ne na typecheck. Drž jen async funkce.
- **PM2 cluster** — testovat se musí dvouinstance scénář (start sync
  na worker A, watch z B). Watchdog na ESRCH řeší crash workera.
- **Sync map metadata read** v admin listingu = 64 KB read per file,
  cached by mtime (`src/lib/admin/mapAnon.ts`). Když sync přepíše
  všechny PNG, cache se invaliduje sama.

## 6. Úkoly TODO / open questions

(Doplň při dalších změnách. Pokud máš PR/issue tracker, link sem.)

- [ ] PR cleanup pro CONTEXT_BACKUP.txt v repo rootu (gitignore?)
- [ ] Trash management UI (browse + restore + manual purge mimo audit)
- [ ] Passkey management UI (list + remove, teď jen `/admin/setup`)

## 7. Pokračování v jiném prostředí

Viz checklist na konci [CLAUDE.md] sekce 12 + krátký bootstrap:

```bash
git clone https://github.com/Safronus/ctyrlistkoteka.git
cd ctyrlistkoteka
nvm install                 # Node LTS dle .nvmrc / package.json engines
corepack enable && corepack prepare pnpm@latest --activate
pnpm install
cp .env.example .env        # vyplň hesla pro lokální dev
docker compose up -d        # Postgres + PostGIS
pnpm prisma migrate deploy
pnpm dev                    # http://localhost:3000
```

Pro Claude Code v jiném počítači:
1. Repo je portable (GitHub).
2. Tento dokument + `CLAUDE.md` + ostatní `docs/` cestují s repem
   a stačí jako základní kontext.
3. Lokální memory adresář (`~/.claude/projects/<hash>/memory/`) je
   per-stroj. Buď ho zkopíruj přes Dropbox/iCloud/git submodule,
   nebo ho nech vzniknout znovu — tenhle doc + commit history vrátí
   Claude do tématu během pár obratů.
