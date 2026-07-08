# Changelog

Pozoruhodné změny ve Čtyřlístkotéce. Formát volně dle
[Keep a Changelog](https://keepachangelog.com/); projekt zatím nemá
verzovaná vydání (kontinuální deploy z `main`), proto jsou položky
seskupené po datech. Vyčerpávající historie je v `git log` — sem patří
jen to, co stojí za zapamatování. **Každou podstatnou změnu sem přidej**
(pravidlo: docs / changelog / readme se drží aktuální).

## 2026-07

### /mapa — bod lokace bez polygonu je vidět i v hustých nálezech
- Lokace bez polygonu (jen středový bod) se ztrácela pod hustým shlukem
  poloprůhledných čtyřlístků — bod byl navíc kreslený *pod* vrstvou nálezů.
  **Body lokací teď v pane nad nálezy** (z-index 560 > 550 canvasu),
  **neprůhledné, s bílým obrysem** (oddělí je od kulatých zelených ikonek).
  Výraznost se **obrací dle výběru**: nevybraný bod je výrazný (najdeš ho),
  vybraný **ustoupí** (poloprůhledný, tenčí obrys) — po zakliknutí hrají prim
  ikonky nálezů + zelený kruh. Žádná oranžová na bodu (bila se se zeleným
  kruhem).
- **Dekorace vybrané polygonless lokace** (`SelectedLocationDecor`):
  - **zelený 5m radiální gradient** (střed výrazný → okraj průhledný) pod
    nálezy — hranice odchýlení; pokryje přesně zelené (≤5 m) nálezy,
  - **jemný amber konvexní obal** amber nálezů (tone 1) pod nálezy,
  - **rose outliery (tone 2) jemně pulzují** nad nálezy (CSS, respekt
    k `prefers-reduced-motion`) — bez obalu, ten by se u vzdálených nafoukl.

### /mapa — vrstva Nálezy už nezůstane skrytá po `?find` prokliku
- Proklik na `/mapa?find=X` schová hromadnou vrstvu Nálezy, aby vynikl jeden
  zvýrazněný marker (záměr). Jenže ten vynucený „off" se **ukládal do
  localStorage**, takže návrat na prostou `/mapa` nechal Nálezy skryté, i když
  mají být defaultně zobrazené. Fix: highlight-driven „off" se **neukládá**
  (ruční zapnutí během highlightu se pořád uloží). Navíc **bump klíče**
  (`mapa.layers.finds` → `.v2`) zahojí prohlížeče, které už mají uložené to
  vadné „false" — spadnou zpět na výchozí zobrazeno.

### Domů — „Náhodný čtyřlístek" se na širokoúzkém okně otočí na šířku
- Showcase fotka vyplňovala 100 % šířky sloupce bez stropu na výšku, takže
  vysoký portrét na FullHD přetekl (vidět půlka). Nově: **vejde-li se
  vzpřímený, nech ho** (4K/vysoká okna beze změny); **nevejde-li se na výšku**
  (široké-krátké okno), **překlopí se na šířku** — pořád **plná šířka** (hrany
  lícují s párem prvního/posledního nálezu nad ním), teď dost nízký, aby byl
  **celý vidět**. Portrét originál se otočí o 90°, landscape originál se ukáže
  ve své **přirozené šířce**. Overlaye (ikony, datum) zůstávají **vzpřímené**,
  crop/lupa se otáčí s fotkou.
- Čistě CSS (per-image `@media (min-width:1280px) and (max-height:…)`, práh
  z rozměrů fota) — **žádný JS, žádné probliknutí**. Za flag `landscapeOnTall`,
  který posílá **jen showcase** → sdílená `ImageGallery` na detailu /sbirka se
  chová **beze změny**. Fullscreen (šetřič) se **neotáčí** (plní se dle výšky).

### /lokality — návrat zpět znovu rozbalí lokalitu
- Rozbalený řádek lokality se zrcadlí do URL (`?open=id,id2`) přes nativní
  `replaceState` (bez reloadu, bez re-renderu ostatních řádků). Po prokliku
  z rozbaleného řádku na detail nálezu / mapu a stisku **Zpět** se ty řádky
  znovu **rozbalí**. SSR čte `?open` → `defaultOpen`; klient ale na (re)mountu
  a při Zpět čte **živou URL** (`isOpenInUrl` + `popstate`), protože router
  cache po Zpět servíruje starý server render — bez toho to bylo „o krok
  pozadu" (rozbalilo se až po reloadu). Bez client-storage (jako filtry).
  `?open` není filtr — nesahá na dotaz.

### /lokality — na mobilu jen ikonky u tlačítek v řádku
- Tlačítka v nerozbalené části řádku lokality (Detail lokality / Zobrazit na
  mapě / Zobrazit nálezy lokality) se pod `lg` scvrknou **jen na ikonku s
  tooltipem** (`title`) — na telefonu se tři textová tlačítka jinak zalamovala
  do několika stísněných řádků. Text se vrací od `lg` (≥1024 px, kde se
  i nejdelší počet „12 494 🍀 (vč. dílčích částí)" + tři tlačítka vejdou na
  řádek) — **velké rozlišení beze změny**. Popisek zůstává `sr-only`, takže
  čtečky ho čtou i u ikonek.

### /lokality — rozbalený detail: náhledy prvního/posledního nálezu
- Rozbalená část řádku lokality přepracována kolem **prvního a posledního
  nálezu**:
  - **Ořezový náhled** (crop) nálezu doleva před popis — **klikatelný na
    detail nálezu** (`/sbirka/{id}`).
  - **Pin v pravém horním rohu** karty → **nález na mapě** (`/mapa?find={id}`).
    Skrytý u anonymizovaných lokalit, aby se neprozradila poloha skrytého
    místa (crop na /sbirka zůstává — self-anonymizuje se).
  - Titulky **„První 🍀 #id"** / **„Poslední 🍀 #id"**.
  - **Odstraněno** (redundantní — je to výš v nerozbalené části): panel
    „Celkem nálezů" a tlačítka „První nález" / „Poslední nález" / „Vše ve
    sbírce". Tlačítka nahrazuje klik na ořez.
- V nerozbalené části **„N nálezů" → „N 🍀"**.
- Crop náhledy prvního/posledního nálezu dodává `listLocations` jedním
  dávkovým dotazem (po foldu rodič/dítě). Uklizeny mrtvé i18n klíče
  (`totalFinds`, `firstFound`, `lastFound`, `firstFindLink`, `lastFindLink`,
  `allInCollectionLink`, `ownVsChildren`).

### /mapa — panel Vrstvy se na mobilu už nepřekrývá s detailem lokality
- Na mobilu se rozbalený panel **Vrstvy** kreslil **za** kartou detailu
  lokality (vyšší z-index) → toggly byly schované. Nově tvoří obě karty
  jeden **flex-sloupec**: Vrstvy se rozbalí **přes celou šířku** a detail
  lokality **odsune pod sebe** (žádný překryv). Sbalený zůstává úzký (w-40),
  takže pilulka „Lokality" vpravo prosvítá skrz (`pointer-events-none` na
  kontejneru, karty si je zapínají zpět). Desktop beze změny — Vrstvy a
  detail zůstávají vedle sebe (flex-řádek). Sjednoceno do jedné responzivní
  karty (dřív se detail renderoval zvlášť pro mobil a desktop).

### Navbar detailu, info ikona na Domů, anon lokality
- **/sbirka/[id] — navbar už se nesmršťuje na úzkou fotku.** Lišta prev/next
  s „Zpět na sbírku" má nově vlastní **komfortní min šířku (768 px)**
  nezávislou na fotce; fotka + mapa + fakta si drží svou (klidně menší)
  šířku. Tím zmizel překryv tlačítka „Zpět na sbírku" přes odkaz na
  předchozí nález u úzkých/nekvalitních fotek. **Široké fotky beze změny** —
  jejich šířka floor stejně převyšuje, takže navbar u nich lícuje s fotkou
  jako dřív. (`photoBox.layoutWidthCss` vedle `widthCss`; odstraněn nefunkční
  `minWidthPx` z `ImageGallery`.)
- **Domů — ⓘ ikona nápovědy k lístečku** přesunuta k **pravému hornímu rohu**
  kartičky pro všechna rozlišení (dřív na mobilu vlevo u špendlíku). Horní
  hrana ikonky lícuje s horní hranou nakloněné kartičky, mezera ~20 px na
  tabletu/desktopu; na úzkém telefonu menší (kartička skoro vyplní šířku,
  plná mezera by ikonu vytlačila mimo obrazovku).
- **/lokality — anonymizovaná lokalita** v rozbaleném detailu nově ukazuje
  **počty podle stavů + první a poslední nález** (nálezy jsou stejně
  dostupné přes „Zobrazit nálezy", každý si drží vlastní anonymizaci na
  /sbirka). Skrytá zůstává jen **identita místa** — přesná poloha, GPS,
  mapa i katastr.

