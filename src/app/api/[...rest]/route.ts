import { NextResponse } from "next/server";

/**
 * Any `/api/…` path no route handles. Without this, an unknown API path fell
 * through to `[locale]/[...rest]` with `locale = "api"` and answered with a
 * full HTML page that echoes the path.
 *
 * The answer is the same bare 404 the `/api/admin/*` routes give a caller
 * who isn't signed in, and the Nginx admin cloak rewrites a refused
 * `/api/admin/…` request onto this catch-all (`/api/__cloak/…`) — so from
 * outside, `/api/admin/<anything>` is indistinguishable from
 * `/api/<anything>`. Keep it free of anything request-specific.
 * Specific routes always win over a catch-all, so this only sees what
 * nothing else matched.
 */
export const dynamic = "force-dynamic";

function notFound(): NextResponse {
  return new NextResponse("Not found", { status: 404 });
}

export {
  notFound as GET,
  notFound as HEAD,
  notFound as POST,
  notFound as PUT,
  notFound as PATCH,
  notFound as DELETE,
  notFound as OPTIONS,
};
