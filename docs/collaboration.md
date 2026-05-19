# Spolupráce s Claude Code

Pravidla a preference pro práci s Claude Code na tomhle projektu. Doplňuje
`CLAUDE.md` o konkrétní workflow a komunikační konvence, které vznikly
z minulých kol spolupráce.

---

## 1. Komunikační jazyk

**S uživatelem komunikuj česky** (chat, vysvětlení, shrnutí, popisy v PR).
Identifikátory v kódu, JSDoc, a Conventional Commits hlavičky (`feat:`,
`fix:`, …) zůstávají anglicky.

> ⚠️ Po kompresi konverzace má default Claude chování tendenci spadnout zpátky
> na angličtinu — explicitně se na to po každé kompresi zkontroluj dřív, než
> odpovíš.

---

## 2. Commit + push policy

**Po každé schválené úpravě udělej `git commit` a `git push origin main`
automaticky.** Výjimky:

- Uživatel v dané zprávě explicitně řekne „jen ukaž", „necommituj" apod.
- Změna není dokončená / je rozpracovaná napříč více kroky — počkej na
  uživatelův pokyn po dokončení celé série.

Mód byl přepnut **2026-04-28** z původního „necommituj bez pokynu" → tohle.

> ⚠️ Po kompresi konverzace má default Claude chování tendenci se vrátit
> k necommitování — kontroluj.

---

## 3. Žádné automatické připojení na produkční VPS

Claude Code se **nepřipojuje k produkčnímu serveru automaticky**. Generuje
skripty a příkazy, uživatel je spouští sám v Termiusu (případně přes GitHub
Actions po merge do `main`). Detail viz `CLAUDE.md` kap. 9.

---

## 4. Fáze projektu — checkpoint po každé fázi

Na konci každé fáze (viz `CLAUDE.md` kap. 8) **se zastav a ukaž, co bylo
uděláno** — čekej na souhlas před zahájením další fáze.

---

## 5. Neimprovizovat u zásadních rozhodnutí

Pokud něco není jisté nebo jde o zásadní rozhodnutí (datový model,
deployment, bezpečnost, anonymizace) — **zeptej se, neimprovizuj.**

---

## 6. Design-call etiketa

Když oprava bugu otevírá **designovou volbu** (ne jen technický detail),
zeptej se před implementací. Nerozhoduj sám podle vlastního vkusu.

**Konkrétní typy věcí, na které dát pozor:**

- **Dedup logiky** — skrýt duplicitní položku, nebo ukázat jak je?
- **Fallback chování** — vrátit defaultní hodnotu, nebo error?
- **Formátování** — zaokrouhlit, nebo přesné číslo?
- **Threshold konstanty** — kdy se aktivuje fallback, jakou má hranici?

**Jak otázku položit:**

- Krátká, 2–3 řádky. Ne mini-plán.
- Typicky: „Mám to A, nebo B?" + jedna věta kontextu ke každé variantě.
- Cílem je nechat uživatele rychle vybrat, ne ho zatížit dokumentem.

Pokud spěchá nebo to vypadá triviálně, udělej odhad **ale napiš v reportu**,
že to byla design volba a co druhá varianta by znamenala — ať může korigovat
zpětně.

**Incident-base:** 2026-05-19, karta „Nejvzdálenější nález" na `/statistiky` —
volil jsem mezi „vždy ukázat reálně nejvzdálenější (i když duplikuje
nejnovější)" a „druhý nejvzdálenější při kolizi". Šel jsem do druhé varianty
podle vlastního vkusu, uživatel korigoval — chtěl první variantu, protože
karta má sémanticky odlišný framing (vzdálenost + mapa vs. datum).

---

## 7. Code & commit konvence (rekap)

Detaily v `CLAUDE.md` kap. 7. Stručně:

- **Conventional Commits** v hlavičce: `feat(scope):`, `fix(scope):`,
  `chore:`, `docs:`, `refactor:`.
- **TypeScript strict.** Kód anglicky, UI texty česky.
- **Před push:** `pnpm lint && pnpm typecheck && pnpm test`.