### Počty v hlavičce (/sbirka, /lokality) + „Ukázat nálezy" na /statistiky
- **Počty přesunuty na úroveň hlavního titulku, zarovnané doprava.** Místo
  počtu *vyfiltrovaných* (ten je teď v „Filtr je aktivní" pod filtry) hlavička
  ukazuje **filter-independent** souhrn: **počet lokalit · celkový počet
  nálezů**. Na /lokality navíc **v závorce počet anonymizovaných**. Řádek
  pod titulkem (redundantní) odstraněn. Sdílená komponenta
  `FilterablePageHeader` (obě stránky). Na /sbirka se s počty přesunulo i
  **přesýpací tlačítko** rozbalující „Sbírka se postupně doplňuje".
- **/statistiky — „Top 10 lokalit"**: nové tlačítko **„Ukázat nálezy"** mezi
  „Detail" a „Mapa" v každém řádku → proklik `/sbirka?loc=<id>` (stejně jako
  „Nejlepší den" na Domů, mapa a lokality).

### /lokality sladěno s /sbirka (+ sdílené komponenty)
- **Ikona nápovědy bez kolečka** — borderless je nově **default** v
  `HelpDialog`, takže /sbirka, /lokality i /statistiky vypadají stejně
  (/mapa má vlastní styl). Redundantní override na /sbirka odstraněn.
- **Kaskáda Stát ↔ Město** ve filtru lokalit jako na /sbirka (výběr města
  připne stát, výběr státu zúží města). Města i státy nově berou ze
  **sdíleného `getFilterOptions`** (nese vazbu město→stát).
- **„Zrušit filtry"** přesunuto z toolbaru na **spodek filter-baru** (stejné
  místo jako /sbirka); zachovává řazení, čistí jen filtry.
- **Řádek „Filtr je aktivní — N 🍀 lokalit odpovídá filtru (*popis*)"** pod
  filtry, stejně jako nedávná korekce na /sbirka. Počítá vyfiltrované
  lokality a popisuje filtr (hledání / město / stát). `sort` už nepočítá
  jako filtr (jako na /sbirka).
- **Sjednoceno**: nová sdílená `FilterActiveNotice` (používá /sbirka i
  /lokality) + reuse `buildFilterSummary` a `getFilterOptions`. Oba
  filter-bary zůstávají zvlášť (filtrují jiné entity), ale sdílí tyto kusy.

### Drobné korekce stylu
- **Karta zajímavostí (Domů)**: tlačítko „další fakt" (shuffle) je nově
  **inline za odpočtem času** dole uprostřed karty — v rohu kolidovalo s
  #id (vpravo) i watermark smajlíkem (vlevo). Info ikona (ⓘ) ztratila
  kolečkový rámeček a přesunula se **vlevo vedle špendlíku** na horní hranu
  karty. Dekorativní **čtyřlístek** v levém horním rohu (mobil) je
  **zrcadlově převrácený** (`-scale-x-100`).
- **/lokality — bary stavů**: po rozbalení detailu lokality mají pruhy
  jednotlivých stavů **stejnou délku** nezávisle na šířce štítku stavu
  (grid s fixním sloupcem pro štítek místo flexu).
- **Detail nálezu — vysoké/úzké fotky**: fotka, kterou 70vh height-cap
  scvrkne do úzkého proužku (např. `/sbirka/165` = 739×1600 → ~290 px),
  **uvolní cap až na ~28rem** (nikdy přes native px → žádný upscale), takže
  se zobrazí pohodlně široká a **celý zarovnaný sloupec** (fotka + navigace
  + lokační mapa) se roztáhne s ní. Široké fotky beze změny (jejich
  cap-šířka floor převyšuje). `minWidthPx` v `photoBox` řídí fotku i chrome
  přes jednu `widthCss` (galerie dostává stejnou hodnotu). *(Oprava
  předchozího pokusu, který podlažoval jen chrome → nesoulad fotka vs
  navigace.)*
- **/mapa — scroll hlavičky**: stránka mapy nově **zamyká scroll a skrývá
  patičku** (`:has([data-map-fullscreen])`), takže mapa vlastní celý
  viewport pod sticky hlavičkou. Dřív šlo scrollovat s kurzorem nad
  hlavičkou a Leaflet panes (vysoký z-index) přejely přes ni.

### Odolnost deploye — čtyřlístková obrazovka i pro „rozbitý styl"
- **Detekce rozbitého CSS během deploye.** Když se build zruší mid-flight
  (timeout / superseding push), starý PM2 proces dál servíruje HTML s hashi,
  které přebuild smazal → assety vrací 404 a stránka se vykreslí **bez
  stylů** (nic nespadne, takže `global-error` se nespustí; často je i JS
  mrtvý, takže React guard by se nezhydratoval). Nový **inline nonced
  skript** (`DeployHealthScript`, vzor dle `ThemeScript`) hlídá `error` na
  stylesheetech + probne na `window.load`, jestli platí Tailwind `.hidden`;
  když ne, vykreslí čtyřlístkovou „Web se aktualizuje…" obrazovku a
  auto-reloadne (throttle 20 s, cap 10×) do doběhnutí buildu. Funguje i bez
  živého JS, protože jede přímo ze SSR HTML.
- **Deploy scéna vytažena** z `global-error.tsx` do sdílené `DeployScene`
  (chunk/JS pády = plná animovaná scéna, rozbitý-styl = odlehčený overlay).
- **Timeout deploye 15 → 25 min**, aby pomalý build **doběhl** místo zrušení
  mid-build (což `.next/static` rozbije). Příčina outage 2026-07-08.

### /sbirka — vylepšení filtrů a UX (série)
- **Nadpis** „Sbírka nálezů" → **„Sbírka 🍀"**.
- **Ikona nápovědy** už není v kolečku s rámečkem — jen samotná ikonka.
- **Banner „Sbírka se postupně doplňuje"** je nově **skrytý** za malým
  přesýpacím tlačítkem u „Počet nálezů celkem" (dřív zabíral místo nad
  filtry pořád); rozbalí se kliknutím.
- **Přepnutí jazyka** (CS ⇄ EN) nově **zachová query string** — filtry,
  řazení a hledání na /sbirka (i parametry jiných stránek) přežijí, dřív
  se přepnutím jazyka mlčky vynulovaly.
- **Text „Filtr je aktivní"** nově zní „…N 🍀 odpovídá filtru (*popis*)"
  s lidským popisem aktivních filtrů (např. „datum po 25. 12. 2024",
  „stav Darovaný", „sběr …"). Cíl: po prokliku z „Nejlepší den"/statistik
  uživatel hned vidí, čím je výběr zúžený. Popis je ve sdíleném helperu
  `buildFilterSummary` (použije ho i mapa).
