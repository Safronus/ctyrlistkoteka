import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import { getAdminSession, isAuthenticated } from "@/lib/admin/session";
import { getScope, statScopeFile } from "@/lib/admin/scopes";

// Auth-gated download endpoint for files outside the public Nginx
// alias (everything in data/ is private; some generated/ files are
// _ANON-blocked at the proxy). Shape: GET /api/admin/file?scope=…&name=…

export const runtime = "nodejs";
// Per-user response — never cache the *response*, but the file's
// mtime ETag still allows browser conditional GETs.
export const dynamic = "force-dynamic";

// Hard cap for what this endpoint will serve. Bigger than current
// realities (HEIC ~30 MB) but small enough that a runaway request
// can't OOM the box. If a future scope grows past this, we switch
// that scope to streaming rather than raise the cap blindly.
const MAX_BYTES = 80 * 1024 * 1024;

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
  } catch (err) {
    // safeJoin throws on path traversal — treat that the same as a
    // 404 to avoid hinting to a probe that the path was rejected
    // for security reasons rather than not existing.
    console.error("[admin/file] stat failed", {
      scope: scopeSlug,
      name,
      message: (err as Error).message,
    });
    return new NextResponse("Not found", { status: 404 });
  }
  if (!info) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (info.size > MAX_BYTES) {
    console.error("[admin/file] over size cap", {
      scope: scopeSlug,
      name: info.name,
      size: info.size,
      cap: MAX_BYTES,
    });
    return new NextResponse("Too large", { status: 413 });
  }

  // ETag includes a version tag so caches the previous (broken) stream
  // implementation populated with truncated bytes can no longer match.
  // Bump `v` whenever the response body shape changes incompatibly.
  const etag = `W/"v2-${info.size.toString(16)}-${Date.parse(info.mtime).toString(16)}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304 });
  }

  // Read the whole file into memory. Previous implementation used
  // `Readable.toWeb(createReadStream(...))` but that path was
  // truncating binary responses (~8 bytes received for multi-MB
  // images). Buffering up-front sidesteps every Next.js / undici
  // edge case around Buffer-vs-Uint8Array stream chunks, and at
  // single-user admin scale on a 12 GB box the cost is irrelevant.
  let data: Buffer;
  try {
    data = await fs.readFile(info.absolutePath);
  } catch (err) {
    console.error("[admin/file] read failed", {
      scope: scopeSlug,
      name: info.name,
      path: info.absolutePath,
      code: (err as NodeJS.ErrnoException).code,
      message: (err as Error).message,
    });
    return new NextResponse("Read failed", { status: 500 });
  }

  const headers = new Headers();
  headers.set("Content-Type", info.contentType);
  headers.set("Content-Length", String(data.byteLength));
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
  // Copy the bytes into a fresh Uint8Array<ArrayBuffer>. The runtime
  // accepted a Buffer just fine, but TypeScript's stricter typed-array
  // generics reject Buffer<ArrayBufferLike> as BodyInit. The copy is
  // cheap at admin scale and disambiguates the body type — which also
  // sidesteps whatever caused the previous stream path to truncate
  // multi-MB images down to a handful of bytes.
  const body = new Uint8Array(data.byteLength);
  body.set(data);
  return new NextResponse(body, { headers });
}
