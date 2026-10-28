# PROGRESS

Záchytný bod pro navázání v nové session. Historie změn je v `CHANGELOG.md`,
tady jen to, co je rozpracované.

## Opravný balíček nálezů („oprava-nalezu“, od 2026-10-28)

Smlouva formátu: desktopové repo `docs/WEB_aktualizace_nalezu.md` (revize 2).
Oprava je SAMOSTATNÝ typ balíčku — balíčky map a nových nálezů se nemění.

### Hotovo
- ✅ F1 analýza + náhled (20b76b5), F2 zápis vše-nebo-nic (d470529) — nasazené.
- ✅ F3 po potvrzení opravy se sám spustí plný sync (bfb76bd, jen lokálně).
- ✅ F4 sync + /admin/checks hlásí víc fotek téhož nálezu; `reconcileFindLinks`
  bere stejný soubor jako zbytek syncu (3f6d3a7, jen lokálně).

### Rozpracováno
- ⏳ Společný test na 31420–31422 (desktop → /admin/import → potvrdit → sync).
  Po něm ověřit /sbirka/3142x: darovaný banner, skrytá poznámka, stejné WebP.
  F3+F4 pushnout AŽ po ověřeném testu.
- ✅ Varování v náhledu BĚŽNÉHO balíčku (jen text) — schváleno, ee93b6f.
- ✅ F5 dokumentace (admin-overview, sync-workflow, CHANGELOG), jen lokálně.

### Zbývá
- Push F3–F5 po ověřeném testu; pak výsledek poslat desktopové session.

## Bezpečnost runtime (od 2026-10-28)

### Hotovo
- ✅ Mac: Node 24.15.0 → 24.22.1 (nvm default), pnpm 10.33.2 přes corepack.
- ✅ `scripts/check-runtime-security.ts` + testy, varování v `deploy.yml`,
  týdenní `runtime-security.yml`, CI `node-version: 24` + `check-latest`,
  `packageManager: pnpm@10.33.2`, docs (`docs/deployment.md`: „Upgrade
  Node.js", „Hlídání bezpečnosti runtime").

### Rozpracováno
- ✅ VPS: Node 24.18.0 → 24.22.1 (CVE-2026-111497) hotový 2026-10-28 —
  unit `pm2-app`, démon i worker ověřeny přes `/proc/<pid>/exe`.
- ✅ Týdenní triáž (`~/.claude/scheduled-tasks/ctyrlistkoteka-dependabot-triage`)
  kontroluje runtime vždy, i bez PR.

### Zbývá
- ❌ Ubuntu 25.10 je od 2026-07-09 EOL → plán upgradu na 26.04 LTS (záloha
  DB, `do-release-upgrade`, PostgreSQL/PostGIS, nginx, PM2, runner, návrat).
  Do té doby týdenní *Runtime security* svítí červeně — schválně.
- Po ověření upgradu: smazat Node 24.18.0 na VPS postupem „Mazání staré
  verze Node".
- Rozšířit kontrolu o mezery: Docker images na hostu (GoatCounter,
  RustDesk), balíčky z repozitářů mimo Ubuntu `-security` (PGDG), verze
  self-hosted runneru (CLAUDE.md §11 „Bezpečnost a aktualizace runtime").
- Dependabot #197 selhal na `postcss@^8.5.32` mladším než jeho karence
  (gotchas #35) — ověřit, že další běh projde.

### Klíčová rozhodnutí
- Deploy na nález jen varuje (nikdy neshodí produkci), týdenní běh selže,
  aby přišel e-mail.
- Zůstáváme na řadě 24; přechod na 26 je samostatná migrace.
- Ven jde jen GET na `nodejs.org/dist/index.json`.

### Další krok
Plán upgradu Ubuntu 25.10 → 26.04 LTS (fáze 4).
