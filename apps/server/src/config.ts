import path from "node:path";

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: process.env.DATA_DIR ?? path.resolve("data"),
  webDist: process.env.WEB_DIST ?? path.resolve(import.meta.dirname, "../../web/dist"),
  migrationsDir: process.env.MIGRATIONS_DIR ?? path.resolve(import.meta.dirname, "../drizzle"),
};
