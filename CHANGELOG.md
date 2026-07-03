# Changelog

Pozoruhodné změny ve Čtyřlístkotéce. Formát volně dle
[Keep a Changelog](https://keepachangelog.com/); projekt zatím nemá
verzovaná vydání (kontinuální deploy z `main`), proto jsou položky
seskupené po datech. Vyčerpávající historie je v `git log` — sem patří
jen to, co stojí za zapamatování. **Každou podstatnou změnu sem přidej**
(pravidlo: docs / changelog / readme se drží aktuální).

## 2026-07

### Přístupnost (WCAG AA)
- **Kontrast** na dvou dříve padajících místech (Lighthouse a11y 96 → cíl 100):
  na **/statistiky** labely na světle zeleném `bg-brand-50` / `bg-gray-50`
  (`text-gray-500/400`, ~4,2:1) zvednuty na `gray-600` (~6,6:1) — totals karta,
  „nejrychlejší okno", dlaždice top-nálezů (data), deviation GPS labely
  i placeholdery chybějících jubileí; na **/sbirka**
  disabled tlačítka paginace „← Předchozí / Další →" (`text-gray-700` +
  `opacity-40`) dostala `aria-disabled="true"` — signalizuje disabled stav
  asistenčním technologiím a uplatní WCAG výjimku pro neaktivní ovládací prvky.
  Na **/sbirka** navíc štítek vzdálenosti od hrany AOI (`locationOffsetToneClass`)
  používal `text-amber-600` (3,2:1) — ztmaveno na `amber-700` (5:1); jednou
  změnou se opraví všechny opakující se výskyty napříč nálezy.
- **Klávesové zavírání modálů** (S1082): tři admin modály na custom
  `<div role="dialog">` (QR, QR-PDF, editor Zajímavostí) neměly Esc — přidán
  window-level keydown listener (vzor z veřejného screensaveru). Veřejná část
  už klávesnicově funguje (nativní `<dialog>` + Esc, screensaver). Zbývající
  S1082 nálezy jsou false-positive (statická analýza nevidí nativní/​window Esc)
  → k označení „Safe" v Sonaru.

### Kvalita a bezpečnost (SonarCloud)
- **Napojen SonarCloud** (Automatic Analysis, veřejný projekt) a provedena
  kompletní triage 926 nálezů. Většina „vulnerabilities" jsou kontextové
  false-positive (rating E táhla jediná falešná BLOCKER — `TOKEN_ALPHABET`).
  - **Reálné opravy**: GitHub Actions třetích stran SHA-pinnuty
    (`pnpm/action-setup`, `gitleaks/gitleaks-action`) proti supply-chain
    záměně tagu (S7637); lokální `parseInt` stínící globál přejmenován na
    `parsePositiveInt` v `/mapa` + `/sbirka` (S2137); dvě „obě větve vrací
    totéž" zjednodušeny (`location-popup.ts`, `unlock-code-panel.tsx`, S3923).
  - **False-positive utlumeny** v novém `sonar-project.properties` s doloženým
    odůvodněním (audit trail přímo v repu): Prisma migrace vyloučeny z analýzy
    (31× PL/SQL nález — Postgres DDL čtený jako Oracle), a per-rule ignory pro
    non-krypto SHA-1 (S4790), UI `Math.random` (S2245), iron-session
    `password:` klíč (S2068), `TOKEN_ALPHABET` (S6418), build-time `git` /
    admin `pm2` PATH lookup (S4036) a agentic-path-injection na lokálním
    prep-skriptu (S8707).

### Obsah
- **Oprava rozbité diakritiky** u faktu #21 „Genom jetele": malá písmena
  s diakritikou byla zapsaná jako velká základní (`plazivého`→`plazivEho`,
  `týmu`→`tYmu`, `časopis`→`Casopis` …) — nejspíš artefakt z auditu při přidání
  faktu. Přepsáno na správnou češtinu; sken všech 210 textů potvrdil, že šlo
  o jediný poškozený (91 „miR172" a 186 „iNaturalist" jsou legit CamelCase).
