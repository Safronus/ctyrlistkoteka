import { formatLocationId, locationDetailHref } from "@/lib/format";

export interface LocationPopupLabels {
  /** "dílčí část" / "sub-part" */
  subPart: string;
  /** "Zaniklá" / "Former" */
  gone: string;
  /** "Detail lokality →" / "Location detail →" */
  detail: string;
  /** "Ukázat nálezy →" / "Show finds →" */
  showFinds: string;
  /** Locale-aware "X nálezů" / "X finds" plural label. */
  findsLabel: (count: number) => string;
  /** Locale-aware number formatter (Intl.NumberFormat with the active
   *  locale) — caller resolves it once and hands it down. */
  numFmt: Intl.NumberFormat;
}

/**
 * Renders the content for a Leaflet popup bound to a location polygon
 * or dot. Inline styles only — Leaflet's popup DOM lives outside the
 * usual Tailwind CSS reach, and global utility classes can collide
 * with Leaflet's own popup styling.
 */
export function buildLocationPopupHtml(
  params: {
    id: number;
    code: string;
    displayName: string;
    findCount: number;
    isGone: boolean;
    isChild: boolean;
  },
  labels: LocationPopupLabels,
): string {
  const { id, code, displayName, findCount, isGone, isChild } = params;
  const idLabel = formatLocationId(id);
  const detailHref = locationDetailHref(id);
  const sbirkaHref = `/sbirka?loc=${id}`;
  const titleText = code;
  const sub =
    displayName && displayName !== code ? escapeHtml(displayName) : "";
  const badges: string[] = [];
  if (isChild) {
    badges.push(
      `<span style="display:inline-block;padding:1px 6px;border-radius:9999px;background:#e0f2fe;color:#075985;font-size:10px;font-weight:500;letter-spacing:0.02em;">${escapeHtml(labels.subPart)}</span>`,
    );
  }
  if (isGone) {
    badges.push(
      `<span style="display:inline-block;padding:1px 6px;border-radius:9999px;background:#ffe4e6;color:#9f1239;font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(labels.gone)}</span>`,
    );
  }

  const badgesRow =
    badges.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">${badges.join("")}</div>`
      : "";

  const subRow = sub
    ? `<div style="color:#4b5563;font-size:12px;line-height:1.3;margin-top:2px;">${sub}</div>`
    : "";

  const linksRow = `
    <div style="display:flex;gap:5px;margin-top:6px;">
      <a href="${detailHref}"
         style="flex:1;display:inline-flex;align-items:center;justify-content:center;padding:3px 6px;border:1px solid #e5e7eb;border-radius:5px;font-size:11px;font-weight:500;color:#1f5e1c;text-decoration:none;background:white;white-space:nowrap;line-height:1.3;">
        ${escapeHtml(labels.detail).replace(/ /g, "&nbsp;")}
      </a>
      <a href="${sbirkaHref}"
         style="flex:1;display:inline-flex;align-items:center;justify-content:center;padding:3px 6px;border:1px solid #e5e7eb;border-radius:5px;font-size:11px;font-weight:500;color:#1f5e1c;text-decoration:none;background:white;white-space:nowrap;line-height:1.3;">
        ${escapeHtml(labels.showFinds).replace(/ /g, "&nbsp;")}
      </a>
    </div>`;

  return `<div style="min-width:200px;font-family:inherit;">
    <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;">
      <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#6b7280;">${escapeHtml(idLabel)}</span>
      <strong style="font-size:14px;color:#111827;line-height:1.2;">${escapeHtml(titleText)}</strong>
    </div>
    ${subRow}
    ${badgesRow}
    <div style="margin-top:6px;">
      <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#1f5e1c;font-weight:600;">${labels.numFmt.format(findCount)}</span>
      <span style="color:#6b7280;font-size:12px;"> ${escapeHtml(labels.findsLabel(findCount))}</span>
    </div>
    ${linksRow}
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
