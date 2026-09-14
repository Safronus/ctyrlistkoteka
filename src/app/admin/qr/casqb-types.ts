import type { CasqbStyle } from "@/lib/admin/casqbQr";

/** Raw option bag the CaSQB form sends to its server actions. Every
 *  field is re-validated server-side (`normalizeCasqb`); nothing here is
 *  trusted. Lives apart from the actions file because a "use server"
 *  module may only export async functions. */
export interface CasqbInput {
  label?: string;
  targetUrl?: string;
  style?: Partial<CasqbStyle> | null;
}

export interface CasqbListItem {
  id: number;
  label: string;
  token: string;
  /** What the code encodes (see lib/admin/casqbEncoded.ts). */
  encodedUrl: string;
  targetUrl: string;
  createdAt: string;
  archived: boolean;
  scansTotal: number;
  scans30: number;
  scans7: number;
  afterRetire: number;
  /** Last 14 days, oldest first. */
  spark: number[];
  style: CasqbStyle;
}
