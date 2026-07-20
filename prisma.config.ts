import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 configuration.
 *
 * Two things changed in v7 that make this file mandatory:
 *
 *  1. The schema path and migration settings moved out of package.json /
 *     CLI flags into this config.
 *  2. Prisma no longer loads `.env` by itself. Without the `dotenv/config`
 *     import above, `prisma migrate deploy` and `prisma generate` would see
 *     no DATABASE_URL — which is exactly what the VPS deploy runs before
 *     every build.
 *
 * Note the app itself does NOT rely on this file at runtime: `src/lib/db.ts`
 * reads DATABASE_URL from the environment that PM2 provides. This config is
 * for the CLI only.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  // v7 removed `url` from the schema's datasource block, so the CLI reads
  // it here instead (used by `migrate deploy`, `migrate dev`, `db pull`…).
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
