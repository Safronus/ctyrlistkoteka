import { z } from "zod";

/**
 * Special per-find detail effects, assignable from /admin (phase 2).
 * Client-safe: just the types + validation + a pure resolver. The
 * filesystem read/write lives in specialFinds.server.ts.
 */

export const SPECIAL_EFFECTS = ["record", "heavenly", "hellish"] as const;
export type SpecialEffect = (typeof SPECIAL_EFFECTS)[number];

export interface SpecialFind {
  findId: number;
  effect: SpecialEffect;
}

/** Human labels for the admin UI (Czech — admin is CZ-only). */
export const SPECIAL_EFFECT_LABELS: Record<SpecialEffect, string> = {
  record: "Rekord 🏆 (zlatá + tricolor + jiskřičky)",
  heavenly: "Nebeský 😇 (zelená sprška čtyřlístků)",
  hellish: "Pekelný 😈 (uhlíky + rudá vinětace)",
};

export const specialFindSchema = z.object({
  findId: z.number().int().positive(),
  effect: z.enum(SPECIAL_EFFECTS),
});
export const specialFindsSchema = z.array(specialFindSchema);

/** Resolve a find's effect from the assignment list (null = no effect). */
export function effectForFind(
  findId: number,
  list: readonly SpecialFind[],
): SpecialEffect | null {
  return list.find((s) => s.findId === findId)?.effect ?? null;
}
