import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Server-side Prisma singleton (node runtime only — API route handlers).
 * Returns null when DATABASE_URL is not configured so the app can keep
 * running with localStorage-only persistence.
 */
const globalForPrisma = globalThis as unknown as { __blackboxPrisma?: PrismaClient };

export function getDb(): PrismaClient | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!globalForPrisma.__blackboxPrisma) {
    const adapter = new PrismaPg({ connectionString: url });
    globalForPrisma.__blackboxPrisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.__blackboxPrisma;
}

/** True when a DATABASE_URL is present in the server environment. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
