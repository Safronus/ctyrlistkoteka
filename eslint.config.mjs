import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import security from "eslint-plugin-security";
import sonarjs from "eslint-plugin-sonarjs";
import jsxA11y from "eslint-plugin-jsx-a11y";
import noUnsanitized from "eslint-plugin-no-unsanitized";

/**
 * Downgrade every `error` in a preset to `warn`. The audit layers below run
 * as advisories: they surface issues in `pnpm lint` output without failing
 * the deploy-gating exit code, so we can burn down the backlog incrementally
 * rather than in one blocking sweep. High-signal rules are re-raised to
 * `error` in the tuning block afterwards.
 */
const asWarnings = (preset) => ({
  ...preset,
  rules: Object.fromEntries(
    Object.entries(preset.rules ?? {}).map(([id, val]) => {
      const sev = Array.isArray(val) ? val[0] : val;
      const isError = sev === "error" || sev === 2;
      if (!isError) return [id, val];
      return [id, Array.isArray(val) ? ["warn", ...val.slice(1)] : "warn"];
    }),
  ),
});

const eslintConfig = [
  // eslint-config-next 16 ships native flat config (arrays of config
  // objects), so these are spread directly. Up to v15 they were legacy
  // `.eslintrc` presets pulled in through `FlatCompat.extends()` — that
  // path now throws "Converting circular structure to JSON".
  ...nextCoreWebVitals,
  ...nextTypescript,

  // --- Audit layers (quality + security) on top of Next's config ---
  // jsx-a11y: pull in the fuller recommended RULES only — Next still
  // registers the plugin itself, so re-adding it throws "Cannot redefine".
  //
  // The `files` glob is required and must match the one Next scopes its
  // plugin registration to (its "next" config object). Under flat config a
  // plugin is only visible to config objects covering the same files: an
  // unscoped rules block also applies to files outside Next's glob, where
  // the plugin doesn't exist, and ESLint then fails with "could not find
  // plugin jsx-a11y". Keep the two globs in sync.
  asWarnings({
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: { ...jsxA11y.flatConfigs.recommended.rules },
  }),
  // SonarJS: bug patterns + maintainability (the "SONAR" ruleset, local).
  asWarnings(sonarjs.configs.recommended),
  // eslint-plugin-security: Node/JS security anti-patterns.
  asWarnings(security.configs.recommended),
  // no-unsanitized: DOM-XSS sinks (innerHTML etc.).
  asWarnings(noUnsanitized.configs.recommended),

  {
    // Same glob as Next's plugin registration — see the jsx-a11y note above.
    // Required because these rules are set to `warn`; a rule turned fully
    // `off` is tolerated without the plugin in scope, a `warn` is not.
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      // -- React Compiler rules, new in eslint-config-next 16 --
      // These ship as `error` and produced 41 findings on code that was
      // clean under v15. Demoted to `warn` so they stay visible without
      // gating the deploy — the same "audit layers are advisories" approach
      // used for the presets above.
      //
      // `purity` in particular is a false positive here: every hit is
      // `Date.now()` (the `?debug=timing` instrumentation in /sbirka) or
      // `Math.random()` (the placeholder easter egg) inside a *Server*
      // Component, which renders once per request — not the client re-render
      // loop the rule is written for.
      //
      // `set-state-in-effect` (16×, in mapa-shell / theme-toggle /
      // collapsible-section / main-nav) is the one worth actually burning
      // down: those are real client components and the pattern can cause
      // cascading renders. Left as a warning for now, not silenced.
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      // typescript-eslint's recommended set raises this to `error` in v16;
      // it was advisory before. 10 hits, all deliberate `any` at untyped
      // boundaries (EXIF tags, raw SQL rows).
      "@typescript-eslint/no-explicit-any": "warn",

      // -- Off: near-zero signal for this data-driven, fs-backed app --
      "security/detect-object-injection": "off",
      "security/detect-non-literal-fs-filename": "off",
      "sonarjs/no-duplicate-string": "off",
      "sonarjs/todo-tag": "off",
      "sonarjs/no-commented-code": "off",
      // -- Off: high-volume maintainability/style, not bugs or security --
      "sonarjs/cognitive-complexity": "off",
      "sonarjs/no-nested-conditional": "off",
      "sonarjs/no-nested-functions": "off",
      "sonarjs/no-nested-template-literals": "off",
      "sonarjs/use-type-alias": "off",
      // -- Off: consistently false-positive / pure style in THIS codebase.
      //    Every hit was reviewed (also on SonarCloud) — none is a real bug
      //    or security issue, so they were just noise in the deploy log. --
      // Math.random() is only ever used for UI jitter / particle timing /
      // fact shuffling — never tokens or crypto (those use node:crypto).
      "sonarjs/pseudo-random": "off",
      // SHA-1 is used for content-addressed image filenames + vote/rate
      // fingerprints — dedup / bucketing, not a security primitive.
      "sonarjs/hashing": "off",
      // Regex micro-style: `[0-9]`→`\d`, `(a|b)`→`[ab]`. Cosmetic.
      "sonarjs/concise-regex": "off",
      "sonarjs/single-character-alternation": "off",
      // Autofocus is deliberate in the admin dialogs / inline editors
      // (single-user tool — the field the user just opened should be hot).
      "jsx-a11y/no-autofocus": "off",
      // Click/interaction handlers on non-interactive elements. Every hit
      // is a modal backdrop or a decorative overlay that closes on outside
      // click — always paired with Escape + a real close <button>. Genuine
      // controls use <button>/<a>. Off to keep the log meaningful; the
      // substantive a11y rules (alt text, labels, roles, aria) stay on.
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/no-static-element-interactions": "off",
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      // -- Re-raise to error: high-signal, currently zero occurrences,
      //    so they guard the future without breaking today's build --
      // `method` over-matches dynamic import() (a false positive on
      // next-intl's locale loader) — keep it advisory; `property`
      // (innerHTML-style assignment, the real XSS sink) stays hard.
      "no-unsanitized/method": "warn",
      "no-unsanitized/property": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-child-process": "error",
    },
  },

  {
    ignores: [
      "src/generated/**",
      ".next/**",
      "node_modules/**",
      "prisma/migrations/**",
      "tmp/**",
    ],
  },
];

export default eslintConfig;
