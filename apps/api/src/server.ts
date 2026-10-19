import { createDatabase, migrateDatabase } from '@ai-pixel/db';
import { CodexSubscriptionProvider, DockerSandbox, WorkflowRunner } from '@ai-pixel/agents';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { loadRuntime } from '../../../scripts/runtime.js';
import { createApp, initializeOwner } from './app.js';
import { WorkflowRepository } from './workflows.js';
import { IntegrationService } from './integrations.js';
import { ReviewService } from './reviews.js';

const runtime = loadRuntime();
const database = createDatabase(runtime.databaseUrl);
await migrateDatabase(database);
await initializeOwner(database);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const integrations = new IntegrationService(database, root);
await integrations.configureFromLocalFile();
const provider = new CodexSubscriptionProvider(root);
const reviews = new ReviewService(database, provider);
const runner = new WorkflowRunner(new WorkflowRepository(database), provider, new DockerSandbox(`${root}/.local/agent-workspaces`));
const app = createApp({ database, workflowProvider: provider, integrations, reviews, config: {
  ...runtime, sessionTtlSeconds: 28_800, cookieSecure: new URL(runtime.appOrigin).protocol === 'https:',
  ssePollMs: 1000, sseHeartbeatMs: 15_000, sseBatchSize: 1000, sseRetentionDays: 30,
  loginMaxAttempts: 10, loginWindowMs: 60_000,
} });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.API_PORT ?? 3001) });
await runner.start();
await integrations.start();
await reviews.start();
console.log('AI Pixel API: http://127.0.0.1:3001 (Codex subscription workers, local only)');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  await reviews.stop();
  await runner.stop();
  await integrations.stop();
  await database.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
