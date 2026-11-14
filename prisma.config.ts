import { defineConfig } from "prisma/config";

/**
 * Prisma 7 configuration. The datasource URL comes from DATABASE_URL
 * (see .env.example); the fallback keeps `prisma generate` working in
 * environments that only generate the client without a live database.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://postgres@127.0.0.1:5432/blackbox?schema=public",
  },
  migrations: {
    path: "prisma/migrations",
  },
});
