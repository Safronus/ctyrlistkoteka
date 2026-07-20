# Známé chyby a gotchy

Sbírka konkrétních lessons-learned z minulých incidentů. Každá položka má **Co**,
**Proč** (kořenová příčina) a **Jak aplikovat** (kdy a jak se tomu vyhnout
příště). Pokud narazíš na podobný symptom, projdi tenhle dokument dřív, než
začneš debugovat.

---

## 1. NFC normalizace pro matchování souborů mac → linux

**Co:** Při porovnání on-disk filename proti DB-stored hodnotě (např.
`originalFilename` v `location_maps`) je nutné obě strany **NFC-normalizovat +
lowercase** před porovnáním. Bez toho lookup tiše selže pro každé jméno
s diakritikou.

**Proč:** macOS iCloud Drive (Mobile Documents) drží soubory zdánlivě tak, jak
je uživatel napsal, ale `rsync` z Macu na Linux VPS doručí jména v NFD
(rozložené diakritické znaky — `Í` jako `I` + combining acute U+0301). DB má
`originalFilename` v NFC (sloučená forma — `Í` jako U+00CD), protože ta hodnota
se zapisovala při `pnpm sync` z jiné cesty / jiného kódu. Byte-for-byte
porovnání pak selže, i když to lidsky vypadá identicky.

Ověřeno empiricky 2026-05-01: real-photo lookup v `src/lib/locationPhotos.ts`
nematchoval Reykjavík mapu, dokud se na obě strany nepřidalo
`.normalize("NFC").toLowerCase()`. Samotný `pm2 restart` problém nevyřešil.

**Jak aplikovat:**
- Jakýkoli helper, který listuje `${GENERATED_DIR}/<dir>/` a hledá soubor podle
  `originalFilename` (nebo jiného uživatelem zadaného jména) — vždy
  NFC-normalizuj obě strany.
- Helper `makeKey()` v `src/lib/locationPhotos.ts` je referenční implementace;
  kopíruj ten pattern.
- Pokud se v budoucnu přidá `pnpm geocode` nebo jiný adresářový lookup
  s uživatelskými jmény, replikuj tu normalizaci.
- **Netýká se** existujícího sync pipeline (location maps + finds) — ten
  matchuje soubory přes content-addressed sha1 hash, ne podle jména.

---

## 2. `"use server"` soubory smí exportovat jen async funkce

**Co:** V Next.js (App Router) soubor s direktivou `"use server"` na vrcholu
**smí exportovat výhradně async funkce**. Cokoli jiného (konstanty, objekty,
interface, type aliasy) tam patřit nesmí — při importu z client komponenty se
totiž nahradí server reference (proxy, kterou nelze invokovat) místo skutečné
hodnoty, a render umře s generickou „Application error: a server-side
exception" bez čitelného stack tracu.

**Symetrické pravidlo:** Server component **nesmí předávat client componentě
libovolnou funkci jako prop** — projde jen async funkce s `"use server"`
direktivou. Inline arrow funkce v JSX (např. `confirmText: (n) => "..."`)
shodí stránku se stejnou generickou chybou. Místo funkce předávej řetězec /
template a substituci dělej v client componentě.

**Proč:**
- 2026-05-01: `src/lib/actions/findDonation.ts` vedle `findDonationAction`
  exportoval `FIND_DONATION_INITIAL` konstantu + `FindDonationActionState`
  interface → runtime crash.
- 2026-05-02: prop `bulkRename={{ confirmText: (n) => ... }}` v
  `[scope]/page.tsx` (server) předaný do `FilesListClient` shodil
  `/admin/files/maps`. Vyřešeno přepisem na `confirmTemplate: string` + `{n}`
  placeholder.

Typecheck/lint tyhle chyby nezachytí. Lokální `pnpm build` s funkční DB by je
odhalil, ale prod buildy obvykle padnou až za page-data collection — a když
tahle fáze padne na DB connection, runtime regrese se pozná až z VPS.

**Jak aplikovat:**
- Pro každou novou Server Action: udělej dva soubory — `<name>.ts` s
  `"use server"` a jen async funkcí, vedle něj `<name>Types.ts` (bez direktivy)
  pro typy + initial states + helpery.
- Action file si typy importuje zpět přes `import type` — type-only importy
  jsou erased, takže neporušují pravidlo.
- Pro props server → client komponenta: předávej **hodnoty** (string, number,
  object), ne funkce. Pokud potřebuješ pluralizaci/formátování, dělej ji na
  klientovi (předej template) nebo přes server action.
