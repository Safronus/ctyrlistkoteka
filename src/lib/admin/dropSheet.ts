import { createHash } from "node:crypto";

/**
 * Pulling the wave's workbook back out of Google Sheets.
 *
 * Deliberately fetched as **xlsx**, not CSV. The obvious choice would be
 * the CSV endpoint — no parsing library, smaller payload — and it would
 * be wrong here: the landing-page texts are multi-paragraph, so nearly
 * every row contains embedded newlines and commas. CSV survives that only
 * with quoting that has to be parsed exactly right, and any mistake shows
 * up as a card whose text is silently truncated mid-sentence.
 *
 * Asking Google for xlsx means the SAME parser reads the same format
 * whether the file arrived by upload or by link, so the two paths cannot
 * drift apart in their idea of what a row means.
 *
 * Read-only, unauthenticated: it works because the document is shared
 * "anyone with the link can view". Nothing is ever written back — see
 * docs/admin-overview.md for why that direction was dropped.
 */

/** Google's own limit is 10 MB for this endpoint; ours is about the size
 *  of a wave, and a bigger response means the link points at something
 *  other than our sheet. */
const MAX_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

export interface SheetRef {
  documentId: string;
  /** Canonical URL for the admin to display back. */
  normalizedUrl: string;
}

/**
 * Pulls the document id out of whatever the operator pasted.
 *
 * Accepts the edit URL, a share URL, the /d/e/ published form, or a bare
 * id — because all four are things Google hands out and none of them is
 * obviously "the" link.
 */
export function parseSheetUrl(input: string): SheetRef | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  // A bare id: 20+ of Google's file-id alphabet and nothing else.
  if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) {
    return { documentId: raw, normalizedUrl: docUrl(raw) };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/i.test(url.hostname)) return null;

  // /spreadsheets/d/<id>/…  and  /spreadsheets/d/e/<publishId>/pubhtml
  const parts = url.pathname.split("/").filter(Boolean);
  const dIdx = parts.indexOf("d");
  if (dIdx === -1 || parts.length <= dIdx + 1) return null;
  const id = parts[dIdx + 1] === "e" ? parts[dIdx + 2] : parts[dIdx + 1];
  if (!id || !/^[A-Za-z0-9_-]{20,}$/.test(id)) return null;

  return { documentId: id, normalizedUrl: docUrl(id) };
}

function docUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

export interface FetchedSheet {
  bytes: Buffer;
  /** Content fingerprint — an unchanged sheet costs nothing to skip. */
  hash: string;
}

export class SheetFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Downloads the whole spreadsheet as a workbook.
 *
 * Failures are translated into something an operator can act on, because
 * the two that actually happen — the sheet stopped being shared, and the
 * link points at a Drive file that isn't a spreadsheet — both arrive as a
 * bare HTTP status that says nothing.
 */
export async function fetchSheetWorkbook(
  ref: SheetRef,
  signal?: AbortSignal,
): Promise<FetchedSheet> {
  const url = `https://docs.google.com/spreadsheets/d/${ref.documentId}/export?format=xlsx`;

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(url, {
    redirect: "follow",
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  }).catch((e: unknown) => {
    throw new SheetFetchError(
      `Tabulku se nepodařilo stáhnout: ${e instanceof Error ? e.message : "spojení selhalo"}`,
    );
  });

  if (res.status === 401 || res.status === 403) {
    throw new SheetFetchError(
      "Google odmítl přístup — tabulka není sdílená. Nastav „Kdokoli s odkazem: Čtenář“.",
      res.status,
    );
  }
  if (res.status === 404) {
    throw new SheetFetchError(
      "Tabulka na tomhle odkazu neexistuje (nebo byla smazána).",
      404,
    );
  }
  if (!res.ok) {
    throw new SheetFetchError(`Google odpověděl ${res.status}.`, res.status);
  }

  const type = res.headers.get("content-type") ?? "";
  // An unshared document answers 200 with the sign-in PAGE rather than a
  // file, which would otherwise reach the parser as "corrupt workbook".
  if (type.includes("text/html")) {
    throw new SheetFetchError(
      "Odkaz vrátil přihlašovací stránku místo souboru — tabulka nejspíš není sdílená veřejně.",
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new SheetFetchError("Google vrátil prázdný soubor.");
  }
  if (buf.byteLength > MAX_BYTES) {
    throw new SheetFetchError(
      `Soubor má ${Math.round(buf.byteLength / 1024 / 1024)} MB — to není naše tabulka.`,
    );
  }
  // xlsx is a zip; anything else means the link isn't a spreadsheet.
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new SheetFetchError(
      "Stažený soubor není tabulka. Míří odkaz opravdu na Google Sheets?",
    );
  }

  return {
    bytes: buf,
    hash: createHash("sha256").update(buf).digest("hex"),
  };
}
