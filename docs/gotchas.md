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
