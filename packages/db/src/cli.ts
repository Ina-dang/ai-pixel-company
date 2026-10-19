import { createDatabase, migrateDatabase } from "./index.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exitCode = 1;
} else {
  const database = createDatabase(url, { max: 1 });
  try {
    await migrateDatabase(database);
    console.log("Database migrations applied");
  } catch {
    console.error("Database migration failed; inspect database connectivity and migration state without exposing credentials");
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}
