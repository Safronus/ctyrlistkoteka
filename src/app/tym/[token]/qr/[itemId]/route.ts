import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { CREW_TOKEN_RE, crewCookieName, crewCookieOk } from "@/lib/crewMap";
import { renderDropItemQr } from "@/lib/admin/dropQrRender";

/**
 * One card's QR code, for the crew page's list.
 *
 * Served per card rather than baked into the page: a wave is a hundred
 * cards and a hundred inline SVGs is a megabyte of HTML that most visits
 * never look at. Behind `<img loading="lazy">` the browser fetches only
 * the codes actually scrolled to, and only when the operator has switched
 * previews on.
 *
 * Gated by exactly the same two locks as the page it belongs to — the
 * unguessable token in the path AND the area's password, proven by the
 * cookie. An unauthenticated request gets a 404, not a 401: the whole
 * surface behaves as if it were not there.
 */

export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not found", { status: 404 });

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string; itemId: string }> },
) {
  const { token, itemId } = await ctx.params;
  if (!CREW_TOKEN_RE.test(token)) return NOT_FOUND();
  const id = Number(itemId);
  if (!Number.isInteger(id) || id <= 0) return NOT_FOUND();

  const area = await prisma.dropArea.findUnique({
    where: { crewToken: token },
    select: { campaignId: true, crewPassword: true },
  });
  if (!area?.crewPassword) return NOT_FOUND();

  const jar = await cookies();
  if (!crewCookieOk(jar.get(crewCookieName(token))?.value, token, area.crewPassword)) {
    return NOT_FOUND();
  }

  // The card has to belong to the same wave as the area whose link this
  // is — otherwise one crew's password would render another wave's codes.
  const item = await prisma.dropItem.findFirst({
    where: { id, campaignId: area.campaignId },
    include: { campaign: true },
  });
  if (!item) return NOT_FOUND();

  const { svg } = renderDropItemQr(item);
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // Private: the response is only meaningful to this browser, and a
      // shared cache must never hand it to somebody without the cookie.
      "Cache-Control": "private, max-age=3600",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
