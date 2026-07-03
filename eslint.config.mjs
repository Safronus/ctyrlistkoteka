import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import security from "eslint-plugin-security";
import sonarjs from "eslint-plugin-sonarjs";
import jsxA11y from "eslint-plugin-jsx-a11y";
import noUnsanitized from "eslint-plugin-no-unsanitized";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

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
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // --- Audit layers (quality + security) on top of Next's config ---
  // jsx-a11y: Next already registers the plugin, so pull in its fuller
  // recommended RULES only (re-adding the plugin throws "Cannot redefine").
  asWarnings({ rules: { ...jsxA11y.flatConfigs.recommended.rules } }),
  // SonarJS: bug patterns + maintainability (the "SONAR" ruleset, local).
  asWarnings(sonarjs.configs.recommended),
  // eslint-plugin-security: Node/JS security anti-patterns.
  asWarnings(security.configs.recommended),
  // no-unsanitized: DOM-XSS sinks (innerHTML etc.).
  asWarnings(noUnsanitized.configs.recommended),

  {
    rules: {
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
      ".next/**",
      "node_modules/**",
      "prisma/migrations/**",
      "tmp/**",
    ],
  },
];

export default eslintConfig;
