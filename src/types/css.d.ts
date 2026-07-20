/**
 * Side-effect imports of stylesheets (`import "./globals.css"`,
 * `import "leaflet/dist/leaflet.css"`). The bundler handles these; TypeScript
 * just needs to know the modules exist.
 *
 * Required since TypeScript 6.0, which flipped `noUncheckedSideEffectImports`
 * to `true` by default — without these declarations `tsc` fails with
 * "TS2882: Cannot find module or type declarations for side-effect import".
 *
 * Declaring the patterns is deliberately preferred over switching the flag
 * back off: the check still catches a genuinely mistyped or missing module in
 * every other side-effect import.
 */
declare module "*.css";
declare module "*.scss";
