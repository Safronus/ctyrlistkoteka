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
| **3** Finds + crops | Procházení, single + bulk delete (.trash backup), přejmenování, detail. **Nahrávání zrušeno 2026-07-26** — plně ho nahradil ZIP balíček přes `/admin/import` (dvoufázový, s analýzou). Odstraněny `upload-{form,action,types}` pro finds i crops, `api/upload/{finds,crops}` a osiřelý `_shared/materialize.ts`; upload fotek darů a lokalit zůstává (balíček je neřeší). | `src/app/admin/files/{finds,crops}/delete-action.ts` |
| **4** Maps (v2) | **Manifest-driven přehled** (`MapsScopeView`): čte `data/maps/manifest.json` (autoritativní), ne plochý readdir — vnořené v2 mapy pod `Nosné mapy/`. Řádky: číslo, kód, název, město/stát, indikátor + plocha, odznaky anon/zaniklá/potomek/chybí PNG; hledání + filtry. **Read-only** — mapy v2 se přidávají/ruší jako celek přes `/admin/import`. Detail = `MapV2Detail` (metadata z manifestu) + **CZ/EN override popisku pro web** (tlačítko „pozn."; `setMapNoteOverride` bere číslo přes `extractMapId`, funguje pro v1 i v2). Obrázky vnořených PNG přes `statScopeFile` v2 fallback. **Celá v1 mašinérie zrušena 2026-07-26** (upload, replace, přejmenování, editor popisku, „zaniklé", anonymizace přes PNG tEXt, mazání, metadata z názvu) — po přechodu na v2 neměla co obsluhovat; z `data/maps/` zmizelo posledních 207 plochých v1 PNG. S ní padly i `lib/admin/{mapAnon,pngTextEdit,anonCascade}.ts`. Mapy se spravují výhradně přes `/admin/import`. | `src/app/admin/files/maps/*`, `src/lib/admin/mapsV2.ts`, `src/lib/mapNoteOverrides.ts` |
| **5** JSON editor | LokaceStavyPoznamky.json — 4 sekce v tabech, Zod validace per sekce, atomic write, .trash snapshot. Hromadný merge (per sekce i „Celý soubor"); „Celý soubor" bere i partial JSON (chybějící sekce se nechají) a ignoruje `metadata` blok (lenient `lokaceStavyPoznamkyMergeInputSchema`). Před každým mergem/obnovou se ukládá rotující záloha (posledních 10, `data/.admin/backups/lokace-stavy-poznamky/`, `src/lib/admin/lspBackups.ts`); panel na stránce je vypisuje s tlačítkem Obnovit (obnova se sama nejdřív zazálohuje). | `src/app/admin/json/lokace-stavy-poznamky/*` + `src/lib/admin/jsonSchema.ts` |
| **5b** Hierarchie lokalit | **Zrušeno (mapy v2).** Rodič/potomek se teď bere výhradně z v2 manifestu (`potomek` = id_lokace rodiče; `phaseMapsV2` nastaví `locations.parent_id` přímo). Původní `LokaceHierarchie.json` + editor + `phaseHierarchy` byly odstraněny. | — |
| **5c** Textové lístečky | clover-texts.json + .en.json — CRUD rotujících faktů na homepage. List + filter + modal s CZ/EN side-by-side editorem. Zod validace (10 kategorií, 3 source types, 2 vibes, unique id). Atomic write obou souborů + .trash snapshot v lockstepu. Runtime fs.readFile loader v `cloverTexts.ts` se obnovuje per-mtime, takže homepage ihned ukazuje nový obsah. | `src/app/admin/clover-texts/*` + `cloverTextsFileSchema`, `cloverTranslationsFileSchema` v `src/lib/admin/jsonSchema.ts` |
| **5d** Překlady poznámek | Dávkový CZ→EN překlad na `/admin/translations`: **stáhne** JSON s českými zdroji všech poznámek nálezů + popisků map, které nemají EN (GET `notes/export`), po přeložení **nahraje zpět** (POST `notes/import`) → zapíše jen `en` do override vrstev (CS sleduje zdroj), revaliduje veřejné stránky. Export **vynechává anonymizované/darované nálezy a anonymizované mapy** (privacy §6). Ukazuje počty „zbývá přeložit". **Překlad popisku mapy se od 2026-07-27 používá i jako anglický název lokality** — `scripts/sync.ts` zapisuje manifestový `popis` do `location_maps.description` i `locations.display_name` a obě řádky nesou totéž číslo lokace, takže `src/lib/locationNameI18n.ts` dohledá EN podle id. Dotazová vrstva to aplikuje na každé DTO s `displayName`, takže `/lokality`, `/mapa`, řádky `/sbirka`, `/statistiky` i widget na domovské stránce ukážou anglicky bez dalšího zásahu; bez překladu zůstává čeština. | `src/app/admin/translations/*`, `src/app/admin/api/notes/{export,import}/route.ts`, `src/lib/noteTranslations.ts` |
| **6** Reálné fotky | Donation photos (`<id><slot>_DAR[_ANON].<ext>`) + location photos (`<mapa>_reálné foto…`) — drag-drop upload, single + bulk delete, cache invalidation hook. **+ Hromadné přiřazení sdílené fotky (dedup):** nahraj pár fotek (jakýkoli formát → normalizace WebP web+thumb) a přiřaď je rozsahu čísel nálezů. Uloží se jednou (`generated/find-photos/s_<sha1>_DAR[_ANON].webp`, sha1-dedup) a nálezy na ně jen odkážou přes manifest `data/.admin/donation-photo-shares.json` — nekopíruje se. Validace ID proti DB, kolize slotů (přepis jen s potvrzením; per-find soubory se nešoupají), anon = `_ANON` soubor (Nginx 404 + unlock). **Invarianty (`s_` prefix, `_ANON` suffix, plochý adresář) jsou load-bearing — viz paměť.** Chybí: unassign + GC osiřelých souborů. | `src/app/admin/files/{donation,location}-photos/*`, `src/app/admin/api/donation-bulk-assign/route.ts`, `src/lib/donationShares.ts` |
| **7** Sync trigger | `tsx scripts/sync.ts` jako podproces, file-based stav, live log polling, dry-run + ostrý sync s confirm, `--only` filter | `src/app/admin/sync/*` + `src/lib/admin/syncRunner.ts` |

> **Sekce na stránce sady jsou sbalovací a stav si pamatují.** `useRememberedOpen`
> (`src/app/admin/qr/use-remembered-open.ts`) drží otevřeno/zavřeno v `localStorage`
> pod `ctyr.admin.open.<klíč>`; klíče: `drops.stats`, `drops.settings`, `drops.areas`,
> `drops.map`, `drops.xlsx`, `drops.sheet`, `drops.items`. Klientské úložiště je tu
> v souladu s CLAUDE.md — zákaz se týká aplikačního stavu „mimo preferenci UI“ a
> co má kdo složené, je právě preference UI. Hodnota se čte až v efektu, ne při
> renderu: server ji nezná a inicializace z ní by roztrhla hydrataci.

> **Dílna na koláže** (`/admin/collage`) — tentýž generátor, ale s formulářem:
> libovolný rozsah čísel nálezů, výběr vzorů, běh na pozadí (`collageRunner`,
> stejný vzor jako `syncRunner` — stav v souboru, aby ho viděly oba PM2
> workery a nespustily dva běhy naráz), živý log, seznam hotových dávek ke
> stažení. Dávky padají do `generated/collage/vzory/<runId>/`; **ostrá pozadí
> kartiček se přepíšou jen se zvlášť zaškrtnutou volbou**, protože ta jsou
> zmražená na 30 000 schválně. V navigaci není, chodí se tam z dlaždice na
> Přehledu.

### Další admin sekce (mimo původní fáze)

Přibyly v provozu, ve stejném auth + atomic-write + audit patternu:

| Sekce (nav) | Co dělá | Klíčové soubory / config |
| --- | --- | --- |
| **Import balíčku** (`/admin/import`) | Hromadný import jednoho **ZIP „balíčku pro web"** (originály + výřezy + mapy + `meta/LokaceStavyPoznamky.json`) najednou. Dvoufázově: analýza (nic nezapisuje) → přehled → potvrzení → staging souborů + merge LSP. Nezapisuje DB — připraví soubory pro `sync`. Idempotentní (přepis podle ID / MAP_ID, ne duplikace). | `src/app/admin/import/*`, `src/app/admin/api/import/{upload-chunk,analyze,commit,cancel}/route.ts`, `src/lib/admin/importZip.ts` + `importPackage.ts` |
| **QR** (`/admin/qr`) | **Dvě záložky s vlastními počty.** *QR nálezů*: hromadně podle čísel/intervalů (`?ids=` přijímá výběr z `/admin/files`), kód míří na `/n/<číslo>` — trvalá adresa, sken se počítá per nález. Volba hustoty (H/Q/M se skutečnými počty bodů), loga a titulku; velikost v cm s fyzicky kalibrovaným náhledem; ZIP (SVG + PNG 300 DPI + tiskový A4 arch). Seznam je sbalitelný, filtruje se podle čísla, podle poznámky (bez diakritiky) a „skrýt nenaskenované", řadí se podle čísla (Nejnovější/Nejstarší, výchozí nejnovější), má multi-select **obousměrně svázaný s polem čísel** (spec string je jediný zdroj pravdy), zobrazuje LSP poznámku a plné datum s časem, umí vynulovat skeny (per nález i hromadně) a **zrušit kód** (viz gotcha). Čísla mimo seznam se při stažení doplní (idempotentně přes PK). Nastavení + kalibrace v `data/.admin/qr-prefs.json`. *QR stránek*: původní generátor s tokenem `/go/<token>`. SVG fonty jen systémové; rasterizace **jen v prohlížeči** (viz gotcha níže). | `src/app/admin/qr/*`, `src/app/n/[id]/route.ts`, `src/app/go/[token]/route.ts`, `src/lib/admin/qr.ts` + `qrDensity.ts` + `qrPrefs.ts` |
| **Darování ve světě** (`/admin/qr` → záložka *Darování ve světě*) | Sady laminovaných kartiček schovávaných ve veřejném prostoru. Sada (`DropCampaign`) → oblasti (`DropArea`, jedna na město/vesnici, střed + zoom + rádius rozhozu) → kusy (`DropItem`, jeden na nález). Každý kus má **vlastní náhodný token** a landing page `/d/<uuid>`, volitelnou GPS úkrytu, čtyři stavy (Připravený → Vytištěný → Schovaný → Nalezený), člena týmu (`campaign.placers`, zatím Magďul + Pali / Míša / Leonka / Já) a per-kus přepisy textů (nadpis, tělo, bonus, titulek QR, hustota/logo). Prázdné pole = dědí se ze sady (`resolveDropText`, fallback per pole a per jazyk). Formuláře jsou rozdělené do pojmenovaných bloků — **stránka po naskenování** / **vzhled kartičky** / **nápověda** / **tým** — protože nejčastější omyl byl plést texty landing page s tím, co je natištěné. Oblast si umí stáhnout **skutečný obrys města z OSM** (viz gotcha) a náhledová mapa v jejím formuláři ukazuje střed, poloměr i hranici. Mapa úkrytů má **dvě fronty** — vlevo kusy bez pozice, vpravo umístěné (s možností pozici zrušit), takže omylem zaklikaný úkryt jde opravit; značky jsou čtyřlístky obarvené podle stavu. **Rozhoz míří dovnitř hranice**, poloměr je jen záloha; umístěné jde zrušit po jednom i všechny naráz. Nad výběrem v Kusech jde vynulovat skeny (viz gotcha). Landing page ukazuje číslo nálezu a pořadí v sadě („3. ze 111“). Nad QR se tiskne **titulek** a pod ním **podpis** (oba dědí ze sady). **Velikost tisku** taky dědí — u sady výchozí, u kusu volitelný přepis. Tlačítko **Tiskový arch** složí z vybraných (nebo ze všech zobrazených) kusů PDF na A4: řádkové skládání, nastavitelná mezera, rohové značky nebo rámeček a volitelná drobná čísla nálezů vedle kartiček, **volné místo nad a pod kartičkou** (prázdný pruh, který se ustřihne spolu s ní — ořezová linka jde kolem něj) a **text na zadní straně pro oboustranný tisk**: za každou stránku s kartičkami se vloží druhá, zrcadlená podle hrany, kterou tiskárna otáčí papír (delší = obvyklé, přepínač je tam i pro kratší). Text se umístí k hornímu nebo dolnímu okraji, s doladěním ±2 mm, protože se druhý průchod nikdy netrefí přesně. Zadní text se **rastruje v prohlížeči**, ne přes `pdf.text()` — vestavěné fonty jsPDF jsou WinAnsi a udělaly by z „Čtyřlístkotéky“ kaši. V dialogu je **náhled jedné hotové kartičky** ve skutečné velikosti (podle kalibrace `pxPerCm`), včetně volného místa a rubu. Geometrie archu (`src/lib/printSheet.ts`) je čistá a otestovaná — chyba v ní se pozná až po vytištění, otočení a stříhání stovky kartiček. Celá sada se stáhne a nahraje zpět jako **xlsx** — týmový dokument: sloupce jsou v barevných skupinách podle toho, kam text patří, buňky jsou **předvyplněné** tím, co kartička říká teď, a každý nahraný soubor se archivuje do `data/.admin/backups/drop-xlsx/<sada>/` (20 nejnovějších, seznam i re-download přímo v panelu). **Sekce Google Sheets**: vloží se odkaz na tabulku, tlačítko *Zkontrolovat změny* stáhne a **ukáže rozdíl** (kus po kusu, staré → nové), teprve pak *Použít*. Jen čtení, nikdy se nezapisuje zpět. V panelu je i návod na založení a na aktualizaci struktury. **Režim tabulky** předá vládu nad kusy tabulce — včetně **stavu**: *připravený / vytištěný / schovaný* se berou z buňky a odnikud jinud, aby tým viděl přesně to, co napsal. **Nalezený** je jediná výjimka a jde opačným směrem: sken je důkaz, buňka jen záměr, takže naskenovaná kartička zůstane nalezená, i když tabulka tvrdí něco jiného (a naopak „nalezený“ z tabulky se respektuje i bez skenu — někdo to může říct osobně). Nikdy potichu: náhled synchronizace vypíše, u kterých kusů to nastalo. Zpátky do hry se kartička vrátí vynulováním naskenování. pole v adminu zšednou, klikání do mapy i Rozhodit se vypnou, a stejné odmítnutí sedí i na serveru (`sheetOwns`) — zastaralá záložka nesmí zapsat něco, co příští sync smaže. **Automaticky** stahuje systemd timer po 5 minutách přes `POST /api/admin/drops/sync`; endpoint je bez `DROP_SHEET_SYNC_TOKEN` vypnutý a vrací 404. Sloupec **Poznámka týmu** se načítá a ukazuje u kartičky i v seznamech u mapy — je to popis úkrytu, takže na web nikdy nejde. **Pozadí landing page** je koláž z ořezů celé sbírky (`src/lib/collage.ts` + `scripts/generate-collage.ts`, `pnpm collage`): šest variant — mozaika, rozptýlená vrstva, a čtyři tvarové (jednoduchý čtyřlístek, číslo 30 000, kreslený čtyřlístek webu, smajlík). U sady se volí režim (vypnuto / jedna zvolená / podle čísla nálezu / náhodně / rotace po dnech), varianta a síla závoje pod textem. Koláž je **jedna vrstva pozadí** přes celou stránku (`fixed`), síla dle posuvníku. Dvě vrstvy (pozadí + pruh nahoře) se zkoušely a nefungovaly: u tvarových variant se čtyřlístek nakreslil dvakrát — celý vzadu a oříznutý nahoře — a na širokém monitoru byly vidět oba naráz. V nastavení sady je i **seznam hotových koláží ke stažení** v plné velikosti (`src/lib/admin/collageFiles.ts` je stat-ne, ne domněnka — soubory vznikají ručně na serveru, takže co existuje appka opravdu neví). Koláže se generují **s alfou** — kolem tvaru a v mezerách rozptylu je průhledno, takže prosvítá barva stránky (dřív tam byla zapečená světlá výplň, která seděla na jeden motiv). **Mobil má vlastní volbu** (`bgMobileVariant`, **výchozí `BY_FIND`**: Podle čísla — liché mozaika, sudé rozptyl / Mozaika / Rozptýlená vrstva / Bez pozadí; to „podle čísla“ je tady prosté liché/sudé, ne hash jako na desktopu — u dvou možností by hash nic nepřinesl a liché/sudé si ověříš pohledem na kartičku) a **tvarové varianty se na něj nekreslí vůbec** — na výšku se ořežou a skrz průsvitnou kartu z nich je šmouha pod textem. Vykresluje se jedna vrstva pro telefon (`sm:hidden`) a druhá pro širokou obrazovku (`hidden sm:block`); prohlížeč nestahuje `background-image` skrytého prvku, takže telefon stáhne jen svůj soubor. Sada má i **krytí karty** (`bgCardOpacity`, 100 % = plná bílá jako dřív) — pod 100 % koláž prosvítá i skrz kartu. **Rozostření je slabé a škáluje se** (`max(1, (1 − krytí) × 4)` px). Silnější verze mozaiku zprůměrovala na jednolitou plochu — dlaždice mají na telefonu ~5 CSS px a iOS renderuje `backdrop-filter` ještě těžší rukou — takže karta na 55 % vypadala PLNÁ. Na nulu ale jít nejde: změřeno proti skutečné mozaice vychází kontrast těla textu bez rozostření na 55 % jen 3,1:1 a nadpisu 2,1:1, tedy pod WCAG AA. Právě ty extrémy blur odstraňuje. Posuvník proto začíná na 55 % a popisek u něj nese naměřená čísla; doporučené je 80–90 %. **Souhrn sady** má dvě tlačítka k počítání skenů: *Pozastavit počítání* (`scansPaused` — landing page funguje dál, ale nic se nezapíše a nic se nepřepne na FOUND; na testování kartiček a na dobu, než jdou opravdu ven) a *Vynulovat počty* (dvoukrokové, smaže skeny celé sady a FOUND vrací na HIDDEN — stejné tři kroky jako reset nad výběrem). Panel u odkazu ukazuje **odpočet do další kontroly** (odhad z poslední kontroly + 5 min — appka do systemd nevidí; když čas uplyne, řekne „měla už proběhnout“ a od 20 minut nastoupí varování o zaseknuté automatice). **Mapa úkrytů je sbalená** (56rem výšky odsouvalo všechno pod ní) a **náhledy QR v Kusech jsou vypnuté** — přepínač *Zobrazit QR* je nad seznamem a dokud se nezapne, kód se ani nevykresluje, takže odpadnou i dávkové requesty. **Mapa pro tým** (`/tym/<token>`) je jediná veřejně dosažitelná stránka, na které jsou souřadnice úkrytů — zapíná se **per oblast** a stojí na dvou zámcích: náhodná adresa (18 bajtů, `crew_token`) a heslo (`crew_password`, plain text schválně — je to slovo do skupinového chatu, ne přihlášení, a majitel ho musí umět přečíst zpátky). Bez hesla stránka neukáže ani název oblasti; vypnutá nebo přegenerovaná adresa vrací 404, takže *Nový odkaz* = okamžité zneplatnění. Blok je **v řádku oblasti, ne v jejím editačním formuláři**: odkaz i heslo jsou tam vidět rovnou (heslo s okem na skrytí a tlačítkem na zkopírování), stav je binární — buď *Zapnout* s jedním polem na heslo, nebo *Nový odkaz* / *Vypnout* (s potvrzením). Vlastní *Uložit* oblasti se toho nedotýká; dvě ukládací tlačítka v jednom formuláři byla první verze a byla to hádanka, které co uloží. Samotná stránka je na celou obrazovku: mapa vlevo, seznam vpravo (na mobilu pod sebou), nahoře souhrn (kolik má pozici, nalezených, skenů) a **stav synchronizace s tabulkou i odpočet do další kontroly** — „dorazila už moje editace?“ je přesně to, kvůli čemu tým jinak píše majiteli. Seznam nese **celou sadu** včetně nezařazených kusů, ale **souřadnice a značky na mapě jen z téhle oblasti** — odkaz pro Zlín nesmí vydat Ratiboř. U kusu je stav, kdo schoval, poznámka týmu, souřadnice na kliknutí do schránky, proklik na landing page, rozbalovací text kartičky a (za přepínačem) náhled QR — ten se tahá po jednom z `/tym/<token>/qr/<itemId>`, cookie-gated stejně jako stránka, protože sto inline SVG je megabajt HTML, který si nikdo nevyžádal. **Klepnutí do mapy přečte souřadnice** toho místa ve formátu, který bere sloupec GPS ve sdílené tabulce (`formatGpsDecimal`, tedy přesně to, co `parseGps` při importu spolkne) — na jedno kliknutí do schránky. Je to pravítko, ne pero: stránka nikam nic nezapisuje a panel to říká, aby klepnutí nevypadalo jako přesun kartičky. U kusu je i **kompletní text kartičky** (česky, anglicky a bonus; anglická část se staví jen z anglických polí, aby pod nadpisem „Anglicky“ nebyla čeština), **co je natištěné** (titulek nad QR, podpis pod ním, šířka v cm), **historie skenů** (kolikrát, kdy naposledy) a **pořadí v sadě**. Seznam je **seskupený po členech týmu**: každá skupina má svou barvu (barevný pruh u seznamu i prstenec kolem čtyřlístku na mapě, který dál drží barvu stavu), jde **sbalit**, **skrýt** (zmizí i z mapy) a tlačítkem *jen tyhle* nechat jen ji — takže Míša si jedním klikem nechá svoje. Skrytí se vypisuje pod seznamem, aby prázdná mapa nevypadala jako chyba. Z řádku vede **„na mapě“**, které na kartičku zaostří (zoom min. 17, nikdy nezmenšuje); animace se vynechá při `prefers-reduced-motion` a ve skryté záložce, kde by ji `requestAnimationFrame* stejně nedoběhl. **Poznámka týmu je popsaná** (jak tady, tak v adminu v Kusech): stojí vedle nápovědy a nepopsané se ty dvě pletly. Odkaz na sdílenou tabulku se ukáže jen když ho majitel pustí přepínačem v sekci Google Sheets — viz CLAUDE.md §9. Cookie je HttpOnly, odvozená z (token, heslo) — změna hesla odhlásí všechny — a scoped na `path=/tym/<token>`. Deset pokusů o heslo na 10 minut a IP. Route je `noindex`, v `robots.txt` zakázaná a testem držená mimo sitemap. **V režimu tabulky jsou zamčené i výchozí texty sady**, ne jen pole u jednotlivých kusů: sheet je nepřepisuje, ale nese je předvyplněné v každém řádku, takže změna tady udělá z toho sloupce „zastaralý“ a příští sync ho přeskočí (`exportedDefaults` v `dropPlan.ts`) — což je tichá cesta, jak přijít o editace týmu. Zamčená pole mají odznak *z tabulky* a **doopravdy vypadají neaktivně** (viz gotcha o `disabled`). **Řetězec čtyřlístků** je hra přes *podmnožinu* jedné oblasti: vybrané kartičky dostanou pořadí (`drop_items.chain_order`, náhodně nebo podle čísla nálezu, s tlačítkem *Promíchat*) a kdo takovou kartičku najde, uvidí na její landing page tlačítko „Odkrýt nápovědu na čtyřlístek #X“. Ven jde **jen text nápovědy**, nikdy souřadnice ani token té další — prokliknout se řetězem od stolu tedy nejde, každý krok chce fyzicky předchozí kartičku. Když je další kartička už naskenovaná, řekne to; poslední článek řekne, že řetěz končí. Vypnuto per oblast (`drop_areas.chain_enabled`, výchozí false) a vypnutí pořadí nezahodí. Když kus změní oblast (ručně i ze sheetu), `chain_order` se mu **maže** — pořadí platí jen uvnitř své oblasti a jinak by se kus vloudil do cizího řetězu. Admin panel varuje u kartiček bez nápovědy — na těch by řetěz utnul. Logika je čistá a otestovaná v `src/lib/dropChain.ts`. | `src/app/admin/qr/darovani/[id]/*`, `src/app/admin/qr/drop-actions.ts`, `src/lib/admin/{drops,dropVocab,dropXlsx}.ts`, `src/lib/{dropText,dropScan,dropHint,dropChain,crewMap,printSheet}.ts`, `src/app/d/[token]/page.tsx`, `src/app/tym/[token]/*`, `src/app/admin/api/drops/[id]/xlsx/route.ts` |
| **Nastavení** (`/admin/settings`) | Věci, co se dřív měnily jen v kódu. Zatím jedna: **bod, od kterého se měří vzdálenosti nálezů** (dřív `DISTANCE_ORIGIN_LOCATION_ID` v `constants.ts`). Výběr z lokalit, které mají střed; id mimo databázi se nahlásí a nepřepíše se tiše. Čte se přes `getDistanceOriginLocationId()` s cache podle mtime — žádná vzdálenost se neukládá, počítají se za běhu, takže změna je vidět hned. | `src/app/admin/settings/*`, `src/lib/admin/siteSettings.ts`, config `data/.admin/site-settings.json` |
| **Efekty** (`/admin/special`) | Speciální atmosférický efekt na detailu nálezu (`record` / `heavenly` / `hellish`) přiřaditelný k libovolnému ID. „Rekord" je **jeden** (přiřazení jinému ho z předchozího sundá) a táhne i zlatý marker na `/mapa`, kartu na `/statistiky` a odznak v `/sbirka`. | `src/app/admin/special/*`, `src/lib/specialFinds.ts` + `…server.ts`, config `data/.admin/special-finds.json` |
| **Rozdané** (`/admin/donated`) | „Pole darovaného štěstí" pod „Malou omluvou" na homepage. Toggle-seznam **darovaných** nálezů od #22094 výš (starší předcházejí nabídce), nejnovější nahoře; zapnuté se vykreslí jako rozházené pin-čtyřlístky. | `src/app/admin/donated/*`, `src/lib/donatedBoard.ts` + `…server.ts`, config `data/.admin/donated-board.json` |
| **Hlasování** (`/admin/votes`) | Audit + mazání hlasů (single / fingerprint / uuid), tlačítko na kompletní reset. | `src/app/admin/votes/*` |
| **Návštěvnost** (`/admin/visitors`) | Souhrn návštěvnosti webu. | `src/app/admin/visitors/*` |
| **Kontroly** (`/admin/checks`) | Kontroly konzistence dat (anonymizace, EXIF datum, originál ↔ výřez, EXIF GPS bez `NO_GPS`…) + skupina **Překlady (EN)**: poznámky nálezů a popisky map bez anglické varianty, s inline „pozn.“ editorem (CZ + prázdné EN, aby nevznikla kopie). | `src/app/admin/checks/*`, `src/lib/admin/checks.ts`, `src/lib/noteTranslations.ts` |
| **Audit** (`/admin/audit`) | Prohlížeč append-only audit logu (každá mutace + auth event). | `src/app/admin/audit/*`, `src/lib/admin/audit.ts` |

Konfigy „Efekty" a „Rozdané" žijí v `data/.admin/` vedle sync-statusu a
záloh — drobné admin-interní JSONy, ne sbírková data; čte je homepage /
detail / statistiky a po uložení se revaliduje celý strom.

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
| Import balíčku (upload) | `isValidUploadId` + offset + chunk-size cap | chunk `fs.write` na offset do `data/.admin/import-tmp/<id>.zip` | — |
| Import balíčku (commit) | streaming unzip (yauzl), `findIdOf`/`mapIdOf`, `safeBaseName`+`safeJoin` | staré ID/MAP_ID → `.trash`, `atomicWrite` per soubor; LSP přes `mergeWholeFile` | `file.replace` (`scope: import-package`) |
| Sync start | concurrent-run check on disk | spawn child + write status JSON | `sync.start` |
| Darování — xlsx import | `parseDropXlsx` (hlavičky podle názvu, číslo nálezu = klíč, `parseGps`); chybný stav/GPS blokuje celý soubor | jedna `$transaction` nad `drop_items` — buď projde tabulka celá, nebo nic | `settings.update` (`drops: xlsx-import`) |

### Import balíčku pro web — tok

Cíl: nahrát celou dávku nových/změněných dat jedním ZIP místo po scope.
ZIP má v rootu `finds/` (JPG originály), `crops/` (JPG výřezy), `maps/`
(PNG mapy) a `meta/LokaceStavyPoznamky.json` (částečný LSP výřez).

1. **Upload** (client → `upload-chunk`): prohlížeč `crypto.randomUUID()`,
   nakrájí ZIP na **8 MB** bloky a POSTuje je s `?uploadId&offset` (raw
   body). Server je zapisuje na offset do `data/.admin/import-tmp/<id>.zip`
   — obchází ~10 MB truncation cap, stovky MB se poskládají na disku bez
   držení v paměti. `offset=0` soubor vytvoří/zkrátí.
   **Strop balíčku: 4 GB** (`MAX_IMPORT_ZIP_BYTES`, zrcadlené v
   `import-panel.tsx` kvůli rychlému odmítnutí ještě před uploadem). Nic
   v cestě celý soubor nebuffuje, offsety jsou běžná JS čísla, takže limit
   je čistě rozhodnutí — 4 GB je zvolené proto, že nad ním je ZIP64 povinný.
   Reálný strop je místo na disku: temp ZIP, nastagované kopie i WebP, které
   z nich odvodí `sync`, chvíli existují vedle sebe.
2. **Analyze** (`analyze` → `analyzeImportZip`): **read-only** streaming
   průchod (yauzl, `lazyEntries`). Vrací **podrobný přehled**, aby operátor
   viděl, co se z balíčku přečetlo:
   - finds/crops: `{total, +nové, ↻přepis}` **+ konkrétní seznamy ID**
     (které jsou nové vs. přepis; přepis = ID už na disku existuje),
   - mapy: seznam položek `{MAP_ID, kód lokality, popis, nová/přepis,
     soubor}` (parsováno z názvu mapy),
   - nekompletní páry (jen originál / jen výřez), nerozpoznané názvy,
   - LSP: **dry-run merge** proti živému souboru přes sdílený
     `computeWholeFileMerge` (`src/lib/admin/lspMerge.ts`) → **stejný
     per-sekční diff jako JSON editor** (anonymizace/stavy/poznámky/lokace:
     „Beze změny" nebo „Nové klíče / Přidaných ID") + **konflikty poznámek**
     (stejné ID, jiný text, na kterých by se merge přerušil).
   Nic nezapisuje.
3. **Confirm/Cancel** (UI): uživatel vidí přehled. Cancel → `cancel` smaže
   temp ZIP hned (jinak ho po 1 dni sklidí `import-tmp` cron).
4. **Commit** (`commit` → `commitImportFiles(zipPath, onCollision)`):
   streaming zápis každého souboru do `data/{finds,crops,maps}`. Klíčování je
   **podle ID / MAP_ID**, ne podle názvu. Kolize (ID už na disku) řeší volba
   z přehledu: **`overwrite`** (default) přesune starý soubor do
   `.trash/<ts>/<scope>/` a zapíše nový (atomicky, tmp → rename), **`skip`**
   ponechá verzi na disku a nový neimportuje. Nová ID se zapíšou vždy.
   Syrové názvy z disku se drží kvůli NFC/NFD renamu; parsuje se na NFC.
   LSP se pak sloučí přes `mergeWholeFile` (aditivně, s abort na konflikt,
   snapshot do `.trash` + rotující záloha). **Nezapisuje DB.** Temp ZIP se
   smaže při úspěchu i chybě (idempotence → stačí nahrát znovu).
5. **Sync**: sumář odkáže na `/admin/sync`, který teprve zapíše DB a
   vygeneruje WebP.

> **Pozor na koš u velkých přepisů (poprvé 2026-07-21):** import v režimu
> `overwrite` odklidí **každý nahrazovaný soubor** do `data/.trash/<ts>/`.
> Přeimportování celé sbírky (typicky po přejmenování fotek při migraci) tak
> vyrobí jeden bucket velký skoro jako sbírka sama — 21. 7. to bylo **14 GB**
> (11 GB finds + 2,7 GB crops) a bez úklidového cronu tam leželo, dokud si toho
> někdo nevšiml na widgetu „Místo na disku". Po velkém přepisu si ověř, že
> živě existuje soubor ke každému ID z bucketu, a smaž ho ručně — 30denní
> retence je na běžné mazání, ne na kopii celé sbírky.
>
> Ověření porovnává **čísla nálezů** (vše před prvním `+`), takže mu nevadí, že
> se jméno mezi koším a živým stromem liší kódem lokality ani diakritikou:
>
> ```bash
> for s in finds crops; do
>   sudo find /var/ctyrlistkoteka/data/$s -type f -printf '%f\n' | cut -d+ -f1 | sort -u > /tmp/live-$s.txt
>   sudo find <bucket>/$s -type f -printf '%f\n' | cut -d+ -f1 | sort -u > /tmp/trash-$s.txt
>   echo "$s: chybí živě $(grep -F -x -v -f /tmp/live-$s.txt /tmp/trash-$s.txt | wc -l)"
> done
> ```
>
> **Nepoužívej na to `comm -23 <(…) <(…)`.** Při první verzi téhle kontroly
> (2026-07-27) nahlásil 417 falešně chybějících ID — souvislý blok, klasický
> příznak rozejitého merge. `comm` předpokládá vstup seřazený přesně tak, jak
> sám porovnává, a stačí jediný cizí řádek (např. text sudo promptu, který
> spadne do process substitution) a od toho místa je výstup nesmysl. Výše
> použitý `grep -F -x -v -f` porovnává přesnou shodu řetězců a na pořadí
> nespoléhá.
>
> **Známý strop u velkých balíčků (2026-07-27):** commit je **jeden blokující
> request**, který rozbalí všechny položky, a Nginx má na `/admin/`
> `proxy_read_timeout 300s`. Balíček s desítkami tisíc souborů (25 000 nálezů
> = ~50 000 položek) se do pěti minut vejít nemusí a projeví se to jako **504,
> zatímco server dál dobíhá** — stav pak není jednoznačný. Řešení, až na to
> dojde: dát `/admin/api/import/` vlastní `location` blok s dlouhým timeoutem
> v `deploy/nginx.conf.template`. **Nginx nenasazuje CI** — je to ruční krok.
> Po nejasném 504 je bezpečné import zopakovat: je idempotentní podle ID.

Idempotence: opakovaný import stejného balíčku soubory **přepíše podle ID**,
nezduplikuje (to řeší jednorázový problém name-keyed uploadu, kde by změněný
odvozený název vytvořil druhý soubor pro totéž ID).

## 4. Veřejný web vs admin — invariants

- `/`, `/sbirka`, `/mapa`, `/statistiky`, `/lokality` zůstávají
  read-only. **Do sbírkových tabulek** (`finds`, `find_images`,
  `locations`, `location_maps`) nepíše admin nikdy — ty se mění
  výhradně přes `pnpm sync` z filesystemu. Admin vlastní jen své
  postranní tabulky (`votes`, `find_qr_codes`/`find_qr_scans`,
  `drop_*`), které sync naopak nikdy nesahá.
- Anonymizované nálezy: `find.notes` se nesmí číst přímo, vždy přes
  `anonymize(find)` v `src/lib/anonymize.ts`. Admin to taky respektuje
  (stačí Audit log neukládat poznámky verbatim — ten je v `secure/`).
- **Souřadnice úkrytů darovaných kartiček se nesmí dostat na veřejnou
  routu.** `DropItem.lat/lng` je čistě admin údaj: mapa úkrytů, xlsx
  export (auth-gated GET) a — od 2026-08-12, vědomě a na přání majitele —
  **mapa pro tým `/tym/<token>`**, zamčená náhodnou adresou i heslem a
  zapínaná per oblast. Ta výjimka je jediná; nerozšiřuj ji ani na
  `/d/<token>`, ani na `/sbirka/<id>`. Nic jiného. Z celé sady prosakují ven
  jen dvě věci, obě jen text nápovědy: `hintPublished` u kusu
  (`getPublishedDropHint`, na `/sbirka/<id>`) a **řetězec čtyřlístků** —
  landing page naskenované kartičky odkryje nápovědu na tu následující
  (`src/lib/dropChain.ts`). Ne stav, ne token, ne souřadnice, ne kdo
  ji schoval. Kdyby se přidávalo cokoli dalšího na `/sbirka/<id>` nebo
  na `/d/<token>`, projdi tenhle odstavec znovu.

## 5. Známé gotchas

- **Cookie path** — pokud někdy refaktoruješ session helper, drž
  `path: "/"`. Path scoped na `/admin` rozhodí `/api/admin/file`.
  (memory `feedback_admin_cookie_path.md`)
- **NFC vs NFD** — viz výše. Pokud lookup po readdir nic nevrací,
  začni `n.normalize("NFC")` na obou stranách.
- **Server actions s exported konstantou** — build padá s generickou
  „Application error" runtime, ne na typecheck. Drž jen async funkce.
- **`<fieldset disabled>` nic neobarví** — pole uvnitř opravdu nejdou
  ovládat, ale dokud má input vlastní `bg-white`, prohlížeč mu žádný
  „zašedlý" vzhled nedá. Zamčená pole tak vypadala úplně stejně jako
  editovatelná. Proto `INPUT_CLS`/`SELECT_CLS` v `src/app/admin/qr/qr-ui.tsx`
  nesou i `disabled:` variantu; kdyby se konstanty přepisovaly, drž ji.
  A pozor při ověřování: `input.disabled` je v JS **false** i uvnitř
  zakázaného fieldsetu — pravdu řekne `input.matches(":disabled")`.
- **PM2 cluster** — testovat se musí dvouinstance scénář (start sync
  na worker A, watch z B). Watchdog na ESRCH řeší crash workera.
- **Sync map metadata read** v admin listingu = 64 KB read per file,
  cached by mtime (`src/lib/admin/mapAnon.ts`). Když sync přepíše
  všechny PNG, cache se invaliduje sama.
- **QR se rasterizuje VÝHRADNĚ v prohlížeči** (canvas → PNG/PDF).
  Server vrací jen SVG. Je to invariant, ne shoda okolností: titulek QR
  nálezu obsahuje znak 🍀 a VPS nemá barevný emoji font, takže
  serverová rasterizace (dřív `/admin/api/qr-zip` přes sharp/librsvg,
  dnes zrušená) by v PNG vytiskla prázdný čtvereček — a to zrovna
  v dávce určené na kartičky. Nezaváděj zpátky server-side rasterizaci
  QR, dokud v titulku může být emoji.
- **„Zrušený" QR nálezu neznamená rozbitý.** Revoke jen vypne
  započítávání: `/n/<číslo>` pořád přesměruje na detail nálezu (jen bez
  `?ref=qr`) a řádek se přesune do sekce „Zrušené". Kdyby zrušení
  vracelo 404 nebo posílalo na výpis, přestala by fungovat kartička,
  kterou už někdo má doma — a to je přesně to, čemu se celý design
  `/n/<číslo>` vyhýbá.
- **QR nálezu má trvalou adresu** — `/n/<číslo>`, ne minted token.
  Kartička s darovaným čtyřlístkem je fyzická věc v cizích rukou:
  dotisk musí vyjít identicky a starý kód nesmí přestat platit. Kdyby
  se to překlopilo na `/go/<token>`, každé přegenerování by rozdané
  kartičky odpojilo.
- **Kartičky „darování ve světě" naopak token MAJÍ** — a je to schválně.
  `/n/<číslo>` prozradí číslo nálezu už z natištěného QR; u kusu
  schovaného v parku je pointa, že se nedá dopředu uhodnout, kam
  vede. Proto `/d/<uuid>`, `noindex` a nikde na webu na to neodkazuje.
  Obojí přesto **nesmí do `sitemap.xml`** — hlídá to test
  `src/app/sitemap.test.ts` (`/go/`, `/n/`, `/d/`).
- **Prisma nesmí do klientského bundlu.** Import čehokoli, co sahá na
  `@/lib/db` nebo `node:fs`, z `"use client"` komponenty přitáhne
  `pg` → `dns` do prohlížeče a build spadne. U QR i u darování to
  spadlo pokaždé stejně; řešení je vždycky rozdělit modul na čistý
  slovník (`qrDensity.ts`, `dropVocab.ts`) a server-only zbytek
  (`qr.ts`, `drops.ts`), a z klienta importovat jen ten čistý.
- **Automatický sync přeskočí nezměněný soubor podle hashe.** Vlna
  kontrolovaná po pěti minutách je skoro pokaždé tentýž soubor; spočítat
  otisk stažených bajtů je řádově levnější než ho otevřít a naplánovat.
- **`sheetMode` musí hlídat server, ne jen UI.** Zšedlé pole je vzkaz, ne
  zámek — stránka otevřená před zapnutím režimu by klidně odeslala, a
  ztráta by byla neviditelná, protože příští sync to přepíše. Proto se
  `sheetOwns()` ptá v každé akci, která na kus sahá.
- **Ze Sheets se tahá `export?format=xlsx`, ne CSV.** Vypadá to jako
  zbytečná okliku — a není: texty na landing page jsou víceodstavcové,
  takže skoro každý řádek nese odřádkování a čárky. CSV to přežije jen
  s bezchybným quotováním a každý omyl se projeví jako uříznutá věta
  uprostřed. Přes xlsx čte **stejný parser** soubor nahraný ručně i
  stažený z odkazu, takže se nemůžou rozejít.
- **Sdílená tabulka toleruje chybný řádek, ruční nahrání ne.** Stejná
  vada, dvě různé správné reakce: u nahraného souboru se operátor dívá na
  výsledek a překlep opraví, takže „všechno nebo nic“ chrání. U tabulky,
  do které píšou čtyři lidi a která se tahá na pozadí, by jedna rozepsaná
  souřadnice tiše zastavila práci všech — proto `planFromWorkbook`
  s `tolerant: true` políčko přeskočí a nahlásí. Fatální zůstává jen
  „nedá se přečíst vůbec nic“ (chybí klíčový sloupec, není to tabulka).
- **Předvyplněná tabulka + editovatelné texty sady = past, kterou hlídá
  `exportedDefaults`.** Export si zapíše, jaké výchozí texty tehdy platily.
  Když se pak v adminu text sady změní a tabulka nese starou verzi, sync
  ji **nepoužije** — poznal by ji jako překonaný default, pole přeskočí a
  napíše to do reportu. Bez toho by stačilo změnit text sady a příští sync
  by ho vrátil zpátky jako přepis na všech kusech.
- **Náhledy QR v mřížce se cachují podle `renderKey`, ne podle id kusu.**
  Klíč nese vše, co ovlivňuje kresbu (sloučené volby + vyřešený titulek a
  podpis). Cache podle id znamenala, že uložený vzhled sady se do mřížky
  nedostal, dokud jsi stránku tvrdě neobnovil — `router.refresh()` totiž
  překreslí server, ale klientský stav si drží staré obrázky.
- **Předvyplněná tabulka nesmí udělat přepis ze všeho.** Export plní každou
  buňku tím, co kartička opravdu říká (jinak se v ní nedá pracovat), takže
  import musí brát „shodné se sadou“ jako „pořád dědí“ — a to nejen
  u textů, ale i u **velikosti tisku** a u **režimů titulku**. Option bag
  je totiž právě to, co kus odpojí od sady; napsat ho všem by vlnu tiše
  rozbilo. Test je jednoduchý: stáhnout a hned nahrát = `changed: 0`.
- **Mřížka kusů kreslí QR jako `<img>` s data URI, ne inline SVG.**
  Vložený kód měl ~600 DOM uzlů na kartu, u vlny 111 kusů přes 70 000 —
  a to byl důvod, proč „zaškrtnout políčko“ trvalo. Jako obrázek je karta
  29 uzlů. `<img>` musí dostat `width`/`height`, jinak nemá poměr stran,
  vyloží se na nulovou výšku a strhne layout.
- **Titulek nad QR je REŽIM plus text, ne jen text.** Prázdné pole nemůže
  znamenat zároveň „vytiskni číslo nálezu“ i „nevytiskni nic“ — dokud
  tohle nebylo rozdělené (`titleMode` v option bagu, text v `qr_title`),
  nešlo o holý kód vůbec požádat. Rozhoduje `resolveQrLines`, jedno místo
  pro mřížku, náhled i tiskový arch. Import z xlsx proto po zapsání textu
  do sloupce zapne i `titleMode: "custom"`; jinak by text přistál v DB a
  na kartičce se nezměnilo nic.
- **Vlastní vzhled kusu je snímek, ne vrstva po polích.** Zaškrtnutí
  „Vlastní vzhled“ zkopíruje aktuální vzhled sady do `drop_items.qr_options`
  a od té chvíle kus na změny sady nereaguje — což je přesně to, co
  zaškrtnutí slibuje. Vypnutí přepínače bag smaže a kus se vrátí k sadě.
- **Adresa na kartičce se nebere z env na slovo.** `printableSiteUrl()`
  vynutí `https` pro cokoli, co není localhost, protože `http://` vytištěné
  na sto zalaminovaných kartičkách už nikdo neopraví. Používá ji
  `dropLandingUrl` i `findQrUrl`; nesahej do nich zvlášť.
- **Vynulování skenů musí vzít i stav.** `registerDropScan` dělá tři věci:
  zapíše řádek, orazítkuje `foundAt` a přepne stav na FOUND. Reset, který
  smaže jen řádky, nechá kus ve stavu „nalezený, nikým, nikdy“ — proto
  `resetScansAction` maže i razítko a FOUND vrací na HIDDEN.
- **`MapContainer` si `className` po namontování nemění.** react-leaflet ho
  přečte jednou; přepínání třídy podle stavu (kurzor při umísťování) proto
  patří na obalový `div`, ne na mapu.
- **Nominatim je jediné volání ven — a smí jím zůstat.** Hranice města se
  tahá z `nominatim.openstreetmap.org` na ruční stisk v adminu, posílá se
  jen název místa, výsledek se uloží do `drop_areas.boundary` a víc se
  nikam nevolá. Podmínky té výjimky jsou vypsané v CLAUDE.md §9.
- **Řaď nálezy z Nominatimu podle `place_rank`, ne podle velikosti.**
  „Zlín“ vrátí i **Zlínský kraj**, a ten má víc bodů polygonu — první
  verze podle nich řadila a spolehlivě dala vlně hranici velkou jako
  okres. Vyšší `place_rank` = menší místo; navíc si operátor vybírá ze
  seznamu, protože i správně seřazený odhad se občas netrefí.
- **Karty v mřížce jsou `memo()` a jejich callbacky `useCallback`.**
  Sto jedenáct karet po pár tisících SVG uzlech: bez toho se při otevření
  dialogu překreslovaly všechny a čistě klientské přepnutí stavu trvalo
  skoro sekundu. Inline `onClick={() => …}` tu memoizaci zruší.
- **Šířka v Tailwindu se neřeší pořadím ve třídě.** `SELECT_CLS` nese
  `w-full`; připsané `w-32` NEVYHRAJE, protože pořadí rozhoduje stylopis.
  Proto mají filtry vlastní obalovací `div` a jednořádkové prvky sdílejí
  `CONTROL_H` / `CONTROL_H_SM` z `qr-ui.tsx` — jinak řádek z inputu,
  selectu a tlačítka nikdy nelícuje.
- **Tiskový arch skládá řádky, ne mřížku.** Kus si smí přepsat velikost,
  takže pevná mřížka by na jednu odchylku rozsypala celou stránku. Řádek
  je vysoký jako jeho nejvyšší kartička a zalomí se, až se další nevejde —
  při jednotné velikosti z toho vyjde obyčejná mřížka.
- **Kolo přes xlsx musí být bezztrátové.** Export píše souřadnice na
  6 desetin (≈ 11 cm), klik do mapy ukládá plnou přesnost — import
  proto porovnává obojí přes `formatGpsDecimal`, aby neupravený soubor
  vyšel jako „žádná změna". Bez toho hlásil změnu u každého řádku
  s pozicí a operátor by přestal reportu věřit.
- **Do koše se zapisuje jedině přes `prepareTrashDir()`.** Na tom helperu
  (`src/lib/admin/trash.ts`) visí prune 30 dnů — ruční
  `path.join(ADMIN_ROOTS.trash, trashTimestamp(), scope)` ho obejde a koš
  zase začne růst donekonečna. Přesně to se stalo: CLAUDE.md §9 retenci
  slibovala od začátku, ale kód pro ni nikdy nevznikl a na VPS se do
  2026-08-10 nasbíralo 197 MB. Prune běží **při zápisu**, ne z timeru —
  koš roste jen tehdy, když se do něj píše, takže tam se to i vyplatí
  hlídat a nepřibývá věc, která může na serveru tiše přestat běžet.
  Maže jen přímé potomky `.trash`, jejichž jméno umí přečíst jako datum;
  co nepozná, nechá být. Stejným pravidlem se řídí i `sync-*.log`
  v `data/.admin/logs/` (prune při startu syncu).
- **Pod `/api/admin/*` žije šest rout a maska adminu na ně NESEDÍ.** Ta
  maska je v `deploy/nginx.conf.template` psaná jako `location /admin` —
  prefix, a `/api/admin/…` jím nezačíná. Šablona proto od 2026-08-10 dává
  `/api/admin` **stejný allowlist** (volá je jen prohlížeč přihlášeného
  admina, tedy z povolené IP) a navíc `location =` s `return 404` na
  `drops/sync` a `revalidate`, které volá výhradně stroj sám přes
  loopback. **Nginx ale nasazuje ruka, ne CI** — živý soubor se od
  šablony liší a žádná routa se na tu masku nesmí spolehnout. Každá se
  brání i sama a při neúspěchu vrací 404, ne 401.
- **Sync endpoint se brání sám, ve třech vrstvách**
  (`src/lib/admin/dropSyncGate.ts`):
  tajemství porovnané v konstantním čase a odmítnuté, když je kratší než
  24 znaků; **jen loopback**; a 404 na každé selhání, aby prubíř nepoznal,
  že něco našel. Čtvrtá vrstva je tvar endpointu — nic nepřijímá v těle,
  stáhne jen odkaz, který sada už má, a `parseSheetUrl` pustí jedině
  `docs.google.com` (takže to není ani páka na SSRF).
- **Loopback se nepozná podle chybějící `x-forwarded-for`.** Next si tu
  hlavičku **dosadí sám** z otevřeného socketu, takže přímé volání
  z timeru dorazí s `::ffff:127.0.0.1` — první verze kontroly proto
  odmítala právě ten timer, kvůli kterému vznikla. Správně se čte celý
  **řetěz** a všechny články musí být loopback: nginx skládá hlavičku jako
  `$proxy_add_x_forwarded_for`, tedy vždy připojí reálného peera, takže
  podvržené `127.0.0.1` zvenku nepomůže — vlastní adresa útočníka stojí
  hned za ním. Zbývá jediný předpoklad, a ten drží firewall:
  `iifname != "lo" tcp dport 3000 counter drop`
  v `deploy/nftables-ssh-allowlist.nft`. Kdyby to pravidlo zmizelo, spadne
  ochrana zpátky na samotný token.

## 6. Úkoly TODO / open questions

(Doplň při dalších změnách. Pokud máš PR/issue tracker, link sem.)

- [ ] PR cleanup pro CONTEXT_BACKUP.txt v repo rootu (gitignore?)
- [ ] Trash management UI (browse + restore + manual purge mimo audit) —
      retence 30 dnů už běží sama (`src/lib/admin/trash.ts`), chybí jen
      prohlížení a ruční obnova
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
