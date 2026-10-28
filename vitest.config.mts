import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    globals: false,
    server: {
      deps: {
        // next-intl's ESM build imports `next/server` without an extension,
        // which Node's resolver rejects; inlining sends it through Vite's
        // resolver instead (needed by src/middleware.test.ts).
        inline: ["next-intl"],
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
});
