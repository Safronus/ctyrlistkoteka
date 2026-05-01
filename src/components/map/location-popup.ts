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
 * The "Detail lokality" / "Ukázat nálezy" links + the "dvojklik" hint
 * give the visitor everything they need to act on the highlighted spot
 * without going back to the sidebar; the dvojklik shortcut mirrors the
 * dblclick handler the polygon/dot layers register on the map.
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

  // Two-button row: detail page + filtered finds list. Keep the button
  // styles inline so they don't depend on Tailwind's preflight.
  const linksRow = `
    <div style="display:flex;gap:6px;margin-top:8px;">
      <a href="${detailHref}"
         style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:5px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;font-weight:500;color:#1f5e1c;text-decoration:none;background:white;">
        Detail lokality →
      </a>
      <a href="${sbirkaHref}"
         style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:5px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;font-weight:500;color:#1f5e1c;text-decoration:none;background:white;">
        Ukázat nálezy →
      </a>
    </div>`;

  return `<div style="min-width:220px;font-family:inherit;">
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
    <div style="margin-top:6px;font-size:11px;color:#9ca3af;line-height:1.3;">
      Tip: dvojklik na lokalitu otevře detail
    </div>
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
