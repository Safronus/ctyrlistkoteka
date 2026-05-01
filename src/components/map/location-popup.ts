import { formatLocationId, locationDetailHref } from "@/lib/format";

const NF_CS = new Intl.NumberFormat("cs-CZ");

/**
 * Renders the content for a Leaflet popup bound to a location polygon
 * or dot. Inline styles only — Leaflet's popup DOM lives outside the
 * usual Tailwind CSS reach by virtue of being injected into the
 * `.leaflet-popup-content` element, and global utility classes can
 * collide with Leaflet's own popup styling. Keeping the look local
 * also means the markup is portable to the dots layer without dragging
 * an external stylesheet along.
 *
 * The "Detail lokality" / "Ukázat nálezy" links give the visitor every
 * action they need without leaving the popup — the polygon/dot click
 * handler already selects + centres the location.
 */
export function buildLocationPopupHtml(params: {
  id: number;
  code: string;
  displayName: string;
  findCount: number;
  isGone: boolean;
  isChild: boolean;
}): string {
  const { id, code, displayName, findCount, isGone, isChild } = params;
  const idLabel = formatLocationId(id);
  const detailHref = locationDetailHref(id);
  const sbirkaHref = `/sbirka?loc=${id}`;
  const titleText = displayName && displayName !== code ? code : code;
  const sub =
    displayName && displayName !== code ? escapeHtml(displayName) : "";
  const badges: string[] = [];
  if (isChild) {
    badges.push(
      `<span style="display:inline-block;padding:1px 6px;border-radius:9999px;background:#e0f2fe;color:#075985;font-size:10px;font-weight:500;letter-spacing:0.02em;">dílčí část</span>`,
    );
  }
  if (isGone) {
    badges.push(
      `<span style="display:inline-block;padding:1px 6px;border-radius:9999px;background:#ffe4e6;color:#9f1239;font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Zaniklá</span>`,
    );
  }

  const badgesRow =
    badges.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">${badges.join("")}</div>`
      : "";

  const subRow = sub
    ? `<div style="color:#4b5563;font-size:12px;line-height:1.3;margin-top:2px;">${sub}</div>`
    : "";

  // Two compact link buttons: detail page + filtered finds list. Kept
  // small (11 px font, 3 px vertical padding) so the popup height stays
  // close to the headline content even on narrow tiles like the example
  // ZLÍN_JSVAHY-UTB-U5-001 where the longer label "Ukázat nálezy →"
  // would otherwise wrap. Inline styles so Tailwind's preflight can't
  // touch them via class collisions inside leaflet-popup-content.
  const linksRow = `
    <div style="display:flex;gap:5px;margin-top:6px;">
      <a href="${detailHref}"
         style="flex:1;display:inline-flex;align-items:center;justify-content:center;padding:3px 6px;border:1px solid #e5e7eb;border-radius:5px;font-size:11px;font-weight:500;color:#1f5e1c;text-decoration:none;background:white;white-space:nowrap;line-height:1.3;">
        Detail&nbsp;lokality&nbsp;→
      </a>
      <a href="${sbirkaHref}"
         style="flex:1;display:inline-flex;align-items:center;justify-content:center;padding:3px 6px;border:1px solid #e5e7eb;border-radius:5px;font-size:11px;font-weight:500;color:#1f5e1c;text-decoration:none;background:white;white-space:nowrap;line-height:1.3;">
        Ukázat&nbsp;nálezy&nbsp;→
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
      <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#1f5e1c;font-weight:600;">${NF_CS.format(findCount)}</span>
      <span style="color:#6b7280;font-size:12px;"> ${pluralFinds(findCount)}</span>
    </div>
    ${linksRow}
  </div>`;
}

function pluralFinds(n: number): string {
  if (n === 1) return "nález";
  if (n >= 2 && n <= 4) return "nálezy";
  return "nálezů";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
