import { createDatabase, migrateDatabase } from '@ai-pixel/db';
import { CodexSubscriptionProvider, DockerSandbox, RepositorySandbox, WorkflowRunner } from '@ai-pixel/agents';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { loadRuntime } from '../../../scripts/runtime.js';
import { createApp, initializeOwner } from './app.js';
import { WorkflowRepository } from './workflows.js';
import { IntegrationService } from './integrations.js';
import { ReviewService } from './reviews.js';
import {OperationsService} from './operations.js';
import {BackupManager,dockerCommand} from './operations-backup.js';
import { VoiceService } from './voice.js';

const runtime = loadRuntime();
const database = createDatabase(runtime.databaseUrl);
await migrateDatabase(database);
await initializeOwner(database);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const integrations = new IntegrationService(database, root);
const voice = new VoiceService(database, root);
await integrations.configureFromLocalFile();
const provider = new CodexSubscriptionProvider(root);
const reviews = new ReviewService(database, provider);
const fixtureSandbox = new DockerSandbox(`${root}/.local/agent-workspaces`);
const sandbox = Object.assign(fixtureSandbox, { forRun(run: import('@ai-pixel/agents').WorkflowRun) {
  if (run.fixture === 'how-to-trash-v1') {
    if (!run.repositorySource) throw new Error('Sandbox: REPOSITORY_SOURCE_MISSING');
    return new RepositorySandbox(root, run.repositorySource);
  }
  return fixtureSandbox;
} });
const runner = new WorkflowRunner(new WorkflowRepository(database), provider, sandbox);
const backup=new BackupManager(database,root,runtime.databaseUrl);
const operations=new OperationsService(database,root,async()=>{
  const now=new Date().toISOString(),status=await provider.status();let dockerReady=true,activeContainers=0,orphanedContainers=0;
  try{await dockerCommand(['info','--format','{{.ServerVersion}}'],undefined,5000);
    const rows=(await dockerCommand(['ps','-a','--filter','label=ai-pixel-run','--filter','name=^pixel-sandbox-','--format','{{.ID}}|{{.Label "ai-pixel-run"}}'],undefined,5000)).toString().trim().split('\n').filter(Boolean);
    activeContainers=rows.length;for(const row of rows){const id=row.split('|')[1];if(!/^[a-f0-9-]{36}$/.test(id??'')){orphanedContainers++;continue;}if(!(await database.sql`select 1 from workflow_runs where id=${id} and status='RUNNING'`).length)orphanedContainers++;}
  }catch{dockerReady=false;}
  return{provider:{ready:status.ready,code:status.reason,checkedAt:now},sandbox:{ready:dockerReady,code:dockerReady?null:'DOCKER_UNAVAILABLE',checkedAt:now,activeContainers,orphanedContainers},workers:{workflow:runner.health(),reviews:reviews.health(),integrations:integrations.health()}};
},backup.execute);
const app = createApp({ database, workflowProvider: provider, integrations, reviews, operations,voice,structuredLogs:true, config: {
  ...runtime, sessionTtlSeconds: 28_800, cookieSecure: new URL(runtime.appOrigin).protocol === 'https:',
  ssePollMs: 1000, sseHeartbeatMs: 15_000, sseBatchSize: 1000, sseRetentionDays: 30,
  loginMaxAttempts: 10, loginWindowMs: 60_000,
} });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.API_PORT ?? 3001) });
await runner.start();
await integrations.start();
await reviews.start();
await operations.start();
await voice.start();
console.log('AI Pixel API: http://127.0.0.1:3001 (Codex subscription workers, local only)');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  await operations.stop();
  await voice.stop();
  await reviews.stop();
  await runner.stop();
  await integrations.stop();
  await database.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// A local supervisor can request graceful shutdown over its private child IPC.
if (process.connected) {
  process.on('message', message => { if (message && typeof message === 'object' && 'type' in message && message.type === 'ai-pixel.shutdown') void stop(); });
  process.on('disconnect', () => { void stop(); });
}
