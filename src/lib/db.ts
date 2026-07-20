import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "@/lib/prismaClient";

// Prevents multiple PrismaClient instances during Next.js HMR in development.
// https://www.prisma.io/docs/guides/other/troubleshooting-orm/help-articles/nextjs-prisma-client-dev-practices

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * The long-lived web client. Pool size is pinned explicitly rather than left
 * to the driver default: the app runs under PM2 **cluster mode**, so live
 * connections are `max` × workers and they all share Postgres'
 * `max_connections`. Under Prisma 6 the Rust engine managed this; with the
 * v7 driver adapter it's ours to get right.
 */
export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient({ max: 5, log: process.env.NODE_ENV === "development" });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