- **Audit pravdivosti „Zajímavostí"**: homepage fakta (`data/meta/clover-texts.json`)
  prošla hloubkovým auditem — web-research + adversariální ověření **všech 102
  faktů**. **51 bylo nepravdivých nebo nedoložitelných** (vymyšlené osoby, muzea,
  rekordy, literární scény, botanické termíny). Aplikováno: **1 fabrikace
  odstraněna** (#100), **46 přepsáno** na ověřené znění se zdroji, **23 přehnaných
  zjemněno**; **27 ověřených** ponecháno. Autorovy BONUS entry (#111, #666 aj.)
  netknuté. Zastaralé EN překlady u změněných id odstraněny (dočasný fallback na
  CS, čeká re-translation). *(66 „pověr" má zvlášť naznačené přerámování — zatím
  neaplikováno.)*

### Výkon
- **Odlehčení homepage payloadu (facts on-demand)**: rotující kartička
  „Drobnosti" už do iniciálního HTML neserializuje celou sadu ~210 faktů —
  pošle se jen náhodný **seed 8 položek**, zbytek si klient dotáhne po
  hydrataci z nového **`/api/clover-facts`** (Cache-Control 5 min). Dataset
  faktů dřív dominoval váze homepage (~396 KB raw / 91 KB gzip HTML). Bez JS
  karta funguje dál (zobrazí seed). Stat dlaždice „Zajímavosti" počítá
  `total/bonus/kategorie` dál server-side, takže beze změny.
- **Obrázky loga (LCP)**: hero i mobilní `clover.png` (`next/image`) měly
  `width={1024}` (zdroj je 1024×1024/692 KB) bez `sizes` → Next servíroval
  velkou variantu pro **98px displej**. PSI (mobil) to hlásil jako **~731 KiB
  k úspoře** a hlavní příčinu **LCP 6,6 s**. Sníženo na reálné fixní rozměry
  (256/128 px, retina 2×) → Next posílá malou WebP variantu. *(Skóre výkonu
  homepage 74; Přístupnost/Doporučené postupy/SEO 100.)*
- **CLS na detailech (mobil i desktop)**: detailní lokační mapy (`<img>`
  s `h-auto w-full`) neměly rozměry → posun layoutu při doloadování (PSI:
  nález CLS 0,16 mobil; lokalita 0,29 desktop). Doplněny `width`/`height`
  z `imageWidth`/`imageHeight` → prohlížeč rezervuje výšku předem. *(Bajtová
  optimalizace obrázků — menší varianty map/náhledů — vyžaduje re-sync ~17k
  obrázků, řeší se zvlášť.)*
- **/sbirka LCP (mobil i desktop)**: náhledy nálezů se všechny lazy-loadovaly
  včetně prvního nad ohybem → PSI hlásil **LCP 3,7 s i na desktopu**
  („nepoužívej lazy pro LCP obrázek"). První řádek (grid ≤4, list ≤3) teď
  `loading="eager"` + `fetchPriority="high"`, zbytek zůstává lazy.
  `FindThumbnail`/`FindCard`/`FindGrid`/`FindList` dostaly `priority` prop.
- **/statistiky doc-latency (SSR cache agregací)**: 10 těžkých agregací
  (časové řady, heatmapa, top lokality, rekordy, série…) se počítalo při
  **každém** requestu → PSI hlásil latenci dokumentu **~1410 ms** (nejhorší
  stránka, Výkon 69). Stránka měla `revalidate = 21600`, ale `force-dynamic`
  layout to přebíjel. Agregace obaleny do `unstable_cache` (revalidate 6 h,
  tag `stats`) → data se cachnou napříč requesty i pod force-dynamic; request
  je cache-hit místo přepočtu. Výsledky jsou serializable (datumy jako ISO
  stringy, jdou i jako RSC props do grafů).
- **/mapa payload — přesnost souřadnic**: polygony (`ST_AsGeoJSON` bez limitu)
  i marker/center souřadnice se serializovaly na **9 desetin** (~0,1 mm).
  Zkráceno na **6** (`ST_AsGeoJSON(l.polygon, 6)` + `ROUND(…, 6)`; ~0,11 m,
  vizuálně identické) → menší HTML (polygony dominují 179 KB gzip). Deviation
  výpočet používá raw geometrii, ne zaokrouhlený výstup → nedotčen. *(Hlavní
  bolest /mapa — LCP 6,5 s — jsou ale externí OSM dlaždice, mimo naši
  kontrolu. Leaflet se mimo /mapa nenačítá — code-split je OK.)*

### Výkon (pokr.)
- **A2 — mapové náhledy na `-thumb`**: lokační mapy se generovaly jen v plné
  velikosti (~800 px) a servírovaly se tak i do 80–200 px náhledů v seznamech
  (~4× overdraw, PSI ~0,5 MB na /lokality). `generateMapWebP` teď vytváří i
  `{sha}-thumb.webp` (256 px; **5 KB vs 33 KB = −85 %/mapa**, backfill i pro
  existující mapy přes maps-only sync), a seznam lokalit (`location-list-row`)
  + náhled v seznamu nálezů (`find-list`) ho používají přes helper
  `mapThumbUrl`. Detail mapy zůstává na plné variantě.

### Přidáno
- **Stránka „Ochrana soukromí"** (`/soukromi`, `/en/soukromi`) + odkaz v
  patičce. Informační povinnost dle čl. 13 GDPR: správce + kontakt, co a proč
  se zpracovává (cookieless GoatCounter, IP v bezpečnostních logách, hashovaný
  otisk u hlasování, OSM dlaždice jako třetí strana), právní základy (oprávněný
  zájem), doby uchování, práva subjektu + ÚOOÚ. Cs/en přes `Privacy` namespace,
  v sitemapě. **Cookie lišta záměrně není** — web nemá sledovací ani reklamní
  cookies (jen funkční `vote_voter_uuid` a `theme` v localStorage), souhlas se
  dle § 89 z. č. 127/2005 Sb. nevyžaduje.

### Přístupnost
- **Kontrast textů** (dle Lighthouse): smysluplné sekundární texty povýšeny na
  `text-gray-600`/`-700`, aby splnily WCAG AA 4.5:1 — časové značky na home,
  popisky měsíců ve sparkline, počet hlasů, datum v retrospektivě, patička
  (build #, „přes", jazyk. poznámka), **hint stat-dlaždice na `bg-brand-50`**
  („X nahraných"), **dlaždice Zajímavosti** („N kategorií"), **poznámka pod
  mapou** („Mění se každých…") a **kartička Drobností** (kategorie + countdown;
  odstraněno kontrast-ubíjející `opacity-70`). Dekorativní `aria-hidden`
  separátory (`·`, `→`) nechány — z kontrastu jsou vyňaté.
- **Pořadí nadpisů**: titulek rotující kartičky Drobností byl `<h3>` hned pod
  `<h1>` (přeskok úrovně) → změněn na `<p>`; je to dekorativní rotující obsah
  v `<aside aria-label>`, takže nadpis do osnovy stránky nepatří. Styl řídí
  atribut `[data-fact-title]`, beze změny vzhledu.

### Automatizace / údržba
- **Dependabot** (`.github/dependabot.yml`): týdenní hlídání npm (Next.js,
  React, Prisma, …) i GitHub Actions + okamžité PR pro bezpečnostní
  aktualizace (po zapnutí „Dependabot security updates" v Settings). PR se
  po CI mergují ručně (kvůli auto-deployi na `main`).
- **Audit kódu — ESLint pluginy**: `eslint-plugin-security`,
  `eslint-plugin-sonarjs` (lokální „SONAR" pravidla), `eslint-plugin-jsx-a11y`
  (plná a11y sada) a `eslint-plugin-no-unsanitized` (DOM-XSS). Naladěno na
  vysoký signál: šumivá maintainability pravidla vypnuta, bezpečnost/a11y/bugy
  jako `warn` (nerozbijí deploy-gate), `no-unsanitized/property` +
  `detect-eval` + `detect-child-process` jako `error`. Aktuálně **0 errorů,
  78 warningů** (backlog k postupnému úklidu).
- **gitleaks** (`.github/workflows/gitleaks.yml`): CI sken celé git historie
  na commitnutá tajemství (klíče, hesla, private keys) — u veřejného repa
  důležité. Zdarma pro osobní/public repo.

### Bezpečnost
- **Next.js 15.5.15 → 15.5.20**: záplata **7 high** CVE (3× DoS — Server Actions /
  connection / image; 3× middleware/proxy bypass; 1× SSRF) + moderaty (XSS v App
  Routeru, cache poisoning RSC). `pnpm audit --prod` klesl ze 17 (7 high) na 4
  (2 low + 2 moderate, jen build-time / admin PDF transitivní). Admin auth u nás
  nejede přes middleware (server-guard + nginx cloak), takže bypass CVE nás bolí
  míň; reálně relevantní byly DoS/SSRF/XSS.
- **Reálné allowlist IP pryč z veřejného repa**: domácí/záložní IP se scrubly
  z trackovaných souborů (`deploy/permaban-whitelist.conf` je teď jen šablona
  s placeholdery, `deploy/README.md` příklady, `docs/gotchas.md`). Skutečné
  adresy žijí výhradně v `/etc/permaban-whitelist.conf` a nginx configu na
  VPS — odkud je skripty reálně čtou, takže se nic nerozbilo. *(Pozn.: v git
  historii zůstávají; jejich odstranění z minulých commitů je samostatný
  destruktivní krok — rewrite historie.)*
- **robots.txt už neprozrazuje `/admin`**: `Disallow: /admin/` odstraněn.
  robots.txt je veřejně čitelný, takže ta řádka fungovala jako ukazatel na
  admin cestu pro kohokoli, kdo dělá průzkum — opak skrývání. Admin drží mimo
  indexy hlavička `X-Robots-Tag: noindex, nofollow, noarchive` (middleware na
  každé `/admin` odpovědi), autentizace (WebAuthn + iron-session) a volitelný
  Nginx IP-allowlist cloak. `/api/` a `/go/` (JSON / QR-redirect, nic citlivého)
  v robots zůstávají kvůli crawl-budget hygieně.

### Změněno
- **Brandová OG karta** `/og` teď používá **autorovu ručně kreslenou
  čtyřlístek-ilustraci** („SAFRONUS" na stonku) + tvářičku jako podpis v
  rohu (místo generovaného geometrického čtyřlístku), na stejném zeleném
  gradientu. Assety `public/og-{clover.png,face.webp}`, normalizované přes
  sharp na PNG a vložené jako data URL.

### SEO / dosah (průběžně)
- **Detail nálezu + detail lokality**: self-referencing `canonical` + hreflang
  (cs/en/x-default) v `<head>`, `og:locale`/`og:url`, a **OG/Twitter obrázek**
  (fotka nálezu / náhled mapy, `summary_large_image`) → sdílení na sítích má
  konečně náhledový obrázek. Anonymizované nálezy/lokality zůstávají `noindex`
  bez obrázku. Logika je v `generateMetadata` (helper `src/lib/seo.ts`), takže
  platí i pro každý budoucí nález automaticky. *(Batch 1.)*
- **Vynucení https** pro canonical/OG/sitemap/robots (`siteBaseUrl()`), i když
  má prod `.env` `http://`.
- **Sekční stránky** (home, sbírka, lokality, mapa, statistiky): canonical +
  hreflang + `og:locale`/`og:url` + **brandová OG karta** (`/og`,
  `ImageResponse`, bezfontová vektorová zelená karta se čtyřlístkem,
  `summary_large_image`). *(Batch 2.)*
- **IndexNow** (`src/lib/indexnow.ts` + `/indexnow-key`): `pnpm sync` po
  přidání nálezů sám pingne Bing / Seznam.cz / Yandex s URL **nově
  vložených** (a neanonymizovaných) nálezů → indexace v hodinách, ne dnech.
  Best-effort (selhání nerozbije sync), localhost/dry-run = no-op.
- **Ověření webmaster nástrojů**: `<meta>` tagy pro Google / Bing / Seznam
  přes env (`GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`,
  `SEZNAM_WMT`) — vykreslí se, jen když je token nastavený. *(Batch 4.)*
- **Strukturovaná data (JSON-LD)** *(Batch 3)*: `WebSite`+`SearchAction` na
  homepage (vyhledávací box v Google, napojený na `/sbirka?q=`),
  `BreadcrumbList` + `ImageObject` (foto, datum, místo, GPS) na detailu
  nálezu, `BreadcrumbList` + `Place`+`GeoCoordinates` na detailu lokality.
  Neviditelný `<script type="application/ld+json">` (nulový vliv na UI);
  bezpečné vložení (escape `<`), anonymizované nálezy/lokality JSON-LD
  nedostanou.

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
