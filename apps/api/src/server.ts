import { createDatabase, migrateDatabase } from '@ai-pixel/db';
import { serve } from '@hono/node-server';
import { loadRuntime } from '../../../scripts/runtime.js';
import { createApp, initializeOwner } from './app.js';

const runtime = loadRuntime();
const database = createDatabase(runtime.databaseUrl);
await migrateDatabase(database);
await initializeOwner(database);
const app = createApp({ database, config: {
  ...runtime, sessionTtlSeconds: 28_800, cookieSecure: new URL(runtime.appOrigin).protocol === 'https:',
  ssePollMs: 1000, sseHeartbeatMs: 15_000, sseBatchSize: 1000, sseRetentionDays: 30,
  loginMaxAttempts: 10, loginWindowMs: 60_000,
} });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.API_PORT ?? 3001) });
console.log('AI Pixel API: http://127.0.0.1:3001 (Phase 0, local only)');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  await database.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
