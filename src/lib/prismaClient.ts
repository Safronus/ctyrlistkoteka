import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Builds a PrismaClient wired to the `pg` driver adapter.
 *
 * Prisma 7 removed the Rust query engine, so `new PrismaClient()` with no
 * arguments is a type error — every client needs an adapter. This factory
 * keeps that wiring in one place instead of repeating it in `src/lib/db.ts`
 * and each of the four CLI scripts.
 *
 * `max` defaults to 1 because the callers that pass nothing are the
 * short-lived CLI scripts (sync, seed, watermark, diagnostics): they run one
 * query at a time and a bigger pool would just hold idle connections open
 * against production while a multi-hour sync grinds through. The long-lived
 * web app overrides it — see `src/lib/db.ts`.
 */
export function createPrismaClient(
  options: { max?: number; log?: boolean } = {},
): PrismaClient {
  const { max = 1, log = false } = options;
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max,
    idleTimeoutMillis: 30_000,
  });
  return new PrismaClient({
    adapter,
    log: log ? ["query", "error", "warn"] : ["error"],
  });
}
