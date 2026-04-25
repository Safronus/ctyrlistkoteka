/**
 * Inline blocking script that sets `data-theme` on <html> before the
 * page paints. Without this the user would see a single-frame flash
 * of the @theme defaults on every navigation/reload before our React
 * effect runs. Runs synchronously, must stay tiny.
 */
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

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SOURCE }} />;
}
