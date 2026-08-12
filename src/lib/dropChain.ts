import type { DropLang } from "@/lib/dropText";

/**
 * "Řetězec čtyřlístků" — a hunt through a subset of one area.
 *
 * The idea: some of an area's cards are strung into an order. Whoever
 * finds card 3 gets, on its landing page, a hint towards card 4 — and
 * only there. The chain therefore cannot be walked from a desk: each step
 * needs the previous card in hand, because the page that reveals a hint
 * is reached by scanning a printed QR.
 *
 * What is revealed is the next card's HINT — free text like "u laviček v
 * parku", never its coordinates and never its token. The same rule as
 * `getPublishedDropHint`: the hunt gets a nudge, not a map.
 *
 * Off by default, per area. A card outside the chain (`chainOrder` null)
 * behaves exactly as it did before this existed.
 */

/**
 * In the chain, or not.
 *
 * `!= null` rather than `!== null` on purpose: a Prisma `select` that
 * forgets `chainOrder` hands back `undefined`, and a strict comparison
 * would then read every card in the area as chained — quietly switching
 * a hunt on for a whole wave. It cost one confused minute in the admin
 * already, where a stale client did exactly that.
 */
function inChain(i: Pick<ChainItem, "chainOrder">): boolean {
  return i.chainOrder != null;
}

/** What the chain needs to know about one card. */
export interface ChainItem {
  id: number;
  findId: number;
  chainOrder: number | null;
  hintCs: string | null;
  hintEn: string | null;
  /** Someone has already found this one — worth saying so. */
  foundAt: Date | null;
}

export type ChainMode = "random" | "findId";

export interface ChainStep {
  /** The next card in the chain. */
  next: ChainItem;
  /** Its hint, in the visitor's language, or null when none is written. */
  hint: string | null;
  /** Position of the CURRENT card, 1-based, and how long the chain is. */
  position: number;
  total: number;
  /** The next one has already been found by somebody. */
  alreadyFound: boolean;
}

/**
 * The step after the current card, or null when it is the last (or is not
 * in the chain at all).
 *
 * Takes the whole area's cards and filters here rather than trusting the
 * caller to pass only chained ones — the landing page loads an area's
 * items for other reasons too, and a stray unchained card silently
 * shifting everyone's position is exactly the bug this hides.
 */
export function chainStep(
  current: Pick<ChainItem, "chainOrder">,
  areaItems: readonly ChainItem[],
  campaignHint: { hintCs: string | null; hintEn: string | null },
  lang: DropLang,
): ChainStep | null {
  if (!inChain(current)) return null;
  const chain = areaItems
    .filter(inChain)
    .sort((a, b) => a.chainOrder! - b.chainOrder!);
  const at = chain.findIndex((i) => i.chainOrder === current.chainOrder);
  if (at === -1) return null;
  const next = chain[at + 1];
  if (!next) return null;
  return {
    next,
    hint: resolveChainHint(next, campaignHint, lang),
    position: at + 1,
    total: chain.length,
    alreadyFound: next.foundAt !== null,
  };
}

/** True when the current card is the chain's last link. */
export function isChainEnd(
  current: Pick<ChainItem, "chainOrder">,
  areaItems: readonly ChainItem[],
): boolean {
  if (!inChain(current)) return false;
  return !areaItems.some((i) => inChain(i) && i.chainOrder! > current.chainOrder!);
}

/**
 * The hint text to reveal: the card's own, else the wave's, else nothing.
 *
 * Same per-field, per-language fallback as `resolveDropText` — an English
 * visitor is better served by the Czech hint than by an empty box.
 */
export function resolveChainHint(
  item: Pick<ChainItem, "hintCs" | "hintEn">,
  campaign: { hintCs: string | null; hintEn: string | null },
  lang: DropLang,
): string | null {
  const order =
    lang === "en"
      ? [item.hintEn, item.hintCs, campaign.hintEn, campaign.hintCs]
      : [item.hintCs, item.hintEn, campaign.hintCs, campaign.hintEn];
  for (const v of order) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) return s;
  }
  return null;
}

/**
 * Puts the chosen cards in order.
 *
 * `findId` walks them by find number — the order the wave was assembled
 * in, which is also the order they sit in the admin. `random` shuffles
 * (Fisher–Yates, so every permutation is equally likely; the naive
 * sort-by-random is not). The RNG is an argument so a test can pin the
 * result and so "promíchat znovu" is genuinely a different draw.
 *
 * Returns ids in order; the caller writes 1..N onto them.
 */
export function buildChainOrder(
  items: readonly { id: number; findId: number }[],
  mode: ChainMode,
  rng: () => number = Math.random,
): number[] {
  const byFind = [...items].sort((a, b) => a.findId - b.findId);
  if (mode === "findId") return byFind.map((i) => i.id);
  const out = byFind.map((i) => i.id);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
