import { NextResponse, type NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getAdminSession, isAuthenticated } from "@/lib/admin/session";
import { getScope, statScopeFile } from "@/lib/admin/scopes";

// Auth-gated streaming endpoint for files outside the public Nginx
// alias (everything in data/ is private; some generated/ files are
// _ANON-blocked at the proxy). Shape: GET /api/admin/file?scope=…&name=…

export const runtime = "nodejs";
// Streamed download — never cache the *response* (per-user) but the
// underlying file's mtime ETag still allows browser conditional GETs.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    // 404 instead of 401 — match the Nginx-side IP cloak so probing
    // /api/admin/file from a logged-out browser tells the attacker
    // nothing about whether the route exists.
    return new NextResponse("Not found", { status: 404 });
  }

  const sp = request.nextUrl.searchParams;
  const scopeSlug = sp.get("scope");
  const name = sp.get("name");
  if (!scopeSlug || !name) {
    return new NextResponse("Bad request", { status: 400 });
  }
  const scope = getScope(scopeSlug);
  if (!scope) {
    return new NextResponse("Unknown scope", { status: 400 });
  }

  let info;
  try {
    info = await statScopeFile(scope, name);
  } catch {
    // safeJoin throws on path traversal — we treat that the same as
    // a 404 to avoid hinting to a probe that the path was rejected
    // for security reasons rather than not existing.
    return new NextResponse("Not found", { status: 404 });
  }
  if (!info) {
    return new NextResponse("Not found", { status: 404 });
  }

  const etag = `W/"${info.size.toString(16)}-${Date.parse(info.mtime).toString(16)}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304 });
  }

  // ReadableStream from a Node stream so Next.js streams the file
  // straight to the response without buffering it in memory. HEIC
  // originals can be 5–30 MB, so this matters.
  const nodeStream = createReadStream(info.absolutePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  const headers = new Headers();
  headers.set("Content-Type", info.contentType);
  headers.set("Content-Length", String(info.size));
  headers.set("ETag", etag);
  headers.set("Cache-Control", "private, max-age=60");
  // Force download for non-image types so the browser can't try to
  // execute the response (defense-in-depth against a malicious file
  // ending up in data/ somehow).
  if (!info.contentType.startsWith("image/")) {
    headers.set(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(info.name)}"`,
    );
  }
  return new NextResponse(webStream, { headers });
}