- **Tlačítko „Zobrazit na mapě"** se nově zobrazí **jen když vyfiltrované
  nálezy spadají do jedné mapovatelné lokace** (výslovná lokace s aspoň
  jedním nálezem, nebo výběr, co se do jedné lokace scvrkl). Dřív vedlo
  i na prázdnou/anonymizovanou mapu (anonymní nálezy nemají bod). Po
  prokliku navíc **panel detailu lokality na mapě ukazuje kontext filtru**
  („Zobrazení odpovídá filtru: …"), takže uživatel ví, proč jsou nálezy
  ztlumené. /mapa nově přebírá i `fromTs/toTs` (přesný sběr).
- **Fix highlightu na mapě po prokliku**: filtrový highlight z deep-linku
  měl v painteru absolutní přednost, takže po příchodu z /sbirka klik na
  lokaci nezvýraznil její nálezy („překlikávání nefungovalo"). Nově se
  filtrový highlight „spotřebuje", jakmile uživatel sám klikne lokaci
  (`highlightCleared`), a zvýraznění přejde na kliknutou lokaci — a kontext
  filtru v panelu zmizí, aby netvrdil filtr, který už není vidět.
- **Faceted county v comboboxech**: u každé položky (stát, město, lokalita,
  stav, rok) je nově **počet nálezů, který reaguje na ostatní aktivní
  filtry** — např. po výběru „Darovaný" ukazuje stát/lokalita počty jen
  darovaných. **Nulové možnosti se z nabídky skryjí** (kromě aktuálně
  zvolené). County počítá `getFacetCounts` (každá dimenze vynechá svůj
  vlastní filtr; nálezy dětských lokací se rolují do rodiče, ať sedí, co
  výběr rodiče reálně vrátí).
- **County u toggle „S fotkou daru" a „Skrýt největší lokalitu"** nově
  odpovídají tomu, co se reálně skryje/zůstane vůči aktuálnímu filtru
  (dřív byly statické, nezávislé na filtru).
- **Stav je nově multi-select (AND)**: lze vybrat víc stavů, např.
  „Ztracený" + „Anonymizovaný" → nálezy, které mají **oba** stavy. Nabídka
  ukazuje jen stavy, co s výběrem **koexistují** (co-occurrence county;
  ostatní zmizí). Nativní `<select>` nahrazen checkbox dropdownem
  (`StateMultiSelect`), URL nese opakované `?state=`. Staré single-stav
  deep-linky (`?state=DONATED` ze statistik/Domů) fungují beze změny.
- **Nápověda `/sbirka`** aktualizována dle všech změn (multi-select stavů,
  faceted county + skrývání nulových, tlačítko na mapu jen pro jednu lokaci
  + kontext filtru, „Filtr je aktivní" řádek, přežití filtrů při změně
  jazyka) + nadpis „Sbírka 🍀".
- **Deep-link `?loc=X`** (proklik „Top lokalita" / statistiky / lokality /
  mapa → „Ukázat nálezy") nově **nastaví i dropdowny Stát a Město** podle
  zvolené lokace — stejně, jako když lokalitu vybereš přímo ve filtru.
  Dřív zůstaly na „Všechny" (nekonzistentní). Odvození je klientské
  (URL zůstává čistá `?loc=X`).

### Nejoblíbenější nálezy — ořez místo originálu (Domů + /statistiky)
- Tlačítko „nejoblíbenější" na Domů a leaderboard **„Top 10
  nejoblíbenějších"** na `/statistiky` ukazovaly thumbnail **originální**
  fotky. Teď preferují **ořez čtyřlístku** (stejně jako dlaždice `/sbirka`) —
  ve `getTopFindsWithThumbs` se dotahuje i CROP obrázek a bere se přednostně,
  s fallbackem na primární originál. Jedna změna, obě plochy (home tile
  `limit 3` i tři okna leaderboardu `limit 10`).

### Dark theme — brand-800 dodefinováno + zelené popisky sekcí (celý web)
- **`brand-800` konečně definováno** (v `@theme` i v dark bloku, interpolace
  mezi 700 a 900). Dřív `--color-brand-800` neexistoval: `text-brand-800`
  (odznaky „darováno" / části lokace, aktivní stránkování, „voted" palec)
  padal na zděděnou barvu textu a `bg-brand-800/40` (admin/audit) se počítalo
  jako **průhledné**. Teď mají reálnou tmavou/světlou zelenou (kontrast
  8,9–11,9:1 v obou motivech).
- **„Eyebrow" nadpisy sekcí** (`uppercase tracking-wide`) přebarveny ze šedé
  na **`brand-700`** kvůli konzistenci — nejdřív `/statistiky` (17), pak
  sjednoceno i na **Domů, lokality, `/sbirka` toolbar a `/mapa` sidebar**
  (dalších 13). Zelený akcent jako jinde na webu (hodnoty u nich už zelené
  byly). Kontrast 7,8:1 (světlý) / 10,2:1 (dark). Popisek **„GPS"**
  (`gps-value`, ~175× na `/lokality`) v default tónu je taky zelený — jen
  samotná souřadnice zůstává neutrální `gray-800` (popisek zelený, hodnota
  neutrální). Neutrální **záměrně** zůstávají: muted stavy (jubilejní
  placeholdery), legenda kompasu a datové popisky.

### Dlaždice /sbirka — banner s pinem + lajkem, dark popup na mapě
- **Banner dlaždice** přeskládán: **pin s proklikem na mapu** (`/mapa?find=<id>`,
  stejný odkaz i gate jako v seznamu — `!isAnonymized && coordinates≠null`)
  vlevo, **`🍀 #id`** uprostřed (odkaz na detail), **hlasovací tlačítko** vpravo
  (varianta `default` — pilulka s počtem, sedí na plný podklad líp než plovoucí
  overlay chip). Lajk se tím přesunul z overlaye fotky do banneru. Dlaždice už
  není jeden vnější `<Link>` — pin i lajk jsou **sourozenci** detail-odkazů
  (validní HTML, žádné vnořené `<a>`/`<button>`).
- **Leaflet „highlight" popup v dark theme** (bublina zvýrazněného nálezu na
  `/mapa`) měl natvrdo světlý gradient (`#f0fdf4→#ffffff`) → v tmavém režimu
  svítil jako bílý ostrov. Přidán `[data-theme="dark"]` override: **tmavě zelené**
  pozadí (record varianta **zlaté**) + světlá zavírací „×". Text uvnitř popupu
  přepnut z literálních hex na `var(--color-*)` tokeny, takže se **sám obrací**
  (tmavý na světlém / světlý na tmavém) a světlý motiv zůstává beze změny.

### /sbirka — datum čitelné i v dark theme + zapamatované zobrazení
- **Datum v dlaždici** má teď fixní **světlou zelenou** (`#bbf7d0`) přes inline
  `color` (ne Tailwind třídu): dark theme obrací barevné třídy, takže se
  `text-white` převracel na černou → „tmavé na tmavém". Gradient pod ním je
  fixní tmavý, takže text musí být fixně světlý v obou režimech.
- **Zapamatování zobrazení**: volba **dlaždice/seznam** se ukládá do funkční
  cookie `view` (1 rok), server ji čte jako výchozí → drží se napříč
  návštěvami, bez blikání. **Dlaždice jsou nově výchozí pro všechny** (dřív jen
  telefony přes UA; desktop/tablet měl seznam). Nová cookie doplněna do
  „Ochrana soukromí" (funkční, neslouží ke sledování).

### Dlaždice + čtyřlístková chybová stránka
- **Datum v dlaždici** `/sbirka` je čitelné i na světlých fotkách — silný spodní
  gradient + dvojitý text-shadow, obojí **inline stylem** (Tailwind arbitrary
  `text-shadow` se spolehlivě nekompiloval, takže první pokus nebyl vidět).
- **Dark theme:** smajlík autora v navigaci detailu nálezu (první/poslední nález
  → „snad brzy") dostal `theme-invertible` — ve tmavém režimu je světlý jako
  v patičce (dřív černý na černém, neviditelný).
- **Hlasovací tlačítko** v dlaždici používá `variant="overlay"` (kulatý
  bílý/blur chip, brand barva po hlasování) místo vlastního obalu — čistší.
- **Nová globální chybová stránka** (`src/app/global-error.tsx`) místo ošklivého
  Next defaultu „Application error: a client-side exception…": čtyřlístková
  scéna s animací — houpající se čtyřlístek (mapová ikona), stoupající lístky,
  třpyt ✨, střídající se vtipné hlášky („Sázíme nové čtyřlístky…"). Při chybě
  načtení chunku (typicky **během deploye**) se stránka **sama obnoví** za 4 s
  (pojistka proti smyčce: max 1× za 20 s). Self-contained — vlastní
  `<html>/<body>`, inline styly, žádný Tailwind/next-intl (běží mimo layout).

### Statistiky — kratší TTL cache (cluster prodleva po syncu)
- Po syncu se `/statistiky` občas neobnovila, zatímco hlavní strana ano (např.
  745 vs 740 hledání). Příčina: **PM2 cluster** (2 workeři), každý má vlastní
  in-memory kopii statistik; `revalidateTag("stats")` z pingu dorovná jen
  workera, který ping obsloužil, takže málo navštěvovaná `/statistiky` dojížděla
  na starých číslech druhého workera (stránky jsou `force-dynamic`, jediná cache
  je tedy datová `unstable_cache`). **`STATS_REVALIDATE` sníženo 6 h → 10 min**,
  takže se taková divergence sama srovná do pár minut; běžný případ řeší
  `revalidateTag` okamžitě. (Plné odstranění by chtělo sdílený cache handler
  přes Redis — zatím není zapojený.)

### Sync — nálezy po skupinách (originál před ořezem, vzestupně)
- Protože `/sbirka` teď ukazuje jako náhled **ořez**, ořez vygenerovaný **dřív
  než originál** během syncu způsoboval, že web během importu vypadal rozbitě.
  Sync teď zpracovává každý nález jako **celek** — nejprve originál (zdroj
  `foundAt`), pak ořez — a nálezy jdou **vzestupně podle id**. Ořez se tak nikdy
  neobjeví před svým originálem a nálezy plynule přibývají. Propustnost stejná:
  concurrency 4 (jeden soubor na worker naráz) = stejné „4 soubory naráz" jako
  dřívější dva paralelní proudy `pMap(finds) + pMap(crops)`.

### /sbirka — přeuspořádání dlaždice (mřížka)
- Číslo nálezu přesunuto **nad fotku** jako centrovaný banner „🍀 #123"
  (+ odznak REKORD, pokud jde o rekord).
- **Palec hlasování** přesunut do **pravého horního rohu** fotky.
- **Datum a čas** jako overlay na **spodní hraně** fotky, na střed (bílý text
  na jemném gradientu kvůli čitelnosti).
- Z dlaždice **zmizely GPS, kód lokace i puntík odchylky** od lokace — celý
  spodní popisný banner je pryč (vše zůstává na detailu nálezu). Týká se jen
  mřížky/dlaždic; seznam (list) beze změny. Uklizeny osiřelé importy.

### Statistiky — „Top 10 lokalit" i podle počtu sbírání
- Žebříček „Top 10 lokalit" má nový přepínač **„Podle sbírání"** — kolikrát jsem
  na dané lokalitě byl na čtyřlístkách (počet hledání). V řádku: **počet hledání**
  (sloupec) + **průměrný počet nálezů na hledání** + celkem nálezů; vedle
  přepínače baseline „⌀ nálezů / hledání".
- Sběr (session) = běh nálezů max 15 min od sebe (`STATS_SESSION_GAP_MS`, stejné
  pravidlo jako „Odhadovaná doba sbírání"). Počítá se v `getStatsTopLocations`
  (sub-části se skládají do master lokace jako u „podle počtu"); nový typ
  `LocationSessionPoint` + `topLocationsBySessions` / `avgFindsPerSession`.

### Hlavní strana — širší záplava + výraznější „→ pole"
- **Záplava čtyřlístků** roztažena přes **šířku obsahu stránky** (jak nav/stat
  karty — `inset-0` za sekcí, ne celé okno) a za celý blok darování (nabídka →
  odlétající → pole → počet → hledání). Rozmístění je **rovnoměrné** —
  jittered grid (`buildFlood` 9×7, jeden čtyřlístek na buňku + deterministický
  posun), opacita slábne ke středu kvůli čitelnosti textu.
- Tlačítko **„→ pole"** je **~1,5× větší**, používá **novou mapovou ikonu
  čtyřlístku** (srdíčkové lístky + tmavý obrys + žilky), posunuté níž na svislý
  střed vizualizace, a přibyl mu **třpyt (✨)**.
- Odkrytí/zakrytí pole je **plynulé** — grid-rows `0fr→1fr` animace (+ `inert`
  na skrytém obsahu, aby odkazy nebyly v tab pořadí / a11y stromu).

### Hlavní strana — reorganizace (patička, tagline, pole)
- **„Poslední aktualizace sbírky"** (+ ⓘ založení / poslední backfill) přesunuta
  z hero do **globální patičky** jako druhý řádek. Nový lehký cachovaný
  `getCollectionFreshness` (`queries/home.ts`, tag „stats" → obnoví se po syncu),
  aby patička nemusela tahat celý `getHomePageData` na každé stránce.
- **Tagline** „Veřejná prezentace soukromé sbírky čtyřlístků…" **odstraněn**
  z hlavní strany (popis webu nese `<meta description>`); mrtvý i18n klíč
  `Home.intro` smazán (cs + en).
- **Pole darovaného štěstí** přesunuto ze spodku strany **mezi vizualizaci
  odlétajících čtyřlístků a počet „Komu už putovalo štěstí"**; **defaultně
  skryté**, odkryje ho tlačítko **„→ pole"** na konci vizualizace (dřív kotva
  `#pole` na spodní sekci → teď přepínač, nový klient `DonatedFieldReveal`;
  `DriftSvg` rozdělen na `DriftClovers` + toggle).
- Tím se **nabídka darování (se záplavou)** posunula výš — hned pod fakta v hero.

### /sbirka — v seznamu i mřížce rovnou ořez nálezu
- Náhled nálezu v `/sbirka` (mřížka i seznam) je teď rovnou **ořez** (close-up
  čtyřlístku, `CROP`) místo hlavní fotky — v malém náhledu je čitelnější; celá
  fotka je o klik dál na detailu. Helper `cropVariant` vybírá CROP (fallback na
  originál), data už byla k dispozici (`find.images`). Nahradilo to krátce živý
  hover-náhled ořezu (ten už není potřeba).

### Sync — nálezy bez lokace se po pozdním nahrání map nedorovnaly
- **Příčina:** sync přeskočí **celé** zpracování nálezu, když se jeho foto
  nezměnilo (`mtime`), včetně upsertu `location_id`. Když se udělá sync
  s **chybějícími** lokačními mapami, nálezy dostanou `location_id = null`;
  po nahrání map a dalším syncu se ale fotky nezměnily → přeskočily se →
  lokace se nikdy nedoplnila (např. `/sbirka/837`).
- **Oprava:** nový průchod `reconcileFindLinks` na konci fáze finds znovu
  přiřadí `location_id`/`map_id` z názvu souboru + přítomných map, nezávisle
  na tom, jestli se foto změnilo. **Konzervativní** — jen doplní/opraví, nikdy
  nevynuluje nález, jehož mapa v běhu chybí (mapless/částečný sync tak nesmaže
  lokace). Běží každý ostrý sync (self-healing), loguje `relinked`. Řešení:
  stačí spustit normální `pnpm sync` (bez
  `--force-regen`, žádné překódování fotek). Detail v `docs/sync-workflow.md`.

### Statistiky se po syncu neobnovovaly (cache)
- **Příčina:** `/statistiky` (a statové panely na `/`) cachují agregace přes
  `unstable_cache(tag: "stats", revalidate 6 h)` + ISR stránek. `pnpm sync`
  z Termiusu běží mimo Next runtime a **neinvaliduje nic** (dělal jen IndexNow
  ping), takže se každá sekce obnovila teprve po vypršení vlastního 6h časovače
  — každá v jiný čas → sekce se navzájem i s `/sbirka` (ta je `force-dynamic`,
  čerstvá) neshodovaly. Výpočet je přitom správný: kalendář i „průměrné tempo"
  počítají rok byte-identickým SQL (`EXTRACT(YEAR FROM found_at)`), DB běží
  v UTC. Šlo tedy o **přechodnou staleness**, ne chybu v číslech.
- **Oprava:** sdílený helper `revalidatePublicSurfaces()`
  (`src/lib/revalidate.ts`) = `revalidateTag("stats")` +
  `revalidatePath("/","/sbirka","/statistiky","/lokality","/mapa")`. Volá ho
  admin-UI sync (`syncRunner.ts` — dřív volal jen `revalidatePath`, chyběl
  `revalidateTag`, takže se datová cache statistik nevyčistila ani tam) i nový
  endpoint `POST /api/admin/revalidate` (bearer `REVALIDATE_TOKEN`,
  timing-safe, fail-closed bez tokenu). `pnpm sync` ho na konci ostrého běhu
  pingne přes `127.0.0.1` (`src/lib/revalidatePing.ts`), takže se statistiky
  obnoví **hned** místo čekání na 6h TTL. Bez tokenu no-op; cluster-safe
  (invalidace přes sdílený on-disk `.next/cache`).
- Nový volitelný env **`REVALIDATE_TOKEN`** (viz `.env.example`); detail v
  `docs/sync-workflow.md` → „Revalidace cache po syncu".

### Mapa — velikost ikon nálezů + barevné odlišení odchýlených
- Pod „Nálezy" ve Vrstvách přibyly dva ovladače (sub-řádky vedle „Skrýt
  odchýlené"):
  - **Posuvník „Velikost ikon"** — zvětší/zmenší body nálezů na mapě
    (0,6–2×, výchozí 1× = dosavadní 10 px). Ukládá se v prohlížeči.
  - **Přepínač „Barevně odlišit odchýlené"** (výchozí zapnuto) — body
    dostanou stejné třípásmové barvy (zelená/žlutá/červená) jako v `/sbirka`
    a na detailu nálezu: zelená = na lokaci, žlutá = mimo lokaci ale v lokační
    mapě, červená = mimo všechny mapy. Reaguje na „Skrýt odchýlené" jako dřív
    (žlutá + červená = odchýlené).
- Server tuple `findCoords[4]` se z binárního `deviated` (0/1) změnil na
  **`tone` (0/1/2)** — počítáno **jedním** SQL `CASE`, který znovupoužívá
  stejná pravidla jako `/sbirka` (`locationOffsetToneClass` + `withinMap`
  EXISTS proti `location_maps.image_bounds`), nepočítá se nic znovu. `CASE`
  zkratuje na zelené (běžný případ), takže amber EXISTS běží jen pro menšinu.
- Konstanty velikosti v `constants.ts` (`MAP_FIND_ICON_*`). Nápověda Vrstvy
  (`MapaHelp.sectionLayers`) doplněna o oba ovladače.
- **Nová ikona nálezu** — bod nálezu je teď vykreslený **čtyřlístek** (čtyři
  srdíčkové lístky do „X" s tmavým obrysem a tmavými „žilkami" sbíhajícími se
  ke středu), místo dřívějších čtyř slitých koleček s tmavým jádrem. Kreslí se
  na canvas v `createSprite` (`find-dots-canvas.ts`), jednou předrenderované na
  tón, takže překreslení zůstává rychlé; barvy tónů se nemění.

### Hlavní strana — přepracovaná sekce „darování štěstí"
- Nabídka darování + LinkedIn se přesunula nahoru (ze spodní „malé omluvy")
  do nové **`GiveAwaySection`** nad „Komu putovalo štěstí". Pořadí odshora:
  **záplava čtyřlístků + nabídka + LinkedIn** (bez rámečku/pozadí, ~32
  kolébajících se čtyřlístků) → **putující čtyřlístky s „přistávacím"
  čtyřlístkem → Pole** (kotva `#pole`) → **počet „Komu už putovalo štěstí"** →
  **vyhledávač darovaných** („Dostal jsi čtyřlístek?").
- Dole zbyla jen **„Malá omluva"** (bez nabídky) a pod ní „Pole darovaného
  štěstí" beze změny.
- Uklizen mrtvý kód (starý `DonatedShowcase` + dočasný debug přepínač konceptů).
- Smajlík u nabídky darování zjednodušen `🍀😇💌` → `🍀💌`; svatozář (😇) zůstává
  jen dole u „Malé omluvy".

### Hlavní strana — zrušena sekce „Retrospektiva"
- Odstraněna spodní sekce **„Retrospektiva"** (look-back mřížka napříč roky).
  Uklizen i mrtvý kód: komponenta `retrospective-grid.tsx`, query
  `queries/retrospective.ts`, fetch/import na hlavní straně a celý i18n
  namespace `Retrospective` (cs + en).

### Hlavní strana — panel „Odhadovaná doba sbírání" + centrování Top lokality
- Nad třemi ukazateli je nově **panel přes celou šířku** s **„Odhadovanou
  dobou sbírání"** + průměrným tempem (od počátku sbírání) — stejná část jako
  na `/statistiky`. Vytaženo do sdílené `TimePaceSummary` (statistiky ji
  používá taky; per-year rozpad zůstává jen tam).
- **Fix**: název lokality v panelu „Top lokalita" byl mírně vlevo (kvůli
  `pr-8` kolem proklik tlačítka na detail) → `px-8` (symetrické = zůstane na
  střed, pořád mimo tlačítko).

### Hlavní strana — „Zajímavosti" jako ⓘ popover u lístečku (místo dlaždice)
- Dlaždice **„Zajímavosti o čtyřlístcích"** z řady ukazatelů odstraněna (řada
  je teď 3 sloupce). Její obsah (počet zajímavostí + z toho autorských, počet
  a názvy kategorií) je teď **ⓘ popover v rohu rotujícího lístečku** v heru
  (`CloverFactsInfoButton`) — bez tlačítka „Další" (to má lísteček vlastní).
- **Mrtvý kód uklizen**: `CloverFactsStatCard`, window event
  `CLOVER_FACT_ADVANCE_EVENT` + jeho listener v kartě, i18n klíče `tileNext*`.
- „Naposledy darováno" ukazuje nově **jen datum** (bez času — darování je týž
  den, čas byl šum).

### Hlavní strana — čerstvost sbírky do jedné řádky (+ⓘ) + „naposledy darováno"
- Tři řádky metadat pod úvodem (založení / poslední aktualizace / poslední
  doplnění historických) nahrazeny **jednou řádkou** „Poslední aktualizace
  sbírky … (+N)"; datum založení a poslední backfill se schovaly za **ⓘ
  rozbalení** (nová klientská `CollectionFreshnessNote`).
- Do sekce **„Komu už putovalo štěstí"** přibyla řádka **„Naposledy darováno:
  {datum a čas}"** — reálné datum+čas nálezu (`found_at`) nejnovějšího
  darovaného čtyřlístku (nový `lastDonatedAt` v home query).

### Admin — check „bez EN překladu" s inline editací
- Nové kontroly **„Poznámky nálezů bez EN"** a **„Popisky map bez EN"** ve
  vlastní skupině **Překlady (EN)** na `/admin/checks`. Po syncu nových
  nálezů/map hned ukážou, u kterých chybí anglická varianta.
- **Inline editace:** u každého řádku tlačítko **„pozn.“** otevře CZ/EN editor
  přednastavený českým textem a **prázdným EN** (aby nevznikla nechtěná kopie
  češtiny). Uložení zapíše override a řádek po refreshi zmizí. (Alternativa:
  hromadně v sekci Překlady.)
- Sdílí `collectNotesToTranslate` s exportem, takže počty „bez EN" sedí napříč
  `/admin/checks` i `/admin/translations`.

### Admin — dávkový CZ→EN překlad poznámek (stáhnout/nahrát na /admin)
- Nová sekce **`/admin/translations`** („Překlady"): **stáhne** JSON s českými
  zdrojovými texty poznámek nálezů + popisků map; po přeložení ho **nahraješ
  zpět** — zapíše se jen `en` do override vrstev (čeština dál sleduje název
  souboru / LSP). Ukazuje počty „celkem" a „bez EN".
- **Dvě varianty stažení:** *„Vše (ke kontrole)"* (`?all=1` — i položky, co už
  EN mají, s přiloženým současným `en`, na odhalení nepřeložených CS-kopií) a
  *„Jen nepřeložené"*.
- **Bez SSH/pnpm** — celé přes autentizované admin API (`notes/export` GET
  download, `notes/import` POST). Po importu se veřejné stránky přegenerují.
- **Ochrana soukromí:** export vynechává anonymizované + darované nálezy a
  anonymizované mapy (jejich text se veřejně nezobrazuje → nesmí opustit
  server, CLAUDE.md §6). Ven jde jen text, co už tak visí veřejně.
- Sdílená logika v `src/lib/noteTranslations.ts`.

### Admin — override popisků lokačních map pro web (CZ/EN)
- Doplněk k override poznámek nálezů: na `/admin/files/maps` má **každá mapa**
  tlačítko **„pozn."** s **CZ + volitelnou EN** variantou popisku. Uloží se do
  `data/.admin/map-note-overrides.json` (klíč = MAP_ID) — **mezivrstva jen pro
  zobrazení**, název souboru ani DB řádek se nemění. Přežije rsync i re-sync.
  (`src/lib/mapNoteOverrides.ts` + `files/maps/note-override-action.ts`.)
- **Web**: popisek (figcaption) pod lokační mapou — v **detailu nálezu** i na
  **`/lokality/[mapId]`** — bere přednostně override; bez EN varianty se v EN
  ukáže česky s upozorněním „🇨🇿 In Czech only".
- Sdílené UI: `NoteOverrideButton` se přesunul do `files/_shared/` a bere akci
  + hint jako props (nálezy → `setFindNoteOverride`, mapy → `setMapNoteOverride`).
- Nový `czechOnly` klíč v i18n namespace `LocationDetail` (dřív jen `FindDetail`).

### Hlavní strana — showcase přesně přes kontejner + stavy nahoře i na mobilu
- **Fotka „Náhodný 🍀"** teď vyplní **přesně 100 % kontejneru** (`fill`), takže
  její levá/pravá hrana sedí na levou hranu první a pravou hranu poslední
  fotky (dřív byla o ~8 px užší kvůli nativnímu stropu 1200 px < 1216 px).
  `photoDisplay` má nový `fill`.
- **Indikátory stavů** (StateBadges) jsou teď **nahoře na všech velikostech**.
  Na mobilu dřív skákaly dolů a **kolidovaly s datem/GPS** overlayem vlevo
  dole. Týká se všech fotek s overlay stavy (hlavní strana i detail).

### Hlavní strana — showcase/První-Poslední přes celou šířku + rotace + lupa
- **Fotky „Náhodný 🍀" i „První vs poslední"** teď **vyplní celou šířku
  sloupce** (zrušen výškový strop) — okraje sednou na „Nejoblíbenější".
  Portrét proto vyjde vysoký a spodek se odscrolluje; to je zvolený kompromis
  (velká fotka přes celou šířku > vejít se celá na výšku). `photoDisplay` má
  nový `maxVh: null` = bez stropu.
- **Landscape fotky** se na showcase i u První/Poslední **otáčejí 90° CW na
  výšku** (jako na detailu) — konzistentní orientace.
- **První/Poslední** dostaly **lupu s výřezem** vpravo nahoře vedle liku (jako
  všude): query nově načítá i CROP obrázek (`HomeLatestFind.cropImage`).
- **Panel s počtem nálezů** má místo 3 řádků **2**: velké číslo a pod ním
  „nálezů (X nahraných)" — počet nahraných se přesunul do závorky.
- **Pozn.:** nález s nízkým rozlišením originálu (např. #17844 = 960×1280)
  zůstává užší i na plné šířce — layout ho záměrně neroztahuje nad nativní
  velikost, aby nebyl rozmazaný.

### Hlavní strana — „První vs poslední" jako dvě fotky; pryč titulky
- **Sekce „První vs poslední čtyřlístek"** už není dvojice vodorovných
  dlaždic — jsou to **dvě fotky nálezů vedle sebe** (na mobilu pod sebou),
  vyplňují šířku stránky s mezerou mezi nimi, **bez rámečku**. Nad každou je
  **na střed zarovnaný proklikávací nadpis** (`🍀 #1` vlevo = nejstarší nález,
  `🍀 #<max>` vpravo = nejnovější) mířící na detail. Overlaye nad fotkou
  stejně jako u „Náhodný 🍀": vlevo nahoře proklik na mapu (skryto u
  anonymizovaných), vpravo nahoře **like** (bez lupy), na horní hraně
  indikátory stavů, vlevo dole datum+čas a pod ním GPS. **Bez informací o
  lokalitě.** Výškový strop 80vh (dvě fotky sdílí výšku stránky).
- **Nadpis „Náhodný 🍀 #…"** je nově **zarovnaný na střed** (dřív vlevo).
- **Odstraněn titulek „Zajímavosti"** nad čtyřmi dlaždicemi na hlavní straně
  (a s ním i titulek „První vs poslední…" nad novou sekcí). Šest osiřelých
  i18n klíčů (`highlightsHeading`, `firstVsLatestHeading`, `latestFindDetail`,
  `latestFindShowOnMapShort`, `latestFindAnonymizedLocation`,
  `latestFindNoLocation`) smazáno z `cs.json`/`en.json`.

### Overlaye nad fotkou — brand barva (ladí s tlačítky) + 4K šířka
- **Barva textu/ikon** overlayů nad fotkou (detail nálezu i „Náhodný 🍀") je
  teď **`brand-700`** místo `gray-700` — takže v dark theme svítí **zeleně**
  (ne bíle) a **ladí s tlačítky „Mapa"/„Detail"** nad lokační mapkou. Týká se:
  fullscreen, refresh, pin na mapu, hlasovací tlačítko, lupa, datum+čas, GPS
  (nový `tone="brand"` u `GpsValue`), text o rotaci — a **ID lokace** vlevo
  nahoře nad lokační mapkou.
- **Fotka „Náhodný 🍀"** — výškový strop zvednut 80 → 85vh, aby landscape
  dosáhla plné šířky sloupce i na scaled-down 4K (~1080 CSS px).

### Mobil/responzivita — overlaye pod sebou + výškový strop showcase fotky
- **Datum a čas** + **GPS/rotace** overlay na spodní hraně fotky se už
  **nepřekrývají** — jsou naskládané pod sebou (datum nahoře, GPS/rotace pod
  ním), vlevo dole, na všech velikostech (týká se detailu nálezu i „Náhodný 🍀"
  na hlavní stránce).
- **Fotka „Náhodný 🍀"** už není full-width (portrét přetékal na FullHD) —
  dostala **výškový strop 80 % výšky okna**: na FullHD se vejde celá, na 4K
  zůstává velká (do nativní šířky). (`photoDisplay` má nový `maxVh` param,
  `ImageGallery` prop `maxVh`; `fullWidth` zrušen.)

### Oprava — mazání ořezů míjelo NFD názvy; upload teď nahradí osiřelé
- **Bug:** „Smazat všechny ořezy" smazalo DB CROP řádky, ale fyzické soubory s
  **NFD názvem** (diakritika z macOS, např. `RATIBOŘ`) neodstranilo —
  `safeBaseName` dělá NFC a přímý `fs.rename(NFC)` na NFD souboru hodil ENOENT a
  **tiše přeskočil**. Zůstaly osiřelé soubory, které pak blokovaly upload
  („už existuje"). Opraveno: delete teď používá **`resolveDiskPath`**
  (NFC-necitlivé porovnání), takže odstraní i NFD názvy.
- **Upload ořezů** nově: když soubor „už existuje", ale nález **nemá CROP řádek
  v DB** (= osiřelý soubor), upload ho **přesune do koše a zapíše nový**. Reálný
  synced ořez (má DB řádek) se dál chrání a odmítne. → osiřelé soubory z minulého
  mazání se při novém uploadu samy nahradí.

### Admin — hromadné „Smazat všechny ořezy" u checku celé-fotky
- Nad tabulkou checku „Ořez je celá fotka" je tlačítko **„Smazat všechny
  ořezy (N)"** (s potvrzením). Přesune všechny dotčené ořezy do
  `data/.trash/<ts>/crops/` (obnovitelné) a **smaže jejich `find_images` CROP
  řádky** — nálezy tak čistě zůstanou bez ořezu a z checku zmizí. Akce si
  offendery **re-derivuje serverově** (nemaže dle klientského seznamu), takže
  smaže jen to, co check aktuálně hlásí.
- Workflow: smazat → ořezat externě z originálů → nahrát přes /admin → sync.
  Detekce offenderů je teď sdílená (`wholePhotoCropOffenders`) mezi checkem
  i mazáním.

### Admin — nástroj „Ořezat" (crop dialog) u checku (fáze 2–4)
- U checku „Ořez je celá fotka" má každý řádek tlačítko **„Ořezat"**, které
  otevře **dialog se čtvercovým výběrem** (react-easy-crop — zoom/pan do
  čtverce). Uložení **přeořízne ořez z originálu na serveru**, nahradí soubor
  v `data/crops/` (starý se zálohuje do `data/.trash/`), **regeneruje
  watermarkované WebP** a rovnou aktualizuje `find_images` — změna je na webu
  hned (admin = zdroj).
- **EXIF GPS + datum pořízení se přenáší** z originálu na ořez (přes piexifjs),
  orientace se narovná na 1 (pixely už jsou narovnané). Auto-otočení dle EXIF
  originálu je ošetřené.
- Dialog **naviguje na další nález** z checku; tlačítko **„Přeskočit"** posune
  bez uložení. Ořezané řádky dostanou ✓ (z checku zmizí po přenačtení).
- Nové závislosti: `react-easy-crop` (UI), `piexifjs` (EXIF přenos).

### Admin check „Ořez je celá fotka" — náhledy + kopírování ID (fáze 1)
- Řádky checku teď ukazují **malé náhledy originálu a ořezu vedle sebe** — na
  první pohled vidíš, jestli je ořez skutečný výřez (vypadá jinak) nebo celá
  fotka (vypadá stejně).
- Tlačítko **„Kopírovat ID"** vykopíruje čísla všech dotčených nálezů (po jednom
  na řádek) do schránky — pro dořešení jinde.
- Neužitečné tlačítko „Přejmenovat ořez dle originálu" u tohoto checku skryto
  (zůstává jen u checku na neshodu názvů). Vlastní **„Ořezat" nástroj** přijde
  v další fázi.

### Admin check — „Ořez je nejspíš celá fotka, ne výřez"
- Nový check v `/admin/checks` (skupina „Originály ↔ ořezy") vypíše nálezy, kde
  má **ořez stejný poměr stran jako originál a pokrývá ≥50 % jeho plochy** —
  typicky celá fotka nahraná jako ořez (lupa nad fotkou pak neukáže žádnou
  změnu). Detekce je na **poměru stran + ploše**, ne na přesných rozměrech —
  chytí i zmenšené kopie (např. #13801: ořez 1077×1436 vs originál 1200×1600,
  stejné 3:4, 80 % plochy). Řádek nabídne chipy „Originál →" i „Ořez →".

### Detail nálezu — datum a GPS jako overlaye nad fotkou
- Datum a čas se přesunuly z popisku nad fotkou na **overlay vlevo dole nad
  fotkou**; GPS souřadnice (s přepínáním formátu) na **overlay na střed spodní
  hrany** — stejně jako to má sekce „Náhodný 🍀" na hlavní stránce. Datum je
  pinnuté na Europe/Prague.

### Detail nálezu — „Zpět na sbírku" na řádku navigace, u levého okraje fotky
- Tlačítko je **na stejné lince** jako prev/next navigace (absolutní overlay
  vycentrovaný na baru), zarovnané s **levým okrajem fotky**. Pod `md` se skryje
  a převezme ho „Sbírka" chip v app baru (skok nahoru). Pozn.: na úzkém sloupci
  portrétní fotky se širší text-tlačítko může nepatrně překrýt s „🍀 #předchozí".

### Detail nálezu — „Zpět na sbírku" jako tlačítko + šipky v navigaci
- Zpátky ze samotné **ikony ← na plné tlačítko „Zpět na sbírku"** (vlevo v
  navigačním baru). Od `md` nahoru je v baru; pod `md` se skryje a převezme ho
  kompaktní **„Sbírka" chip v app baru** (skočí nahoru jako na mobilu). Titulek
  „🍀 #číslo" zůstává vycentrovaný (dvě `flex-1` buňky balancují).
- Prev/next navigace dostala **decentní chevrony**: `‹` před „🍀 #předchozí"
  a `›` za „🍀 #další".

### „Náhodný 🍀" — bez rámečku, fotka na plnou šířku
- Titulek sekce i **rámeček karty odstraněny**; fotka teď zabírá **plnou šířku
  stránky** (nový `fullWidth` režim `ImageGallery` obchází výškový cap `min(100%,
  1200px, 70vh)`). Pozn.: u portrétních fotek je box vysoký (poměr stran).
- Klikací nadpis je teď **„Náhodný 🍀 #číslo"**, zarovnaný s levým okrajem fotky.
- Tlačítko „Další náhodný 🍀" zrušeno jako tlačítko → **refresh ikona-overlay**
  v levém horním rohu mezi fullscreen a mapou.
- Info „Mění se každých…" přesunuto z popisku pod fotkou na **overlay na střed
  spodní hrany** fotky (vedle datum-overlaye vlevo dole).

### „Náhodný 🍀" — overlaye nad fotkou jako v detailu
- Sekce na hlavní stránce přepracovaná do stejného stylu jako detail nálezu:
  - **Vote** a **„Na mapě"** jsou teď **overlaye nad fotkou** (vote vpravo nahoře,
    mapa vlevo nahoře vedle fullscreen ikony). „Na mapě" je jen ikona.
  - **„Detail nálezu"** tlačítko pryč — proklik je teď **klikací nadpis
    „🍀 #číslo"**. Vedle něj tlačítko **„Další náhodný 🍀"** (rotace).
  - **Datum a čas** = malý overlay vlevo dole (pinnutý na Europe/Prague, ať SSR
    a klient renderují stejný čas).
  - **Stavy nálezu** (LOST, DONATED, GIGANT, …) = indikátory na středu horní hrany
    fotky, stejně jako v detailu; lost nálezy jsou i tady odbarvené.
  - Kód + MapID lokality odstraněny; titulek sekce „Náhodný čtyřlístek" → „Náhodný 🍀".
- **Anonymizované** nálezy dál bez prokliku na mapu i bez map-indikátoru.

### Oprava — zmizelá fotka v „Náhodný čtyřlístek" na hlavní stránce
- Sekce showcase obalovala fotku do `w-fit` (shrink-wrap) kolem `ImageGallery`,
  jejíž šířka je `min(100%, …px, …vh)`. To je **cyklická závislost šířky** —
  některé prohlížeče ji vyhodnotí jako **nulovou** → box fotky zkolaboval na 0
  a sekce vypadala prázdně (overlaye slité doprostřed). Ověřeno CSS testem:
  `w-fit` → 0×0, explicitní šířka → 640×853.
- Wrapper teď dostává **explicitní šířku** `photoDisplay().widthCss` (stejně jako
  to už dělá detail nálezu), takže `100%` uvnitř galerie má definitní základ.
  Detail nálezu byl OK, protože nikdy `w-fit` nepoužil. Viz [gotcha #8](docs/gotchas.md).

### Oprava — anonymizovaný stav v dark theme (tmavé na tmavém)
- **Purple škála v dark theme byla neúplná** (chyběly odstíny 300/500/700) →
  odznak „Anonymizovaný" (`text-purple-700`) padal na default střední fialovou
  na tmavém pozadí (kontrast **2.19:1**). Doplněna celá škála → **7.92:1**.
- **Overlay „?" u anonymizované mapy** (`text-purple-50`) se v dark theme
  přemapoval na tmavou → tmavý text na tmavém scrimu (**1.17:1**). Label má teď
  pevnou světlou barvu nezávislou na theme → **14.00:1**. (Detail nálezu i
  dlaždice v seznamu.)
- Notice banner nad fotkou (`text-purple-900` na `bg-purple-50`) byl v pořádku
  (**13.58:1**) — neměněn. Ostatní theme (light, leaf) byly celou dobu OK.

### Admin — správa textů bannerů nad fotkou nálezu
- Nová sekce **`/admin/banner-texts`**: editace vysvětlujících pruhů nad fotkou
  nálezu (stavy `LOST` / `ANONYMIZED` / `DONATED` / `GIGANT` / `NO_GPS` /
  `NO_PHOTO` + zlatý odznak rekordu) v **češtině i angličtině**.
- **Override vrstva**, ne přepis překladů: výchozí texty zůstávají v
  `messages/<locale>.json`; vlastní verze se ukládají do
  `data/.admin/banner-texts.json` (přežije rsync i re-sync) a čtou se přímo na
  webu. Uloží se jen text, který se **liší od výchozího** — úprava výchozího
  překladu se tak dál propisuje do bannerů, které sis nepřepsal.
- „Vrátit na výchozí" / prázdné pole override odstraní. Změny se projeví hned
  (detaily nálezů se přegenerují přes `revalidatePath`).

### Admin — odhad kapacity disku, předvyplněné poznámky, méně warningů
- **„Místo na disku"** na `/admin` teď ukazuje **odhad, kolik nálezů se ještě
  vejde** — průměrná stopa nálezu na disku (originál + výřez) promítnutá do
  volného místa. Sken zdrojových adresářů je cachovaný na 30 min (přehled
  zůstává svižný).
- **Dialog „pozn."** (`/admin/files/finds`) se **předvyplní aktuální poznámkou**
  z LSP JSONu; **EN pole dostane český text jako podklad** k přeložení — stačí
  upravovat, ne psát od nuly. (Žádný strojový překlad — jen seed textu k ruční
  úpravě.)
- **Lint**: konzistentně false-positive / čistě stylová pravidla vypnuta
  (`jsx-a11y` interakce na overlay/backdrop, `sonarjs` pseudo-random/hashing/
  regex-styl) — warningů při deploji z ~90 na ~16. Zbytek jsou nízkoobjemové
  advisory (ReDoS triáž, hardcoded-secret false-positives u názvů env
  proměnných), nic z toho neblokuje deploy.

### Opravy — „Bez fotky", middleware, #666
- **Nové public obrázky se 404-ovaly** (`clover-illustration.png` → 404): matcher
  next-intl middleware měl **explicitní seznam** vyloučených souborů a nový
  obrázek v něm nebyl → přesměroval se na `/cs/…` a spadl. Nahrazeno **obecným
  vyloučením obrázkových přípon** (png/jpg/webp/gif/ico/svg/avif) — nové obrázky
  už matcher nepotřebují.
- **„Bez fotky"**: upřesněný text banneru a **pozadí placeholderu `bg-gray-50`**
  místo zeleného gradientu.
- **/sbirka seznam**: proklik na mapu (pin) má teď pozadí `bg-gray-50`.
- **Speciální #666**: fakta lokality pod mapou byla šedá na skoro-černém pozadí
  (nečitelná) — dostala světlou kartu jako mapa nad nimi.

### Admin — override poznámek nálezů pro web (CZ/EN)
- Na `/admin/files/finds` má každý originál tlačítko **„pozn."**, které otevře
  dialog s **CZ + volitelnou EN** variantou poznámky. Uloží se do
  `data/.admin/find-note-overrides.json` — **mezivrstva jen pro zobrazení**,
  název souboru ani LSP JSON se nemění (řeší znaky, které v názvu nejdou —
  dvojtečky, tečky…). Přežije rsync i re-sync.
- **Web**: banner pod fotkou nálezu bere přednostně override; když není EN
  varianta, v EN se ukáže česky s upozorněním „🇨🇿 In Czech only" (jako dosud).
- Nový **filtr „S poznámkou"** v seznamu originálů (nálezy s poznámkou v LSP
  JSONu nebo s overridem).
- Fáze pro lokační mapy (`/admin/files/maps`) zatím ne — dle domluvy později.
  *(Doděláno 2026-07 — viz novější záznam „override popisků lokačních map".)*

### /sbirka — provázané filtry Stát → Město → Lokalita
- Filtry se teď kaskádují (celé na klientu — každá lokalita v options nese
  své město i stát):
  - **Stát** → v comboboxu **Město** jsou jen města zvoleného státu.
  - **Město** → automaticky se doplní **Stát** podle města a zamkne se (nejde
    zvolit jiný stát; odemkne se zrušením města). Konec nesmyslů typu
    „Česko + Dublin".
  - **Lokalita** → nabídka je filtrovaná dle státu i města; výběr lokality
    zpětně doplní její město + stát.
- **Kapitalizace měst**: v comboboxu se zobrazují „Dublin" místo „DUBLIN"
  (hodnota pro filtr zůstává původní, kapitalizuje se jen popisek).

### GPS všude + EN varování u českých poznámek
- **Lokalizace GPS dotažena i do řádkového seznamu /sbirka** (`find-list`) —
  teď jsou S/J/V/Z konzistentně na všech veřejných místech (seznam i detail
  nálezů, seznam i detail lokalit, karty, mapa, homepage).
- **Poznámky jsou jen česky**: strojový překlad by znamenal posílat (i citlivé)
  texty třetí straně — proti pravidlům projektu, a je jich 17k+. Takže v EN
  přibylo nenápadné varování **„🇨🇿 In Czech only — not translated"** pod
  poznámkou nálezu (banner pod fotkou) i pod popiskem lokační mapy.

### GPS souřadnice — lokalizace, oprava mezer, nové formáty
- **Směry se lokalizují**: v CS teď S/J/V/Z (Sever/Jih/Východ/Západ) místo
  N/S/E/W — všude, kde se GPS zobrazuje (detail, karty, mapa, /lokality).
- **Oprava „verbose" formátu**: odstraněny mezery navíc za `°` a `'`
  (`S 49°14'09.870" V 17°40'18.970"`).
- **Nové přepínatelné formáty** (tlačítko u GPS cykluje: Apple → Verbose →
  DDM → DD → UTM):
  - **DDM** (stupně + desetinné minuty): `S 49° 14.164 V 017° 40.316`
  - **DD se znaménkem** (kopírovatelné do Google Maps): `49.236075, 17.671936`
  - **UTM** (WGS84): `33U 694497 5455…` — čistě vypočtené, bez závislostí.
  - Pokryto novými unit testy (`gpsFormat.test.ts`).
- **Český rekord**: notice přesunuto do banneru nad fotkou (zlatý, s pohárem)
  a fotka má **zlatý rámeček** (`goldFrame` u `ImageGallery`) místo šedého.
  Hlavička nad fotkou tím úplně zmizela (vše je na fotce / v bannerech).
- **Darovaný nález** má vlastní vizualizaci — stoupající **dárečky + lístečky**
  (`DonatedOverlay`).
- **Oddělené stoupající ikonky**: každý overlay (duchové / otazníčky / dárečky)
  má teď **jiný seed** pozic i časování, takže se u nálezu s víc stavy
  (např. ztracený + anonymizovaný) nekryjí do jednoho sloupce a čtou se jako
  dva samostatné druhy.

### Detail nálezu — duchové, kombinace stavů, drobné opravy
- **Ztracený nález má teď stoupající duchy** místo lístečků; anonymizovaný má
  otazníčky. Overlaye jsou **nezávislé** — anonymizovaný + ztracený nechá
  stoupat **duchy i otazníčky** zároveň (a bannerů je tam pak víc, každý stav
  svůj).
- **Oprava banneru nad lokační mapkou pro lokality bez polygonu**: dřív hlásil
  „mimo polygon (X m od hrany)", ale žádný polygon tam není — teď „mimo okruh
  5 m od středu lokality (X m od středu)".
- **Text „Bez GPS" banneru** zkrácen na „Čtyřlístek byl utržen i vyfocen, ale
  fotka ztratila/neměla EXIF GPS souřadnice."
- **Sjednocená velikost textu** bannerů: stavové bannery nad fotkou, poznámka
  pod fotkou i popisek pod lokační mapkou jsou teď všechny `text-xs`.
- **Mobilní „Zpět na sbírku"** je hned vedle hamburgeru (bez mezery).
- **Zrušené stavy** (Neutržený / Zaniklá lokalita / Bez lokality) už nejsou
  v comboboxu „Stav" na /sbirka.

### Zrušené stavy nálezů — „Neutržený", „Zaniklá lokalita", „Bez lokality"
- Stavy `NOT_PICKED`, `LOCATION_GONE` a `LOCATION_MISSING` byly zrušeny:
  odebrány z `JSON_STATE_MAP` (sync je přestal přiřazovat) a schované z UI
  (`RETIRED_STATES` filtruje `StateBadges`). „Bez lokality" byla špatná kopie
  „Bez GPS"; zaniklou lokalitu už značí prefix kódu `NEEXISTUJE-` + poznámka.
- **Enum hodnoty i filename tokeny zůstávají** (parsování historických názvů se
  nesmí rozbít), ale **`pnpm sync`** (přes `DEPRECATED_STATES` v konvergenci)
  **smaže existující přiřazení** těchto tří stavů ze všech nálezů. → po nasazení
  je potřeba na VPS spustit `pnpm sync`.

### Detail nálezu — stavové bannery, „Bez fotky" a „Bez GPS", back k okraji
- **Back ikona zarovnaná k levému okraji fotky** (desktop): už neplave u kraje
  stránky, ale sedí na levé hraně vycentrovaného sloupce fotky (přes overlay
  vrstvu, klikací zůstává jen odkaz).
- **Vysvětlující bannery nad fotkou pro další stavy** (stackují se, každý svou
  barvou): **Darovaný** (amber), **Gigant** (emerald), **Bez GPS** (yellow),
  **Bez fotky** (slate) — vedle už existujících Ztracený (šedý) a Anonymizovaný
  (fialový).
- **„Bez fotky"**: placeholder má teď stejnou plochu jako reálná fotka (default
  3:4 portrait, mapa i popis se tomu přizpůsobí) a místo emoji je v něm
  **černobílý vysoký clover** (`/clover.png` grayscale) na gradientu.
- **„Bez GPS"**: pod datem se zobrazí GPS řádek, ale se samými otazníky
  (`??°??′??″N …`) — je vidět, že souřadnice by tu mohly být, jen chybí.

### Detail nálezu — rámeček fotky, stavové bannery, anonymizace
- **Fotka má rámeček jako lokační mapka** (`bordered` u `ImageGallery`).
- **Stavové notice jako banner nad fotkou**: „Ztracený" (šedý, s duchem) a
  „Anonymizovaný" (fialový, barvou jako mělo hlášení o anonymizaci) přesunuty
  z hlavičky do banneru na horní hraně fotky — souměrně k poznámce dole
  (`topBanner` u `ImageGallery`). Sjednocený vzhled.
- **Anonymizované nálezy**: celá sekce „Lokalita" (nadpis + placeholder mapka
  s otazníkem) se u nich už nezobrazuje; info o anonymizaci nese banner nad
  fotkou. Navíc mají vlastní vizualizaci jako „Ztracený" — ale místo lístečků
  stoupají malé fialové otazníčky (`AnonymizedOverlay`).
- **„Zpět na sbírku" méně na očích**: na mobilu je teď jako kompaktní čip
  v horní liště (mezi hamburgerem a přepínači CS/EN, jen na detailu nálezu —
  `MainNav` to pozná z cesty), na desktopu zůstává vlevo v liště detailu, ale
  jen jako nenápadná šipka `←` (nový `variant` u `BackToSbirkaLink`).
- **Klávesy šipek**: `←` / `→` na detailu nálezu skočí na předchozí / další
  nález (`FindKeyNav`; ignoruje psaní do polí a klávesy s modifikátory).
- **Popisná sekce pod mapou má šířku mapy**: dřív `max-w-2xl`, teď stejná šířka
  jako fotka/mapa (`photoBox.widthCss`), takže labely a hodnoty lícují s hranami
  mapky.

### Detail nálezu — šířka fotky/mapy, rotace, poznámka jako banner
- **Mapa se roztáhne na šířku fotky (ne naopak)**: šířka se počítá z rozměrů
  fotky (`photoDisplay` v [src/lib/photoBox.ts](src/lib/photoBox.ts)) jako čistý
  CSS výraz `min(100%, Wpx, 70vh·W/H)` a **stejná hodnota** se použije pro box
  fotky i pro figure lokační mapy — sedí na pixel bez měření v prohlížeči.
  (Oprava předchozí verze, kde jsem chybně zmenšoval fotku místo zvětšení mapy.)
- **Fotky na šířku otočené o 90° doprava**: landscape originály se zobrazí jako
  portrait (přes container-query jednotky + `rotate(90deg)`), takže mapka pod
  nimi není přehnaně široká. Ověřeno, že rotace nedeformuje.
- **Poznámka nálezu jako spodní banner na fotce**: přesunuta z hlavičky do
  `figcaption` na spodní hraně fotky (jako mají lokační mapky). Text poznámky
  nálezu i popisku lokační mapy je v bannerech **vycentrovaný**.

### Detail nálezu — doladění
- **Placeholder rámeček fotky**: box fotky si rezervuje místo z poměru stran
  (`aspect-ratio` + `bg-gray-100`) ještě před načtením obrázku, takže při
  překlikávání předchozí/další nález stránka neposkakuje (dřív nejdřív naskočila
  lokalita s mapou a pak ji fotka odsunula dolů).
- **Šířka fotky = šířka mapky**: fotka i lokační mapa mají teď stejnou pevnou
  šířku (`max-w-2xl`), takže na sebe navazují.
- **PIN „Zobrazit na mapě"** má stejné pozadí jako lupa (bílá/blur místo zelené).
- **Indikátory stavů**: overlay je na desktopu na **středu horní hrany** fotky,
  na mobilu na **středu spodní hrany** (dřív levý dolní roh).
- **Osobní konce sbírky**: u nálezu #1 (bez předchozího) je místo prázdného
  lístku „🍀 #0 jen fyzicky" + smajlík autora; u nejnovějšího „🍀 snad brzy"
  (beze změny). Smajlík už není oříznutý do kolečka.
- **Navigace v lokalitě**: `1.` + „Předchozí" u levé hrany sekce, „Další" +
  poslední u pravé; poslední chip ukazuje **číslo posledního nálezu** (pořadí),
  ne text „Max.".

### Patička
- **Přeorganizováno do čtyř skupin**: (1) `© 2026 Safronova čtyřlístkotéka` +
  podpis autora (smajlík · Safronus · LinkedIn), (2) odkaz **Ochrana soukromí**
  (nahradil tagline „Soukromá sbírka čtyřlístků" v copyrightu), (3) `s asistencí
  Claude Code` **bez uvádění modelu** + odkaz na GitHub repo + číslo buildu
  (počet commitů), (4) počet návštěv. GitHub + build number se přesunuly
  z podpisu autora do části o Claude Code.

### Detail nálezu — hlavička, „Čas a poloha" a fotka
- **Titulek přesunut do lišty „Zpět na sbírku"**: z „Nález #123" je teď
  „🍀 #123", vycentrovaný v horní liště. Po stranách titulku jsou tiché
  navigační odkazy na sousední nálezy — vlevo předchozí („🍀 #122"), vpravo
  další („🍀 #124"). Na začátku sbírky předchozí degraduje na vybledlý lísteček;
  na konci sbírky „další" ukazuje osobní **„🍀 snad brzy"** s malým smajlíkem
  autora — mrknutí, že další čtyřlístky se chystají. Už to nejsou orámovaná
  tlačítka, ale prosté odkazy. Na mobilu titulek s navigací spadne na druhý
  řádek pod „Zpět na sbírku". Přístupný název `<h1>` zůstává „Nález #123" (přes
  `aria-label`).
- **Sekce „Čas a poloha" bez rámu a bez nadpisu**: nadpis je samopopisný, tak
  zmizel; zůstává jen datum a čas bez labelu na střed („pátek 3. července 2026
  v 09:00:50") a GPS na střed s přepínačem formátu. Řádky „Odchylka od lokační
  mapy" (je jako banner nad lokační mapkou) a „Vzdálenost od mapy #00001"
  (zbytečná) odstraněny — a s nimi i rám sekce.
- **Ovládání překryté přes fotku**: „Zobrazit na mapě" je zelená kulatá PIN
  ikonka v levém horním rohu; hlasovací tlačítko je v pravém horním rohu vedle
  lupy pro ořez, stejně vysoké jako lupa (`variant="overlay"` u `VoteButton`);
  **indikátory stavů** (Anonymizovaný / Bez fotky / Gigant …) jsou teď overlay
  v levém dolním rohu fotky (dřív vycentrované v hlavičce).

### Admin / anonymizace
- **Anonymizace lokality se plně propíše do nálezů**: dřív šlo přes admin označit
  mapu lokality jako anonymizovanou, ale přidružené nálezy zůstaly veřejné (jen
  `/admin/checks` to hlásil, nešlo to tam vyřešit). Teď toggle anonymizace mapy
  **kaskádně** (`cascadeMapAnon` → `setFindsAnonymized`) pro všechny nálezy dané
  lokality: **(a)** přejmenuje fotky (pole 5 `NE⇆ANO` v originálu i cropu),
  **(b)** zapíše/odebere find ID v `LokaceStavyPoznamky.json`
  `anonymizace.ANONYMIZOVANE` (s `.trash` zálohou). De-anonymizace revertuje, ale
  jen když žádná jiná mapa lokality není anonymizovaná.
- **Pojistka v syncu**: `phaseMeta` anonymizuje každý nález na lokalitě s
  libovolnou anonymizovanou mapou nezávisle na JSONu — rozbitý/ručně upravený
  JSON nemůže nechat nález veřejně viditelný.
- **Komplexní kontrola v `/admin/checks`**: „Anonymizace lokality — soulad
  názvů a JSONu" ověřuje **tří-cestně** — pro každý nález na lokalitě s
  anonymizovanou mapou musí souhlasit (a) název souboru `+ANO+` **a** (b)
  záznam v `LokaceStavyPoznamky.json` `anonymizace.ANONYMIZOVANE` (DB flag je
  z toho odvozený). Detail u offendera říká, co konkrétně nesedí.
- **Fix tlačítka**:
  - u té kontroly **„Anonymizovat všechny"** — srovná **všechny** nálezy anon
    lokalit do plné konzistence (idempotentně: přejmenuje + doplní JSON, hotové
    přeskočí).
  - „JSON položky bez odpovídajícího názvu souboru" → **„Srovnat +ANO+ v názvech"**
    (nálezy anon v DB/JSONu, ale `+NE+` v názvu). Obě pak stačí dorovnat syncem.

### Detail nálezu — sekce „Lokalita"
- **2-sloupcový layout na desktopu**: fakta lokality (kód, plocha, hustota,
  pořadí) + navigace mezi nálezy **vlevo**, mapa **vpravo** — po capnutí mapy
  zbývalo vedle ní hodně prázdna. Na mobilu se to složí pod sebe (fakta →
  navigace → mapa), jako dřív.
- **Popis lokality už není 2×**: vyhozen z horní tabulky (dlouhý text), zůstává
  jen jako popisek pod mapou.
- **Mapa pinnutá doprava, popis vyplní zbytek**: místo gridu s vycentrovanou
  mapou (mezera vlevo i vpravo) teď flex — mapa má pevnou šířku u pravého kraje
  (`lg:w-[40rem]`), popisný sloupec je přesně „panel minus mapa" (`flex-1`).
  Žádná zbytečná mezera a navigační tlačítka se vejdou na jeden řádek.
- **Kód lokality z tabulky pryč**: je už „zapečený" do watermarku vpravo dole
  v mapce, tak se nad ní neopakuje.
- **Navigace rozdělená na dvě strany**: `1.` + „Předchozí na lokalitě" pinnuté
  **vlevo**, „Další na lokalitě" + `poslední` **vpravo** (`ml-auto` drží pravou
  dvojici u kraje i po zalomení v úzkém sloupci).
- **Nadpis „Lokalita" + `#id` je prvním řádkem popisné sekce**: ne hlavička nad
  celým panelem, ale první řádek levého sloupce — díky `lg:items-start` sedí na
  úrovni horní hrany mapky a nad mapkou tak není žádný prázdný řádek (mapa je
  flush nahoře). Nadpis a číslo jsou vertikálně vycentrované (`items-center`).
- **Nový řádek „Pořadí lokality"**: za hustotou nálezů — kolikátá je lokalita
  v žebříčku podle počtu nálezů (`getLocationFindCountRank`, stejný bucketing
  jako veřejný „Top lokalit", takže číslo sedí s /statistiky) + tlačítko, které
  skočí na `/statistiky#top-locations` a rozbalí/zaměří sekci „Top 10 lokalit"
  (sekce dostala kotvu `id="top-locations"`).
- **Přepracováno na frameless, mapa první (nahrazuje 2-sloupec výše)**: sekce už
  nemá rám. Větší centrovaný nadpis „Lokalita" je nad mapou, mapa je
  vycentrovaná a **číslo lokality** je bold overlay v jejím levém horním rohu
  (`locationBadge`). Popisná část je teď **pod mapou**, zúžená na šířku mapy
  (`max-w-2xl`), takže labely lícují s levou hranou mapky a hodnoty s pravou.
  Navigace mezi nálezy lokality přešla na tichý clover-styl jako horní lišta:
  `1. 🍀 | Předchozí 🍀 | Další 🍀 | Max. 🍀` (vybledlá na krajích řetězu).

### Homepage — kartička „Zajímavosti"
- **„Další zajímavost" skočí na kartu**: tlačítko v dlaždici Zajímavostí je pod
  ohybem, hero kartička nahoře — po kliknutí teď stránka plynule scrolluje ke
  kartě a dá jí focus, aby bylo vidět nově načtený lísteček (i pro čtečky).
- **Kartička roste do šířky, ne do výšky**: fixní `w-72/w-80` → `w-80 sm:w-96
  lg:w-[30rem]`; vedle karty je v hero řádku spousta místa, tak se dlouhé texty
  rozlévají na šířku místo natahování na výšku.
- **Vlastní tlačítko rotace v kartě**: v levém dolním rohu tichá „shuffle"
  ikona (tonální dle varianty, odhalí se na hover) — provede rotaci na místě bez
  čekání na časovač. Skryté na „link" kartách (celá karta je odkaz).

### Homepage — časové značky pod úvodem
- **„Poslední aktualizace sbírky" = čas posledního nahrání, ne posledního
  nálezu**: dřív se zobrazoval `MAX(found_at)` (nejnovější EXIF datum nálezu),
  což neodpovídalo popisku „aktualizace". Teď `MAX(created_at)` — kdy sync
  naposledy zapsal řádek do DB (kdy sbírka na webu naposledy narostla). „(+N
  čtyřlístků)" zůstává.
- **„První čtyřlístek zaevidován" = čas prvního nahrání na web**: analogicky
  `MIN(found_at)` → `MIN(created_at)`. Popisek „zaevidován" teď sedí na to, kdy
  se první lísteček dostal na web, ne na jeho EXIF datum nálezu.

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
- **Vyčištění editačních poznámek z auditu**: do textu 14 faktů se místo
  aplikované úpravy vlila celá doporučující poznámka („Odstranit…",
  „Doporučuji…", „Nahradit…", „raději necitujme" apod.) — byla živě na webu.
  Nahrazeno zamýšleným čistým zněním (text z uvozovek / tělo bez závorky /
  přerámování na debunk). Fakty **80 (Holan)** a **150 (Saint-Exupéry)**, po
  očištění bez vazby na čtyřlístek, odstraněny (sbírka 210 → 208).
- **Dopřeklad EN**: doplněno **67 chybějících anglických překladů** (fakty
  změněné auditem měly zastaralé EN smazané, běžely na CZ fallback). Nyní má
  EN sidecar plných 208 překladů = 1:1 s CZ. Soubory `clover-texts*.json` jsou
  verzované v gitu (výjimka z `/data/` ignoru).
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
