# PROGRESS

Záchytný bod pro navázání v nové session. Historie změn je v `CHANGELOG.md`,
tady jen to, co je rozpracované.

## Bezpečnost runtime (od 2026-10-28)

### Hotovo
- ✅ Mac: Node 24.15.0 → 24.22.1 (nvm default), pnpm 10.33.2 přes corepack.
- ✅ `scripts/check-runtime-security.ts` + testy, varování v `deploy.yml`,
  týdenní `runtime-security.yml`, CI `node-version: 24` + `check-latest`,
  `packageManager: pnpm@10.33.2`, docs (`docs/deployment.md`: „Upgrade
  Node.js", „Hlídání bezpečnosti runtime").

### Rozpracováno
- ⏳ VPS: Node 24.18.0 → 24.22.1 (CVE-2026-111497) — spouští majitel ručně
  podle `docs/deployment.md` → „Upgrade Node.js". Ověření: krok 5 musí
  ukázat `…/v24.22.1/bin/node` u všech workerů i v `dump.pm2`.
- ⏳ Týdenní triáž (`~/.claude/scheduled-tasks/ctyrlistkoteka-dependabot-triage`):
  přidat kontrolu Node bezpečnostních vydání.

### Zbývá
- ❌ Ubuntu 25.10 je od 2026-07-09 EOL → plán upgradu na 26.04 LTS (záloha
  DB, `do-release-upgrade`, PostgreSQL/PostGIS, nginx, PM2, runner, návrat).
  Do té doby týdenní *Runtime security* svítí červeně — schválně.
- Po ověření upgradu: smazat Node 24.18.0 na VPS postupem „Mazání staré
  verze Node".

### Klíčová rozhodnutí
- Deploy na nález jen varuje (nikdy neshodí produkci), týdenní běh selže,
  aby přišel e-mail.
- Zůstáváme na řadě 24; přechod na 26 je samostatná migrace.
- Ven jde jen GET na `nodejs.org/dist/index.json`.

### Další krok
Výstupy kroků 3 a 5 z VPS → ověřit → push této větve na `main` → ověřit
deploy (warning musí zmizet) → ručně spustit *Runtime security*.
