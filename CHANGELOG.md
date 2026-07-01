# Changelog

Pozoruhodné změny ve Čtyřlístkotéce. Formát volně dle
[Keep a Changelog](https://keepachangelog.com/); projekt zatím nemá
verzovaná vydání (kontinuální deploy z `main`), proto jsou položky
seskupené po datech. Vyčerpávající historie je v `git log` — sem patří
jen to, co stojí za zapamatování. **Každou podstatnou změnu sem přidej**
(pravidlo: docs / changelog / readme se drží aktuální).

## 2026-07

### SEO / dosah (průběžně)
- **Detail nálezu + detail lokality**: self-referencing `canonical` + hreflang
  (cs/en/x-default) v `<head>`, `og:locale`/`og:url`, a **OG/Twitter obrázek**
  (fotka nálezu / náhled mapy, `summary_large_image`) → sdílení na sítích má
  konečně náhledový obrázek. Anonymizované nálezy/lokality zůstávají `noindex`
  bez obrázku. Logika je v `generateMetadata` (helper `src/lib/seo.ts`), takže
  platí i pro každý budoucí nález automaticky. *(Batch 1; dál: sekční stránky,
  JSON-LD, IndexNow + hook v syncu, GSC/Seznam verifikace.)*

## 2026-06

### Přidáno
- **/statistiky — „Nejvíce čtyřlístků na jeden zátah"**: panel s největším
  jedním sběrem (globální série nálezů s mezerou ≤ 15 min); proklik dlaždic
  vede na přesně ten zátah v `/sbirka` (instant-resolution `fromTs`/`toTs`
  filtr, ne celý den).
- **/statistiky — nejdelší série dnů s nálezem**: v řádku přepínačů nad
  heatmapou (počet dní + datum od–do + proklik na první/poslední nález).
- **/statistiky — proklik first→last** u panelů „Nejvíc za…" (6 kalendářních
  + 3 klouzavé) a sekundy u „Nejrychlejších 10/100".
- **/statistiky — neúplné krajní roky**: první a aktuální rok v tempu označené
  (počítá se z méně dní, ne podhodnocené).
- **Domů — „Pole darovaného štěstí"**: pole rozházených pin-čtyřlístků pod
  „Malou omluvou" (rozdané nálezy), spravované v `/admin/donated`.
- **Domů — „První vs poslední čtyřlístek"**: dlaždice prvního i posledního
  nálezu; tlačítko „Celý žebříček" → `/statistiky#top-finds` (rozbalí sekci).
- **Speciální efekty nálezů** (`/admin/special`): `record`/`heavenly`/`hellish`
  k libovolnému ID; „Rekord 🏆" (zlatá + tricolora + trofej/vlajka) provázaný
  napříč detailem, mapou, statistikami i seznamem; #666 „pekelný" styl.
- **Ztracený nález** — pietní vzhled detailu (odbarvené fotky, banner,
  stoupající mizející sprška) + grayscale fotek v `/sbirka`.
- **Anonymizované nálezy v `/sbirka`** — placeholder mapka s „?" rozostřením
  jako na detailu.

### Opraveno / bezpečnost
- **EXIF**: malé „volné" fotky pod prahem konverze se servírovaly s původními
  metadaty (GPS) — teď se vždy stripují.
- **+2h posun** v časech na `/statistiky` (found_at je naivní Prague wall-clock).
- **libssh2** (host) povýšen na `1.11.1-1ubuntu0.25.10.2` — záplata
  CVE-2026-55200 (+ CVE-2026-55199, CVE-2025-15661).
- Deploy maže `.next/cache` před buildem (zrušený build otrávil cache → chybějící
  Tailwind utility v CSS).
- Deploy `concurrency.cancel-in-progress: false` — zrušený build uprostřed
  zanechával rozbitý `.next` (bez `BUILD_ID`), což se projevilo až crash-loopem
  po rebootu (502). Viz `docs/gotchas.md` #5.
- Mobil: „plavání" šířky (overflow-x na `<html>`), výška sparkline grafu.

### Dokumentace
- `docs/deployment.md` + `CLAUDE.md` srovnány se skutečností produkce:
  Ubuntu 25.10 „questing", nativní PostgreSQL 17, ověření `pm2-app` unitu,
  Docker pomocné služby na hostu.
- `docs/admin-overview.md` doplněn o sekce Efekty, Rozdané, QR, Hlasování,
  Návštěvnost, Kontroly, Audit.
- README: spolupráce přešla z Claude Opus 4.8 na **Claude Fable 5** (i v patičce).

---

Starší historie (scaffolding → fáze 1–8, admin track, mapy, statistiky) viz
`git log` a `docs/admin-overview.md`.
