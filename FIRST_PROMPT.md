# První prompt pro Claude Code

Tento soubor obsahuje **přesné zadání**, které v Claude Code vložíš jako první
zprávu po inicializaci projektu. Claude Code si přečte `CLAUDE.md` a všechny
soubory v `docs/`, a podle nich začne stavět projekt.

---

## Příprava před spuštěním Claude Code

1. **Vytvoř si GitHub repo** (privátní):
   ```bash
   gh auth login                                # pokud ještě nejsi přihlášen
   gh repo create ctyrlistkoteka --private --clone
   cd ctyrlistkoteka
   ```

2. **Rozbal do něj tenhle balíček** (obsah `ctyrlistkoteka-starter.zip`):
   ```bash
   # Přepiš / doplň soubory z balíčku do složky repa
   unzip /cesta/k/ctyrlistkoteka-starter.zip -d .
   ```

3. **Initial commit:**
   ```bash
   git add .
   git commit -m "chore: initial project setup documents"
   git push -u origin main
   ```

4. **V rootu repa spusť Claude Code:**
   ```bash
   claude
   ```

---

## Zpráva pro Claude Code

Zkopíruj následující (všechno mezi čárami) a pošli jako první prompt:

---

```
Ahoj. Dostal jsi do rukou nový projekt "Čtyřlístkotéka" — veřejnou prezentaci
sbírky čtyřlístků. Mám připravené zadání a potřebuji tvou pomoc s implementací.

KROK 1: Přečti si CLAUDE.md. Je to můj závazný briefing pro tento projekt.
Potom přečti všechny soubory v docs/. Nespěchej, věnuj tomu pozornost — ty
dokumenty obsahují datový model, konvence názvů souborů, sync workflow i
deployment postup.

KROK 2: Po přečtení mi stručně shrň:
  - co projekt má dělat (tvými slovy)
  - jaké jsou tři největší technické výzvy dle tebe
  - co ti přijde nejasné nebo protichůdné (pokud něco)
  - v jakém pořadí bys postupoval (potvrdíme si fáze z kapitoly 8 v CLAUDE.md)

KROK 3: POKUD JE VŠE JASNÉ, začneme Fází 1 (Scaffolding). Cíl fáze:
funkční Next.js 15 projekt s TypeScriptem, Tailwind v4, Prismou, Docker Compose
a zástupnými stránkami, který běží na localhost:3000. Žádná data zatím, jen
kostra a layout se čtyřmi prázdnými stránkami (Domů / Sbírka / Mapa / Statistiky).

ZÁVAZNÁ PRAVIDLA PRÁCE:
  1. Na konci každé fáze se zastav a ukaž mi co jsi udělal. Pak čekej na souhlas
     před další fází.
  2. Nic necommituj bez mého pokynu. Commity a push dělám já, nebo když ti to
     explicitně řeknu.
  3. Nepřipojuj se k produkčnímu VPS automaticky. Generuj skripty a příkazy,
     já je pustím v Termiusu.
  4. Pokud něco nevíš jistě nebo narazíš na rozhodnutí, zeptej se. Neimprovizuj
     na zásadních věcech (datový model, deployment, bezpečnost).
  5. Dodržuj konvence z CLAUDE.md (Conventional Commits, TS strict, kód anglicky,
     UI česky).

Začni tím, že mi napíšeš výstup z KROKU 2. Potom čekej na můj pokyn k Fázi 1.
```

---

## Po každé fázi

Když Claude Code dokončí fázi, ověř:

- Dělá věc, o kterou jsi žádal?
- Splňuje cíl definovaný v CLAUDE.md kapitole 8?
- Nepřidal něco navíc, co se mu „zdálo rozumné"?

Pokud ano, řekni mu `OK, přejdi na Fázi X`. Pokud ne, řekni konkrétně co je špatně.

## Nouzové postupy

- **Claude Code zadrhne nebo se zamotá**: spusť `/clear` a znovu mu řekni
  „Přečti si CLAUDE.md a pokračuj ve Fázi X".
- **Potřebuje přístup k něčemu, co nemá**: spíš ho to odmítni než dávat
  plošná práva. Vše sensitivní si pustíš sám.
- **Vygeneruje SQL/migraci, kterou nechceš**: `pnpm prisma migrate reset`
  před jejím commitem. Neschvaluj naslepo.
