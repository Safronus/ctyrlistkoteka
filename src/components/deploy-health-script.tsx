/**
 * Inline nonced script that catches the "unstyled but not crashed" state a
 * deploy can leave a page in. When a build is cancelled mid-flight the old
 * PM2 process keeps serving HTML that points at hashed CSS/JS the rebuilt
 * `.next` no longer has → those assets 4xx. The page then renders as raw,
 * unstyled server HTML: nothing throws (so `global-error` never fires) and
 * often the client bundle is dead too (so a React-based guard would never
 * hydrate). Only an INLINE script, shipped in the SSR HTML itself, still
 * runs — so the detection lives here rather than in a component.
 *
 * It watches the stylesheet <link>s for an `error` event and, as a fallback
 * for a failure that happened before it attached, probes on `window.load`
 * (by then every render-blocking sheet has resolved, so a `.hidden` probe
 * that isn't `display:none` means the app CSS is genuinely missing — no
 * slow-load false positive). On a hit it paints a self-contained clover
 * "updating…" overlay and hard-reloads (throttled to once/20 s, capped) to
 * pick up the finished build.
 *
 * Mirrors ThemeScript: reads `x-nonce` (from src/middleware.ts) so the
 * production nonce-only CSP allows this one inline <script>.
 */
import { headers } from "next/headers";

const SOURCE = `
(function () {
  var RELOAD_AT = 'ctyr-deploy-reload-at';
  var RELOAD_N = 'ctyr-deploy-reload-count';
  var MAX_RELOADS = 10;

  function stylesMissing() {
    if (!document.body) return false;
    var p = document.createElement('div');
    p.className = 'hidden';
    p.setAttribute('aria-hidden', 'true');
    document.body.appendChild(p);
    var d = getComputedStyle(p).display;
    if (p.parentNode) p.parentNode.removeChild(p);
    return d !== 'none';
  }

  function show() {
    if (document.getElementById('ctyr-deploy-overlay')) return;
    var st = document.createElement('style');
    st.textContent = '@keyframes ctyr-dh-bob{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-11px) rotate(4deg)}}';
    document.head.appendChild(st);
    var o = document.createElement('div');
    o.id = 'ctyr-deploy-overlay';
    o.setAttribute('role', 'alert');
    o.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;background:radial-gradient(1100px 620px at 50% -8%,#eafaea 0%,#dff2df 45%,#cdeccd 100%);font-family:ui-sans-serif,system-ui,-apple-system,\\'Segoe UI\\',Roboto,Arial,sans-serif;color:#14532d';
    o.innerHTML =
      '<div style="font-size:84px;line-height:1;animation:ctyr-dh-bob 3s ease-in-out infinite">🍀</div>' +
      '<div style="margin-top:16px;font-size:22px;font-weight:700">Web se právě aktualizuje…</div>' +
      '<div style="margin-top:8px;font-size:15px;color:#3f7150;max-width:420px">Chytám novou verzi. Štěstí přece neuteče. 😇</div>';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '🍀 Zkusit hned';
    btn.style.cssText = 'margin-top:22px;border:none;border-radius:999px;background:#15803d;color:#fff;padding:11px 22px;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 6px 16px rgba(21,128,61,0.35)';
    btn.onclick = function () { location.reload(); };
    o.appendChild(btn);
    document.body.appendChild(o);

    try {
      var last = Number(sessionStorage.getItem(RELOAD_AT) || '0');
      var n = Number(sessionStorage.getItem(RELOAD_N) || '0');
      if (n < MAX_RELOADS && Date.now() - last > 20000) {
        setTimeout(function () {
          try {
            sessionStorage.setItem(RELOAD_AT, String(Date.now()));
            sessionStorage.setItem(RELOAD_N, String(n + 1));
          } catch (e) {}
          location.reload();
        }, 4000);
      }
    } catch (e) {}
  }

  function attach() {
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) links[i].addEventListener('error', show);
  }
  function probe() { if (stylesMissing()) show(); }
  function ready() {
    attach();
    if (document.readyState === 'complete') probe();
    else window.addEventListener('load', probe);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();
`;

export async function DeployHealthScript() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SOURCE }} />;
}