- Když ladíš „Application error" po nasazení nové fíčury, první kontrola:
  má `"use server"` soubor jen async function exporty? A nepředávám funkci
  jako prop přes RSC hranici?
- Pravidlo platí symetricky pro client: `"use client"` soubor naopak může
  exportovat cokoli, ale jeho exporty se přibalí do client bundlu.

**Reference v repu:** `src/lib/actions/findDonation.ts` (action) +
`src/lib/actions/findDonationTypes.ts` (typy + konstanty). Příklad
string-template propu: `bulkRename.confirmTemplate` v
`src/app/admin/files/_shared/files-list-client.tsx`.

---

## 3. Admin session cookie `path` musí pokrýt `/admin` i `/api/admin`

**Co:** Iron-session cookie pro `/admin` rozhraní musí mít
`cookieOptions.path: "/"` (ne `/admin`).

**Proč:** `/admin` pages a `/api/admin/*` endpointy mají různý URL prefix.
Cookie s `path=/admin` se browserem neposílá pro `/api/admin/file`, takže
streaming endpoint dostává každý request unauthenticated a vrací 404 ještě
před jakýmkoli logováním. Detail page se přitom rendruje OK (`path=/admin`
matchuje), takže symptom vypadá jako broken streaming nebo Unicode/cache
problém. Reálná příčina: chybějící cookie. Setrvání u `path=/admin` by
vyžadovalo přejmenovat API endpointy pod `/admin/api/`, což je invazivnější
změna.

**Jak aplikovat:** Při psaní auth-gated routes pod jiným prefixem než
`/admin` (typicky `/api/admin/*`) ověř, že session cookie má `path=/`. Změna
z `/admin` na `/` je bezpečná, dokud cookie zůstává `HttpOnly` + `Secure` +
`SameSite=Strict` a hodnota je iron-session šifrovaná (veřejné routy ji
stejně nedekódují). Při deploy takové změny musí uživatel smazat starou
cookie ručně v DevTools — iron-session `destroy()` neumí orphanovat cookies
s jiným `path`, než má aktuální config.

---

## 4. Zrušený deploy otráví `.next/cache` → stale Tailwind CSS na produkci

