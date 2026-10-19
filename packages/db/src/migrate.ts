import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { Database } from "./index.js";

/** Atomic, serialized migrations. Changed historical SQL is rejected rather than silently reapplied. */
export async function migrateDatabase(database: Database): Promise<void> {
  const directory = new URL("../migrations/", import.meta.url);
  const names = (await readdir(directory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const migrations = await Promise.all(names.map(async (name) => {
    const source = await readFile(new URL(name, directory), "utf8");
    return { name, source, checksum: createHash("sha256").update(source).digest("hex") };
  }));
  await database.sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('ai-pixel-company:migrations'))`;
    await tx`CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
    for (const migration of migrations) {
      const rows = await tx<{ checksum: string }[]>`SELECT checksum FROM app_migrations WHERE name = ${migration.name}`;
      if (rows[0]) {
        if (rows[0].checksum !== migration.checksum) throw new Error(`Historical migration checksum mismatch: ${migration.name}`);
        continue;
      }
      await tx.unsafe(migration.source);
      await tx`INSERT INTO app_migrations (name,checksum) VALUES (${migration.name},${migration.checksum})`;
    }
  });
}
