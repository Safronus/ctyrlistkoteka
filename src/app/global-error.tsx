"use client";

import { DeployScene } from "@/components/deploy-scene";

/**
 * Global error boundary — replaces the whole app (root layout included) when
 * something throws at the top level. The usual real-world trigger is a
 * DEPLOY: a browser holding the old HTML asks for a hashed chunk the new
 * build already replaced → ChunkLoadError. Instead of Next's bleak default
 * ("Application error: a client-side exception has occurred"), show the
 * friendly clover scene; for the deploy/chunk case it auto-reloads to pick
 * up the new build.
 *
 * The visuals live in DeployScene (shared with DeployHealthGuard, which
 * catches the unstyled-but-not-crashed mid-deploy case). global-error still
 * renders its own <html>/<body> because it runs OUTSIDE the app's providers
 * and global stylesheet.
 */

function isChunkError(error?: { name?: string; message?: string }): boolean {
  const s = `${error?.name ?? ""} ${error?.message ?? ""}`;
  return /chunk|loading (css )?chunk|dynamically imported|failed to fetch|import\(/i.test(
    s,
  );
}

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="cs">
      <body style={{ margin: 0 }}>
        <DeployScene mode={isChunkError(error) ? "deploy" : "error"} />
      </body>
    </html>
  );
}
