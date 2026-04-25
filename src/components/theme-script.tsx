/**
 * Inline blocking script that sets `data-theme` on <html> before the
 * page paints. Without this the user would see a single-frame flash
 * of the @theme defaults on every navigation/reload before our React
 * effect runs. Runs synchronously, must stay tiny.
 *
 * Reads `x-nonce` from the request headers (set by `src/middleware.ts`)
 * and stamps it onto the `<script>` tag so the production CSP — which
 * bans plain `'unsafe-inline'` for scripts — still allows this one to
 * execute. In dev the CSP is relaxed and the nonce is purely belt-
 * and-braces.
 */
import { headers } from "next/headers";

const SOURCE = `
(function() {
  try {
    var t = localStorage.getItem('theme');
    if (t !== 'clover' && t !== 'light' && t !== 'dark') t = 'clover';
    document.documentElement.dataset.theme = t;
  } catch (e) {
    document.documentElement.dataset.theme = 'clover';
  }
})();
`;

export async function ThemeScript() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SOURCE }} />
  );
}
