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
