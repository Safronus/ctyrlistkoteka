export type DropLang = "cs" | "en";

/** The text fields a campaign supplies and an item may override. */
export interface DropTextSource {
  headingCs: string | null;
  headingEn: string | null;
  bodyCs: string | null;
  bodyEn: string | null;
  bonusCs: string | null;
  bonusEn: string | null;
}

export interface ResolvedDropText {
  heading: string;
  body: string;
  bonus: string | null;
}

/**
 * Two-step fallback for a card's landing text.
 *
 * 1. Item override, else the campaign's default — a null item field means
 *    "inherit", so re-wording the campaign propagates everywhere that
 *    hasn't been deliberately personalised.
 * 2. Requested language, else Czech — English is optional throughout, and
 *    an English visitor is better served by Czech text than by a blank
 *    page.
 *
 * Both steps are applied per FIELD, not per object: an item that only
 * overrides the bonus keeps the campaign's heading and body, and a
 * campaign translated only in its heading still shows a Czech body.
 */
export function resolveDropText(
  item: DropTextSource,
  campaign: DropTextSource,
  lang: DropLang,
): ResolvedDropText {
  const pick = (key: "heading" | "body" | "bonus"): string | null => {
    const cs = `${key}Cs` as keyof DropTextSource;
    const en = `${key}En` as keyof DropTextSource;
    const wanted = lang === "en" ? en : cs;
    return (
      trimmed(item[wanted]) ??
      trimmed(item[cs]) ??
      trimmed(campaign[wanted]) ??
      trimmed(campaign[cs]) ??
      null
    );
  };

  return {
    heading: pick("heading") ?? "🍀",
    body: pick("body") ?? "",
    bonus: pick("bonus"),
  };
}

function trimmed(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}