**Co:** Po několika rychlých pushích za sebou (deploy workflow má
`concurrency: cancel-in-progress`) může produkce servírovat HTML s novými
Tailwind třídami, ale CSS bundle, kterému tyto utility chybí. Symptom
2026-06-09: badge „Rekord" v /sbirka seznamu měla v markup `absolute left-1
top-1`, ale `.top-1`/`.left-1` v nasazeném CSS neexistovaly → element zůstal
ve statické pozici pod fotkou, oříznutý. Vypadá to jako CSS/layout bug v kódu,
ale lokálně je vše správně.

**Proč:** Self-hosted runner builduje v `/var/www/ctyrlistkoteka` s perzistentním
`.next/cache` (webpack cache). Deploy zrušený uprostřed buildu může cache
zanechat v nekonzistentním stavu; následující build pak přečte zastaralý
zkompilovaný CSS modul (Tailwind scan se nere-runuje, protože cache klíč
nezohlednil změněný zdrojový soubor se třídami). HTML/RSC část se přitom
přebuildí správně — rozjede se jen CSS.

**Jak aplikovat:**
- Deploy workflow od 2026-06-09 maže `.next/cache` před každým `pnpm build`
  (jen cache, ne celé `.next` — runtime z cache neservíruje, takže je to
  bezpečné za běhu; stojí to jen plnou rekompilaci).
- Diagnóza při podezření: `curl` HTML → ověř, že markup třídu má; pak `curl`
  CSS bundle z `/_next/static/css/…` a `grep` na `.třída{`. Chybí-li jen
  v CSS, je to tahle gotcha — ne kód.

---

## 5. Zrušený deploy → rozbitý `.next` → crash-loop po rebootu

**Co:** Když se `pnpm build` přeruší **uprostřed**, zůstane na disku
**neúplný `.next` bez `BUILD_ID`**. Web ale **dál jede**, protože živý PM2
proces servíruje svůj build z paměti a `pm2 reload` po nedokončeném buildu
neproběhl. Past sklapne až při **restartu procesu** (reboot, crash,
`pm2 restart`): `next start` načte rozbitý `.next` a každý worker padá
dokola s `Error: Could not find a production build in the '.next'
directory`. Symptom: nginx vrací **502**, `pm2 ls` má workery s uptime
pořád `0s`.

**Proč se přerušil build (2026-06-30, reálný incident):** self-hosted
runner běží **na tom samém VPS** jako web. Push spustil deploy → runner
rozjel `pnpm build` → a **mezitím se VPS rebootnul** (ručně, ihned po
nasazení), čímž build zabil v půlce („The operation was canceled" v
Actions). Po nabootování PM2 resurrect načetl rozbitý `.next` → crash-loop.
Druhý spouštěč téhož: rychlé pushe za sebou, kdy novější push zrušil
běžící build (proto `cancel-in-progress: false`, viz #4).

**Varianta „build skončil `exit 0`, ale manifesty jsou 0 B" (2026-07-08):**
podruhé to spadlo jinak — deploy hlásil **success**, `set -euo pipefail`
i `cancel-in-progress:false` byly na místě, a přesto zůstalo v `.next`
šest **nulových (0 B) manifestů** (`required-server-files.json`,
`prerender-manifest.json`, `routes-manifest.json`, `app-path-routes-…`,
`images-manifest.json`, `functions-config-manifest.json`). Signatura pádu
proto **není** „Could not find a production build", ale
`SyntaxError: Unexpected end of JSON input at JSON.parse (<anonymous>)`
dokola à ~1 s (to je přesně `JSON.parse("")`). Disk plný nebyl. Past
sklapla až když se workeři restartovali (~16 min po deployi) a načetli ty
prázdné manifesty. Poučení: build může „uspět" a přesto vyrobit rozbitý
`.next`, takže `pm2 reload` na něj **nesmí** proběhnout naslepo.

**Jak aplikovat:**
- **Nereebootuj / nevypínej VPS, dokud běží deploy build** (runner je na
  stejném stroji). Mrkni do Actions / `gh run list`, že nic neběží.
- Deploy workflow od 2026-06-30 má `concurrency.cancel-in-progress: false`
  — buildy se frontí, neruší se navzájem; `.next` tím skončí kompletní
  (řeší push-variantu, ne reboot uprostřed buildu).
- Akutní oprava na serveru: `cd /var/www/ctyrlistkoteka && source
  ~/.nvm/nvm.sh && pnpm install --frozen-lockfile && pnpm prisma generate
  && pnpm build && pm2 reload ctyrlistkoteka && pm2 save`. (Nebo prostě
  pushni cokoliv — deploy přebuilduje a reloadne sám.)
- Diagnóza: `pm2 logs ctyrlistkoteka --nostream` (hláška o chybějícím
  buildu) + `ls /var/www/ctyrlistkoteka/.next/BUILD_ID`.
- **Otužení deploye (implementováno 2026-07-08):** deploy má teď mezi
  `pnpm build` a `pm2 reload` dvě brány (obě **fail-closed**):
  1. **Integrity gate** — po buildu ověří, že `BUILD_ID` +
     `required-server-files.json` + `prerender-manifest.json` +
     `routes-manifest.json` + `build-manifest.json` jsou **neprázdné**
     (`[ -s ]`). Když je kterýkoli 0 B, deploy `exit 1` **ještě před**
     reloadem → PM2 dál servíruje starý dobrý build z paměti, Actions jsou
     červené. Chytá přesně variantu „exit 0 + prázdné manifesty".
  2. **Health gate** — po `pm2 reload` curlne `http://127.0.0.1:3000/`
     (až 10× à 3 s, bere 2xx/3xx vč. locale redirectu). Když app neožije,
     deploy padne načerveno hned, ne až se to projeví jako 502 za pár hodin.
- **Ještě silnější (stále neimplementováno):** buildit do dočasného
  adresáře a atomicky přehodit (`distDir` přes env → `mv`), takže přerušený
  build nechá živý `.next` netknutý a reboot/crash appku nepoloží.

## 6. `/admin` cloak: `curl` z Claude Code / Macu chodí přes domácí IP (= allowlist)

**Co:** `/admin` je na produkci schovaný **Nginx IP-allowlistem** — cizí IP
(mobil přes GSM, útočník, Googlebot) dostane **maskovanou 404**
nerozeznatelnou od neexistující cesty; jen IP z allowlistu vidí reálný
`/admin` (307 → login, login 200). To je **záměr a funguje to** (viz
[admin-overview.md](admin-overview.md), `deploy/nginx.conf.template`
`location /admin` → `@admin_notfound`).

**Past:** Claude Code (a jakýkoli `curl` z Bash toolu) běží **na uživatelově
Macu**, takže odchozí požadavky jdou přes **jeho domácí přípoj (statická
IP)**, která **je na allowlistu**. Proto `curl https://ctyrlistkoteka.cz/admin`
z tohoto prostředí vrátí **200/307, ne 404**. To **neznamená, že cloak
nefunguje** — jen testuješ zevnitř povolené sítě. Uživatel na mobilu (jiná
IP) správně vidí 404.

**Jak aplikovat:**
- **Netvrď „cloak je rozbitý", když z Bash dostaneš 200 na `/admin`.** Je to
  artefakt domácí IP. Pro test „jak to vidí cizí" použij mobil/jinou síť,
  ne zdejší `curl`.
- Domácí IP uživatele je na allowlistu `/admin` záměrně (a v permaban
  whitelistu / fail2ban `ignoreip`). **Konkrétní IP nepatří do gitu** — repo
  je veřejné; reálné adresy žijí jen v `/etc/permaban-whitelist.conf` a nginx
  configu na VPS. Když je potřebuješ, jsou v mé trvalé paměti, ne tady.
- Ochrana `/admin` je vrstvená a **hotová**: Nginx cloak (404 mimo
  allowlist) + WebAuthn passkey + iron-session + `X-Robots-Tag: noindex`.
  Nepředělávej to.

## 7. Nová route může pár minut po deployi vracet 404 (než se PM2/Nginx usadí)

**Co:** Po nasazení nové route (`/admin/banner-texts`, commit `55f30de`,
2026-07-05) route několik minut vracela **Next 404** (`__next_error__`, tělo
Next chybové stránky — **ne** maskovaná nginx 404), přestože:
- deploy doběhl zeleně,
- build na VPS route table **obsahovala** (`ƒ /admin/banner-texts …`),
- `pm2 reload` reportoval **oba cluster workery** (ids 0, 1) jako `✓`.

Pak začala **sama od sebe** vracet správně `307 → /admin/login` bez jakéhokoli
dalšího zásahu (žádný nový deploy). Lokální `pnpm dev` tu samou route celou dobu
servíroval `307` s čistou kompilací → **nikdy to nebyla chyba v kódu**.

**Past:** „deploy dokončen" (`gh run watch` zelený + `pm2 reload ✓`)
**nezaručuje**, že úplně nová cesta je _okamžitě_ živá na každém workeru.
Přechodná 404 na nové cestě může vydržet i pár minut. Diagnostikovat to jako
chybu kódu/buildu je ztráta času — build tu route má.

**Pravděpodobná příčina (nepotvrzeno):** rolling `pm2 reload` u cluster módu
(2 instance) + nginx upstream keep-alive drží spojení na ještě starý worker,
případně nginx krátce cachne tu přechodnou 404. Existující cesty jsou
netknuté (jsou ve starém i novém buildu) — 404 potká **jen nově přidanou**.

**Jak aplikovat:**
- Po deployi nové route ji **neprohlašuj hned za rozbitou**. Počkej pár minut,
  zkus **víc requestů** za sebou. Existující `/admin/*` cesty přitom jedou
  celou dobu (307) — kontrast potvrzuje, že jde o propagaci, ne o kód.
- Kód ověř lokálně (`pnpm dev` → 307/200), build ověř v deploy logu (route
  table musí novou cestu vypsat). Když obojí sedí, 404 je skoro jistě jen
  usazování.
- **Teprve** když 404 přetrvá i po ~10 min a víc requestech, je to reálný
  problém. První kroky pak: `pm2 restart ctyrlistkoteka` (tvrdší než `reload`)
  a případně full `rm -rf .next` + rebuild (deploy maže jen `.next/cache`, viz
  #4) — spouští uživatel v Termiusu, ne Claude.

## 8. `w-fit`/`fit-content` kolem prvku s `width: min(100%, …)` kolabuje na 0

**Co:** „Náhodný čtyřlístek" na hlavní stránce najednou zobrazoval prázdný box
bez fotky (overlaye — fullscreen tlačítko + countdown — slité doprostřed).
Server byl zdravý: SSR HTML fotku obsahoval, `/api/random-find` vracelo validní
data, obrázky `/generated/web/*.webp` házely 200, detail nálezu fotku
renderoval. Byl to čistě **klientský layout kolaps**.

**Příčina:** showcase obaloval `ImageGallery` do `div.w-fit` (`width:
fit-content`), ale galerie si sama počítá `width: min(100%, <px>, <vh>)` (z
`photoDisplay`). `fit-content` potřebuje intrinsic šířku dítěte, jenže to `100%`
se v intrinsic režimu vyhodnotí jako 0 → `min(0, …)` = 0 → rodič `fit-content` =
0 → dítě `100%` = 0. **Cyklus se ustálí na nule** a box zmizí. Ověřeno
izolovaným CSS testem: `w-fit` → 0×0, explicitní šířka wrapperu → 640×853.

**Past:** vypadá to jako „zmizelá fotka / rozbitá data / regrese v API", ale je
to ryze CSS. `photoDisplay().widthCss` je `min(100%, …)` **záměrně** (sdílí ho
mapa lokality), takže ho **nesmíš obalit shrink-to-fit kontejnerem**.

**Jak aplikovat:**
- Kolem prvku s `width: min(100%, …)` **nikdy nedávej `w-fit` / `inline-block` /
  `fit-content`**. Dej wrapperu **explicitní** šířku (tu samou `widthCss`), jako
  to dělá detail nálezu (`sbirka/[id]/page.tsx`, `style={{ width:
  photoBox.widthCss, maxWidth: "100%" }}`). Pak má `100%` uvnitř definitní základ.
- Když „zmizí" jen vizuál a data/SSR/HTTP jsou v pořádku, hledej **layout**
  (spočítej `getBoundingClientRect()` na wrapperu — 0 = kolaps), ne backend.
- Detail nálezu i showcase teď sdílí stejný vzor: **wrapper má explicitní
  `widthCss`, ne `w-fit`.**

## 9. Po deployi servíruje ISR stránka pár requestů starý (stale) render

**Co:** hned po úspěšném deployi (`DEPLOY_OK`) vracela hlavní stránka **starý
HTML** — nová změna (`fill` → `width:100%`, přesun `statesSlot` nahoru) v něm
nebyla, přestože zdroj i build byly správně. Vypadalo to jako „deploy se
neprojevil / běží starý build". Po **pár requestech na `/`** se render
přegeneroval a nový obsah naskočil.

**Příčina:** hlavní stránka je **ISR** (a další agregační stránky taky). Next
servíruje **stale-while-revalidate** — první request(y) po deployi dostanou
poslední cachovaný (starý) render a nový se dopéká **na pozadí**. `rm -rf
.next/cache` v deploy skriptu smaže inkrementální cache, ale prvních pár hitů
stejně může chytit ještě „doháněcí" render. (Jiné než #7: tam jde o **404 na
nové routě**, tady o **starý obsah na existující stránce**.)

**Past:** ověřovat živý web **hned** po `DEPLOY_OK` jedním `curl` → snadno
usoudíš „změna nešla" a začneš debugovat deploy, který je ve skutečnosti v
pořádku.

**Jak aplikovat:**
- Po deployi **napřed prober ISR** (3–5× `curl https://…/`), teprve pak ověřuj
  obsah — nebo počkej ~30–60 s. Cache-buster query (`?cb=…`) nestačí, ISR klíčuje
  podle cesty.
- Rozliš **stale obsah** (starý render existující stránky → dočasné, sám se
  spraví) od **reálné regrese** (grep zdroje potvrdí, že změna v souboru je, ale
  po ~10 min a mnoha requestech pořád starý HTML → teprve tehdy koukej na build/PM2).
- Nejjistější marker pro ověření je něco, co je **v JS bundlu** (className,
  struktura) — to se nemůže lišit „daty", jen buildem; když je starý, je to build/ISR.

## 10. `<Suspense>` stream-reveal se pod naším přísným CSP nedokončí

**Co:** async Server Component obalený v `<Suspense>` (footer AbuseIPDB badge)
se **nikdy nezobrazil** — v raw HTML odpovědi číslo bylo, ale v živém DOMu
zůstal viset **fallback** (viditelný) a **resolved obsah** byl v DOMu, ale
`display:none` / `offsetParent === null` (skrytý). Vypadalo to jako selhaný
fetch, i když fetch + parse fungovaly (ověřeno debug markerem: `count=8925`).

**Příčina:** Next streamuje Suspense hranici jako fallback + později
`<template>` s resolved obsahem + inline „reveal" skript (`$RC(...)`), který
fallback schová a resolved odkryje. Náš middleware nastavuje **striktní
nonce-CSP** a ten reveal skript se **nespustí/nedokončí** → resolved obsah
zůstane skrytý. (Bootstrap/hydratace běží, takže se to netýká celé stránky —
jen streamovaného odkrytí Suspense hranice.)

**Jak aplikovat:**
- V **globálním layoutu / patičce nepoužívej `<Suspense>`** pro async data.
  Renderuj async Server Component **synchronně** (prostě ho `await`ni bez
  hranice) — obsah je pak v iniciálním HTML a žádný reveal skript netřeba.
- Pomalý zdroj drž **cachovaný** (`unstable_cache` / `fetch next.revalidate`)
  a s **krátkým timeoutem**, ať blokující render path netrpí. Graceful null
  = prvek se prostě vynechá.
- Ověřuj v **živém DOMu** (`offsetParent`, `innerText`), ne jen v raw HTML —
  raw HTML může obsah mít v `<template>`, který se nikdy neodkryl.

## 11. `immutable` cache + regenerace fotky „na místě" = stará fotka až rok

**Co:** po přegenerování fotek nálezů (vodoznak, rotace, kvalita, re-crop)
ukazoval web **starou verzi** — a nepomohl ani běžný reload. Tvrdý reload
opravil jen aktuální načtení stránky; při **klientské navigaci mezi nálezy**
na /sbirka (Next soft-nav) se obrázky nestahovaly znovu a zůstávaly staré.

**Příčina:** URL fotky je `/generated/web/<sha1>.webp`, kde **sha1 je hash
ORIGINÁLU**, ne zakódovaného výstupu. Přegenerování přepíše soubor „na místě"
na **stejné URL** s novým obsahem. Jenže Nginx servíruje `/generated/*` s
`Cache-Control: public, immutable, max-age=31536000`. `immutable` = prohlížeč
se **záměrně nikdy nezeptá serveru** (neposílá `If-None-Match`/`If-Modified-
Since`) ani při reloadu — drží kopii až do vypršení `max-age` (rok). Takže
sha1 tu vlastně `immutable` **nesplňuje** — obsah na té URL se měnit může.

**Jak aplikovat:**
- K render URL fotky nálezu přidávej **verzi** přes `versionedPhotoUrl()`
  (`?v=FIND_PHOTO_ASSET_VERSION`, `src/lib/constants.ts`). Bump konstanty →
  nová URL → všechny cache (i `immutable`) se protrhnou naráz. `immutable`
  si necháváme kvůli efektivitě v rámci verze — je to standardní „versioned
  immutable asset" vzor (jako webpack `[contenthash]`, jen bumpovaný ručně).
- **Bumpni `FIND_PHOTO_ASSET_VERSION` při každém in-place přegenerování fotek.**
  Změna Nginx hlavičky (drop `immutable`) by **neprotrhla už uložené** cache
  — ty si `immutable` nesou s sebou; jediné, co protrhne existující cache, je
  **změna URL**. Proto verzování, ne úprava hlavičky.
- **Mapy lokalit neverzuj** — nepřegenerovávají se, URL zůstávají stabilní a
  smí být cachované donekonečna. `versionedPhotoUrl()` posílej jen na fotky
  nálezů (web/thumb/ořez).
- Lokální „refresh všeho" v prohlížeči (než se nová verze nasadí): DevTools →
  Application → Storage → *Clear site data*, nebo *Empty Cache and Hard
  Reload*. Po nasazení bumpu stačí jeden běžný reload — URL jsou nové.

---

## 12. `require("sharp") as typeof import("sharp")` přestal být volatelný v 0.35

**Příznak:** po bumpu sharp 0.34 → 0.35 spadne `pnpm typecheck` na 17 chyb
typu `TS2349: This expression is not callable. Type 'typeof
import(".../sharp/dist/index")' has no call signatures.` Runtime přitom
funguje bez problému.

**Proč:** sharp 0.35 přidal do `package.json` podmíněné exporty s ESM
typy. Dřív měl balíček jen CJS deklarace končící `export = sharp`, takže
`typeof import("sharp")` **byl** ten volatelný konstruktor. Nově se pod
`moduleResolution: "bundler"` vybere `import` větev (`dist/index.d.mts`),
kde je namespace s pojmenovanými exporty a volatelná funkce až v
`export default sharp`. Typ namespace tím pádem call signature nemá.

Runtime zůstal v pořádku, protože `require("sharp")` vybírá `require`
větev (`dist/index.cjs`), a ta pořád exportuje přímo funkci. Rozešly se
tedy jen typy s realitou.

**Jak aplikovat:**
- Vzor je `const sharp = require("sharp") as typeof import("sharp").default;`
  — s `.default` na konci. Bez něj to neprojde typecheckem.
- **Pojmenované typy měň NE**: `import("sharp").Sharp` a
  `import("sharp").OutputInfo` fungují dál, protože to jsou pojmenované
  exporty i v ESM deklaracích. Přepsat je na `.default.Sharp` by je rozbilo.
- `toBuffer()` nově vrací `Buffer<ArrayBuffer>` místo obecného `Buffer`.
  Když do stejné proměnné přiřazuješ i výsledek vlastní funkce vracející
  `Buffer`, anotuj proměnnou explicitně `: Buffer` (viz `markData`
  v `src/lib/watermark.ts`) — `composite()` široký typ přijímá.
- `require("sharp/package.json")` už nefunguje vůbec (`ERR_PACKAGE_PATH_
  NOT_EXPORTED`) — exports mapa pouští jen kořen. Verzi zjistíš jinudy,
  runtime info je v `sharp.versions`.

---

## 13. Flat config: pravidlo `warn` potřebuje plugin ve stejném scope, `off` ne

**Příznak:** po přechodu na `eslint-config-next` 16 spadne `pnpm lint` na
`A configuration object specifies rule "jsx-a11y/alt-text", but could not
find plugin "jsx-a11y"` — a když plugin doregistruješ, spadne to na
`Cannot redefine plugin "jsx-a11y"`. Chyceni mezi dvěma protichůdnými
chybami.

**Proč:** ve flat configu jsou pluginy **scopované per config objekt** a
zdědí je jen objekty pokrývající stejné soubory. `eslint-config-next` 16
registruje `jsx-a11y`, `react-hooks` a spol. v objektu s
`files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"]`. Náš blok s doplňkovými
pravidly `files` neměl, takže platil i na soubory mimo ten glob — a tam
plugin neexistuje (první chyba). Doregistrování pluginu zase koliduje
uvnitř globu, kde ho Next už zaregistroval (druhá chyba).

Do verze 15 tenhle problém nebyl, protože se presety tahaly přes
`FlatCompat.extends()` jako legacy `.eslintrc` — ten mechanismus scoping
řešil jinak. (Pod 16 `FlatCompat` na tyhle presety navíc padá rovnou na
`TypeError: Converting circular structure to JSON`, protože už jsou
nativně flat — importuj je přímo a rozbal spreadem.)

**Jak aplikovat:**
- Blok, který **zapíná** pravidlo cizího pluginu (`warn`/`error`), musí mít
  `files` se stejným globem, jaký používá ten, kdo plugin registruje.
  Plugin **nedoregistrovávej**.
- Pravidlo nastavené na `"off"` scope nepotřebuje — proto v našem configu
  desítky `"sonarjs/…": "off"` fungovaly bez `files` a rozbilo se to až
  ve chvíli, kdy jsem přidal `"react-hooks/purity": "warn"`.
- Když měníš glob u jednoho bloku, změň ho u obou — jsou svázané.

---

## 14. Prisma 7: raw dotaz s aritmetikou nad parametrem spadne na „operator is not unique"

**Příznak:** po upgradu na Prismu 7 začne `$queryRaw` házet
`Raw query failed. Code: 42725. Message: operator is not unique: unknown *
unknown` (Prisma to zabalí do `P2010` / `DriverAdapterError`). Typecheck
i build projdou — pozná se to až za běhu.

**Proč:** v tagged template `$queryRaw` se **každá interpolace stane
vázaným parametrem**, ne textem. Takže

```ts
prisma.$queryRaw`SELECT pi() * (${RADIUS} * ${RADIUS})`
```

pošle do Postgresu doslova `pi() * ($1 * $2)`. Prisma 6 měla Rust engine,
který parametrům posílal explicitní typy, takže Postgres operátor vyřešil.
Prisma 7 engine zrušila a `pg` driver adapter posílá parametry
**netypované** — Postgres pak u `unknown * unknown` nedokáže vybrat, který
z přetížených operátorů `*` použít, a skončí chybou 42725.

**Jak aplikovat:**
- Když v raw SQL děláš **aritmetiku nad interpolovanou hodnotou**, přetypuj
  ji: `${RADIUS}::float8 * ${RADIUS}::float8`. Viz `getStatsTopLocationsImpl`
  v `src/lib/queries/stats.ts`.
- Týká se to i porovnání a funkcí, kde je typ nejednoznačný — ne jen `*`.
  Samotné `WHERE id = ${id}` problém nemá, protože typ určí druhá strana.
- **Build to nechytí.** Jediná spolehlivá kontrola je appku spustit proti
  reálným datům a projít stránky se sledováním logu na `prisma:error`.

## 15. Prisma 7: import enumů z klienta tahá serverový runtime do prohlížeče

**Příznak:** `pnpm build` spadne na
`Code generation for chunk item errored … [app-client]` u souboru, který
z Prismy importuje jen enum (u nás `src/lib/stateLabels.ts` a `FindState`).

**Proč:** nový generátor `prisma-client` vytváří víc vstupních bodů.
`…/client` obsahuje `PrismaClient` včetně runtime, takže jakýkoli soubor,
který z něj importuje a zároveň skončí v klientském bundlu, si runtime
přitáhne s sebou. Pod `prisma-client-js` se enumy tahaly z `@prisma/client`
bez následků.

**Jak aplikovat:**
- Enumy (`FindState`, `ImageType`) importuj z **`@/generated/prisma/enums`** —
  je to čistá data bez runtime. V repu je takhle přesměrováno 30 souborů.
- Z `@/generated/prisma/client` importuj jen tam, kde je opravdu potřeba
  `PrismaClient` nebo namespace `Prisma` (u nás 9 serverových souborů).
- Pravidlo: **importuje to klientská komponenta nebo něco, co do ní vede?
  Pak `/enums`.**

---

## 16. Prisma 7: CLI skripty (sync/seed/…) nenačtou `.env` samy

**Příznak:** po upgradu na Prismu 7 spadne `pnpm sync` (i seed,
apply-watermark, diagnose) na `SASL: SCRAM-SERVER-FIRST-MESSAGE: client
password must be a string`. Web funguje, admin sync funguje, jen CLI ne.

**Proč:** Prisma 6 načítala `.env` automaticky pro cokoli, co importovalo
klienta. Prisma 7 to **zrušila** — `.env` si musí načíst aplikace sama.
Web ho dostává od Next.js; `prisma.config.ts` má `import "dotenv/config"`
pro Prisma **CLI** (`migrate`/`generate`). Ale samostatné `tsx` skripty
(`scripts/*.ts`) nemají ani jedno → `process.env.DATABASE_URL` je
`undefined` → adaptér `pg` dostane heslo `undefined` → SASL chyba.

**Jak aplikovat:**
- Každý CLI skript, který sahá na DB, má na začátku
  `import "dotenv/config";` **před** jakýmkoli použitím `DATABASE_URL`
  (v repu: sync, seed, apply-watermark, diagnose-location-ids).
- Nedávej to do sdíleného `src/lib/prismaClient.ts` — ten jede i ve webu,
  kde je `.env` už načtený a extra dotenv side-effect je zbytečný.
- `dotenv` **nepřepisuje** už existující proměnné, takže je bezpečné i tam,
  kde je prostředí naplněné jinak (systemd `EnvironmentFile`, PM2 env).

---

## 17. ZIP + diakritika: yauzl bez UTF-8 flagu dekóduje názvy jako mojibake

**Příznak:** import v2 balíčku map (samá diakritika v cestách,
`Nosné mapy/CZ/Ratiboř/…`) najde 0 souborů, nebo je uloží pod rozbitými
názvy (`Ratibo┼Ö`), takže je pak `sync` nenajde.

**Proč:** yauzl UTF-8-dekóduje názvy jen když entry nastaví
language-encoding flag (bit 11). macOS `ditto` i `zip -r` často zapisují
UTF-8 **bajty bez toho flagu**, takže yauzl (default `decodeStrings: true`)
spadne na CP437 → mojibake. NFC normalizace to nespraví — vstup je už
rozbitý.

**Jak aplikovat:**
- Pro balíčky s diakritikou otevírej zip s `decodeStrings: false` a dekóduj
  název sám: `raw.fileName /* Buffer */ .toString("utf8").normalize("NFC")`.
  Viz `iterateZipUtf8` v `src/lib/admin/mapPackageImport.ts`.
- Nespoléhej na to, čím uživatel zabalí (Finder / ditto / `zip`) — dekóduj
  UTF-8 vždy.
- Ověřuj přes yauzl (náš kód), NE přes `unzip -l` v terminálu — ten zobrazí
  `??` kvůli locale, i když jsou bajty v pořádku, což mate diagnostiku.
