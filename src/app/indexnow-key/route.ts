import { INDEXNOW_KEY } from "@/lib/indexnow";

/**
 * Serves the IndexNow key so the IndexNow servers can verify ownership
 * (referenced as `keyLocation` in the ping). Plain text, the key value
 * only. Excluded from the i18n middleware (see src/middleware.ts matcher).
 */
export const dynamic = "force-static";

export function GET() {
  return new Response(INDEXNOW_KEY, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
