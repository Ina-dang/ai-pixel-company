import { createDatabase, migrateDatabase } from '@ai-pixel/db';
import { loadRuntime } from './runtime.js';

const database = createDatabase(loadRuntime().databaseUrl);
try {
  await migrateDatabase(database);
  console.log('데이터베이스 migration 완료');
} finally {
  await database.close();
}
